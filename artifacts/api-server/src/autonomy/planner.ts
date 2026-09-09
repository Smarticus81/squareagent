import type { BusinessSnapshot } from "./metrics";
import { structuredModel } from "./openai";
import { VOYCELAB_OBJECTIVE, type AutonomyRisk } from "./constitution";

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

function deterministicBottleneck(snapshot: BusinessSnapshot): string {
  if (snapshot.product.toolCalls >= 20 && snapshot.product.toolFailureRate >= 0.12) return "product_reliability";
  if (snapshot.product.voiceSessions >= 10 && snapshot.product.noSuccessfulToolRate >= 0.2) return "product_reliability";
  if (snapshot.revenue.paidOrganizations === 0 || snapshot.funnel.paid === 0) return "paid_customer_conversion";
  if (snapshot.funnel.activated >= 10 && snapshot.funnel.activationToPaid < 0.15) return "trial_to_paid_conversion";
  return "net_new_mrr_growth";
}

export async function createAutonomyPlan(snapshot: BusinessSnapshot): Promise<AutonomyPlan> {
  const forcedBottleneck = deterministicBottleneck(snapshot);
  const instructions = [
    "You are VoyceLab's autonomous strategy planner.",
    `Immutable objective: ${VOYCELAB_OBJECTIVE.northStar}.`,
    "Judge business success only by paid customers, net new MRR, retained MRR, and acquisition economics. Email sends, replies, positive sentiment, demo interest, traffic, and clicks are diagnostic signals only and must never be described as success.",
    "VoyceLab is for event venues, wedding venues, bars, bartenders, venue managers and venue owners using Square. Keep growth strategy focused there unless hard conversion evidence supports another segment.",
    "When marketing is not converting, prefer clearer positioning, shorter copy, stronger signup CTAs, better landing-page continuity and better audience fit rather than increasing message volume blindly.",
    "The default acquisition CTA is Start Free at /signup. The live product demo is already on the website; do not propose booking a demo or adding sales-call friction for ordinary prospects.",
    "Use plain language an event-venue owner can understand immediately. Avoid phrases such as voice layer, orchestration, operational intelligence, workflow transformation, connected systems, or AI-powered operations in customer-facing recommendations.",
    "Product reliability still overrides aggressive acquisition only when measured production failure thresholds are actually breached. Do not halt all acquisition merely because the dataset is small; use bounded cohorts while improving measurement and activation in parallel.",
    "Every action must be measurable and bounded. Do not weaken auth, billing integrity, encryption, audit logging, privacy, opt-out behavior, or the constitution.",
    "For code improvements use actionType code.product_fix. For market research use growth.research. For outbound use outreach.email. For lifecycle changes use activation.experiment.",
    "Return concise strings and no more than six actions, ordered by expected paid-customer or revenue impact divided by effort and risk.",
  ].join("\n");

  const plan = await structuredModel<AutonomyPlan>(
    instructions,
    { forcedBottleneck, snapshot, hardConstraints: VOYCELAB_OBJECTIVE.hardConstraints },
    { schemaName: "voycelab_autonomy_plan", schema: PLAN_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "medium", maxOutputTokens: 6000 },
  );

  const reliabilityBreached =
    (snapshot.product.toolCalls >= 20 && snapshot.product.toolFailureRate >= 0.12) ||
    (snapshot.product.voiceSessions >= 10 && snapshot.product.noSuccessfulToolRate >= 0.2);

  if (reliabilityBreached) {
    if (!plan.actions.some((a) => a.actionType === "code.product_fix")) {
      plan.actions.unshift({
        agent: "product",
        actionType: "code.product_fix",
        riskLevel: "medium",
        title: "Repair the measured production failure",
        rationale: "Production telemetry breached the reliability threshold. Fix the measured failure while keeping acquisition bounded.",
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
    plan.bottleneck = "product_reliability";
  }

  plan.actions = plan.actions.slice(0, 6);
  return plan;
}
