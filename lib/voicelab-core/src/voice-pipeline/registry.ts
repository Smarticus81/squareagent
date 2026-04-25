import type {
  VoicePipelineCategory,
  VoicePipelineProvider,
  VoicePipelineUseCase,
} from "./types";

export interface VoicePipelineProviderMetadata {
  provider: VoicePipelineProvider;
  category: VoicePipelineCategory;
  displayName: string;
  shortDescription: string;
  recommendedFor: VoicePipelineUseCase[];
  /** Env vars required for the adapter to be runtime-available. */
  requiredCredentials: string[];
  /** Optional pricing/security caveats shown in admin UI. */
  notes?: string;
  /** Marker that this is a fallback option, not a SOTA recommendation. */
  isFallback?: boolean;
  /** Marker that this is experimental/preview. */
  isExperimental?: boolean;
}

export const VOICE_PIPELINE_PROVIDERS: Record<
  VoicePipelineProvider,
  VoicePipelineProviderMetadata
> = {
  // ── Native realtime speech-to-speech ───────────────────────────────────────
  openai_realtime_webrtc: {
    provider: "openai_realtime_webrtc",
    category: "native_realtime_speech_to_speech",
    displayName: "OpenAI Realtime (WebRTC)",
    shortDescription:
      "Default browser/PWA path. Lowest-latency client voice with native S2S, server VAD, and tool calling over data channel.",
    recommendedFor: ["lowest_latency_browser", "best_tool_control"],
    requiredCredentials: ["OPENAI_API_KEY"],
  },
  openai_realtime_server_ws: {
    provider: "openai_realtime_server_ws",
    category: "native_realtime_speech_to_speech",
    displayName: "OpenAI Realtime (Server WebSocket)",
    shortDescription:
      "Server-controlled relay. Best for native apps, enterprise logging, and future telephony.",
    recommendedFor: ["enterprise_observability", "lowest_latency_mobile", "telephony_future"],
    requiredCredentials: ["OPENAI_API_KEY"],
  },
  google_gemini_live_native_audio: {
    provider: "google_gemini_live_native_audio",
    category: "native_realtime_speech_to_speech",
    displayName: "Google Gemini Live (native audio)",
    shortDescription:
      "Native realtime voice with multimodal future, function calling, and affective audio.",
    recommendedFor: ["best_voice_quality", "best_turn_taking"],
    requiredCredentials: ["GOOGLE_GEMINI_API_KEY"],
    isExperimental: true,
  },
  hume_evi_3: {
    provider: "hume_evi_3",
    category: "native_realtime_speech_to_speech",
    displayName: "Hume EVI 3",
    shortDescription:
      "Highly expressive empathic voice with custom voices/personalities. Premium agent voice option.",
    recommendedFor: ["best_voice_quality"],
    requiredCredentials: ["HUME_API_KEY"],
    isExperimental: true,
    notes: "Premium pricing. POS execution stays in VoyceLab tool layer.",
  },

  // ── Managed voice-agent APIs ──────────────────────────────────────────────
  elevenlabs_agents: {
    provider: "elevenlabs_agents",
    category: "managed_voice_agent_api",
    displayName: "ElevenLabs Agents",
    shortDescription:
      "Managed voice-agent platform with expressive voices, turn-taking, and SDKs for web/iOS/Android.",
    recommendedFor: ["best_voice_quality", "lowest_latency_mobile"],
    requiredCredentials: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"],
    notes: "Use signed URL flow for auth. Public agent IDs are not a secretless production path.",
  },
  deepgram_voice_agent_api: {
    provider: "deepgram_voice_agent_api",
    category: "managed_voice_agent_api",
    displayName: "Deepgram Voice Agent API",
    shortDescription:
      "Managed voice-to-voice API with strong enterprise control and event-driven design.",
    recommendedFor: ["enterprise_observability", "best_tool_control"],
    requiredCredentials: ["DEEPGRAM_API_KEY"],
  },

  // ── Realtime orchestration frameworks ─────────────────────────────────────
  livekit_agents: {
    provider: "livekit_agents",
    category: "realtime_orchestration_framework",
    displayName: "LiveKit Agents",
    shortDescription:
      "Production media infrastructure with WebRTC transport, noise cancellation, turn detection, observability.",
    recommendedFor: ["enterprise_observability", "noisy_bar", "telephony_future"],
    requiredCredentials: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
  },
  pipecat: {
    provider: "pipecat",
    category: "realtime_orchestration_framework",
    displayName: "Pipecat",
    shortDescription:
      "Open-source pipeline orchestration for custom multimodal voice flows. Runs as external Python service.",
    recommendedFor: ["enterprise_observability"],
    requiredCredentials: ["PIPECAT_GATEWAY_URL"],
    notes: "Requires a separately deployed Pipecat runtime; bridges to Node API over HTTP/WebSocket.",
    isExperimental: true,
  },

  // ── Modular cascaded best-in-class components ─────────────────────────────
  deepgram_flux_cartesia: {
    provider: "deepgram_flux_cartesia",
    category: "modular_cascaded_pipeline",
    displayName: "Deepgram Flux + Cartesia Sonic",
    shortDescription:
      "STT + turn detection (Flux), pluggable LLM, fast TTS (Cartesia Sonic). Built for noisy environments.",
    recommendedFor: ["noisy_bar", "nightclub", "best_turn_taking"],
    requiredCredentials: ["DEEPGRAM_API_KEY", "CARTESIA_API_KEY"],
  },
  deepgram_flux_aura: {
    provider: "deepgram_flux_aura",
    category: "modular_cascaded_pipeline",
    displayName: "Deepgram Flux + Aura",
    shortDescription: "All-Deepgram modular pipeline (Flux STT + Aura TTS).",
    recommendedFor: ["noisy_bar", "best_turn_taking"],
    requiredCredentials: ["DEEPGRAM_API_KEY"],
  },
  cartesia_ink_sonic: {
    provider: "cartesia_ink_sonic",
    category: "modular_cascaded_pipeline",
    displayName: "Cartesia Ink + Sonic",
    shortDescription: "Fast STT/TTS modular path with strong TTS expressiveness.",
    recommendedFor: ["best_voice_quality"],
    requiredCredentials: ["CARTESIA_API_KEY"],
    isExperimental: true,
  },
  assemblyai_openai_cartesia: {
    provider: "assemblyai_openai_cartesia",
    category: "modular_cascaded_pipeline",
    displayName: "AssemblyAI + OpenAI + Cartesia",
    shortDescription: "Streaming STT (AssemblyAI), LLM (OpenAI), TTS (Cartesia).",
    recommendedFor: ["best_tool_control"],
    requiredCredentials: ["ASSEMBLYAI_API_KEY", "OPENAI_API_KEY", "CARTESIA_API_KEY"],
    isExperimental: true,
  },
  custom_modular_pipeline: {
    provider: "custom_modular_pipeline",
    category: "modular_cascaded_pipeline",
    displayName: "Custom modular pipeline",
    shortDescription: "User-supplied STT, LLM, and TTS components wired through the adapter.",
    recommendedFor: [],
    requiredCredentials: [],
    notes: "Configure individual STT/LLM/TTS providers in the agent profile.",
    isExperimental: true,
  },

  // ── Fallbacks ─────────────────────────────────────────────────────────────
  browser_speech_api_fallback: {
    provider: "browser_speech_api_fallback",
    category: "browser_or_manual_fallback",
    displayName: "Browser Speech API (degraded)",
    shortDescription:
      "Emergency fallback using the browser's SpeechRecognition/SpeechSynthesis APIs. Not SOTA.",
    recommendedFor: ["offline_or_degraded"],
    requiredCredentials: [],
    isFallback: true,
    notes: "Marked degraded. Never the default for production.",
  },
  push_to_talk_text_fallback: {
    provider: "push_to_talk_text_fallback",
    category: "browser_or_manual_fallback",
    displayName: "Push-to-talk text",
    shortDescription:
      "Manual command entry with large confirmation UI. Always available, no provider needed.",
    recommendedFor: ["nightclub", "offline_or_degraded"],
    requiredCredentials: [],
    isFallback: true,
  },
  text_only_fallback: {
    provider: "text_only_fallback",
    category: "browser_or_manual_fallback",
    displayName: "Text only",
    shortDescription: "No voice. Type commands. Useful for accessibility or silent environments.",
    recommendedFor: ["offline_or_degraded"],
    requiredCredentials: [],
    isFallback: true,
  },
};

export function listVoicePipelineProviders(): VoicePipelineProviderMetadata[] {
  return Object.values(VOICE_PIPELINE_PROVIDERS);
}

export function getVoicePipelineProviderMetadata(
  provider: VoicePipelineProvider,
): VoicePipelineProviderMetadata {
  return VOICE_PIPELINE_PROVIDERS[provider];
}

export function listVoicePipelineProvidersByCategory(
  category: VoicePipelineCategory,
): VoicePipelineProviderMetadata[] {
  return listVoicePipelineProviders().filter((p) => p.category === category);
}
