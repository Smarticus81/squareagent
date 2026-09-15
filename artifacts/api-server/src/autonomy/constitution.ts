export type AutonomyRisk = "low" | "medium" | "high" | "critical";
export type AutonomyAuthority = "autonomous" | "canary" | "founder" | "forbidden";

export interface AutonomyBudget {
  maxOutboundPerDay: number;
  maxOutboundPerDomainPerDay: number;
  maxAdSpendCentsPerDay: number;
  maxAgentComputeCentsPerDay: number;
  maxAutoCreditCents: number;
  maxPriceTestPercent: number;
  maxCampaignBudgetIncreasePercent: number;
  codeCanaryPercent: number;
}

export const VOYCELAB_OBJECTIVE = Object.freeze({
  northStar: "maximize durable net new recurring revenue from customers who receive measurable product value",
  optimize: [
    "new_mrr",
    "expansion_mrr",
    "retained_mrr",
    "activation_rate",
    "customer_value_realization",
    "qualified_pipeline_value",
  ],
  minimize: [
    "cac",
    "churn",
    "refunds",
    "support_burden",
    "voice_compute_cost",
    "operational_risk",
  ],
  hardConstraints: [
    "never fabricate customers, testimonials, evidence, or product capabilities",
    "honor opt-out and communication preferences immediately",
    "never expose secrets or customer credentials to model context",
    "never weaken authentication, authorization, encryption, billing integrity, or audit logging autonomously",
    "prefer reversible changes and retain a complete action trail",
    "stop or roll back experiments that breach safety, reliability, complaint, or margin guardrails",
    "do not modify this objective or constitution autonomously",
  ],
});

export const DEFAULT_AUTONOMY_BUDGET: AutonomyBudget = Object.freeze({
  maxOutboundPerDay: Number(process.env.AUTONOMY_MAX_OUTBOUND_PER_DAY ?? 120),
  maxOutboundPerDomainPerDay: Number(process.env.AUTONOMY_MAX_OUTBOUND_PER_DOMAIN_DAY ?? 3),
  maxAdSpendCentsPerDay: Number(process.env.AUTONOMY_MAX_AD_SPEND_CENTS_DAY ?? 20_000),
  maxAgentComputeCentsPerDay: Number(process.env.AUTONOMY_MAX_AGENT_COMPUTE_CENTS_DAY ?? 5_000),
  maxAutoCreditCents: Number(process.env.AUTONOMY_MAX_AUTO_CREDIT_CENTS ?? 2_500),
  maxPriceTestPercent: Number(process.env.AUTONOMY_MAX_PRICE_TEST_PERCENT ?? 15),
  maxCampaignBudgetIncreasePercent: Number(process.env.AUTONOMY_MAX_CAMPAIGN_INCREASE_PERCENT ?? 20),
  codeCanaryPercent: Number(process.env.AUTONOMY_CODE_CANARY_PERCENT ?? 5),
});

const FOUNDER_GATED_PREFIXES = [
  "auth.",
  "secrets.",
  "billing.refund_large",
  "billing.plan_structural_change",
  "database.destructive_migration",
  "constitution.",
  "ownership.",
];

const FORBIDDEN_PREFIXES = [
  "security.disable",
  "audit.disable",
  "secrets.expose",
  "spam.ignore_opt_out",
  "fabricate.",
];

export function authorityForAction(actionType: string, risk: AutonomyRisk): AutonomyAuthority {
  if (FORBIDDEN_PREFIXES.some((prefix) => actionType.startsWith(prefix))) return "forbidden";
  if (FOUNDER_GATED_PREFIXES.some((prefix) => actionType.startsWith(prefix))) return "founder";

  if (actionType.startsWith("code.")) {
    if (risk === "critical") return "founder";
    return "canary";
  }
  if (actionType.startsWith("pricing.")) return risk === "low" ? "canary" : "founder";
  if (actionType.startsWith("ads.")) return risk === "high" || risk === "critical" ? "founder" : "autonomous";
  if (actionType.startsWith("outreach.")) return risk === "critical" ? "founder" : "autonomous";

  if (risk === "critical") return "founder";
  if (risk === "high") return "canary";
  return "autonomous";
}

export function autonomyEnabled(): boolean {
  return process.env.AUTONOMY_ENABLED === "1" || process.env.AUTONOMY_ENABLED === "true";
}

export function codeWritesEnabled(): boolean {
  return autonomyEnabled() && (process.env.AUTONOMY_ENABLE_CODE_WRITES === "1" || process.env.AUTONOMY_ENABLE_CODE_WRITES === "true");
}

export function outboundEnabled(): boolean {
  return autonomyEnabled() && (process.env.AUTONOMY_ENABLE_OUTBOUND === "1" || process.env.AUTONOMY_ENABLE_OUTBOUND === "true");
}
