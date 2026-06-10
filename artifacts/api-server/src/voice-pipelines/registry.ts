import type {
  VoicePipelineAdapter,
  VoicePipelineEnvContext,
  VoicePipelineProvider,
} from "@workspace/voicelab-core/voice-pipeline";
import {
  VOICE_PIPELINE_PROVIDERS,
  recommendVoicePipeline,
  type VoicePipelineRecommendationInput,
  type VoicePipelineRecommendation,
} from "@workspace/voicelab-core/voice-pipeline";
import { OpenAiRealtimeWebRtcAdapter } from "./openai/realtime-webrtc";
import { OpenAiRealtimeServerWsAdapter } from "./openai/realtime-server-ws";
import { GoogleGeminiLiveAdapter, GEMINI_LIVE_ADAPTER_SPECS } from "./google/gemini-live";
import { BrowserSpeechApiAdapter } from "./fallback/browser-speech-api";
import { PushToTalkTextAdapter, TextOnlyAdapter } from "./fallback/push-to-talk";
import { readServerApiKeyPresence } from "../lib/api-keys";

const adapters = new Map<VoicePipelineProvider, VoicePipelineAdapter>();

function register(adapter: VoicePipelineAdapter): void {
  adapters.set(adapter.provider, adapter);
}

register(new OpenAiRealtimeWebRtcAdapter());
register(new OpenAiRealtimeServerWsAdapter());
for (const spec of GEMINI_LIVE_ADAPTER_SPECS) register(new GoogleGeminiLiveAdapter(spec));
register(new BrowserSpeechApiAdapter());
register(new PushToTalkTextAdapter());
register(new TextOnlyAdapter());

export function getVoicePipelineAdapter(provider: VoicePipelineProvider): VoicePipelineAdapter {
  const a = adapters.get(provider);
  if (!a) throw new Error(`No voice pipeline adapter registered for "${provider}"`);
  return a;
}

export function listVoicePipelineAdapters(): VoicePipelineAdapter[] {
  return Array.from(adapters.values());
}

/** Snapshot of credential env vars that pipeline adapters care about. */
export function readVoicePipelineEnvCredentials(): Record<string, boolean> {
  const out = readServerApiKeyPresence();
  const keys = new Set<string>();
  for (const meta of Object.values(VOICE_PIPELINE_PROVIDERS)) {
    for (const k of meta.requiredCredentials) keys.add(k);
  }
  for (const k of keys) {
    if (out[k] === undefined) {
      const value = process.env[k]?.trim();
      out[k] = Boolean(value);
    }
  }
  return out;
}

export interface PipelineAvailabilityReport {
  provider: VoicePipelineProvider;
  displayName: string;
  category: string;
  status: "available" | "needs_configuration" | "request_access" | "experimental" | "unavailable";
  reason?: string;
  missing?: string[];
  capabilities: {
    nativeAudio: boolean;
    realtimeToolCalling: boolean;
    bargeIn: boolean;
    serverVAD: boolean;
    clientVAD: boolean;
    turnDetection: boolean;
    noiseSuppression: boolean;
    wakeWord: boolean;
    multilingual: boolean;
    mobile: boolean;
    browser: boolean;
  };
}

export async function getAllPipelineAvailability(): Promise<PipelineAvailabilityReport[]> {
  const ctx: VoicePipelineEnvContext = {
    credentials: readVoicePipelineEnvCredentials(),
  };
  const reports: PipelineAvailabilityReport[] = [];
  for (const adapter of listVoicePipelineAdapters()) {
    const a = await adapter.availability(ctx);
    reports.push({
      provider: adapter.provider,
      displayName: adapter.displayName,
      category: adapter.category,
      status: a.status,
      reason: a.reason,
      missing: a.missing,
      capabilities: {
        nativeAudio: adapter.supportsNativeAudio,
        realtimeToolCalling: adapter.supportsRealtimeToolCalling,
        bargeIn: adapter.supportsBargeIn,
        serverVAD: adapter.supportsServerVAD,
        clientVAD: adapter.supportsClientVAD,
        turnDetection: adapter.supportsTurnDetection,
        noiseSuppression: adapter.supportsNoiseSuppression,
        wakeWord: adapter.supportsWakeWord,
        multilingual: adapter.supportsMultilingual,
        mobile: adapter.supportsMobile,
        browser: adapter.supportsBrowser,
      },
    });
  }
  return reports;
}

export function recommend(
  input: VoicePipelineRecommendationInput,
): VoicePipelineRecommendation {
  return recommendVoicePipeline(input);
}
