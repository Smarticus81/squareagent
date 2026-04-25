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
  /** Subset of registered tool names the agent is allowed to call. */
  allowedTools: string[];
  confirmationPolicy: ConfirmationPolicy;
  /** Personality / tone instructions woven into the system prompt. */
  personality: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_AGENT_DISPLAY_NAME = "Bev";
export const DEFAULT_AGENT_PERSONALITY =
  "Friendly, calm, and efficient. Confirms ambiguous requests before executing.";

export function defaultWakePhraseFor(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "Hey assistant";
  return `Hey ${trimmed}`;
}
