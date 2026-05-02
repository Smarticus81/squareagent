/**
 * Voice pipeline abstraction. VoyceLab supports five categories of voice
 * pipeline; UI selects per agent and runtime resolves the matching adapter.
 *
 * Categories:
 *   1. Native realtime speech-to-speech models
 *   2. Managed voice-agent APIs
 *   3. Realtime orchestration frameworks
 *   4. Modular cascaded STT/LLM/TTS pipelines
 *   5. Browser/manual/text fallback
 */

export type VoicePipelineCategory =
  | "native_realtime_speech_to_speech"
  | "managed_voice_agent_api"
  | "realtime_orchestration_framework"
  | "modular_cascaded_pipeline"
  | "browser_or_manual_fallback";

export type VoicePipelineProvider =
  // Native realtime speech-to-speech
  | "openai_realtime_webrtc"
  | "openai_realtime_server_ws"
  | "google_gemini_3_1_flash_live"
  | "google_gemini_2_5_flash_native_audio"
  | "google_gemini_live_native_audio"
  | "hume_evi_3"

  // Managed voice-agent APIs
  | "elevenlabs_agents"
  | "deepgram_voice_agent_api"

  // Realtime orchestration frameworks
  | "livekit_agents"
  | "pipecat"

  // Modular cascaded best-in-class components
  | "deepgram_flux_cartesia"
  | "deepgram_flux_aura"
  | "cartesia_ink_sonic"
  | "assemblyai_openai_cartesia"
  | "custom_modular_pipeline"

  // Fallbacks
  | "browser_speech_api_fallback"
  | "push_to_talk_text_fallback"
  | "text_only_fallback";

export type VoicePipelineUseCase =
  | "lowest_latency_browser"
  | "lowest_latency_mobile"
  | "noisy_bar"
  | "nightclub"
  | "event_venue"
  | "best_voice_quality"
  | "best_turn_taking"
  | "best_tool_control"
  | "enterprise_observability"
  | "offline_or_degraded"
  | "telephony_future";

export type VoicePipelineAvailabilityStatus =
  | "available"
  | "needs_configuration"
  | "request_access"
  | "experimental"
  | "unavailable";

export interface VoicePipelineEnvContext {
  /** Whether each credential env var is present (no values, just presence). */
  credentials: Record<string, boolean>;
  /** Currently selected connected service, if any (for compat warnings). */
  connectedServiceProvider?: string;
  /** Browser / mobile / server runtime environment hint. */
  runtime?: "browser" | "mobile" | "server" | "unknown";
}

export interface VoicePipelineAvailability {
  status: VoicePipelineAvailabilityStatus;
  /** Human-readable note for admin UI (e.g. "Set OPENAI_API_KEY to enable"). */
  reason?: string;
  /** Specific env vars or config keys still missing. */
  missing?: string[];
}

export interface VoicePipelineSessionContext {
  /** Connected service connection (used to power tools). */
  connectionId: string;
  /** Agent profile ID. */
  agentProfileId: string;
  /** Display name of the agent (e.g. "Bev", "Aurora"). */
  agentDisplayName: string;
  /** User ID making the request. */
  userId: string;
  /** Tools the session is allowed to call. */
  allowedToolNames: string[];
  /** Provider-specific options pulled from voicePipelineConfig. */
  providerOptions: Record<string, unknown>;
  /** System instructions composed by the skill layer. */
  instructions: string;
  /** Catalog snapshot. */
  catalogSummary?: string;
}

export interface VoicePipelineSession {
  sessionId: string;
  provider: VoicePipelineProvider;
  /** When non-null, client connects directly using this opaque payload. */
  clientHandshake?: {
    kind: "ephemeral_token" | "signed_url" | "ws_relay" | "config_only" | "noop";
    /** Tokens / URLs expire — clients refresh via /sessions. */
    expiresAt?: string;
    payload: Record<string, unknown>;
  };
  /** Capabilities the chosen pipeline actually exposes for this session. */
  capabilities: {
    nativeAudio: boolean;
    realtimeToolCalling: boolean;
    bargeIn: boolean;
    serverVAD: boolean;
  };
}

export interface VoicePipelineToolResultContext {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
}

export interface VoicePipelineInterruptContext {
  sessionId: string;
}

export interface VoicePipelineCloseContext {
  sessionId: string;
  reason?: "client_done" | "server_done" | "timeout" | "error";
}

export interface VoicePipelineAdapter {
  provider: VoicePipelineProvider;
  category: VoicePipelineCategory;
  displayName: string;
  recommendedFor: VoicePipelineUseCase[];

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

  availability(ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability>;

  createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession>;
  sendToolResult?(ctx: VoicePipelineToolResultContext): Promise<void>;
  interrupt?(ctx: VoicePipelineInterruptContext): Promise<void>;
  closeSession(ctx: VoicePipelineCloseContext): Promise<void>;
}

export class VoicePipelineUnavailableError extends Error {
  readonly provider: VoicePipelineProvider;
  readonly availability: VoicePipelineAvailability;
  constructor(provider: VoicePipelineProvider, availability: VoicePipelineAvailability) {
    super(
      `Voice pipeline "${provider}" is not available: ${availability.reason ?? availability.status}`,
    );
    this.name = "VoicePipelineUnavailableError";
    this.provider = provider;
    this.availability = availability;
  }
}
