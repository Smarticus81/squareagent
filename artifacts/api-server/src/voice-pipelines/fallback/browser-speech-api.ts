import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

/**
 * Browser SpeechRecognition / SpeechSynthesis fallback. Server returns a
 * config-only handshake; client implements the actual loop locally.
 */
export class BrowserSpeechApiAdapter implements VoicePipelineAdapter {
  readonly provider = "browser_speech_api_fallback" as const;
  readonly category = "browser_or_manual_fallback" as const;
  readonly displayName = "Browser Speech API (degraded)";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = ["offline_or_degraded"];

  readonly supportsNativeAudio = false;
  readonly supportsRealtimeToolCalling = false;
  readonly supportsBargeIn = false;
  readonly supportsServerVAD = false;
  readonly supportsClientVAD = true;
  readonly supportsTurnDetection = false;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = false;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = false;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    return {
      status: "available",
      reason: "Available in supported browsers. Marked degraded; not for production.",
    };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    return {
      sessionId: `browser-${ctx.userId}-${Date.now()}`,
      provider: this.provider,
      clientHandshake: {
        kind: "config_only",
        payload: { mode: "browser_speech_api", agentDisplayName: ctx.agentDisplayName },
      },
      capabilities: {
        nativeAudio: false,
        realtimeToolCalling: false,
        bargeIn: false,
        serverVAD: false,
      },
    };
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    /* no-op */
  }
}
