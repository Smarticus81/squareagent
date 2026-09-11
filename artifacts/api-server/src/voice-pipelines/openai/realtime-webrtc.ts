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
import { buildLiveSessionPayload, createLiveWebRtcSession, validLiveSdp } from "../../lib/openai-live";

function readApiKey(): string {
  return readServerApiKey("openai")?.value ?? "";
}

/**
 * GPT-Live via WebRTC. The server exchanges the browser SDP offer;
 * the browser connects directly to OpenAI for audio. Delegated tool calls
 * arrive on the data channel and the client posts them to /api/v1/tool-calls.
 */
export class OpenAiRealtimeWebRtcAdapter implements VoicePipelineAdapter {
  readonly provider = "openai_realtime_webrtc" as const;
  readonly category = "native_realtime_speech_to_speech" as const;
  readonly displayName = "OpenAI GPT-Live 1 (WebRTC)";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "lowest_latency_browser",
    "best_tool_control",
  ];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = false;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = false;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = true;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = false;
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
    const sdp = ctx.providerOptions.sdp;
    if (!validLiveSdp(sdp)) throw new Error("A valid audio SDP offer is required");
    const data = await createLiveWebRtcSession(requireServerApiKey("openai").value, buildLiveSessionPayload({
      instructions: ctx.instructions,
      displayName: ctx.agentDisplayName,
      tools: ctx.providerOptions.tools as unknown[],
      voice: ctx.providerOptions.voice,
      speed: ctx.providerOptions.speed,
    }), sdp);
    return {
      sessionId: data.id, provider: this.provider,
      clientHandshake: { kind: "sdp_answer", payload: { ...data } },
      capabilities: { nativeAudio: true, realtimeToolCalling: true, bargeIn: true, serverVAD: false },
    };
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
