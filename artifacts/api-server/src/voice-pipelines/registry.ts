import type {
  VoicePipelineAdapter,
  VoicePipelineEnvContext,
  VoicePipelineProvider,
  VoicePipelineAvailability,
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
import { ElevenLabsAgentsAdapter } from "./elevenlabs/agents";
import { HumeEvi3Adapter } from "./hume/evi-3";
import { DeepgramVoiceAgentAdapter } from "./deepgram/voice-agent-api";
import { LiveKitAgentsAdapter } from "./livekit/agents";
import { PipecatGatewayAdapter } from "./pipecat/gateway";
import { ModularCascadedAdapter, MODULAR_ADAPTER_SPECS } from "./modular/cascaded";
import { BrowserSpeechApiAdapter } from "./fallback/browser-speech-api";
import { PushToTalkTextAdapter, TextOnlyAdapter } from "./fallback/push-to-talk";

const REQUEST_ONLY_PROVIDERS = new Set<VoicePipelineProvider>([
  "livekit_agents",
  "pipecat",
  "deepgram_flux_cartesia",
  "deepgram_flux_aura",
  "cartesia_ink_sonic",
  "assemblyai_openai_cartesia",
  "hume_evi_3",
]);

function wrapRequestOnly(adapter: VoicePipelineAdapter): VoicePipelineAdapter {
  return {
    ...adapter,
    async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
      return {
        status: "request_access",
        reason: "Contact sales for enterprise provisioning",
      };
    },
    async createSession(): Promise<never> {
      const err: any = new Error(
        `Pipeline "${adapter.provider}" is request-only. Contact sales for enterprise provisioning.`,
      );
      err.code = "pipeline_not_provisioned";
      throw err;
    },
  };
}

const adapters = new Map<VoicePipelineProvider, VoicePipelineAdapter>();

function register(adapter: VoicePipelineAdapter): void {
  if (REQUEST_ONLY_PROVIDERS.has(adapter.provider)) {
    adapters.set(adapter.provider, wrapRequestOnly(adapter));
  } else {
    adapters.set(adapter.provider, adapter);
  }
}

register(new OpenAiRealtimeWebRtcAdapter());
register(new OpenAiRealtimeServerWsAdapter());
for (const spec of GEMINI_LIVE_ADAPTER_SPECS) register(new GoogleGeminiLiveAdapter(spec));
register(new HumeEvi3Adapter());
register(new ElevenLabsAgentsAdapter());
register(new DeepgramVoiceAgentAdapter());
register(new LiveKitAgentsAdapter());
register(new PipecatGatewayAdapter());
for (const spec of MODULAR_ADAPTER_SPECS) register(new ModularCascadedAdapter(spec));
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
  const keys = new Set<string>();
  for (const meta of Object.values(VOICE_PIPELINE_PROVIDERS)) {
    for (const k of meta.requiredCredentials) keys.add(k);
  }
  keys.add("AI_INTEGRATIONS_OPENAI_API_KEY");
  const out: Record<string, boolean> = {};
  for (const k of keys) {
    out[k] = process.env[k] !== undefined && process.env[k] !== "";
  }
  if (out["AI_INTEGRATIONS_OPENAI_API_KEY"]) out["OPENAI_API_KEY"] = true;
  return out;
}

export interface PipelineAvailabilityReport {
  provider: VoicePipelineProvider;
  displayName: string;
  category: string;
  status: "available" | "needs_configuration" | "request_access" | "experimental" | "unavailable";
  reason?: string;
  missing?: string[];
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
    });
  }
  return reports;
}

export function recommend(
  input: VoicePipelineRecommendationInput,
): VoicePipelineRecommendation {
  return recommendVoicePipeline(input);
}
