/**
 * Durable voice-session metering — PostgreSQL-backed heartbeats and
 * exactly-once finalization for voice_minutes usage events.
 */

import { db, usageEventsTable, voiceSessionsTable } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { invalidateUsage } from "./usage-cache";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("voice-metering");

const STALE_HEARTBEAT_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface RegisterVoiceSessionParams {
  id: string;
  userId: number;
  organizationId: string | null;
  venueId: number | null;
  agentProfileId?: string | null;
  pipelineProvider?: string;
  metadata?: Record<string, unknown>;
}

export async function registerVoiceSession(params: RegisterVoiceSessionParams): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(voiceSessionsTable)
    .values({
      id: params.id,
      userId: params.userId,
      organizationId: params.organizationId,
      venueId: params.venueId,
      agentProfileId: params.agentProfileId ?? null,
      pipelineProvider: params.pipelineProvider ?? null,
      state: {},
      expiresAt,
      lastHeartbeatAt: new Date(),
      metadata: params.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: voiceSessionsTable.id,
      set: {
        updatedAt: new Date(),
        expiresAt,
        pipelineProvider: params.pipelineProvider ?? sql`${voiceSessionsTable.pipelineProvider}`,
        agentProfileId: params.agentProfileId ?? sql`${voiceSessionsTable.agentProfileId}`,
      },
    });
}

export async function recordVoiceHeartbeat(params: {
  sessionId: string;
  userId: number;
  organizationId: string | null;
  elapsedMs: number;
  venueId?: number;
  provider?: string;
  agentProfileId?: string | null;
}): Promise<boolean> {
  const result = await db
    .update(voiceSessionsTable)
    .set({
      meteredDurationMs: sql`GREATEST(${voiceSessionsTable.meteredDurationMs}, ${Math.max(0, params.elapsedMs)})`,
      lastHeartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(voiceSessionsTable.id, params.sessionId),
        eq(voiceSessionsTable.userId, params.userId),
        isNull(voiceSessionsTable.finalizedAt),
      ),
    )
    .returning({ id: voiceSessionsTable.id });

  return result.length > 0;
}

export interface FinalizeResult {
  finalized: boolean;
  alreadyFinalized: boolean;
  durationMs: number;
}

export async function finalizeVoiceSessionUsage(params: {
  sessionId: string;
  userId: number;
  organizationId: string | null;
  durationMs?: number;
  provider?: string;
  venueId?: number;
  agentProfileId?: string | null;
  autoFlushed?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<FinalizeResult> {
  const effectiveDuration = Math.max(0, params.durationMs ?? 0);

  const updated = await db
    .update(voiceSessionsTable)
    .set({
      endedAt: sql`COALESCE(${voiceSessionsTable.endedAt}, NOW())`,
      finalizedAt: new Date(),
      finalizedDurationMs: sql`GREATEST(${voiceSessionsTable.meteredDurationMs}, ${effectiveDuration})`,
      meteredDurationMs: sql`GREATEST(${voiceSessionsTable.meteredDurationMs}, ${effectiveDuration})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(voiceSessionsTable.id, params.sessionId),
        eq(voiceSessionsTable.userId, params.userId),
        isNull(voiceSessionsTable.finalizedAt),
      ),
    )
    .returning({
      id: voiceSessionsTable.id,
      finalizedDurationMs: voiceSessionsTable.finalizedDurationMs,
      organizationId: voiceSessionsTable.organizationId,
      agentProfileId: voiceSessionsTable.agentProfileId,
      venueId: voiceSessionsTable.venueId,
      pipelineProvider: voiceSessionsTable.pipelineProvider,
    });

  if (updated.length === 0) {
    const [existing] = await db
      .select({
        finalizedAt: voiceSessionsTable.finalizedAt,
        finalizedDurationMs: voiceSessionsTable.finalizedDurationMs,
      })
      .from(voiceSessionsTable)
      .where(eq(voiceSessionsTable.id, params.sessionId))
      .limit(1);

    return {
      finalized: false,
      alreadyFinalized: Boolean(existing?.finalizedAt),
      durationMs: existing?.finalizedDurationMs ?? 0,
    };
  }

  const row = updated[0];
  const billedMs = row.finalizedDurationMs ?? effectiveDuration;

  if (billedMs > 0) {
    try {
      await db
        .insert(usageEventsTable)
        .values({
          kind: "voice_minutes",
          userId: params.userId,
          organizationId: params.organizationId ?? row.organizationId,
          sessionId: params.sessionId,
          agentProfileId: params.agentProfileId ?? row.agentProfileId,
          quantity: Math.ceil(billedMs / 60_000),
          metadata: {
            durationMs: billedMs,
            provider: params.provider ?? row.pipelineProvider ?? "openai_realtime_webrtc",
            venueId: params.venueId ?? row.venueId ?? null,
            autoFlushed: params.autoFlushed ?? false,
            ...(params.metadata ?? {}),
          },
        })
        .onConflictDoNothing();
      invalidateUsage(params.userId, params.organizationId ?? row.organizationId);
    } catch (err: any) {
      log.warn({ sessionId: params.sessionId, err: err.message }, "usage insert failed");
    }
  }

  return { finalized: true, alreadyFinalized: false, durationMs: billedMs };
}

export async function sweepStaleVoiceSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const stale = await db
    .select({
      id: voiceSessionsTable.id,
      userId: voiceSessionsTable.userId,
      organizationId: voiceSessionsTable.organizationId,
      meteredDurationMs: voiceSessionsTable.meteredDurationMs,
      agentProfileId: voiceSessionsTable.agentProfileId,
      venueId: voiceSessionsTable.venueId,
      pipelineProvider: voiceSessionsTable.pipelineProvider,
    })
    .from(voiceSessionsTable)
    .where(
      and(
        isNull(voiceSessionsTable.finalizedAt),
        lt(voiceSessionsTable.lastHeartbeatAt, cutoff),
        sql`${voiceSessionsTable.meteredDurationMs} > 0`,
      ),
    )
    .limit(50);

  let flushed = 0;
  for (const row of stale) {
    const result = await finalizeVoiceSessionUsage({
      sessionId: row.id,
      userId: row.userId,
      organizationId: row.organizationId,
      durationMs: row.meteredDurationMs ?? 0,
      provider: row.pipelineProvider ?? undefined,
      venueId: row.venueId ?? undefined,
      agentProfileId: row.agentProfileId,
      autoFlushed: true,
    });
    if (result.finalized) flushed++;
  }
  if (flushed > 0) {
    log.info({ flushed }, "autoflushed stale voice sessions");
  }
  return flushed;
}

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

export function startVoiceSessionSweeper(): void {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    sweepStaleVoiceSessions().catch((err) => {
      log.warn({ err: err.message }, "stale session sweep failed");
    });
  }, 60_000);
  if (typeof sweeperTimer.unref === "function") sweeperTimer.unref();
}

export function stopVoiceSessionSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}
