/**
 * Credential Cache — in-memory cache for venue Square credentials.
 *
 * Avoids a DB query on every tool call by caching credentials with a 5-minute TTL.
 * Invalidate when Square OAuth is reconnected.
 */

import { db, venuesTable } from "@workspace/db";
import { eq, and, isNull, or } from "drizzle-orm";
import { decrypt } from "../lib/secrets";

interface CachedCredentials {
  squareToken: string;
  squareLocationId: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CachedCredentials>();

function cacheKey(userId: number, venueId: number, organizationId?: string | null): string {
  return `${organizationId ?? `user-${userId}`}:${venueId}`;
}

/**
 * Get cached credentials, falling back to DB on miss.
 * Returns null if venue not found or not owned by user.
 */
export async function getCachedCredentials(
  userId: number,
  venueId: number,
  organizationId?: string | null,
): Promise<{ squareToken: string; squareLocationId: string } | null> {
  const key = cacheKey(userId, venueId, organizationId);
  const cached = cache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return { squareToken: cached.squareToken, squareLocationId: cached.squareLocationId };
  }

  // Cache miss — query DB
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(
      and(
        eq(venuesTable.id, venueId),
        organizationId
          ? or(
              eq(venuesTable.organizationId, organizationId),
              and(eq(venuesTable.userId, userId), isNull(venuesTable.organizationId)),
            )
          : eq(venuesTable.userId, userId),
      ),
    );

  if (!venue) {
    cache.delete(key);
    return null;
  }

  const creds = {
    squareToken: decrypt(venue.squareAccessToken),
    squareLocationId: venue.squareLocationId ?? "",
  };

  cache.set(key, { ...creds, expiresAt: Date.now() + TTL_MS });
  return creds;
}

/**
 * Invalidate cached credentials for a venue.
 * Call this after Square OAuth reconnect or venue deletion.
 */
export function invalidateCredentials(userId: number, venueId: number): void {
  cache.delete(cacheKey(userId, venueId));
  for (const key of cache.keys()) {
    if (key.endsWith(`:${venueId}`)) cache.delete(key);
  }
}

/**
 * Invalidate all cached credentials for a user.
 * Call this after user deletion or broad credential changes.
 */
export function invalidateUserCredentials(userId: number): void {
  const userPrefix = `user-${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(userPrefix)) cache.delete(key);
  }
}

/** Number of cached entries (for diagnostics). */
export function credentialCacheSize(): number {
  return cache.size;
}
