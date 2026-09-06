import { pool } from "@workspace/db";
import { authorityForAction, type AutonomyRisk } from "./constitution";

export interface BusinessEventInput {
  organizationId?: string | null;
  userId?: number | null;
  visitorId?: string | null;
  sessionId?: string | null;
  eventType: string;
  actorType?: string;
  actorId?: string | null;
  source?: string | null;
  campaign?: string | null;
  experimentId?: string | null;
  variant?: string | null;
  valueCents?: number | null;
  properties?: Record<string, unknown>;
  dedupeKey?: string | null;
  occurredAt?: Date;
}

export async function recordBusinessEvent(input: BusinessEventInput): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_events (
      organization_id, user_id, visitor_id, session_id, event_type,
      actor_type, actor_id, source, campaign, experiment_id, variant,
      value_cents, properties, dedupe_key, occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`,
    [
      input.organizationId ?? null,
      input.userId ?? null,
      input.visitorId ?? null,
      input.sessionId ?? null,
      input.eventType,
      input.actorType ?? "system",
      input.actorId ?? null,
      input.source ?? null,
      input.campaign ?? null,
      input.experimentId ?? null,
      input.variant ?? null,
      input.valueCents ?? null,
      JSON.stringify(input.properties ?? {}),
      input.dedupeKey ?? null,
      input.occurredAt ?? new Date(),
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function startAutonomyRun(runType: string, trigger: string, objective: string, scoreBefore?: number): Promise<string> {
  if (!pool) throw new Error("Database is required for autonomy runs");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO autonomy_runs (run_type, trigger, objective, objective_score_before)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [runType, trigger, objective, scoreBefore ?? null],
  );
  return result.rows[0].id;
}

export async function finishAutonomyRun(
  runId: string,
  status: "completed" | "failed" | "blocked",
  result: unknown,
  scoreAfter?: number,
  errorMessage?: string,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE autonomy_runs
     SET status=$2, result=$3::jsonb, objective_score_after=$4, error_message=$5, finished_at=now()
     WHERE id=$1`,
    [runId, status, JSON.stringify(result ?? {}), scoreAfter ?? null, errorMessage ?? null],
  );
}

export async function updateRunPlan(runId: string, plan: unknown): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE autonomy_runs SET plan=$2::jsonb WHERE id=$1`, [runId, JSON.stringify(plan ?? {})]);
}

export async function recordAutonomousAction(params: {
  runId?: string | null;
  agent: string;
  actionType: string;
  riskLevel: AutonomyRisk;
  status?: string;
  reversible?: boolean;
  input?: unknown;
  output?: unknown;
  expectedImpact?: unknown;
  externalRef?: string | null;
  costCents?: number;
}): Promise<{ id: string; authority: string }> {
  if (!pool) throw new Error("Database is required for autonomy actions");
  const authority = authorityForAction(params.actionType, params.riskLevel);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO autonomous_actions (
      run_id, agent, action_type, risk_level, authority, status, reversible,
      input, output, expected_impact, external_ref, cost_cents
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
    RETURNING id`,
    [
      params.runId ?? null,
      params.agent,
      params.actionType,
      params.riskLevel,
      authority,
      params.status ?? (authority === "founder" ? "awaiting_founder" : authority === "forbidden" ? "blocked" : "planned"),
      params.reversible ?? true,
      JSON.stringify(params.input ?? {}),
      JSON.stringify(params.output ?? {}),
      JSON.stringify(params.expectedImpact ?? {}),
      params.externalRef ?? null,
      params.costCents ?? 0,
    ],
  );
  return { id: result.rows[0].id, authority };
}

export async function markActionExecuted(actionId: string, output: unknown, externalRef?: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE autonomous_actions SET status='executed', output=$2::jsonb, external_ref=COALESCE($3, external_ref), executed_at=now() WHERE id=$1`,
    [actionId, JSON.stringify(output ?? {}), externalRef ?? null],
  );
}

export async function markActionFailed(actionId: string, output: unknown): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE autonomous_actions SET status='failed', output=$2::jsonb WHERE id=$1`,
    [actionId, JSON.stringify(output ?? {})],
  );
}
