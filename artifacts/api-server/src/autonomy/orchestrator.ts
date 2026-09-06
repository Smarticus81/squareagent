import { pool } from "@workspace/db";
import { autonomyEnabled, VOYCELAB_OBJECTIVE } from "./constitution";
import { collectBusinessSnapshot, objectiveScore } from "./metrics";
import { createAutonomyPlan } from "./planner";
import { detectProductFindings, highestPriorityFinding, persistProductFindings } from "./product-diagnostics";
import { generateProductRepair } from "./product-engineer";
import { researchProspects, runOutboundBatch } from "./growth";
import { runActivationInterventions } from "./activation";
import { runSupportInbox } from "./support";
import { evaluateExperiments } from "./experiments";
import { evaluateMergedProductRepairs, promoteReadyProductRepairs } from "./promotion";
import { finishAutonomyRun, startAutonomyRun, updateRunPlan } from "./ledger";

export interface AutonomyCycleResult {
  enabled: boolean;
  runId?: string;
  before?: unknown;
  after?: unknown;
  plan?: unknown;
  product?: unknown;
  growth?: unknown;
  activation?: unknown;
  support?: unknown;
  experiments?: unknown;
  promotion?: unknown;
}

async function snapshotMetrics(snapshot: Awaited<ReturnType<typeof collectBusinessSnapshot>>): Promise<void> {
  if (!pool) return;
  const rows: Array<[string, number, number | null, number | null]> = [
    ["objective_score", objectiveScore(snapshot), null, null],
    ["mrr_cents", snapshot.revenue.mrrCents, null, null],
    ["visitor_to_signup", Math.round(snapshot.funnel.visitorToSignup * 1000), snapshot.funnel.signups, snapshot.funnel.visitors],
    ["signup_to_connect", Math.round(snapshot.funnel.signupToConnect * 1000), snapshot.funnel.squareConnected, snapshot.funnel.signups],
    ["connect_to_activation", Math.round(snapshot.funnel.connectToActivation * 1000), snapshot.funnel.activated, snapshot.funnel.squareConnected],
    ["activation_to_paid", Math.round(snapshot.funnel.activationToPaid * 1000), snapshot.funnel.paid, snapshot.funnel.activated],
    ["tool_failure_rate", Math.round(snapshot.product.toolFailureRate * 1000), snapshot.product.toolFailures, snapshot.product.toolCalls],
    ["no_successful_tool_session_rate", Math.round(snapshot.product.noSuccessfulToolRate * 1000), snapshot.product.sessionsWithNoSuccessfulTool, snapshot.product.voiceSessions],
  ];
  for (const [metric, value, numerator, denominator] of rows) {
    await pool.query(
      `INSERT INTO metric_snapshots (metric_name,value_milli,numerator,denominator,dimensions) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [metric, value, numerator, denominator, JSON.stringify({ windowDays: snapshot.windowDays })],
    );
  }
}

function materiallyDegraded(snapshot: Awaited<ReturnType<typeof collectBusinessSnapshot>>): boolean {
  return (snapshot.product.toolCalls >= 20 && snapshot.product.toolFailureRate >= 0.12)
    || (snapshot.product.voiceSessions >= 10 && snapshot.product.noSuccessfulToolRate >= 0.2);
}

async function eligibleLeadCount(): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM prospect_leads
     WHERE stage IN ('new','nurture','contacted') AND stage <> 'do_not_contact'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function runAutonomyCycle(trigger = "scheduler"): Promise<AutonomyCycleResult> {
  if (!autonomyEnabled()) return { enabled: false };
  const before = await collectBusinessSnapshot(30);
  const beforeScore = objectiveScore(before);
  const runId = await startAutonomyRun("strategy", trigger, VOYCELAB_OBJECTIVE.northStar, beforeScore);

  try {
    const plan = await createAutonomyPlan(before);
    await updateRunPlan(runId, plan);

    const findings = await persistProductFindings(detectProductFindings(before), runId);
    const topFinding = highestPriorityFinding(findings);

    const promotion = {
      ...(await promoteReadyProductRepairs()),
      monitoring: await evaluateMergedProductRepairs(),
    };
    const experiments = await evaluateExperiments();

    const requested = new Set(plan.actions.map((action) => action.actionType));
    let product: unknown = { findings: findings.length };
    if (topFinding && (requested.has("code.product_fix") || materiallyDegraded(before))) {
      product = { findings: findings.length, topFinding: topFinding.fingerprint, repair: await generateProductRepair(topFinding, runId) };
    }

    // Acquisition has a deterministic floor: keep a healthy qualified prospect
    // pool even when the strategy model is focused elsewhere. Actual outbound is
    // paused while product reliability is materially degraded so we do not buy
    // or create demand for a broken experience.
    const leadCount = await eligibleLeadCount();
    let growth: Record<string, unknown> = { eligibleLeadCountBefore: leadCount };
    if (requested.has("growth.research") || leadCount < 20) {
      growth.research = await researchProspects(runId);
    }
    if (!materiallyDegraded(before)) {
      growth.outbound = await runOutboundBatch(runId);
    } else {
      growth.outbound = { paused: "product_reliability_veto" };
    }

    // Activation and support are continuous service loops rather than one-off
    // experiments; run a bounded batch every strategy cycle even when the CEO
    // planner is focused elsewhere.
    const activation = await runActivationInterventions(runId);
    const support = await runSupportInbox(runId);

    const after = await collectBusinessSnapshot(30);
    const afterScore = objectiveScore(after);
    await snapshotMetrics(after);

    const result = { enabled: true, runId, before, after, plan, product, growth, activation, support, experiments, promotion };
    await finishAutonomyRun(runId, "completed", result, afterScore);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishAutonomyRun(runId, "failed", { error: message }, undefined, message);
    throw error;
  }
}

/**
 * Cross-instance lock for Railway horizontal scaling. A dedicated pg client
 * holds the advisory lock for the duration of the cycle; other instances skip.
 */
export async function runAutonomyCycleLocked(trigger = "scheduler"): Promise<AutonomyCycleResult | { enabled: true; skipped: "already_running" }> {
  if (!autonomyEnabled()) return { enabled: false };
  if (!pool) return runAutonomyCycle(trigger);
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(82651231) AS locked`);
    if (!lock.rows[0]?.locked) return { enabled: true, skipped: "already_running" };
    return await runAutonomyCycle(trigger);
  } finally {
    try { await client.query(`SELECT pg_advisory_unlock(82651231)`); } catch { /* connection teardown releases it */ }
    client.release();
  }
}
