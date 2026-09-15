/**
 * Session Store — durable voice session state management.
 *
 * Uses in-memory Map as L1 cache for speed, with PostgreSQL as the
 * authoritative source of truth. Every mutation is persisted immediately;
 * background flush is a safety net only.
 */

import { db, voiceSessionsTable } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  cancelLiveOrder,
  type LiveSession,
} from "./square-helpers";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("session-store");

// ── Types ───────────────────────────────────────────────────────────────────

export interface ManagedSession {
  session: LiveSession;
  squareToken: string;
  squareLocationId: string;
  userId: number;
  organizationId: string | null;
  venueId: number;
  agentProfileId: string | null;
  pipelineProvider: string | null;
  stateVersion: number;
  lastAccess: number;
  dirty: boolean;
}

export interface SessionOwnership {
  userId: number;
  organizationId: string | null;
  venueId: number;
}

// ── Configuration ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 5_000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ── In-memory store ─────────────────────────────────────────────────────────

const memoryStore = new Map<string, ManagedSession>();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a new voice session row in PostgreSQL (called on session mint).
 */
export async function registerSessionRow(params: {
  sessionId: string;
  userId: number;
  organizationId: string | null;
  venueId: number | null;
  agentProfileId?: string | null;
  pipelineProvider?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(voiceSessionsTable)
    .values({
      id: params.sessionId,
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
      },
    });
}

/**
 * Get or rehydrate a session. On memory miss, loads from PostgreSQL.
 * Creates a new in-memory entry only if no DB row exists.
 */
export async function getSessionOrRehydrate(
  sessionId: string,
  squareToken: string,
  squareLocationId: string,
  ownership: SessionOwnership,
  agentProfileId?: string | null,
  pipelineProvider?: string,
): Promise<LiveSession> {
  const existing = memoryStore.get(sessionId);
  if (existing) {
    existing.lastAccess = Date.now();
    existing.squareToken = squareToken;
    existing.squareLocationId = squareLocationId;
    return existing.session;
  }

  // Try DB rehydrate
  const [row] = await db
    .select()
    .from(voiceSessionsTable)
    .where(
      and(
        eq(voiceSessionsTable.id, sessionId),
        eq(voiceSessionsTable.userId, ownership.userId),
        isNull(voiceSessionsTable.finalizedAt),
      ),
    )
    .limit(1);

  if (row && new Date(row.expiresAt) > new Date()) {
    const session = (row.state ?? { items: [] }) as LiveSession;
    if (row.squareOrderId && !session.squareOrderId) {
      session.squareOrderId = row.squareOrderId;
    }
    memoryStore.set(sessionId, {
      session,
      squareToken,
      squareLocationId,
      userId: ownership.userId,
      organizationId: ownership.organizationId,
      venueId: ownership.venueId,
      agentProfileId: row.agentProfileId,
      pipelineProvider: row.pipelineProvider,
      stateVersion: row.stateVersion ?? 0,
      lastAccess: Date.now(),
      dirty: false,
    });
    log.info({ sessionId, itemCount: session.items?.length ?? 0 }, "rehydrated session from DB");
    return session;
  }

  // Create fresh session
  const session: LiveSession = { items: [] };
  memoryStore.set(sessionId, {
    session,
    squareToken,
    squareLocationId,
    userId: ownership.userId,
    organizationId: ownership.organizationId,
    venueId: ownership.venueId,
    agentProfileId: agentProfileId ?? null,
    pipelineProvider: pipelineProvider ?? null,
    stateVersion: 0,
    lastAccess: Date.now(),
    dirty: true,
  });
  return session;
}

/** @deprecated Use getSessionOrRehydrate for hot path. Sync wrapper for legacy callers. */
export function getOrCreateSession(
  sessionId: string,
  squareToken: string,
  squareLocationId: string,
  userId: number,
  venueId: number,
): LiveSession {
  const existing = memoryStore.get(sessionId);
  if (existing) {
    existing.lastAccess = Date.now();
    existing.squareToken = squareToken;
    existing.squareLocationId = squareLocationId;
    return existing.session;
  }

  const session: LiveSession = { items: [] };
  memoryStore.set(sessionId, {
    session,
    squareToken,
    squareLocationId,
    userId,
    organizationId: null,
    venueId,
    agentProfileId: null,
    pipelineProvider: null,
    stateVersion: 0,
    lastAccess: Date.now(),
    dirty: true,
  });
  return session;
}

export function markDirty(sessionId: string): void {
  const entry = memoryStore.get(sessionId);
  if (entry) entry.dirty = true;
}

/**
 * Immediately persist session state to PostgreSQL with optimistic versioning.
 */
export async function persistSessionNow(sessionId: string): Promise<void> {
  const entry = memoryStore.get(sessionId);
  if (!entry) return;

  const expiresAt = new Date(entry.lastAccess + SESSION_TTL_MS);
  const expectedVersion = entry.stateVersion;

  try {
    const result = await db
      .update(voiceSessionsTable)
      .set({
        state: entry.session as any,
        squareOrderId: entry.session.squareOrderId ?? null,
        stateVersion: expectedVersion + 1,
        updatedAt: new Date(),
        expiresAt,
        venueId: entry.venueId > 0 ? entry.venueId : null,
        organizationId: entry.organizationId,
        agentProfileId: entry.agentProfileId,
        pipelineProvider: entry.pipelineProvider,
      })
      .where(
        and(
          eq(voiceSessionsTable.id, sessionId),
          eq(voiceSessionsTable.stateVersion, expectedVersion),
        ),
      )
      .returning({ stateVersion: voiceSessionsTable.stateVersion });

    if (result.length === 0) {
      // Version conflict — upsert instead
      await db
        .insert(voiceSessionsTable)
        .values({
          id: sessionId,
          userId: entry.userId,
          organizationId: entry.organizationId,
          venueId: entry.venueId > 0 ? entry.venueId : null,
          agentProfileId: entry.agentProfileId,
          pipelineProvider: entry.pipelineProvider,
          state: entry.session as any,
          squareOrderId: entry.session.squareOrderId ?? null,
          stateVersion: expectedVersion + 1,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: voiceSessionsTable.id,
          set: {
            state: entry.session as any,
            squareOrderId: entry.session.squareOrderId ?? null,
            stateVersion: expectedVersion + 1,
            updatedAt: new Date(),
            expiresAt,
          },
        });
    }

    entry.stateVersion = expectedVersion + 1;
    entry.dirty = false;
  } catch (e: any) {
    log.warn({ sessionId, err: e.message }, "failed to persist session");
  }
}

export function removeSession(sessionId: string): void {
  memoryStore.delete(sessionId);
  db.delete(voiceSessionsTable)
    .where(eq(voiceSessionsTable.id, sessionId))
    .catch(() => {});
}

export function getSession(sessionId: string): ManagedSession | undefined {
  return memoryStore.get(sessionId);
}

/**
 * Acquire a PostgreSQL advisory lock for serializing commands on a session.
 */
export async function withSessionLock<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = hashSessionId(sessionId);
  await db.execute(sql`SELECT pg_advisory_lock(${lockKey})`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`).catch(() => {});
  }
}

function hashSessionId(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Flush all dirty sessions — called during graceful shutdown. */
export async function flushAllDirtySessions(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [id, entry] of memoryStore) {
    if (entry.dirty) promises.push(persistSessionNow(id));
  }
  await Promise.allSettled(promises);
}

// ── Background persistence (safety net) ─────────────────────────────────────

async function persistDirtySessions(): Promise<void> {
  for (const [id, entry] of memoryStore) {
    if (!entry.dirty) continue;
    await persistSessionNow(id);
  }
}

async function cleanupStaleSessions(): Promise<void> {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of memoryStore) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      if (entry.session.squareOrderId && entry.squareToken && entry.squareLocationId) {
        log.info({ sessionId: key, squareOrderId: entry.session.squareOrderId }, "canceling orphaned order");
        cancelLiveOrder(entry.session, entry.squareToken, entry.squareLocationId).catch(() => {});
      }
      memoryStore.delete(key);
      cleaned++;
    }
  }

  try {
    await db.delete(voiceSessionsTable).where(lt(voiceSessionsTable.expiresAt, new Date()));
  } catch {
    // Non-critical
  }

  if (cleaned > 0) {
    log.info({ cleaned, active: memoryStore.size }, "cleaned stale sessions");
  }
}

let persistTimer: ReturnType<typeof setInterval> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionStoreBackgroundTasks(): void {
  if (!persistTimer) {
    persistTimer = setInterval(() => { persistDirtySessions().catch(() => {}); }, PERSIST_DEBOUNCE_MS);
    if (typeof persistTimer.unref === "function") persistTimer.unref();
  }
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => { cleanupStaleSessions().catch(() => {}); }, CLEANUP_INTERVAL_MS);
    if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
  }
}

export function stopSessionStoreBackgroundTasks(): void {
  if (persistTimer) { clearInterval(persistTimer); persistTimer = null; }
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

// Auto-start background tasks on import
startSessionStoreBackgroundTasks();
