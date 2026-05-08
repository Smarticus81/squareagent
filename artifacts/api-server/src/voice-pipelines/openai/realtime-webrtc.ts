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

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const REALTIME_REASONING_EFFORT =
  (process.env.OPENAI_REALTIME_REASONING_EFFORT as "minimal" | "low" | "medium" | "high" | undefined) ?? "low";

function readApiKey(): string {
  return process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
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
        reason: "OPENAI_API_KEY not set on the server.",
        missing: ["OPENAI_API_KEY"],
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const apiKey = readApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY missing");
    }
    const voice = (ctx.providerOptions.voice as string | undefined) ?? "ash";
    const speed = (ctx.providerOptions.speed as number | undefined) ?? 1.0;
    const session = {
      type: "realtime" as const,
      model: REALTIME_MODEL,
      instructions: ctx.instructions,
      tools: ctx.providerOptions.tools as unknown[] | undefined,
      tool_choice: "auto" as const,
      output_modalities: ["audio" as const],
      reasoning: { effort: REALTIME_REASONING_EFFORT },
      audio: {
        input: {
          format: { type: "audio/pcm" as const, rate: 24000 as const },
          transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad" as const,
            threshold: 0.5,
            prefix_padding_ms: 150,
            silence_duration_ms: 300,
            create_response: true,
          },
        },
        output: {
          format: { type: "audio/pcm" as const, rate: 24000 as const },
          voice,
          speed,
        },
      },
    };

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
          payload: { value: data.value, model: REALTIME_MODEL },
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
