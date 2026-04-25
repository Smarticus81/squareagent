import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCategory,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineProvider,
  VoicePipelineSession,
  VoicePipelineSessionContext,
  VoicePipelineUseCase,
} from "@workspace/voicelab-core/voice-pipeline";
import { VoicePipelineUnavailableError } from "@workspace/voicelab-core/voice-pipeline";

interface UnconfiguredAdapterSpec {
  provider: VoicePipelineProvider;
  category: VoicePipelineCategory;
  displayName: string;
  recommendedFor: VoicePipelineUseCase[];
  /** Required env vars; presence determines availability. */
  requiredEnv: string[];
  /** When all env vars are present we still expose this status (not "available"). */
  configuredStatus: "experimental" | "available" | "request_access";
  /** Note shown when not yet runtime-implemented even with credentials. */
  notImplementedNote: string;
  capabilities: Partial<{
    supportsNativeAudio: boolean;
    supportsRealtimeToolCalling: boolean;
    supportsBargeIn: boolean;
    supportsServerVAD: boolean;
    supportsClientVAD: boolean;
    supportsTurnDetection: boolean;
    supportsNoiseSuppression: boolean;
    supportsWakeWord: boolean;
    supportsMultilingual: boolean;
    supportsMobile: boolean;
    supportsBrowser: boolean;
    requiresServerRelay: boolean;
    requiresEphemeralToken: boolean;
    requiresProviderAgentConfig: boolean;
  }>;
}

/**
 * Honest unconfigured adapter. Reports availability based on credential
 * presence, but throws if an attempt is made to actually open a session
 * before runtime support is implemented. Never silently succeeds.
 */
class UnconfiguredVoicePipelineAdapter implements VoicePipelineAdapter {
  readonly provider: VoicePipelineProvider;
  readonly category: VoicePipelineCategory;
  readonly displayName: string;
  readonly recommendedFor: VoicePipelineUseCase[];

  readonly supportsNativeAudio: boolean;
  readonly supportsRealtimeToolCalling: boolean;
  readonly supportsBargeIn: boolean;
  readonly supportsServerVAD: boolean;
  readonly supportsClientVAD: boolean;
  readonly supportsTurnDetection: boolean;
  readonly supportsNoiseSuppression: boolean;
  readonly supportsWakeWord: boolean;
  readonly supportsMultilingual: boolean;
  readonly supportsMobile: boolean;
  readonly supportsBrowser: boolean;
  readonly requiresServerRelay: boolean;
  readonly requiresEphemeralToken: boolean;
  readonly requiresProviderAgentConfig: boolean;

  private readonly requiredEnv: string[];
  private readonly configuredStatus: "experimental" | "available" | "request_access";
  private readonly notImplementedNote: string;

  constructor(spec: UnconfiguredAdapterSpec) {
    this.provider = spec.provider;
    this.category = spec.category;
    this.displayName = spec.displayName;
    this.recommendedFor = spec.recommendedFor;
    this.requiredEnv = spec.requiredEnv;
    this.configuredStatus = spec.configuredStatus;
    this.notImplementedNote = spec.notImplementedNote;

    const c = spec.capabilities;
    this.supportsNativeAudio = c.supportsNativeAudio ?? false;
    this.supportsRealtimeToolCalling = c.supportsRealtimeToolCalling ?? false;
    this.supportsBargeIn = c.supportsBargeIn ?? false;
    this.supportsServerVAD = c.supportsServerVAD ?? false;
    this.supportsClientVAD = c.supportsClientVAD ?? false;
    this.supportsTurnDetection = c.supportsTurnDetection ?? false;
    this.supportsNoiseSuppression = c.supportsNoiseSuppression ?? false;
    this.supportsWakeWord = c.supportsWakeWord ?? false;
    this.supportsMultilingual = c.supportsMultilingual ?? false;
    this.supportsMobile = c.supportsMobile ?? false;
    this.supportsBrowser = c.supportsBrowser ?? false;
    this.requiresServerRelay = c.requiresServerRelay ?? false;
    this.requiresEphemeralToken = c.requiresEphemeralToken ?? false;
    this.requiresProviderAgentConfig = c.requiresProviderAgentConfig ?? false;
  }

  async availability(ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    const missing = this.requiredEnv.filter((k) => !ctx.credentials[k]);
    if (missing.length > 0) {
      return {
        status: "needs_configuration",
        reason: `Missing required credentials: ${missing.join(", ")}`,
        missing,
      };
    }
    return {
      status: this.configuredStatus,
      reason:
        this.configuredStatus === "experimental"
          ? `Credentials present. ${this.notImplementedNote}`
          : this.notImplementedNote,
    };
  }

  async createSession(_ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    throw new VoicePipelineUnavailableError(this.provider, {
      status: "needs_configuration",
      reason: this.notImplementedNote,
    });
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    /* no-op */
  }
}

export const VOICE_PIPELINE_UNCONFIGURED_SPECS: UnconfiguredAdapterSpec[] = [
  {
    provider: "google_gemini_live_native_audio",
    category: "native_realtime_speech_to_speech",
    displayName: "Google Gemini Live (native audio)",
    recommendedFor: ["best_voice_quality", "best_turn_taking"],
    requiredEnv: ["GOOGLE_GEMINI_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote:
      "Adapter scaffold. Server-to-server WebSocket bridge to Gemini Live not yet wired.",
    capabilities: {
      supportsNativeAudio: true,
      supportsRealtimeToolCalling: true,
      supportsBargeIn: true,
      supportsServerVAD: true,
      supportsTurnDetection: true,
      supportsMultilingual: true,
      supportsMobile: true,
      supportsBrowser: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "hume_evi_3",
    category: "native_realtime_speech_to_speech",
    displayName: "Hume EVI 3",
    recommendedFor: ["best_voice_quality"],
    requiredEnv: ["HUME_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote: "Adapter scaffold. EVI 3 connection not yet wired.",
    capabilities: {
      supportsNativeAudio: true,
      supportsRealtimeToolCalling: true,
      supportsBargeIn: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "elevenlabs_agents",
    category: "managed_voice_agent_api",
    displayName: "ElevenLabs Agents",
    recommendedFor: ["best_voice_quality", "lowest_latency_mobile"],
    requiredEnv: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"],
    configuredStatus: "experimental",
    notImplementedNote:
      "Signed URL minting and client tool call routing not yet implemented.",
    capabilities: {
      supportsNativeAudio: true,
      supportsRealtimeToolCalling: true,
      supportsBargeIn: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresProviderAgentConfig: true,
    },
  },
  {
    provider: "deepgram_voice_agent_api",
    category: "managed_voice_agent_api",
    displayName: "Deepgram Voice Agent API",
    recommendedFor: ["enterprise_observability", "best_tool_control"],
    requiredEnv: ["DEEPGRAM_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote: "Adapter scaffold. Deepgram Voice Agent API session not yet wired.",
    capabilities: {
      supportsNativeAudio: true,
      supportsRealtimeToolCalling: true,
      supportsBargeIn: true,
      supportsServerVAD: true,
      supportsTurnDetection: true,
      supportsMobile: true,
      supportsBrowser: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "livekit_agents",
    category: "realtime_orchestration_framework",
    displayName: "LiveKit Agents",
    recommendedFor: ["enterprise_observability", "noisy_bar", "telephony_future"],
    requiredEnv: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
    configuredStatus: "experimental",
    notImplementedNote:
      "Adapter scaffold. LiveKit room/token minting and worker dispatch not yet wired.",
    capabilities: {
      supportsNativeAudio: true,
      supportsRealtimeToolCalling: true,
      supportsBargeIn: true,
      supportsServerVAD: true,
      supportsClientVAD: true,
      supportsTurnDetection: true,
      supportsNoiseSuppression: true,
      supportsMultilingual: true,
      supportsMobile: true,
      supportsBrowser: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "pipecat",
    category: "realtime_orchestration_framework",
    displayName: "Pipecat",
    recommendedFor: ["enterprise_observability"],
    requiredEnv: ["PIPECAT_GATEWAY_URL"],
    configuredStatus: "experimental",
    notImplementedNote:
      "Adapter scaffold. Bridge to Pipecat external worker not yet implemented.",
    capabilities: {
      supportsNativeAudio: true,
      supportsRealtimeToolCalling: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "deepgram_flux_cartesia",
    category: "modular_cascaded_pipeline",
    displayName: "Deepgram Flux + Cartesia Sonic",
    recommendedFor: ["noisy_bar", "nightclub", "best_turn_taking"],
    requiredEnv: ["DEEPGRAM_API_KEY", "CARTESIA_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote:
      "Adapter scaffold. Streaming Flux + Cartesia Sonic pipeline orchestration not yet wired.",
    capabilities: {
      supportsRealtimeToolCalling: true,
      supportsServerVAD: true,
      supportsTurnDetection: true,
      supportsNoiseSuppression: true,
      supportsMultilingual: true,
      supportsMobile: true,
      supportsBrowser: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "deepgram_flux_aura",
    category: "modular_cascaded_pipeline",
    displayName: "Deepgram Flux + Aura",
    recommendedFor: ["noisy_bar", "best_turn_taking"],
    requiredEnv: ["DEEPGRAM_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote: "Adapter scaffold. Flux + Aura modular pipeline not yet wired.",
    capabilities: {
      supportsRealtimeToolCalling: true,
      supportsServerVAD: true,
      supportsTurnDetection: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "cartesia_ink_sonic",
    category: "modular_cascaded_pipeline",
    displayName: "Cartesia Ink + Sonic",
    recommendedFor: ["best_voice_quality"],
    requiredEnv: ["CARTESIA_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote: "Adapter scaffold. Cartesia Ink/Sonic pipeline not yet wired.",
    capabilities: {
      supportsRealtimeToolCalling: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "assemblyai_openai_cartesia",
    category: "modular_cascaded_pipeline",
    displayName: "AssemblyAI + OpenAI + Cartesia",
    recommendedFor: ["best_tool_control"],
    requiredEnv: ["ASSEMBLYAI_API_KEY", "OPENAI_API_KEY", "CARTESIA_API_KEY"],
    configuredStatus: "experimental",
    notImplementedNote:
      "Adapter scaffold. AssemblyAI streaming → OpenAI → Cartesia chain not yet wired.",
    capabilities: {
      supportsRealtimeToolCalling: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresServerRelay: true,
    },
  },
  {
    provider: "custom_modular_pipeline",
    category: "modular_cascaded_pipeline",
    displayName: "Custom modular pipeline",
    recommendedFor: [],
    requiredEnv: [],
    configuredStatus: "experimental",
    notImplementedNote:
      "Custom pipeline. Configure individual STT/LLM/TTS providers in the agent profile.",
    capabilities: {
      supportsRealtimeToolCalling: true,
      supportsBrowser: true,
      supportsMobile: true,
      requiresServerRelay: true,
    },
  },
];

export const UNCONFIGURED_VOICE_PIPELINE_ADAPTERS: VoicePipelineAdapter[] =
  VOICE_PIPELINE_UNCONFIGURED_SPECS.map((spec) => new UnconfiguredVoicePipelineAdapter(spec));
