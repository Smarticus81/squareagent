/**
 * Usage Cache — short-TTL cache for the rolling 30-day voice-minutes total.
 *
 * The overage cap is checked on the voice hot path: once in POST
 * /api/realtime/session (per conversation) and again in POST
 * /api/realtime/tools (per spoken command). Each check ran a
 * `sum(usage_events.quantity)` aggregate over a 30-day window — an expensive,
 * ever-growing scan sitting directly in front of every Square operation.
 *
 * Voice minutes only accrue via the 60s PWA heartbeat and session-end POST, so
 * a few seconds of staleness on the total is immaterial to cap enforcement.
 * Caching the SUM for a short TTL removes the aggregate from the per-tool-call
 * latency budget and caps the query rate per tenant regardless of tool volume.
 *
 * TTL-bounded staleness makes explicit invalidation optional, but session-end
 * billing calls `invalidateUsage` so the next check reflects the just-written
 * minutes immediately.
 */

import { db, usageEventsTable } from "@workspace/db";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

const TTL_MS = Number(process.env.USAGE_CACHE_TTL_MS ?? 15_000);
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

const cache = new Map<string, { minutes: number; expiresAt: number }>();

function usageKey(userId: number, organizationId: string | null): string {
  return organizationId ? `org:${organizationId}` : `user:${userId}`;
}

/**
 * Rolling 30-day voice-minutes total for the tenant, served from cache when
 * fresh. Falls back to the aggregate query on miss/expiry.
 */
export async function getCachedVoiceMinutes(
  userId: number,
  organizationId: string | null,
): Promise<number> {
  const key = usageKey(userId, organizationId);
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.minutes;

  const periodStart = new Date(Date.now() - PERIOD_MS);
  const [usage] = await db
    .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
    .from(usageEventsTable)
    .where(
      and(
        organizationId
          ? or(
              eq(usageEventsTable.organizationId, organizationId),
              and(eq(usageEventsTable.userId, userId), isNull(usageEventsTable.organizationId)),
            )
          : eq(usageEventsTable.userId, userId),
        eq(usageEventsTable.kind, "voice_minutes"),
        gte(usageEventsTable.occurredAt, periodStart),
      ),
    );

  const minutes = Number(usage?.total ?? 0);
  cache.set(key, { minutes, expiresAt: Date.now() + TTL_MS });
  return minutes;
}

/** Drop the cached total for a tenant (call after writing a usage event). */
export function invalidateUsage(userId: number, organizationId: string | null): void {
  cache.delete(usageKey(userId, organizationId));
}

// Bound memory: sweep expired entries periodically.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}, 5 * 60_000);
