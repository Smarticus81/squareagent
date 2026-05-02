/**
 * LiveKit Agents adapter.
 *
 * The server mints a short-lived participant access token (JWT signed with
 * LIVEKIT_API_SECRET) and returns it as a `signed_url` handshake. The
 * client uses that token + the LiveKit URL to join a room. A LiveKit
 * Agent Worker (separate Python/Node service running the
 * `@livekit/agents` framework) is expected to be subscribed to the
 * VoyceLab project; when a participant joins, the worker dispatches an
 * agent into the room. VoyceLab's tool definitions are passed in the
 * room metadata so the agent worker can register them dynamically.
 *
 * Without a LiveKit Agent Worker deployed, joining the room succeeds
 * but no agent will respond. Availability reports this honestly.
 *
 * Docs: https://docs.livekit.io/agents/
 */

import jwt from "jsonwebtoken";
import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";

function readUrl(): string {
  return process.env.LIVEKIT_URL ?? "";
}
function readApiKey(): string {
  return process.env.LIVEKIT_API_KEY ?? "";
}
function readApiSecret(): string {
  return process.env.LIVEKIT_API_SECRET ?? "";
}

let probeCache: { ok: boolean; reason?: string; expiresAt: number } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

async function probeLiveKit(): Promise<{ ok: boolean; reason?: string }> {
  if (probeCache && probeCache.expiresAt > Date.now()) return probeCache;
  const url = readUrl();
  const apiKey = readApiKey();
  const secret = readApiSecret();
  if (!url || !apiKey || !secret) {
    probeCache = { ok: false, reason: "credentials missing", expiresAt: Date.now() + PROBE_TTL_MS };
    return probeCache;
  }
  // LiveKit URL is wss://… for client connections. The signing API key
  // can be validated by minting a no-op token; if minting succeeds the
  // credential pair is structurally valid. We can't ping the cloud
  // server without an HTTP variant, so we accept structural validation.
  try {
    mintLiveKitToken({
      identity: "voycelab-probe",
      roomName: "voycelab-probe-room",
      ttlSeconds: 30,
    });
    probeCache = { ok: true, expiresAt: Date.now() + PROBE_TTL_MS };
    return probeCache;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "probe failed";
    probeCache = { ok: false, reason, expiresAt: Date.now() + 30_000 };
    return probeCache;
  }
}

export class LiveKitAgentsAdapter implements VoicePipelineAdapter {
  readonly provider = "livekit_agents" as const;
  readonly category = "realtime_orchestration_framework" as const;
  readonly displayName = "LiveKit Agents";
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"] = [
    "enterprise_observability",
    "noisy_bar",
    "telephony_future",
  ];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = true;
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
    const missing: string[] = [];
    if (!readUrl()) missing.push("LIVEKIT_URL");
    if (!readApiKey()) missing.push("LIVEKIT_API_KEY");
    if (!readApiSecret()) missing.push("LIVEKIT_API_SECRET");
    if (missing.length > 0) {
      return {
        status: "needs_configuration",
        reason: `Missing: ${missing.join(", ")}. Required to mint room access tokens. The LiveKit Agent Worker (separate service) must also be deployed and subscribed to this project for an agent to respond.`,
        missing,
      };
    }
    const probe = await probeLiveKit();
    if (!probe.ok) {
      return {
        status: "needs_configuration",
        reason: `LiveKit credentials rejected: ${probe.reason ?? "unknown error"}.`,
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const url = readUrl();
    const apiKey = readApiKey();
    const secret = readApiSecret();
    if (!url || !apiKey || !secret) throw new Error("LiveKit credentials missing");

    const roomName = `voycelab-${ctx.agentProfileId}-${Date.now()}`;
    const identity = `user-${ctx.userId}-${Date.now()}`;

    const tools = (ctx.providerOptions.tools as Array<{ name: string; description?: string; parameters?: unknown }>) ?? [];
    const metadata = JSON.stringify({
      voycelab: {
        agentProfileId: ctx.agentProfileId,
        agentDisplayName: ctx.agentDisplayName,
        instructions: ctx.instructions,
        tools,
        // The agent worker is expected to relay every tool call back to
        // the VoyceLab API at /api/v1/tool-calls so executions stay
        // auditable in our DB.
        toolCallEndpoint: process.env.PUBLIC_BASE_URL
          ? `${process.env.PUBLIC_BASE_URL}/api/v1/tool-calls`
          : "/api/v1/tool-calls",
      },
    });

    const token = mintLiveKitToken({
      identity,
      roomName,
      ttlSeconds: 60 * 60,
      metadata,
    });

    return {
      sessionId: `lk-${ctx.userId}-${Date.now()}`,
      provider: this.provider,
      clientHandshake: {
        kind: "signed_url",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        payload: {
          url,
          token,
          roomName,
          identity,
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
    /* LiveKit rooms auto-close when the last participant leaves. */
  }
}

interface MintTokenOptions {
  identity: string;
  roomName: string;
  ttlSeconds: number;
  metadata?: string;
}

/** Mint a LiveKit access token. Compatible with livekit-server-sdk's AccessToken. */
export function mintLiveKitToken(opts: MintTokenOptions): string {
  const apiKey = readApiKey();
  const secret = readApiSecret();
  if (!apiKey || !secret) throw new Error("LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing");
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: apiKey,
    sub: opts.identity,
    nbf: now,
    exp: now + opts.ttlSeconds,
    name: opts.identity,
    video: {
      room: opts.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  if (opts.metadata) claims.metadata = opts.metadata;
  return jwt.sign(claims, secret, { algorithm: "HS256" });
}
