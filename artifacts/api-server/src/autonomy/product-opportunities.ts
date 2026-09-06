import { readFile } from "fs/promises";
import path from "path";
import { pool } from "@workspace/db";
import type { BusinessSnapshot } from "./metrics";
import { structuredModel } from "./openai";
import type { ProductFinding } from "./product-engineer";

type UpgradeMetric =
  | "visitor_to_signup"
  | "signup_to_connect"
  | "connect_to_activation"
  | "activation_to_paid"
  | "tool_failure_rate"
  | "no_successful_tool_session_rate"
  | "mrr_cents";

interface UpgradeOpportunity {
  slug: string;
  title: string;
  description: string;
  priority: number;
  confidence: number;
  effort: "small" | "medium" | "large";
  risk: "low" | "medium" | "high";
  whyNow: string[];
  successMetric: UpgradeMetric;
  implementationHint: string;
}

const UPGRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["opportunities"],
  properties: {
    opportunities: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "title", "description", "priority", "confidence", "effort", "risk", "whyNow", "successMetric", "implementationHint"],
        properties: {
          slug: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "number", minimum: 0, maximum: 100 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          effort: { type: "string", enum: ["small", "medium", "large"] },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          whyNow: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
          successMetric: {
            type: "string",
            enum: ["visitor_to_signup", "signup_to_connect", "connect_to_activation", "activation_to_paid", "tool_failure_rate", "no_successful_tool_session_rate", "mrr_cents"],
          },
          implementationHint: { type: "string" },
        },
      },
    },
  },
} as const;

async function capabilities(): Promise<string> {
  try {
    const text = await readFile(path.resolve(process.cwd(), "CAPABILITIES.md"), "utf8");
    return text.slice(0, 34_000);
  } catch {
    return "VoyceLab is a Square-connected voice operations platform for hospitality with POS, reporting, inventory, catalog, customer/payment and team/labor workflows.";
  }
}

async function recentlyAudited(): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `SELECT 1 FROM autonomy_opportunities
     WHERE kind='product_upgrade' AND created_at >= now()-interval '7 days' LIMIT 1`,
  );
  return Boolean(result.rowCount);
}

function baselineForMetric(snapshot: BusinessSnapshot, metric: UpgradeMetric): number {
  switch (metric) {
    case "visitor_to_signup": return snapshot.funnel.visitorToSignup;
    case "signup_to_connect": return snapshot.funnel.signupToConnect;
    case "connect_to_activation": return snapshot.funnel.connectToActivation;
    case "activation_to_paid": return snapshot.funnel.activationToPaid;
    case "tool_failure_rate": return snapshot.product.toolFailureRate;
    case "no_successful_tool_session_rate": return snapshot.product.noSuccessfulToolRate;
    case "mrr_cents": return snapshot.revenue.mrrCents;
  }
}

function directionForMetric(metric: UpgradeMetric): "higher" | "lower" {
  return metric === "tool_failure_rate" || metric === "no_successful_tool_session_rate" ? "lower" : "higher";
}

export async function discoverProductUpgrades(snapshot: BusinessSnapshot, runId?: string): Promise<UpgradeOpportunity[]> {
  if (!pool || await recentlyAudited()) return [];

  const recentSupport = await pool.query(
    `SELECT event_type, properties FROM business_events
     WHERE event_type IN ('support_opened','support_escalated')
       AND occurred_at >= now()-interval '30 days'
     ORDER BY occurred_at DESC LIMIT 80`,
  );

  const result = await structuredModel<{ opportunities: UpgradeOpportunity[] }>(
    [
      "You are VoyceLab's product intelligence agent.",
      "Use the supplied production telemetry, recent support signals, current product capabilities, and current public web information to identify concrete product upgrades that could materially improve activation, retention, revenue, reliability or differentiation.",
      "VoyceLab serves hospitality operators and is currently centered on Square-connected voice operations. Do not recommend generic AI features merely because competitors mention them.",
      "Prefer evidence-backed improvements that can be shipped incrementally and measured. Distinguish a real customer workflow improvement from marketing copy.",
      "Choose exactly one permitted successMetric that should move if the upgrade works. Funnel/MRR metrics should rise; reliability failure metrics should fall.",
      "Do not propose weakening auth, permissions, billing, encryption, confirmation safety, privacy, audit logging or secret handling.",
      "Risk=high for anything touching money movement, destructive data changes, identity/access, credentials, or broad architectural migration. Such opportunities may be recorded but will not be autonomously implemented.",
      "Priority is expected durable customer/business impact divided by effort and risk.",
    ].join("\n"),
    {
      snapshot,
      supportSignals: recentSupport.rows,
      capabilities: await capabilities(),
      marketQuestion: "What high-value voice operations capabilities, UX improvements, workflow improvements, or integrations are hospitality operators adopting or asking for now?",
    },
    {
      schemaName: "voycelab_product_upgrade_opportunities",
      schema: UPGRADE_SCHEMA as unknown as Record<string, unknown>,
      useWebSearch: true,
      reasoningEffort: "medium",
      maxOutputTokens: 4200,
    },
  );

  for (const opportunity of result.opportunities) {
    const slug = opportunity.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
    if (!slug) continue;
    await pool.query(
      `INSERT INTO autonomy_opportunities (
        source_run_id,kind,status,title,description,priority_score,confidence_milli,
        estimated_impact,evidence,recommendation,effort,risk_level
       ) VALUES ($1,'product_upgrade','open',$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
      [
        runId ?? null,
        opportunity.title,
        opportunity.description,
        Math.round(opportunity.priority),
        Math.round(opportunity.confidence * 1000),
        JSON.stringify({
          successMetric: opportunity.successMetric,
          baseline: baselineForMetric(snapshot, opportunity.successMetric),
          direction: directionForMetric(opportunity.successMetric),
        }),
        JSON.stringify(opportunity.whyNow),
        JSON.stringify({ slug, implementationHint: opportunity.implementationHint }),
        opportunity.effort,
        opportunity.risk,
      ],
    );
  }
  return result.opportunities;
}

export function bestAutonomousUpgrade(opportunities: UpgradeOpportunity[], snapshot: BusinessSnapshot): ProductFinding | null {
  const candidate = [...opportunities]
    .filter((item) => item.risk !== "high" && item.effort !== "large" && item.priority >= 70 && item.confidence >= 0.65)
    .sort((a, b) => b.priority * b.confidence - a.priority * a.confidence)[0];
  if (!candidate) return null;
  const baseline = baselineForMetric(snapshot, candidate.successMetric);
  const direction = directionForMetric(candidate.successMetric);
  return {
    fingerprint: `product-upgrade:${candidate.slug}`,
    severity: "medium",
    subsystem: candidate.implementationHint.slice(0, 180),
    title: `Product upgrade: ${candidate.title}`,
    evidence: [
      { metric: candidate.successMetric, baseline, direction },
      ...candidate.whyNow,
    ],
    recommendedChange: {
      description: candidate.description,
      successMetric: candidate.successMetric,
      baseline,
      direction,
      implementationHint: candidate.implementationHint,
    },
  };
}
