import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
  VoicePipelineToolResultContext,
  VoicePipelineInterruptContext,
} from "@workspace/voicelab-core/voice-pipeline";
import { readServerApiKey, requireServerApiKey, requiredApiKeyEnv } from "../../lib/api-keys";
import { OPENAI_REALTIME_MODEL, buildRealtimeSessionPayload } from "../../lib/openai-realtime";

function readApiKey(): string {
  return readServerApiKey("openai")?.value ?? "";
}

/**
 * OpenAI Realtime via WebRTC. The server only mints the ephemeral client
 * secret; the browser connects directly to OpenAI for audio. Tool calls
 * arrive on the data channel and the client posts them to /api/v1/tool-calls.
 */
export class OpenAiRealtimeWebRtcAdapter implements VoicePipelineAdapter {
  readonly provider = "openai_realtime_webrtc" as const;
  readonly category = "native_realtime_speech_to_speech" as const;
  readonly displayName = "OpenAI Realtime (WebRTC)";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "lowest_latency_browser",
    "best_tool_control",
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

  readonly requiresServerRelay = false;
  readonly requiresEphemeralToken = true;
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
    const apiKey = requireServerApiKey("openai").value;
    const session = buildRealtimeSessionPayload({
      instructions: ctx.instructions,
      tools: ctx.providerOptions.tools as unknown[] | undefined,
      voice: ctx.providerOptions.voice ?? "ash",
      speed: ctx.providerOptions.speed,
      turnDetection: {
        type: "semantic_vad",
        eagerness: "auto",
        create_response: true,
        interrupt_response: true,
      },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({ session }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`OpenAI client_secret HTTP ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { value?: string; expires_at?: string; session?: { id?: string } };
      return {
        sessionId: data.session?.id ?? `oa-rt-${Date.now()}`,
        provider: this.provider,
        clientHandshake: {
          kind: "ephemeral_token",
          expiresAt: data.expires_at,
          payload: { value: data.value, model: OPENAI_REALTIME_MODEL },
        },
        capabilities: {
          nativeAudio: true,
          realtimeToolCalling: true,
          bargeIn: true,
          serverVAD: true,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendToolResult(_ctx: VoicePipelineToolResultContext): Promise<void> {
    // Client posts tool results back to OpenAI directly via the data channel.
    // No server action is required for the WebRTC path.
  }

  async interrupt(_ctx: VoicePipelineInterruptContext): Promise<void> {
    // Interrupt is initiated by the client on the data channel.
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    // Stateless on the server side.
  }
}
