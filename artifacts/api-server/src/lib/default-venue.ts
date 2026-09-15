/**
 * Default venue resolution — which Square-connected venue a session should use
 * when neither the launch request nor the assistant profile names one.
 *
 * Assistants can be created before (or without) a venue binding. Previously a
 * venue-less assistant silently ran as a "general" assistant with no Square
 * commands, even when the organization had a healthy Square connection, so the
 * dashboard said "connected" while the voice session could do nothing. Every
 * session entry point (WebRTC mint, tool execution, WS relay, PWA launch code)
 * now falls back to the organization's Square-connected venue instead.
 */

import { db, serviceConnectionsTable, venuesTable } from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";

const TTL_MS = 60 * 1000;
const cache = new Map<string, { venueId: number | null; expiresAt: number }>();

function cacheKey(userId: number, organizationId: string | null | undefined): string {
  return organizationId ?? `user-${userId}`;
}

/**
 * The organization's (or, without an organization, the user's) most recently
 * connected Square venue, or null when none is connected. Cached for one minute
 * so tool calls do not pay a DB round-trip; call `invalidateDefaultVenue` after
 * a Square connect/disconnect so the change is visible immediately.
 */
export async function resolveDefaultVenueId(
  userId: number,
  organizationId: string | null | undefined,
): Promise<number | null> {
  const key = cacheKey(userId, organizationId);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.venueId;

  let venueId: number | null = null;

  if (organizationId) {
    // Prefer a live service connection: it carries the refresh token and the
    // health status the dashboard shows.
    const [connection] = await db
      .select({ venueId: serviceConnectionsTable.venueId })
      .from(serviceConnectionsTable)
      .where(
        and(
          eq(serviceConnectionsTable.organizationId, organizationId),
          eq(serviceConnectionsTable.provider, "square"),
          isNotNull(serviceConnectionsTable.venueId),
          ne(serviceConnectionsTable.status, "needs_reauthorization"),
        ),
      )
      .orderBy(desc(serviceConnectionsTable.updatedAt))
      .limit(1);
    if (connection?.venueId != null) venueId = connection.venueId;
  }

  if (venueId === null) {
    // Legacy venues (pre service_connections) still hold their own token.
    const [venue] = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(
        and(
          organizationId
            ? or(
                eq(venuesTable.organizationId, organizationId),
                and(eq(venuesTable.userId, userId), isNull(venuesTable.organizationId)),
              )
            : eq(venuesTable.userId, userId),
          isNotNull(venuesTable.squareAccessToken),
          isNotNull(venuesTable.squareLocationId),
        ),
      )
      .orderBy(desc(venuesTable.connectedAt), desc(venuesTable.updatedAt))
      .limit(1);
    if (venue) venueId = venue.id;
  }

  cache.set(key, { venueId, expiresAt: Date.now() + TTL_MS });
  return venueId;
}

/**
 * Drop every cached default (after a Square connect/disconnect). The cache is
 * one entry per tenant with a one-minute TTL, so clearing it all is cheap and
 * avoids threading the organization id through every venue route.
 */
export function invalidateDefaultVenue(): void {
  cache.clear();
}
