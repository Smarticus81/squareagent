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
  /** Map of credential env var → presence. */
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
 * Always returns *something* — at minimum, push_to_talk_text_fallback,
 * which has no credentials.
 */
export function recommendVoicePipeline(
  input: VoicePipelineRecommendationInput,
): VoicePipelineRecommendation {
  const warnings: string[] = [];
  const { availableCredentials, environment, deviceType } = input;

  // Build candidate ordering per the spec, then filter to credential-available.
  let candidates: VoicePipelineProvider[];
  let baseReason: string;

  // 1. Noisy environments take priority — recommend Flux + Cartesia.
  if (environment === "nightclub" || environment === "bar") {
    candidates = [
      "deepgram_flux_cartesia",
      "livekit_agents",
      "openai_realtime_webrtc",
      "push_to_talk_text_fallback",
    ];
    baseReason = `noise mode=${environment}: prefer modular pipeline with strong turn detection and noise tolerance`;
  }
  // 2. Enterprise observability.
  else if (input.requiresEnterpriseObservability) {
    candidates = [
      "livekit_agents",
      "openai_realtime_server_ws",
      "pipecat",
      "push_to_talk_text_fallback",
    ];
    baseReason = "enterprise observability requested: prefer orchestration framework";
  }
  // 3. Best voice quality.
  else if (input.requiresBestVoiceQuality) {
    candidates = [
      "elevenlabs_agents",
      "hume_evi_3",
      "cartesia_ink_sonic",
      "openai_realtime_webrtc",
      "push_to_talk_text_fallback",
    ];
    baseReason = "best voice quality requested: prefer expressive managed agent or premium TTS";
  }
  // 4. Mobile native.
  else if (deviceType === "ios_native" || deviceType === "android_native") {
    candidates = [
      "openai_realtime_server_ws",
      "elevenlabs_agents",
      "livekit_agents",
      "push_to_talk_text_fallback",
    ];
    baseReason = `mobile native (${deviceType}): prefer server-controlled relay or managed agent`;
  }
  // 5. Default — browser/PWA low-latency.
  else {
    candidates = [
      "openai_realtime_webrtc",
      "google_gemini_live_native_audio",
      "deepgram_voice_agent_api",
      "push_to_talk_text_fallback",
    ];
    baseReason = `browser/PWA low-latency default for device=${deviceType}`;
  }

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
