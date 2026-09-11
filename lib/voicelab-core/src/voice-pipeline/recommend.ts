import type { ConnectedServiceProvider } from "../connected-service/types";
import type { NoiseMode } from "../noise/types";
import type { VoicePipelineProvider } from "./types";
import { VOICE_PIPELINE_PROVIDERS } from "./registry";

export interface VoicePipelineRecommendationInput {
  deviceType:
    | "desktop_browser"
    | "mobile_browser"
    | "ios_native"
    | "android_native"
    | "server"
    | "unknown";
  environment: NoiseMode;
  connectedServiceProvider: ConnectedServiceProvider;
  requiresToolCalling: boolean;
  requiresBestVoiceQuality: boolean;
  requiresLowestLatency: boolean;
  requiresEnterpriseObservability: boolean;
  /** Map of credential env var -> presence. */
  availableCredentials: Record<string, boolean>;
}

export interface VoicePipelineRecommendation {
  recommendedProvider: VoicePipelineProvider;
  fallbackProviders: VoicePipelineProvider[];
  reason: string;
  warnings: string[];
}

function hasCreds(
  available: Record<string, boolean>,
  required: string[],
): boolean {
  if (required.length === 0) return true;
  return required.every((k) => available[k] === true);
}

function firstAvailable(
  candidates: VoicePipelineProvider[],
  available: Record<string, boolean>,
): VoicePipelineProvider | undefined {
  for (const c of candidates) {
    const meta = VOICE_PIPELINE_PROVIDERS[c];
    if (hasCreds(available, meta.requiredCredentials)) return c;
  }
  return undefined;
}

/**
 * Pure recommendation engine. Maps device + environment + intent to a
 * concrete pipeline provider, falling back through the spec's defaults.
 *
 * Always returns *something* -- at minimum, push_to_talk_text_fallback,
 * which has no credentials.
 */
export function recommendVoicePipeline(
  input: VoicePipelineRecommendationInput,
): VoicePipelineRecommendation {
  const warnings: string[] = [];
  const { availableCredentials, environment, deviceType } = input;

  const candidates: VoicePipelineProvider[] = input.requiresEnterpriseObservability || deviceType === "server" || deviceType === "ios_native" || deviceType === "android_native"
    ? ["openai_realtime_server_ws", "openai_realtime_webrtc", "push_to_talk_text_fallback"]
    : ["openai_realtime_webrtc", "openai_realtime_server_ws", "push_to_talk_text_fallback"];
  const baseReason = "GPT-Live 1 provides expressive conversation with delegated business commands.";

  const recommended = firstAvailable(candidates, availableCredentials)
    ?? "push_to_talk_text_fallback";

  // Pull surviving fallbacks (skip the chosen one, dedup, keep order).
  const fallbacks = candidates.filter(
    (c) => c !== recommended && hasCreds(availableCredentials, VOICE_PIPELINE_PROVIDERS[c].requiredCredentials),
  );
  // Always make sure a no-credential fallback is in the list.
  if (!fallbacks.includes("push_to_talk_text_fallback") && recommended !== "push_to_talk_text_fallback") {
    fallbacks.push("push_to_talk_text_fallback");
  }

  // Surface honest warnings.
  if (recommended === "push_to_talk_text_fallback") {
    warnings.push(
      "No configured pipeline matches this profile. Falling back to push-to-talk text. Add credentials to enable a SOTA pipeline.",
    );
  }
  if (recommended === "browser_speech_api_fallback") {
    warnings.push("Browser Speech API is degraded mode. Not recommended for production.");
  }
  if (input.requiresToolCalling) {
    const meta = VOICE_PIPELINE_PROVIDERS[recommended];
    if (meta.category === "browser_or_manual_fallback") {
      warnings.push("Selected pipeline does not support realtime tool calling natively; tools run via fallback path.");
    }
  }

  return {
    recommendedProvider: recommended,
    fallbackProviders: fallbacks,
    reason: baseReason,
    warnings,
  };
}
