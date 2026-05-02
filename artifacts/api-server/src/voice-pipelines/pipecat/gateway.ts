/**
 * Pipecat adapter — delegates to a self-hosted Pipecat runtime.
 *
 * Pipecat is a Python framework for orchestrating modular voice flows.
 * VoyceLab does not ship a Pipecat runtime; instead the operator deploys
 * one and points PIPECAT_GATEWAY_URL at it. The gateway is expected to
 * implement two endpoints:
 *
 *   GET  {PIPECAT_GATEWAY_URL}/healthz  — must return 200
 *   POST {PIPECAT_GATEWAY_URL}/sessions — body: { agentProfileId,
 *        agentDisplayName, instructions, tools, userId }; returns
 *        { sessionId, wsUrl, expiresAt }
 *
 * The browser/native client opens `wsUrl` directly. Tool calls travel
 * over the same websocket and the gateway is expected to call back to
 * /api/v1/tool-calls on the VoyceLab API server for execution.
 */

import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

function readGatewayUrl(): string {
  return process.env.PIPECAT_GATEWAY_URL ?? "";
}
function readGatewayToken(): string {
  return process.env.PIPECAT_GATEWAY_TOKEN ?? "";
}

let probeCache: { ok: boolean; reason?: string; expiresAt: number } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

async function probePipecat(gateway: string): Promise<{ ok: boolean; reason?: string }> {
  if (probeCache && probeCache.expiresAt > Date.now()) return probeCache;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const headers: Record<string, string> = {};
    if (readGatewayToken()) headers.Authorization = `Bearer ${readGatewayToken()}`;
    const res = await fetch(new URL("/healthz", gateway).toString(), {
      headers,
      signal: ctrl.signal,
    });
    const verdict = res.ok
      ? { ok: true, expiresAt: Date.now() + PROBE_TTL_MS }
      : {
          ok: false,
          reason: `gateway HTTP ${res.status}`,
          expiresAt: Date.now() + PROBE_TTL_MS,
        };
    probeCache = verdict;
    return verdict;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "probe failed";
    probeCache = { ok: false, reason, expiresAt: Date.now() + 30_000 };
    return probeCache;
  } finally {
    clearTimeout(t);
  }
}

export class PipecatGatewayAdapter implements VoicePipelineAdapter {
  readonly provider = "pipecat" as const;
  readonly category = "realtime_orchestration_framework" as const;
  readonly displayName = "Pipecat";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = ["enterprise_observability"];

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

  readonly requiresServerRelay = false;
  readonly requiresEphemeralToken = true;
  readonly requiresProviderAgentConfig = true;

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    const gateway = readGatewayUrl();
    if (!gateway) {
      return {
        status: "needs_configuration",
        reason: "PIPECAT_GATEWAY_URL not set on the server.",
        missing: ["PIPECAT_GATEWAY_URL"],
      };
    }
    const probe = await probePipecat(gateway);
    if (!probe.ok) {
      return {
        status: "needs_configuration",
        reason: `Pipecat gateway not reachable: ${probe.reason ?? "unknown error"}.`,
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const gateway = readGatewayUrl();
    if (!gateway) throw new Error("PIPECAT_GATEWAY_URL missing");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (readGatewayToken()) headers.Authorization = `Bearer ${readGatewayToken()}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(new URL("/sessions", gateway).toString(), {
        method: "POST",
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          agentProfileId: ctx.agentProfileId,
          agentDisplayName: ctx.agentDisplayName,
          instructions: ctx.instructions,
          userId: ctx.userId,
          tools: ctx.providerOptions.tools ?? [],
          providerOptions: ctx.providerOptions,
          toolCallEndpoint: process.env.PUBLIC_BASE_URL
            ? `${process.env.PUBLIC_BASE_URL}/api/v1/tool-calls`
            : "/api/v1/tool-calls",
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Pipecat /sessions HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
      const body = (await res.json()) as { sessionId?: string; wsUrl?: string; expiresAt?: string };
      if (!body.wsUrl) throw new Error("Pipecat gateway returned no wsUrl");
      return {
        sessionId: body.sessionId ?? `pc-${ctx.userId}-${Date.now()}`,
        provider: this.provider,
        clientHandshake: {
          kind: "signed_url",
          expiresAt: body.expiresAt,
          payload: { url: body.wsUrl },
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
    /* The Pipecat gateway is responsible for cleaning up its own sessions. */
  }
}
