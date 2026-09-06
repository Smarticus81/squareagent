import type { BusinessSnapshot } from "./metrics";
import { structuredModel } from "./openai";
import { VOYCELAB_OBJECTIVE, type AutonomyRisk } from "./constitution";

export interface PlannedAction {
  agent: "growth" | "activation" | "product" | "support" | "finance" | "evaluator";
  actionType: string;
  riskLevel: AutonomyRisk;
  title: string;
  rationale: string;
  expectedImpact: Record<string, unknown>;
  execution: Record<string, unknown>;
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
        required: ["agent", "actionType", "riskLevel", "title", "rationale", "expectedImpact", "execution"],
        properties: {
          agent: { type: "string", enum: ["growth", "activation", "product", "support", "finance", "evaluator"] },
          actionType: { type: "string" },
          riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
          title: { type: "string" },
          rationale: { type: "string" },
          expectedImpact: { type: "object", additionalProperties: true },
          execution: { type: "object", additionalProperties: true },
        },
      },
    },
  },
} as const;

function deterministicBottleneck(snapshot: BusinessSnapshot): string {
  const candidates: Array<[string, number]> = [];
  if (snapshot.product.toolCalls >= 20) candidates.push(["product_reliability", snapshot.product.toolFailureRate]);
  if (snapshot.product.voiceSessions >= 10) candidates.push(["voice_activation_quality", snapshot.product.noSuccessfulToolRate]);
  if (snapshot.funnel.signups >= 10) candidates.push(["signup_to_square", 1 - snapshot.funnel.signupToConnect]);
  if (snapshot.funnel.squareConnected >= 10) candidates.push(["square_to_activation", 1 - snapshot.funnel.connectToActivation]);
  if (snapshot.funnel.activated >= 10) candidates.push(["activation_to_paid", 1 - snapshot.funnel.activationToPaid]);
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]?.[0] ?? "insufficient_signal_build_measurement_and_acquisition";
}

export async function createAutonomyPlan(snapshot: BusinessSnapshot): Promise<AutonomyPlan> {
  const forcedBottleneck = deterministicBottleneck(snapshot);
  const instructions = [
    "You are VoyceLab's autonomous strategy planner.",
    `Immutable objective: ${VOYCELAB_OBJECTIVE.northStar}.`,
    "Optimize durable paid customer growth, activation, retention, product reliability and gross-margin-aware efficiency; never optimize vanity traffic in isolation.",
    "Prefer the highest-leverage bottleneck. Product reliability and failed user workflows take precedence over buying more traffic when they are materially degraded.",
    "Every action must be measurable, bounded and reversible where possible. Do not propose weakening auth, billing integrity, encryption, audit logging, privacy, opt-out behavior, or the constitution.",
    "For code improvements use actionType code.product_fix and include likely subsystem, evidence to inspect, success metric, and rollback criterion in execution.",
    "For market research use growth.research. For outbound use outreach.email. For lifecycle changes use activation.experiment. For pricing tests use pricing.experiment and keep changes within 15%.",
    "Return no more than six actions, ordered by expected business value divided by effort/risk.",
  ].join("\n");

  const plan = await structuredModel<AutonomyPlan>(
    instructions,
    { forcedBottleneck, snapshot, hardConstraints: VOYCELAB_OBJECTIVE.hardConstraints },
    { schemaName: "voycelab_autonomy_plan", schema: PLAN_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "medium", maxOutputTokens: 2600 },
  );

  // Deterministic reliability override: a planner can add nuance but cannot
  // choose paid acquisition ahead of a severe broken-product signal.
  if ((snapshot.product.toolCalls >= 20 && snapshot.product.toolFailureRate >= 0.12)
      || (snapshot.product.voiceSessions >= 10 && snapshot.product.noSuccessfulToolRate >= 0.2)) {
    const hasProductFix = plan.actions.some((a) => a.actionType === "code.product_fix");
    if (!hasProductFix) {
      plan.actions.unshift({
        agent: "product",
        actionType: "code.product_fix",
        riskLevel: "medium",
        title: "Repair degraded production workflow before scaling acquisition",
        rationale: "Product telemetry breached the reliability threshold; acquiring more users would amplify a broken experience.",
        expectedImpact: { toolFailureRate: "down", activationRate: "up", supportBurden: "down" },
        execution: { subsystem: "highest-failure-path", successMetric: "tool_failure_rate", rollback: "revert if failure rate or latency worsens" },
      });
    }
    plan.bottleneck = "product_reliability";
  }

  plan.actions = plan.actions.slice(0, 6);
  return plan;
}
