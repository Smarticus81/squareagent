/**
 * ElevenLabs Conversational AI Agents adapter.
 *
 * Connects the browser/native client to a pre-configured ElevenLabs
 * agent over the WebSocket Conversation API. The server mints a signed
 * URL (so the API key never leaves the box) and returns it as the
 * `signed_url` handshake; the client opens the WS directly to
 * ElevenLabs and streams 16kHz PCM both ways.
 *
 * Tools: VoyceLab tools are forwarded as `client_tools` in the
 * conversation_initiation_client_data overrides. The client receives
 * `client_tool_call` events, posts them to /api/v1/tool-calls, and
 * sends `client_tool_result` back over the same WebSocket.
 *
 * Docs: https://elevenlabs.io/docs/conversational-ai/api-reference
 */

import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

interface ProbeVerdict {
  ok: boolean;
  status: number;
  reason?: string;
}
let probeCache: { verdict: ProbeVerdict; expiresAt: number } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

function readApiKey(): string {
  return process.env.ELEVENLABS_API_KEY ?? "";
}

function readAgentId(): string {
  return process.env.ELEVENLABS_AGENT_ID ?? "";
}

async function probeElevenLabs(apiKey: string): Promise<ProbeVerdict> {
  if (probeCache && probeCache.expiresAt > Date.now()) return probeCache.verdict;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": apiKey },
      signal: ctrl.signal,
    });
    const verdict: ProbeVerdict = res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, reason: await res.text().then((s) => s.slice(0, 200)).catch(() => "") };
    probeCache = { verdict, expiresAt: Date.now() + PROBE_TTL_MS };
    return verdict;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "probe failed";
    const verdict: ProbeVerdict = { ok: false, status: 0, reason };
    probeCache = { verdict, expiresAt: Date.now() + 30_000 };
    return verdict;
  } finally {
    clearTimeout(t);
  }
}

export class ElevenLabsAgentsAdapter implements VoicePipelineAdapter {
  readonly provider = "elevenlabs_agents" as const;
  readonly category = "managed_voice_agent_api" as const;
  readonly displayName = "ElevenLabs Agents";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "best_voice_quality",
    "lowest_latency_mobile",
  ];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = true;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = false;
  readonly requiresEphemeralToken = true;
  readonly requiresProviderAgentConfig = true;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    const apiKey = readApiKey();
    const agentId = readAgentId();
    const missing: string[] = [];
    if (!apiKey) missing.push("ELEVENLABS_API_KEY");
    if (!agentId) missing.push("ELEVENLABS_AGENT_ID");
    if (missing.length > 0) {
      return {
        status: "needs_configuration",
        reason: `Missing required credentials: ${missing.join(", ")}. Create an agent in the ElevenLabs Conversational AI dashboard, copy its agent ID, and generate an API key with conversational_ai access.`,
        missing,
      };
    }
    const probe = await probeElevenLabs(apiKey);
    if (!probe.ok) {
      return {
        status: "needs_configuration",
        reason: `ElevenLabs key rejected (HTTP ${probe.status}). ${probe.reason ?? ""}`.trim(),
        missing: ["ELEVENLABS_API_KEY"],
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const apiKey = readApiKey();
    const agentId = readAgentId();
    if (!apiKey || !agentId) {
      throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing");
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
        { headers: { "xi-api-key": apiKey }, signal: ctrl.signal },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`ElevenLabs signed URL HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
      const data = (await res.json()) as { signed_url?: string; expires_at?: string };
      if (!data.signed_url) throw new Error("ElevenLabs signed URL missing in response");
      const tools = (ctx.providerOptions.tools as Array<{ name: string; description?: string; parameters?: unknown }>) ?? [];
      const voiceOverride = ctx.providerOptions.voice as string | undefined;
      const overrides: Record<string, unknown> = {
        agent: {
          prompt: { prompt: ctx.instructions },
          first_message: `Hi, this is ${ctx.agentDisplayName}. What can I do for you?`,
        },
      };
      if (voiceOverride) overrides.tts = { voice_id: voiceOverride };
      return {
        sessionId: `el-${ctx.userId}-${Date.now()}`,
        provider: this.provider,
        clientHandshake: {
          kind: "signed_url",
          expiresAt: data.expires_at,
          payload: {
            url: data.signed_url,
            agentId,
            overrides,
            // The client should register these as `client_tools` and route
            // each invocation through POST /api/v1/tool-calls.
            clientTools: tools.map((t) => ({
              name: t.name,
              description: t.description ?? "",
              parameters: t.parameters ?? { type: "object", properties: {} },
            })),
          },
        },
        capabilities: {
          nativeAudio: true,
          realtimeToolCalling: true,
          bargeIn: true,
          serverVAD: true,
        },
      };
    } finally {
      clearTimeout(t);
    }
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    // Stateless on the server side; client closes its own WebSocket.
  }
}
