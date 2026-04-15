/**
 * Session Store — persistent voice session state management.
 *
 * Uses in-memory Map as primary store for speed, with DB write-through
 * for persistence across server restarts. Abandoned sessions are
 * automatically cleaned up with configurable TTL.
 */

import { db, voiceSessionsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import {
  cancelLiveOrder,
  type LiveSession,
} from "./square-helpers";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ManagedSession {
  session: LiveSession;
  squareToken: string;
  squareLocationId: string;
  userId: number;
  venueId: number;
  lastAccess: number;
  dirty: boolean; // needs DB write
}

// ── Configuration ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PERSIST_DEBOUNCE_MS = 5_000; // batch DB writes every 5 seconds
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check for stale sessions every 5 min

// ── In-memory store ─────────────────────────────────────────────────────────

const memoryStore = new Map<string, ManagedSession>();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get or create a session. Returns the LiveSession for tool execution.
 */
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
    venueId,
    lastAccess: Date.now(),
    dirty: true,
  });
  return session;
}

/**
 * Mark a session as dirty (needs persistence).
 * Call after any mutation to session state.
 */
export function markDirty(sessionId: string): void {
  const entry = memoryStore.get(sessionId);
  if (entry) entry.dirty = true;
}

/**
 * Remove a session from memory (e.g., after order is empty).
 */
export function removeSession(sessionId: string): void {
  memoryStore.delete(sessionId);
  // Also remove from DB (fire and forget)
  db.delete(voiceSessionsTable)
    .where(eq(voiceSessionsTable.id, sessionId))
    .catch(() => {});
}

/**
 * Get a session by ID (memory only, no DB fallback for now).
 */
export function getSession(sessionId: string): ManagedSession | undefined {
  return memoryStore.get(sessionId);
}

/**
 * Resume a session from the database (e.g., after server restart).
 */
export async function resumeSession(sessionId: string): Promise<ManagedSession | null> {
  // Check memory first
  const inMemory = memoryStore.get(sessionId);
  if (inMemory) return inMemory;

  // Try DB
  try {
    const [row] = await db
      .select()
      .from(voiceSessionsTable)
      .where(eq(voiceSessionsTable.id, sessionId));

    if (!row || new Date(row.expiresAt) < new Date()) return null;

    const session = (row.state as LiveSession) ?? { items: [] };
    const managed: ManagedSession = {
      session,
      squareToken: "", // must be re-populated from credential cache
      squareLocationId: "",
      userId: row.userId,
      venueId: row.venueId,
      lastAccess: Date.now(),
      dirty: false,
    };
    memoryStore.set(sessionId, managed);
    return managed;
  } catch {
    return null;
  }
}

/** Number of active sessions in memory. */
export function sessionCount(): number {
  return memoryStore.size;
}

// ── Background persistence ──────────────────────────────────────────────────

async function persistDirtySessions(): Promise<void> {
  for (const [id, entry] of memoryStore) {
    if (!entry.dirty) continue;
    try {
      const expiresAt = new Date(entry.lastAccess + SESSION_TTL_MS);
      await db
        .insert(voiceSessionsTable)
        .values({
          id,
          userId: entry.userId,
          venueId: entry.venueId,
          state: entry.session as any,
          squareOrderId: entry.session.squareOrderId ?? null,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: voiceSessionsTable.id,
          set: {
            state: entry.session as any,
            squareOrderId: entry.session.squareOrderId ?? null,
            updatedAt: new Date(),
            expiresAt,
          },
        });
      entry.dirty = false;
    } catch (e: any) {
      console.warn(`[SessionStore] Failed to persist session ${id}:`, e.message);
    }
  }
}

// ── Garbage collection ──────────────────────────────────────────────────────

async function cleanupStaleSessions(): Promise<void> {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of memoryStore) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      // Cancel orphaned live orders
      if (entry.session.squareOrderId && entry.squareToken && entry.squareLocationId) {
        console.log(`[SessionStore] Canceling orphaned order ${entry.session.squareOrderId} for session ${key}`);
        cancelLiveOrder(entry.session, entry.squareToken, entry.squareLocationId).catch(() => {});
      }
      memoryStore.delete(key);
      cleaned++;
    }
  }

  // Also clean expired rows from DB
  try {
    await db.delete(voiceSessionsTable).where(lt(voiceSessionsTable.expiresAt, new Date()));
  } catch {
    // Non-critical
  }

  if (cleaned > 0) {
    console.log(`[SessionStore] Cleaned ${cleaned} stale session(s). Active: ${memoryStore.size}`);
  }
}

// ── Start background tasks ──────────────────────────────────────────────────

setInterval(() => { persistDirtySessions().catch(() => {}); }, PERSIST_DEBOUNCE_MS);
setInterval(() => { cleanupStaleSessions().catch(() => {}); }, CLEANUP_INTERVAL_MS);
