import type { NoiseMode } from "../noise/types";
import type { VoicePipelineProvider } from "../voice-pipeline/types";
import type { ConfirmationPolicy } from "../confirmation/types";

/**
 * Agent profile — user-named, user-configured voice agent attached to a
 * venue. Profile drives skill loading, pipeline selection, noise behavior,
 * and confirmation policy.
 *
 * "Bev" is only a default example; users may set any displayName.
 */
export interface AgentProfile {
  id: string;
  organizationId: string;
  venueId: string;
  /** User-chosen agent name. Default suggestion: "Bev". */
  displayName: string;
  /** Wake phrase, defaults from displayName but editable. */
  wakePhrase: string;
  /** ID of the connected service this agent operates against. */
  connectedServiceId: string;
  voicePipelineProvider: VoicePipelineProvider;
  /** Provider-specific options (model, voice id, agent id, etc.). */
  voicePipelineConfig: Record<string, unknown>;
  noiseMode: NoiseMode;
  /**
   * How submitted orders settle in Square.
   *  - "auto_complete": record payment immediately so the order closes (default).
   *  - "hold_for_review": leave the order OPEN on the POS for end-of-day review.
   */
  orderHandlingMode: OrderHandlingMode;
  /** Subset of registered tool names the agent is allowed to call. */
  allowedTools: string[];
  confirmationPolicy: ConfirmationPolicy;
  /** Personality / tone instructions woven into the system prompt. */
  personality: string;
  createdAt: string;
  updatedAt: string;
}

/** Order settlement behavior for an assistant. */
export type OrderHandlingMode = "auto_complete" | "hold_for_review";

export function normalizeOrderHandlingMode(value: unknown): OrderHandlingMode {
  return value === "hold_for_review" ? "hold_for_review" : "auto_complete";
}

export const DEFAULT_AGENT_PERSONALITY =
  "Friendly, calm, and efficient. Confirms ambiguous requests before executing.";

export function defaultWakePhraseFor(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "Hey assistant";
  return `Hey ${trimmed}`;
}
