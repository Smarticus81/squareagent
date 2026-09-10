import type { BusinessSnapshot } from "./metrics";
import { structuredModel } from "./openai";
import { VOYCELAB_OBJECTIVE, type AutonomyRisk } from "./constitution";
import type { RevenuePressureSnapshot } from "./revenue-operator";

export interface PlannedAction {
  agent: "growth" | "activation" | "product" | "support" | "finance" | "evaluator";
  actionType: string;
  riskLevel: AutonomyRisk;
  title: string;
  rationale: string;
  expectedImpact: string[];
  executionSteps: string[];
}

export interface AutonomyPlan {
  bottleneck: string;
  diagnosis: string;
  confidence: number;
  actions: PlannedAction[];
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bottleneck", "diagnosis", "confidence", "actions"],
  properties: {
    bottleneck: { type: "string" },
    diagnosis: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "actionType", "riskLevel", "title", "rationale", "expectedImpact", "executionSteps"],
        properties: {
          agent: { type: "string", enum: ["growth", "activation", "product", "support", "finance", "evaluator"] },
          actionType: { type: "string" },
          riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
          title: { type: "string" },
          rationale: { type: "string" },
          expectedImpact: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
          executionSteps: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
        },
      },
    },
  },
} as const;

function reliabilityBreached(snapshot: BusinessSnapshot): boolean {
  return (snapshot.product.toolCalls >= 20 && snapshot.product.toolFailureRate >= 0.12) ||
    (snapshot.product.voiceSessions >= 10 && snapshot.product.noSuccessfulToolRate >= 0.2);
}

function deterministicBottleneck(snapshot: BusinessSnapshot, revenue?: RevenuePressureSnapshot): string {
  if (reliabilityBreached(snapshot)) return "product_reliability_blocking_revenue";
  if (revenue?.revenueEmergency) return "revenue_emergency_zero_new_paid_customers";
  if (snapshot.revenue.paidOrganizations === 0 || snapshot.funnel.paid === 0) return "paid_customer_conversion";
  if (snapshot.funnel.activated >= 10 && snapshot.funnel.activationToPaid < 0.15) return "trial_to_paid_conversion";
  return "net_new_mrr_growth";
}

function revenueEmergencyFallbacks(): PlannedAction[] {
  return [
    {
      agent: "growth",
      actionType: "growth.research",
      riskLevel: "low",
      title: "Build the next verified buyer list",
      rationale: "No new paid customer in seven days means the business needs more qualified event-venue buyers, not more internal activity.",
      expectedImpact: ["more verified event-venue prospects", "more opportunities for paid conversion"],
      executionSteps: ["find real event venues and bars using Square", "verify the exact public business email on the official site", "rank by likelihood to buy now"],
    },
    {
      agent: "growth",
      actionType: "outreach.email",
      riskLevel: "medium",
      title: "Send the clearest direct-response offer",
      rationale: "The fastest path to money is a verified buyer understanding VoyceLab immediately and starting free without a meeting.",
      expectedImpact: ["signup starts from qualified prospects", "paid customer conversions"],
      executionSteps: ["use a short event-venue-specific message", "state what VoyceLab does in plain English", "use Start Free as the only CTA", "measure paid conversion, not replies"],
    },
    {
      agent: "activation",
      actionType: "activation.experiment",
      riskLevel: "low",
      title: "Convert existing signups before chasing vanity growth",
      rationale: "Existing signups and Square-connected users are closer to revenue than cold traffic and must be pushed to first value and payment.",
      expectedImpact: ["higher activation", "higher signup-to-paid conversion"],
      executionSteps: ["identify the exact post-signup drop-off", "remove one friction point", "drive one obvious first-value action", "present the paid path immediately after value"],
    },
  ];
}

function enforceRevenueEmergency(plan: AutonomyPlan, snapshot: BusinessSnapshot, revenue?: RevenuePressureSnapshot): AutonomyPlan {
  if (!revenue?.revenueEmergency || reliabilityBreached(snapshot)) return plan;

  const fallbacks = revenueEmergencyFallbacks();
  const allowed = plan.actions.filter((action) =>
    action.agent === "growth" ||
    action.agent === "activation" ||
    action.actionType.startsWith("pricing.") ||
    action.actionType.startsWith("finance.cost_") ||
    action.actionType === "code.product_fix",
  );

  const merged: PlannedAction[] = [];
  const seen = new Set<string>();
  for (const action of [...fallbacks, ...allowed]) {
    if (seen.has(action.actionType)) continue;
    seen.add(action.actionType);
    merged.push(action);
  }

  return {
    ...plan,
    bottleneck: "revenue_emergency_zero_new_paid_customers",
    diagnosis: `VoyceLab has produced ${revenue.paidStarts7d} new paid customers and ${revenue.newMrrCents7d / 100} dollars of new MRR in the last seven days. Internal activity is not an acceptable substitute for money. Concentrate execution on verified acquisition, signup, activation, checkout, retention, and direct cost reduction.`,
    actions: merged.slice(0, 6),
  };
}

export async function createAutonomyPlan(snapshot: BusinessSnapshot, revenue?: RevenuePressureSnapshot): Promise<AutonomyPlan> {
  const forcedBottleneck = deterministicBottleneck(snapshot, revenue);
  const instructions = [
    "You are VoyceLab's autonomous revenue operator. The company exists to make money.",
    `Immutable objective: ${VOYCELAB_OBJECTIVE.northStar}.`,
    "Judge success only by paid customer growth, net new MRR, retained MRR, and net operating contribution. Activity is not progress unless it moves one of those numbers.",
    "If there have been zero new paid customers in seven days, treat that as a revenue emergency. Do not spend strategy capacity on ordinary product upgrades, architecture cleanup, broad research, dashboards, or internal polish unless they remove a measured conversion blocker, protect retained revenue, reduce direct cost, or fix a breached reliability/safety guardrail.",
    "During a revenue emergency, at least four of six proposed actions should be directly tied to acquiring a verified buyer, getting a signup, activating a signup, reaching checkout/payment, retaining a paying customer, testing an offer/pricing change within authority, or reducing direct serving cost.",
    "Have no attachment to previous copy, campaigns, landing-page ideas, or product ideas. If they do not create paid customers, replace them.",
    "VoyceLab is for event venues, wedding venues, bars, bartenders, venue managers and venue owners using Square. Keep growth focused there unless paid conversion evidence proves another segment is better.",
    "The fastest path to revenue is usually: verified buyer -> clear message -> Start Free -> first value -> paid. Remove friction from that path before inventing new work.",
    "The default acquisition CTA is Start Free at /signup. The live demo is already on the website; never add demo-booking or sales-call friction for ordinary prospects.",
    "Use plain language an event-venue owner can understand immediately. Avoid voice layer, orchestration, operational intelligence, workflow transformation, connected systems, AI-powered operations, streamline, unlock, leverage, optimize, ecosystem, and platform transformation.",
    "Product reliability overrides acquisition only when measured production failure thresholds are breached. Otherwise reliability is a guardrail, not the mission.",
    "Every action must be measurable and bounded. Do not weaken auth, billing integrity, encryption, audit logging, privacy, opt-out behavior, deliverability protections, or the constitution.",
    "For code improvements use actionType code.product_fix. For market research use growth.research. For outbound use outreach.email. For lifecycle changes use activation.experiment.",
    "Return concise strings and no more than six actions, ordered by expected paid-customer or contribution impact divided by effort and risk.",
  ].join("\n");

  let plan = await structuredModel<AutonomyPlan>(
    instructions,
    { forcedBottleneck, snapshot, revenuePressure: revenue ?? null, hardConstraints: VOYCELAB_OBJECTIVE.hardConstraints },
    { schemaName: "voycelab_autonomy_plan", schema: PLAN_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "medium", maxOutputTokens: 6000 },
  );

  if (reliabilityBreached(snapshot)) {
    if (!plan.actions.some((a) => a.actionType === "code.product_fix")) {
      plan.actions.unshift({
        agent: "product",
        actionType: "code.product_fix",
        riskLevel: "medium",
        title: "Repair the measured revenue-blocking failure",
        rationale: "Production telemetry breached the reliability threshold. Fix the measured failure because customers cannot pay for a product that fails at the moment of value.",
        expectedImpact: ["fewer failed customer workflows", "higher paid conversion probability"],
        executionSteps: [
          "inspect the highest-failure production path",
          "identify the smallest root-cause fix",
          "add focused regression coverage",
          "open a bounded autonomy PR",
          "require CI to pass before promotion",
          "monitor the original failure metric and revert if it worsens",
        ],
      });
    }
    plan.bottleneck = "product_reliability_blocking_revenue";
  }

  plan = enforceRevenueEmergency(plan, snapshot, revenue);
  plan.actions = plan.actions.slice(0, 6);
  return plan;
}
