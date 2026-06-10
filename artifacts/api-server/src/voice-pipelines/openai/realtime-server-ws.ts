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
  return readServerApiKey("openai")?.value ?? "";
}

/**
 * Server-controlled WebSocket relay to OpenAI Realtime. Mobile clients and
 * enterprise deployments connect to the VoyceLab WS gateway; the gateway
 * owns the OpenAI session and proxies audio/events.
 *
 * Session creation here returns the WS endpoint the client should connect
 * to. Actual relay logic lives in routes/ws-relay.ts.
 */
export class OpenAiRealtimeServerWsAdapter implements VoicePipelineAdapter {
  readonly provider = "openai_realtime_server_ws" as const;
  readonly category = "native_realtime_speech_to_speech" as const;
  readonly displayName = "OpenAI Realtime (Server WebSocket)";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "enterprise_observability",
    "lowest_latency_mobile",
    "telephony_future",
  ];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = true;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = false;
  // The relay itself does not do wake detection, but VoyceLab clients can use
  // the shared PWA/mobile wake layer before opening the server WS session.
  readonly supportsWakeWord = true;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = false;

  readonly requiresServerRelay = true;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    if (!readApiKey()) {
      return {
        status: "needs_configuration",
        reason: `${requiredApiKeyEnv("openai")} not set on the server.`,
        missing: [requiredApiKeyEnv("openai")],
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const sessionId = `oa-ws-${ctx.userId}-${Date.now()}`;
    return {
      sessionId,
      provider: this.provider,
      clientHandshake: {
        kind: "ws_relay",
        payload: {
          path: "/api/realtime",
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
