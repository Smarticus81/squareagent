/**
 * Catalog Cache — per-venue cache of the transformed Square catalog served by
 * `GET /api/venues/:id/catalog`.
 *
 * That endpoint paginates the venue's entire Square ITEM catalog and reshapes it
 * on every call. For a high-traffic venue whose PWA reloads the catalog often,
 * that is a repeated multi-page round trip to Square for data that changes
 * rarely. This cache holds the reshaped item list per venue for a short TTL.
 *
 * Freshness strategy — stale-while-revalidate:
 *   • fresh (< TTL)        → served from memory, no Square call
 *   • stale (TTL..HARD)    → stale copy served immediately AND a background
 *                            refresh is kicked off, so a busy venue never blocks
 *                            on a full catalog fetch
 *   • absent / hard-expired → the loader runs and the caller awaits it
 *
 * Invalidation: catalog write tools (create/update/delete item) and Square
 * OAuth reconnect call `invalidateCatalog(venueId)` so edits show up at once;
 * the TTL bounds staleness for anything missed (e.g. edits made in the Square
 * dashboard, until webhook invalidation lands — see LATENCY_AUDIT.md Phase 4).
 */

import { createComponentLogger } from "./logger";

const log = createComponentLogger("catalog-cache");

const TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS ?? 5 * 60_000);
// How long a stale entry may still be served (while revalidating) before the
// caller must wait for a fresh load. Bounds unbounded staleness if refreshes
// keep failing.
const HARD_TTL_MS = Number(process.env.CATALOG_CACHE_HARD_TTL_MS ?? 30 * 60_000);

export type CatalogLoader = () => Promise<any[]>;

interface Entry {
  items: any[];
  loadedAt: number;
  refreshing: boolean;
}

const cache = new Map<number, Entry>();

/**
 * Return the venue's catalog items, using the cache with stale-while-revalidate.
 * `loader` performs the authoritative Square fetch + reshape; it is only awaited
 * on a cold or hard-expired entry.
 */
export async function getCachedCatalog(venueId: number, loader: CatalogLoader): Promise<any[]> {
  const now = Date.now();
  const entry = cache.get(venueId);

  if (entry) {
    const age = now - entry.loadedAt;
    if (age < TTL_MS) return entry.items; // fresh
    if (age < HARD_TTL_MS) {
      // Stale but usable — serve now, refresh in the background.
      if (!entry.refreshing) {
        entry.refreshing = true;
        loader()
          .then((items) => {
            cache.set(venueId, { items, loadedAt: Date.now(), refreshing: false });
          })
          .catch((e: any) => {
            entry.refreshing = false;
            log.warn({ venueId, err: e?.message }, "background catalog refresh failed; keeping stale");
          });
      }
      return entry.items;
    }
  }

  // Cold or hard-expired — load synchronously and cache.
  const items = await loader();
  cache.set(venueId, { items, loadedAt: Date.now(), refreshing: false });
  return items;
}

/** Drop a venue's cached catalog (call after catalog writes / reconnect). */
export function invalidateCatalog(venueId: number): void {
  cache.delete(venueId);
}

/** Number of cached venues (diagnostics). */
export function catalogCacheSize(): number {
  return cache.size;
}

// Bound memory: sweep hard-expired entries periodically.
setInterval(() => {
  const cutoff = Date.now() - HARD_TTL_MS;
  for (const [venueId, entry] of cache) {
    if (entry.loadedAt < cutoff) cache.delete(venueId);
  }
}, 5 * 60_000);
