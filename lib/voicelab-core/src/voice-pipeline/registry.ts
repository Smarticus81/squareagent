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
  // -- Native realtime speech-to-speech ---
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
  google_gemini_3_1_flash_live: {
    provider: "google_gemini_3_1_flash_live",
    category: "native_realtime_speech_to_speech",
    displayName: "Gemini 3.1 Flash Live",
    shortDescription:
      "Google's newest native audio-to-audio Live model. Tunable thinking, multilingual audio, native barge-in, and strong noisy-room turn taking.",
    recommendedFor: [
      "lowest_latency_browser",
      "lowest_latency_mobile",
      "noisy_bar",
      "best_turn_taking",
      "best_tool_control",
    ],
    requiredCredentials: ["GOOGLE_GEMINI_API_KEY"],
    notes:
      "Preview model gemini-3.1-flash-live-preview. Stateful WebSocket session, 16kHz PCM in / 24kHz PCM out, native barge-in.",
  },
  google_gemini_2_5_flash_native_audio: {
    provider: "google_gemini_2_5_flash_native_audio",
    category: "native_realtime_speech_to_speech",
    displayName: "Gemini 2.5 Flash Native Audio",
    shortDescription:
      "Native audio Live model with Proactive Audio and Affective Dialog for venue environments where the assistant should stay quiet until addressed.",
    recommendedFor: ["best_voice_quality", "best_turn_taking", "enterprise_observability"],
    requiredCredentials: ["GOOGLE_GEMINI_API_KEY"],
    notes:
      "Model gemini-2.5-flash-native-audio-preview-12-2025. Recommended when proactive listening and affective dialogue matter more than the absolute newest preview.",
  },
  xai_grok_realtime_ws: {
    provider: "xai_grok_realtime_ws",
    category: "native_realtime_speech_to_speech",
    displayName: "xAI Grok Voice (Realtime)",
    shortDescription:
      "xAI's premium Grok realtime speech-to-speech over a server WebSocket relay. Expressive native audio, server VAD barge-in, and realtime tool calling.",
    recommendedFor: ["best_voice_quality", "best_turn_taking", "enterprise_observability"],
    requiredCredentials: ["XAI_API_KEY"],
    notes:
      "Model grok-voice-latest via wss://api.x.ai/v1/realtime. Server-controlled relay, 24kHz PCM in/out, native barge-in. Set XAI_API_KEY to enable.",
  },
  // -- Fallbacks ---
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
    recommendedFor: ["loud_venue", "offline_or_degraded"],
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


