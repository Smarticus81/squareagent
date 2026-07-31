import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";
import { readServerApiKey, requiredApiKeyEnv } from "../../lib/api-keys";

function readApiKey(): string {
  return readServerApiKey("xai")?.value ?? "";
}

/**
 * xAI Grok Voice (Realtime) over a server-controlled WebSocket relay. The
 * browser/PWA connects to the VoyceLab WS gateway at /api/realtime/xai; the
 * gateway owns the upstream xAI Realtime session (wss://api.x.ai/v1/realtime)
 * and proxies audio/events. xAI's realtime protocol mirrors the OpenAI
 * Realtime event model, so the relay reuses the shared realtime handler and
 * only normalizes xAI's GA event names before forwarding to the client.
 *
 * Session creation here returns the WS endpoint the client should connect to.
 * Actual relay logic lives in routes/ws-relay.ts.
 */
export class XaiGrokRealtimeWsAdapter implements VoicePipelineAdapter {
  readonly provider = "xai_grok_realtime_ws" as const;
  readonly category = "native_realtime_speech_to_speech" as const;
  readonly displayName = "xAI Grok Voice (Realtime)";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "best_voice_quality",
    "best_turn_taking",
    "enterprise_observability",
  ];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = true;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = true;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    if (!readApiKey()) {
      return {
        status: "needs_configuration",
        reason: `${requiredApiKeyEnv("xai")} not set on the server.`,
        missing: [requiredApiKeyEnv("xai")],
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const sessionId = `xai-ws-${ctx.userId}-${Date.now()}`;
    return {
      sessionId,
      provider: this.provider,
      clientHandshake: {
        kind: "ws_relay",
        payload: {
          path: "/api/realtime/xai",
          query: { sessionId, agentProfileId: ctx.agentProfileId },
        },
      },
      capabilities: {
        nativeAudio: true,
        realtimeToolCalling: true,
        bargeIn: true,
        serverVAD: true,
      },
    };
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    // Cleanup happens in ws-relay on socket close.
  }
}
