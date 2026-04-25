import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

/**
 * Push-to-talk text fallback. Always available, no provider needed.
 * Client renders large confirmation UI; commands are typed or dictated
 * locally and submitted via /api/v1/tool-calls.
 */
export class PushToTalkTextAdapter implements VoicePipelineAdapter {
  readonly provider = "push_to_talk_text_fallback" as const;
  readonly category = "browser_or_manual_fallback" as const;
  readonly displayName = "Push-to-talk text";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "nightclub",
    "offline_or_degraded",
  ];

  readonly supportsNativeAudio = false;
  readonly supportsRealtimeToolCalling = false;
  readonly supportsBargeIn = false;
  readonly supportsServerVAD = false;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = false;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = false;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    return { status: "available", reason: "Always available; no credentials required." };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    return {
      sessionId: `ptt-${ctx.userId}-${Date.now()}`,
      provider: this.provider,
      clientHandshake: {
        kind: "noop",
        payload: { agentDisplayName: ctx.agentDisplayName },
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

export class TextOnlyAdapter implements VoicePipelineAdapter {
  readonly provider = "text_only_fallback" as const;
  readonly category = "browser_or_manual_fallback" as const;
  readonly displayName = "Text only";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = ["offline_or_degraded"];

  readonly supportsNativeAudio = false;
  readonly supportsRealtimeToolCalling = false;
  readonly supportsBargeIn = false;
  readonly supportsServerVAD = false;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = false;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = false;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    return { status: "available", reason: "Always available; type commands instead of speaking." };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    return {
      sessionId: `text-${ctx.userId}-${Date.now()}`,
      provider: this.provider,
      clientHandshake: { kind: "noop", payload: { agentDisplayName: ctx.agentDisplayName } },
      capabilities: { nativeAudio: false, realtimeToolCalling: false, bargeIn: false, serverVAD: false },
    };
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    /* no-op */
  }
}
