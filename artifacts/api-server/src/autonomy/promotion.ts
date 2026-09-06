import { pool } from "@workspace/db";
import { getPullRequestGate, mergePullRequest, revertHeadCommitIfUnchanged } from "./github";
import { codeWritesEnabled } from "./constitution";

function autoMergeEnabled(): boolean {
  return codeWritesEnabled() && (process.env.AUTONOMY_AUTO_MERGE_CODE === "1" || process.env.AUTONOMY_AUTO_MERGE_CODE === "true");
}

function allowNoChecks(): boolean {
  return process.env.AUTONOMY_ALLOW_MERGE_WITHOUT_CHECKS === "1" || process.env.AUTONOMY_ALLOW_MERGE_WITHOUT_CHECKS === "true";
}

export async function promoteReadyProductRepairs(): Promise<{ merged: number; waiting: number; blocked: number }> {
  if (!pool || !autoMergeEnabled()) return { merged: 0, waiting: 0, blocked: 0 };
  const actions = await pool.query(
    `SELECT id, output, external_ref FROM autonomous_actions
     WHERE action_type='code.product_fix' AND status='executed' AND external_ref IS NOT NULL
     ORDER BY executed_at ASC LIMIT 10`,
  );
  let merged = 0;
  let waiting = 0;
  let blocked = 0;

  for (const row of actions.rows) {
    const output = row.output ?? {};
    const prNumber = Number(output.prNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0) { blocked += 1; continue; }
    try {
      const gate = await getPullRequestGate(prNumber);
      if (!gate.mergeable) { waiting += 1; continue; }
      if (!gate.checksSuccessful || (!gate.checksPresent && !allowNoChecks())) { waiting += 1; continue; }
      const result = await mergePullRequest(prNumber, gate.headSha);
      if (!result.merged || !result.sha) { waiting += 1; continue; }
      await pool.query(
        `UPDATE autonomous_actions
         SET status='merged_monitoring', output=output || $2::jsonb, executed_at=now()
         WHERE id=$1`,
        [row.id, JSON.stringify({ mergeSha: result.sha, mergedAt: new Date().toISOString() })],
      );
      await pool.query(
        `UPDATE product_findings SET status='monitoring', updated_at=now()
         WHERE github_pr_url=$1`,
        [row.external_ref],
      );
      merged += 1;
    } catch {
      waiting += 1;
    }
  }
  return { merged, waiting, blocked };
}

async function currentMetricForAction(input: any, mergedAt: Date): Promise<{ value: number; sample: number } | null> {
  if (!pool) return null;
  const finding = input ?? {};
  const fingerprint = String(finding.fingerprint ?? "");
  if (fingerprint.startsWith("tool-failure:")) {
    const tool = fingerprint.slice("tool-failure:".length);
    const result = await pool.query(
      `SELECT COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE status IN ('error','failed') OR error_message IS NOT NULL)::int AS failures
       FROM tool_calls WHERE tool_name=$1 AND created_at >= $2`,
      [tool, mergedAt],
    );
    const calls = Number(result.rows[0]?.calls ?? 0);
    const failures = Number(result.rows[0]?.failures ?? 0);
    return calls ? { value: failures / calls, sample: calls } : null;
  }
  if (fingerprint === "tool-latency:global") {
    const result = await pool.query(
      `SELECT COUNT(duration_ms)::int AS sample, COALESCE(AVG(duration_ms),0)::float AS value
       FROM tool_calls WHERE duration_ms IS NOT NULL AND created_at >= $1`,
      [mergedAt],
    );
    return { value: Number(result.rows[0]?.value ?? 0), sample: Number(result.rows[0]?.sample ?? 0) };
  }
  if (fingerprint === "voice-session:no-successful-tool") {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS sessions,
              COUNT(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM tool_calls tc
                WHERE tc.session_id=vs.id AND tc.created_at >= $1
                  AND tc.status NOT IN ('error','failed') AND tc.error_message IS NULL
              ))::int AS no_success
       FROM voice_sessions vs WHERE vs.created_at >= $1`,
      [mergedAt],
    );
    const sessions = Number(result.rows[0]?.sessions ?? 0);
    const failures = Number(result.rows[0]?.no_success ?? 0);
    return sessions ? { value: failures / sessions, sample: sessions } : null;
  }
  return null;
}

function baselineForFinding(input: any): number | null {
  const evidence = Array.isArray(input?.evidence) ? input.evidence[0] : null;
  if (!evidence) return null;
  if (typeof evidence.failureRate === "number") return evidence.failureRate;
  if (typeof evidence.averageToolLatencyMs === "number") return evidence.averageToolLatencyMs;
  if (typeof evidence.rate === "number") return evidence.rate;
  return null;
}

export async function evaluateMergedProductRepairs(): Promise<{ validated: number; reverted: number; monitoring: number }> {
  if (!pool || !codeWritesEnabled()) return { validated: 0, reverted: 0, monitoring: 0 };
  const rows = await pool.query(
    `SELECT id, input, output, external_ref, executed_at
     FROM autonomous_actions
     WHERE action_type='code.product_fix' AND status='merged_monitoring'
       AND executed_at <= now()-interval '60 minutes'
     ORDER BY executed_at ASC LIMIT 10`,
  );
  let validated = 0;
  let reverted = 0;
  let monitoring = 0;

  for (const row of rows.rows) {
    const mergedAt = new Date(row.output?.mergedAt ?? row.executed_at);
    const mergeSha = String(row.output?.mergeSha ?? "");
    const baseline = baselineForFinding(row.input);
    const current = await currentMetricForAction(row.input, mergedAt);
    if (baseline === null || !current || current.sample < 10) { monitoring += 1; continue; }

    const ageHours = (Date.now() - mergedAt.getTime()) / 3_600_000;
    const worse = baseline === 0 ? current.value > 0 : current.value > baseline * 1.2;
    if (worse && mergeSha) {
      const rollback = await revertHeadCommitIfUnchanged(
        mergeSha,
        `revert(autonomy): telemetry regression after ${String(row.input?.fingerprint ?? "product repair")}`,
      );
      if (rollback.reverted) {
        await pool.query(
          `UPDATE autonomous_actions SET status='rolled_back', rolled_back_at=now(), actual_impact=$2::jsonb WHERE id=$1`,
          [row.id, JSON.stringify({ baseline, current: current.value, sample: current.sample, rollbackSha: rollback.sha })],
        );
        await pool.query(`UPDATE product_findings SET status='open', updated_at=now() WHERE github_pr_url=$1`, [row.external_ref]);
        reverted += 1;
        continue;
      }
      await pool.query(
        `UPDATE autonomous_actions SET status='needs_founder', actual_impact=$2::jsonb WHERE id=$1`,
        [row.id, JSON.stringify({ baseline, current: current.value, sample: current.sample, rollbackBlocked: rollback.reason })],
      );
      monitoring += 1;
      continue;
    }

    if (ageHours >= 24) {
      const improved = baseline === 0 ? current.value === 0 : current.value <= baseline * 0.9;
      await pool.query(
        `UPDATE autonomous_actions SET status='validated', actual_impact=$2::jsonb WHERE id=$1`,
        [row.id, JSON.stringify({ baseline, current: current.value, sample: current.sample, improved })],
      );
      await pool.query(
        `UPDATE product_findings SET status=$2, updated_at=now() WHERE github_pr_url=$1`,
        [row.external_ref, improved ? "resolved" : "monitoring_no_clear_change"],
      );
      validated += 1;
    } else {
      monitoring += 1;
    }
  }
  return { validated, reverted, monitoring };
}
