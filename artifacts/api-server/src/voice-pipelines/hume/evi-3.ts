/**
 * Hume EVI 3 (Empathic Voice Interface) adapter.
 *
 * Hume's chat WebSocket exchanges JSON messages and base64-encoded audio
 * frames. We relay the connection through /api/realtime/hume so the API
 * key stays on the server. Tool calls arrive as `tool_call` messages and
 * are executed via the shared executeToolCall path; results are returned
 * to Hume as `tool_response` messages.
 *
 * Docs: https://dev.hume.ai/docs/empathic-voice-interface-evi/overview
 */

import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

const HUME_WS_BASE = "wss://api.hume.ai/v0/evi/chat";

function readApiKey(): string {
  return process.env.HUME_API_KEY ?? "";
}
function readConfigId(): string {
  return process.env.HUME_CONFIG_ID ?? "";
}

let probeCache: { ok: boolean; status: number; reason?: string; expiresAt: number } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

async function probeHume(apiKey: string): Promise<{ ok: boolean; status: number; reason?: string }> {
  if (probeCache && probeCache.expiresAt > Date.now()) return probeCache;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://api.hume.ai/v0/evi/configs", {
      headers: { "X-Hume-Api-Key": apiKey },
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

export class HumeEvi3Adapter implements VoicePipelineAdapter {
  readonly provider = "hume_evi_3" as const;
  readonly category = "native_realtime_speech_to_speech" as const;
  readonly displayName = "Hume EVI 3";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = ["best_voice_quality"];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = true;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = true;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    const apiKey = readApiKey();
    if (!apiKey) {
      return {
        status: "needs_configuration",
        reason: "HUME_API_KEY not set on the server.",
        missing: ["HUME_API_KEY"],
      };
    }
    const probe = await probeHume(apiKey);
    if (!probe.ok) {
      return {
        status: "needs_configuration",
        reason: `Hume key rejected (HTTP ${probe.status}). ${probe.reason ?? ""}`.trim(),
        missing: ["HUME_API_KEY"],
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    if (!readApiKey()) throw new Error("HUME_API_KEY missing");
    const sessionId = `hume-${ctx.userId}-${Date.now()}`;
    return {
      sessionId,
      provider: this.provider,
      clientHandshake: {
        kind: "ws_relay",
        payload: {
          path: "/api/realtime/hume",
          query: {
            sessionId,
            agentProfileId: ctx.agentProfileId,
            configId: readConfigId() || undefined,
          },
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

export function buildHumeWsUrl(configId?: string): string {
  const apiKey = readApiKey();
  if (!apiKey) throw new Error("HUME_API_KEY missing");
  const params = new URLSearchParams({ api_key: apiKey });
  if (configId) params.set("config_id", configId);
  return `${HUME_WS_BASE}?${params.toString()}`;
}

/** Build the session_settings payload to inject system instructions and tools. */
export function buildHumeSessionSettings(
  instructions: string,
  tools: ReadonlyArray<{ name: string; description?: string; parameters?: unknown }>,
): Record<string, unknown> {
  return {
    type: "session_settings",
    system_prompt: instructions,
    tools: tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description ?? "",
      parameters: t.parameters ?? { type: "object", properties: {} },
    })),
    audio: { encoding: "linear16", sample_rate: 16000, channels: 1 },
  };
}
