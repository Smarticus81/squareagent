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
  northStar: "maximize paid customers and net operating contribution; VoyceLab exists to make money, and every autonomous action must connect to acquiring, converting, retaining, or profitably serving paying customers",
  optimize: [
    "net_operating_contribution",
    "paid_customer_conversions",
    "new_mrr",
    "retained_mrr",
    "revenue_velocity",
    "trial_to_paid_conversion",
  ],
  diagnosticOnly: [
    "emails_sent",
    "opens",
    "clicks",
    "replies",
    "positive_replies",
    "demo_interest",
    "traffic",
    "feature_output",
    "agent_activity",
    "system_uptime_above_required_guardrail",
  ],
  minimize: [
    "cac",
    "churn",
    "refunds",
    "time_to_first_value",
    "support_burden",
    "voice_compute_cost",
    "agent_compute_cost",
    "infrastructure_cost",
    "hard_bounces",
    "sender_reputation_risk",
    "operational_risk",
  ],
  hardConstraints: [
    "never report an email send, click, reply, demo request, feature, agent action, or positive sentiment as business success unless it produces paid conversion, retained revenue, or measurable cost reduction",
    "zero new paid customers in the prior seven days is a revenue emergency, not a normal operating condition",
    "during a revenue emergency, ordinary product upgrades, architecture cleanup, broad research, and nonessential operational work must wait unless they remove a measured conversion blocker, protect retained revenue, lower direct cost, or resolve a breached safety/reliability guardrail",
    "during a revenue emergency, the strategy plan must concentrate on verified acquisition, signup, activation, checkout, retention, pricing/offer learning within authority, and direct cost reduction",
    "kill acquisition messages and offers that receive enough confirmed deliveries but produce zero paid customers; do not preserve a failing campaign merely because it generates replies or engagement",
    "never fabricate customers, testimonials, evidence, or product capabilities",
    "never send autonomous prospecting email to an address unless the exact address is publicly visible on that business's official website and its email domain has valid MX records",
    "never infer, pattern-generate, or guess a prospect email address",
    "never reply to mailer-daemon, postmaster, no-reply, delivery-status, or other automated system messages",
    "hard-bounced addresses must be suppressed immediately and cannot be retried unless the business is later found with a different verified address",
    "honor opt-out and communication preferences immediately",
    "never expose secrets or customer credentials to model context",
    "never weaken authentication, authorization, encryption, billing integrity, or audit logging autonomously",
    "prefer reversible changes and retain a complete action trail",
    "stop or roll back experiments that breach safety, reliability, complaint, deliverability, or margin guardrails",
    "do not modify this objective or constitution autonomously",
  ],
});

export const DEFAULT_AUTONOMY_BUDGET: AutonomyBudget = Object.freeze({
  maxOutboundPerDay: Number(process.env.AUTONOMY_MAX_OUTBOUND_PER_DAY ?? 20),
  maxOutboundPerDomainPerDay: Number(process.env.AUTONOMY_MAX_OUTBOUND_PER_DOMAIN_DAY ?? 1),
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
