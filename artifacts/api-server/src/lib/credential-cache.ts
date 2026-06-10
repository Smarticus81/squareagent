/**
 * Credential Cache — in-memory cache for venue Square credentials.
 *
 * Avoids a DB query on every tool call by caching credentials with a 5-minute TTL.
 * Invalidate when Square OAuth is reconnected.
 */

import { db, serviceConnectionsTable, venuesTable } from "@workspace/db";
import { eq, and, isNull, or } from "drizzle-orm";
import { decrypt } from "../lib/secrets";

interface CachedCredentials {
  squareToken: string;
  squareLocationId: string;
  serviceConnectionId?: string | null;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CachedCredentials>();

function cacheKey(
  userId: number,
  venueId: number,
  organizationId?: string | null,
  serviceConnectionId?: string | null,
): string {
  return `${organizationId ?? `user-${userId}`}:${venueId}:${serviceConnectionId ?? "auto"}`;
}

function readSquareConnectionCredentials(connection: {
  id: string;
  credentials: unknown;
  config: unknown;
}): { squareToken: string; squareLocationId: string; serviceConnectionId: string } | null {
  const credentials = connection.credentials as Record<string, unknown> | null;
  const config = connection.config as Record<string, unknown> | null;
  const encryptedToken = typeof credentials?.accessToken === "string" ? credentials.accessToken : "";
  const locationId = typeof config?.locationId === "string" ? config.locationId : "";
  if (!encryptedToken || !locationId) return null;
  const squareToken = decrypt(encryptedToken);
  if (!squareToken) return null;
  return { squareToken, squareLocationId: locationId, serviceConnectionId: connection.id };
}

/**
 * Get cached credentials, falling back to DB on miss.
 * Returns null if venue not found or not owned by user.
 */
export async function getCachedCredentials(
  userId: number,
  venueId: number,
  organizationId?: string | null,
  serviceConnectionId?: string | null,
): Promise<{ squareToken: string; squareLocationId: string; serviceConnectionId?: string | null } | null> {
  const key = cacheKey(userId, venueId, organizationId, serviceConnectionId);
  const cached = cache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return {
      squareToken: cached.squareToken,
      squareLocationId: cached.squareLocationId,
      serviceConnectionId: cached.serviceConnectionId,
    };
  }

  // Cache miss — query DB
  if (organizationId) {
    const serviceWhere = serviceConnectionId
      ? and(
          eq(serviceConnectionsTable.id, serviceConnectionId),
          eq(serviceConnectionsTable.organizationId, organizationId),
          eq(serviceConnectionsTable.provider, "square"),
        )
      : and(
          eq(serviceConnectionsTable.organizationId, organizationId),
          eq(serviceConnectionsTable.provider, "square"),
          eq(serviceConnectionsTable.venueId, venueId),
        );
    const [connection] = await db
      .select({
        id: serviceConnectionsTable.id,
        credentials: serviceConnectionsTable.credentials,
        config: serviceConnectionsTable.config,
      })
      .from(serviceConnectionsTable)
      .where(serviceWhere)
      .limit(1);
    if (connection) {
      const creds = readSquareConnectionCredentials(connection);
      if (creds) {
        cache.set(key, { ...creds, expiresAt: Date.now() + TTL_MS });
        return creds;
      }
    }
    if (serviceConnectionId) {
      cache.delete(key);
      return null;
    }
  }

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

  const squareToken = decrypt(venue.squareAccessToken);
  const squareLocationId = venue.squareLocationId ?? "";
  if (!squareToken || !squareLocationId) {
    cache.delete(key);
    return null;
  }

  const creds = { squareToken, squareLocationId, serviceConnectionId: null };

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
    if (key.includes(`:${venueId}:`)) cache.delete(key);
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
