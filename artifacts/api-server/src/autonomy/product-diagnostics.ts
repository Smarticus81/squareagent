import { pool } from "@workspace/db";
import type { BusinessSnapshot } from "./metrics";
import type { ProductFinding } from "./product-engineer";

function severityForRate(rate: number): ProductFinding["severity"] {
  if (rate >= 0.35) return "critical";
  if (rate >= 0.2) return "high";
  if (rate >= 0.1) return "medium";
  return "low";
}

export function detectProductFindings(snapshot: BusinessSnapshot): ProductFinding[] {
  const findings: ProductFinding[] = [];

  for (const tool of snapshot.product.topFailingTools) {
    if (tool.failures < 3 || tool.rate < 0.08) continue;
    findings.push({
      fingerprint: `tool-failure:${tool.tool}`,
      severity: severityForRate(tool.rate),
      subsystem: `tool:${tool.tool}`,
      title: `${tool.tool} is failing in ${(tool.rate * 100).toFixed(1)}% of recent calls`,
      evidence: [{ calls: tool.calls, failures: tool.failures, failureRate: tool.rate, windowDays: snapshot.windowDays }],
      recommendedChange: { objective: "identify root cause, add regression coverage, reduce failure rate without increasing latency" },
    });
  }

  if (snapshot.product.toolCalls >= 20 && snapshot.product.averageToolLatencyMs >= 1_800) {
    findings.push({
      fingerprint: "tool-latency:global",
      severity: snapshot.product.averageToolLatencyMs >= 3_000 ? "high" : "medium",
      subsystem: "tool-middleware-and-provider-clients",
      title: `Average tool latency is ${snapshot.product.averageToolLatencyMs} ms`,
      evidence: [{ averageToolLatencyMs: snapshot.product.averageToolLatencyMs, toolCalls: snapshot.product.toolCalls, windowDays: snapshot.windowDays }],
      recommendedChange: { objective: "reduce time-to-result while preserving retries, idempotency and audit logging" },
    });
  }

  if (snapshot.product.voiceSessions >= 10 && snapshot.product.noSuccessfulToolRate >= 0.15) {
    findings.push({
      fingerprint: "voice-session:no-successful-tool",
      severity: severityForRate(snapshot.product.noSuccessfulToolRate),
      subsystem: "realtime-voice-tool-loop",
      title: `${(snapshot.product.noSuccessfulToolRate * 100).toFixed(1)}% of voice sessions complete without a successful tool call`,
      evidence: [{ voiceSessions: snapshot.product.voiceSessions, sessionsWithNoSuccessfulTool: snapshot.product.sessionsWithNoSuccessfulTool, rate: snapshot.product.noSuccessfulToolRate }],
      recommendedChange: { objective: "improve successful voice-to-action completion without loosening confirmation or permissions" },
    });
  }

  return findings;
}

export async function persistProductFindings(findings: ProductFinding[], runId?: string): Promise<ProductFinding[]> {
  if (!pool || !findings.length) return findings;
  const persisted: ProductFinding[] = [];
  for (const finding of findings) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO product_findings (
        source_run_id, fingerprint, severity, subsystem, title, evidence, recommended_change
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
      ON CONFLICT (fingerprint) DO UPDATE SET
        source_run_id=EXCLUDED.source_run_id,
        severity=EXCLUDED.severity,
        subsystem=EXCLUDED.subsystem,
        title=EXCLUDED.title,
        evidence=EXCLUDED.evidence,
        recommended_change=EXCLUDED.recommended_change,
        status=CASE WHEN product_findings.status IN ('resolved','dismissed') THEN product_findings.status ELSE 'open' END,
        updated_at=now()
      RETURNING id`,
      [runId ?? null, finding.fingerprint, finding.severity, finding.subsystem, finding.title, JSON.stringify(finding.evidence), JSON.stringify(finding.recommendedChange ?? {})],
    );
    persisted.push({ ...finding, id: result.rows[0]?.id });
  }
  return persisted;
}

export function highestPriorityFinding(findings: ProductFinding[]): ProductFinding | undefined {
  const rank: Record<ProductFinding["severity"], number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return [...findings].sort((a, b) => rank[b.severity] - rank[a.severity])[0];
}
