/**
 * Agent Profile Cache — short-TTL cache for the agent-profile fields read on
 * the voice hot path.
 *
 * Both POST /api/realtime/session (once per conversation) and
 * POST /api/realtime/tools (once per spoken command) look up the agent profile.
 * The /tools lookup runs on every tool call just to read `noiseMode`, adding a
 * DB round trip to the latency-critical path. Caching the profile for a short
 * TTL removes that round trip for the duration of a conversation. Profile edits
 * invalidate the entry, and the TTL bounds staleness for anything missed.
 */

import { db, agentProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface CachedAgentProfile {
  organizationId: string;
  voicePipelineProvider: string;
  voicePipelineConfig: Record<string, unknown> | null;
  connectedServiceId: string | null;
  noiseMode: string | null;
  displayName: string | null;
  personality: string | null;
  allowedTools: string[] | null;
}

const TTL_MS = Number(process.env.AGENT_PROFILE_CACHE_TTL_MS ?? 60_000);
const cache = new Map<string, { profile: CachedAgentProfile | null; expiresAt: number }>();

/** Fetch the hot-path agent profile fields, using cache when fresh. */
export async function getCachedAgentProfile(id: string): Promise<CachedAgentProfile | null> {
  const hit = cache.get(id);
  if (hit && Date.now() < hit.expiresAt) return hit.profile;

  const [profile] = await db
    .select({
      organizationId: agentProfilesTable.organizationId,
      voicePipelineProvider: agentProfilesTable.voicePipelineProvider,
      voicePipelineConfig: agentProfilesTable.voicePipelineConfig,
      connectedServiceId: agentProfilesTable.connectedServiceId,
      noiseMode: agentProfilesTable.noiseMode,
      displayName: agentProfilesTable.displayName,
      personality: agentProfilesTable.personality,
      allowedTools: agentProfilesTable.allowedTools,
    })
    .from(agentProfilesTable)
    .where(eq(agentProfilesTable.id, id))
    .limit(1);

  const value = (profile as CachedAgentProfile | undefined) ?? null;
  cache.set(id, { profile: value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/** Invalidate a cached profile (call after profile update/delete). */
export function invalidateAgentProfile(id: string): void {
  cache.delete(id);
}

// Bound memory: sweep expired entries periodically.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id);
  }
}, 5 * 60_000);
