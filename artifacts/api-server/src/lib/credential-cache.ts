/**
 * Credential Cache — in-memory cache for venue Square credentials.
 *
 * Avoids a DB query on every tool call by caching credentials with a 5-minute
 * TTL, and keeps Square access tokens alive: a connection stored with a
 * refresh token and expiry is renewed ahead of time (single-flight per
 * connection) so venues never silently drop off Square after 30 days.
 *
 * Invalidate when Square OAuth is reconnected or the venue is removed.
 */

import { db, serviceConnectionsTable, venuesTable } from "@workspace/db";
import { eq, and, isNull, or } from "drizzle-orm";
import { decrypt, encrypt } from "./secrets";
import { refreshSquareAccessToken, shouldRefreshSquareToken } from "./square-oauth";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("credential-cache");

export interface SquareCredentials {
  squareToken: string;
  squareLocationId: string;
  serviceConnectionId?: string | null;
}

interface CachedCredentials extends SquareCredentials {
  expiresAt: number;
}

/** Shape of service_connections.credentials for provider "square". */
export interface StoredSquareCredentials {
  /** AES-GCM encrypted access token. */
  accessToken: string;
  /** AES-GCM encrypted refresh token. */
  refreshToken?: string;
  /** RFC3339 access-token expiry. */
  expiresAt?: string;
  merchantId?: string;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CachedCredentials>();
const refreshInFlight = new Map<string, Promise<string | null>>();

function cacheKey(
  userId: number,
  venueId: number,
  organizationId?: string | null,
  serviceConnectionId?: string | null,
): string {
  return `${organizationId ?? `user-${userId}`}:${venueId}:${serviceConnectionId ?? "auto"}`;
}

function safeDecrypt(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return decrypt(value);
  } catch {
    return "";
  }
}

/**
 * Renew the access token on a stored connection. Returns the new plaintext
 * token, or null when refresh is impossible/failed (the caller keeps using
 * the current token, which may still be valid).
 */
async function refreshConnectionToken(connection: {
  id: string;
  venueId: number | null;
  credentials: StoredSquareCredentials;
}): Promise<string | null> {
  const inFlight = refreshInFlight.get(connection.id);
  if (inFlight) return inFlight;

  const task = (async () => {
    const refreshToken = safeDecrypt(connection.credentials.refreshToken);
    if (!refreshToken) return null;
    const result = await refreshSquareAccessToken(refreshToken);
    if (!result.ok || !result.tokens) {
      // Permanent failures (revoked/invalid grant) are surfaced on the
      // connection so the dashboard can prompt a reconnect.
      if (result.status === 400 || result.status === 401) {
        await db
          .update(serviceConnectionsTable)
          .set({
            status: "needs_reauthorization",
            lastHealthCheck: { status: "error", checkedAt: new Date().toISOString(), message: `Square token refresh failed: ${result.error}` },
            updatedAt: new Date(),
          })
          .where(eq(serviceConnectionsTable.id, connection.id))
          .catch(() => {});
      }
      return null;
    }
    const { accessToken, refreshToken: nextRefresh, expiresAt, merchantId } = result.tokens;
    const credentials: StoredSquareCredentials = {
      ...connection.credentials,
      accessToken: encrypt(accessToken),
      ...(nextRefresh ? { refreshToken: encrypt(nextRefresh) } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(merchantId ? { merchantId } : {}),
    };
    await db
      .update(serviceConnectionsTable)
      .set({
        credentials,
        status: "available",
        lastHealthCheck: { status: "healthy", checkedAt: new Date().toISOString(), message: "Square token refreshed." },
        updatedAt: new Date(),
      })
      .where(eq(serviceConnectionsTable.id, connection.id));
    if (connection.venueId !== null) {
      // Keep the legacy venue column in step for readers that still use it.
      await db
        .update(venuesTable)
        .set({ squareAccessToken: encrypt(accessToken), updatedAt: new Date() })
        .where(eq(venuesTable.id, connection.venueId))
        .catch(() => {});
    }
    log.info({ connectionId: connection.id, expiresAt }, "Square access token refreshed");
    return accessToken;
  })().finally(() => refreshInFlight.delete(connection.id));

  refreshInFlight.set(connection.id, task);
  return task;
}

async function readSquareConnectionCredentials(connection: {
  id: string;
  venueId: number | null;
  credentials: unknown;
  config: unknown;
}): Promise<SquareCredentials | null> {
  const credentials = (connection.credentials ?? {}) as StoredSquareCredentials;
  const config = connection.config as Record<string, unknown> | null;
  const locationId = typeof config?.locationId === "string" ? config.locationId : "";
  if (!credentials.accessToken || !locationId) return null;

  let squareToken = safeDecrypt(credentials.accessToken);
  if (credentials.refreshToken && shouldRefreshSquareToken(credentials.expiresAt)) {
    const refreshed = await refreshConnectionToken({ id: connection.id, venueId: connection.venueId, credentials });
    if (refreshed) squareToken = refreshed;
  }
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
): Promise<SquareCredentials | null> {
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
        venueId: serviceConnectionsTable.venueId,
        credentials: serviceConnectionsTable.credentials,
        config: serviceConnectionsTable.config,
      })
      .from(serviceConnectionsTable)
      .where(serviceWhere)
      .limit(1);
    if (connection) {
      const creds = await readSquareConnectionCredentials(connection);
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

  const squareToken = safeDecrypt(venue.squareAccessToken);
  const squareLocationId = venue.squareLocationId ?? "";
  if (!squareToken || !squareLocationId) {
    cache.delete(key);
    return null;
  }

  const creds: SquareCredentials = { squareToken, squareLocationId, serviceConnectionId: null };
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

/** Drop every cached entry holding this access token (after Square rejects it). */
export function invalidateCredentialsByToken(squareToken: string): void {
  for (const [key, entry] of cache) {
    if (entry.squareToken === squareToken) cache.delete(key);
  }
}

/** Number of cached entries (for diagnostics). */
export function credentialCacheSize(): number {
  return cache.size;
}
