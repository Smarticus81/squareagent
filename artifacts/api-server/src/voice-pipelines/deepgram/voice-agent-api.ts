/**
 * Deepgram Voice Agent API adapter.
 *
 * Streams audio to wss://agent.deepgram.com/v1/agent/converse over a
 * server-side relay (so the API key stays on the server). Uses
 * Deepgram's combined STT + LLM + TTS pipeline with built-in tool
 * calling. Tool invocations are executed via the shared executeToolCall
 * path; results are sent back as `FunctionCallResponse` messages.
 *
 * Docs: https://developers.deepgram.com/docs/voice-agent
 */

import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

const DEEPGRAM_AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";

function readApiKey(): string {
  return process.env.DEEPGRAM_API_KEY ?? "";
}

let probeCache: { ok: boolean; status: number; reason?: string; expiresAt: number } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

async function probeDeepgram(apiKey: string): Promise<{ ok: boolean; status: number; reason?: string }> {
  if (probeCache && probeCache.expiresAt > Date.now()) return probeCache;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}` },
      signal: ctrl.signal,
    });
    const verdict = res.ok
      ? { ok: true, status: res.status, expiresAt: Date.now() + PROBE_TTL_MS }
      : {
          ok: false,
          status: res.status,
          reason: await res.text().then((s) => s.slice(0, 200)).catch(() => ""),
          expiresAt: Date.now() + PROBE_TTL_MS,
        };
    probeCache = verdict;
    return verdict;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "probe failed";
    probeCache = { ok: false, status: 0, reason, expiresAt: Date.now() + 30_000 };
    return probeCache;
  } finally {
    clearTimeout(t);
  }
}

export class DeepgramVoiceAgentAdapter implements VoicePipelineAdapter {
  readonly provider = "deepgram_voice_agent_api" as const;
  readonly category = "managed_voice_agent_api" as const;
  readonly displayName = "Deepgram Voice Agent API";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "enterprise_observability",
    "best_tool_control",
  ];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = true;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = true;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    const apiKey = readApiKey();
    if (!apiKey) {
      return {
        status: "needs_configuration",
        reason: "DEEPGRAM_API_KEY not set on the server.",
        missing: ["DEEPGRAM_API_KEY"],
      };
    }
    const probe = await probeDeepgram(apiKey);
    if (!probe.ok) {
      return {
        status: "needs_configuration",
        reason: `Deepgram key rejected (HTTP ${probe.status}). ${probe.reason ?? ""}`.trim(),
        missing: ["DEEPGRAM_API_KEY"],
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    if (!readApiKey()) throw new Error("DEEPGRAM_API_KEY missing");
    const sessionId = `dg-agent-${ctx.userId}-${Date.now()}`;
    return {
      sessionId,
      provider: this.provider,
      clientHandshake: {
        kind: "ws_relay",
        payload: {
          path: "/api/realtime/deepgram-agent",
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
    /* Cleanup happens in ws-relay. */
  }
}

export function buildDeepgramAgentWsUrl(): string {
  return DEEPGRAM_AGENT_WS;
}

export function deepgramAgentAuthHeaders(): Record<string, string> {
  const apiKey = readApiKey();
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY missing");
  return { Authorization: `Token ${apiKey}` };
}

/**
 * Build the SettingsConfiguration message that Deepgram's Voice Agent API
 * expects as the very first frame after the WebSocket opens.
 */
export interface DeepgramAgentSettingsOpts {
  instructions: string;
  tools: ReadonlyArray<{ name: string; description?: string; parameters?: unknown }>;
  voice?: string;
  language?: string;
  greeting?: string;
}

export function buildDeepgramAgentSettings(opts: DeepgramAgentSettingsOpts): Record<string, unknown> {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: opts.language ?? "en",
      listen: {
        provider: { type: "deepgram", model: "nova-3" },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini" },
        prompt: opts.instructions,
        functions: opts.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          parameters: t.parameters ?? { type: "object", properties: {} },
        })),
      },
      speak: {
        provider: {
          type: "deepgram",
          model: opts.voice ?? "aura-2-asteria-en",
        },
      },
      greeting: opts.greeting ?? "",
    },
  };
}
