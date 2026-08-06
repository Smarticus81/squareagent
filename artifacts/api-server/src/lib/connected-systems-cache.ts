/**
 * Connected-systems presence cache.
 *
 * Venue voice sessions merge in the "general" command set (email / knowledge /
 * database) only when the organization actually has one of those systems
 * connected. Determining that ran three `... limit 1` existence probes across
 * three tables — on POST /api/realtime/tools that meant three DB round trips on
 * every spoken command, purely to decide tool gating.
 *
 * Whether a tenant has any general system connected changes rarely (only when a
 * connection is added or removed), so a short-TTL boolean cache removes the
 * probes from the hot path while staying fresh enough for gating.
 */

import {
  db,
  emailCredentialsTable,
  knowledgeDocumentsTable,
  externalDbConnectionsTable,
} from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";

const TTL_MS = Number(process.env.CONNECTED_SYSTEMS_CACHE_TTL_MS ?? 60_000);
const cache = new Map<string, { present: boolean; expiresAt: number }>();

function tenantWhere(table: { organizationId: any; userId: any }, userId: number, organizationId: string) {
  return or(
    eq(table.organizationId, organizationId),
    and(eq(table.userId, userId), isNull(table.organizationId)),
  );
}

/**
 * True when the tenant has any general connected system (email, knowledge doc,
 * or external database). Cached per org for a short TTL; on error returns false
 * so a transient DB blip degrades to venue-only tools rather than failing.
 */
export async function hasGeneralConnectedSystemsCached(
  userId: number,
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) return false;
  const key = organizationId;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.present;

  try {
    const [[email], [document], [database]] = await Promise.all([
      db
        .select({ id: emailCredentialsTable.id })
        .from(emailCredentialsTable)
        .where(tenantWhere(emailCredentialsTable, userId, organizationId))
        .limit(1),
      db
        .select({ id: knowledgeDocumentsTable.id })
        .from(knowledgeDocumentsTable)
        .where(tenantWhere(knowledgeDocumentsTable, userId, organizationId))
        .limit(1),
      db
        .select({ id: externalDbConnectionsTable.id })
        .from(externalDbConnectionsTable)
        .where(tenantWhere(externalDbConnectionsTable, userId, organizationId))
        .limit(1),
    ]);
    const present = Boolean(email || document || database);
    cache.set(key, { present, expiresAt: Date.now() + TTL_MS });
    return present;
  } catch {
    return false;
  }
}

/** Drop the cached flag for an org (call after connecting/removing a system). */
export function invalidateConnectedSystems(organizationId: string | null): void {
  if (organizationId) cache.delete(organizationId);
}

// Bound memory: sweep expired entries periodically.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}, 5 * 60_000);
