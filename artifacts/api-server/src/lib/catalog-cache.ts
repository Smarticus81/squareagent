/**
 * Square read caches — catalog, inventory counts, location details.
 *
 * The voice hot path (POST /api/realtime/tools, the WS relays, workflows)
 * needs the venue catalog on every command to resolve spoken item names.
 * Previously the PWA shipped the entire catalog in every request; now the
 * server owns it and reads it from here.
 *
 * Catalog entries are served stale-while-revalidate: a fresh entry is returned
 * directly, an expired one is returned immediately while a background refresh
 * runs, and only an entry older than the hard limit blocks. Catalog writes
 * (create/update/delete item, create category) invalidate explicitly so the
 * next command sees the change. Concurrent misses share one in-flight fetch.
 */

import {
  loadCatalog,
  fetchInventoryCounts,
  listLocations,
  type CatalogItem,
  type SquareLocation,
} from "./square-helpers";
import type { SquareClient, SquareError } from "./square-client";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("square-cache");

const CATALOG_TTL_MS = Number(process.env.SQUARE_CATALOG_CACHE_TTL_MS) || 5 * 60 * 1000;
const CATALOG_MAX_STALE_MS = Number(process.env.SQUARE_CATALOG_MAX_STALE_MS) || 30 * 60 * 1000;
const INVENTORY_TTL_MS = Number(process.env.SQUARE_INVENTORY_CACHE_TTL_MS) || 10 * 1000;
const LOCATION_TTL_MS = 60 * 60 * 1000;

interface CatalogEntry {
  items: CatalogItem[];
  fetchedAt: number;
}

const catalogCache = new Map<string, CatalogEntry>();
const catalogInFlight = new Map<string, Promise<CatalogEntry | null>>();

async function fetchCatalogEntry(client: SquareClient, key: string): Promise<CatalogEntry | null> {
  const existing = catalogInFlight.get(key);
  if (existing) return existing;
  const task = (async () => {
    const start = Date.now();
    const res = await loadCatalog(client);
    if (!res.ok) {
      log.warn({ location: key, err: res.error?.message }, "catalog load failed");
      return null;
    }
    const entry = { items: res.items, fetchedAt: Date.now() };
    catalogCache.set(key, entry);
    log.info({ location: key, items: entry.items.length, durationMs: Date.now() - start }, "catalog loaded");
    return entry;
  })().finally(() => catalogInFlight.delete(key));
  catalogInFlight.set(key, task);
  return task;
}

export interface CatalogLoadResult {
  items: CatalogItem[];
  /** True when the items came from cache (fresh or stale). */
  cached: boolean;
  /** Set when a live load was attempted and failed. */
  error?: SquareError;
}

/**
 * The venue catalog for a Square client. Returns `[]` with `error` when Square
 * is unreachable and nothing is cached, so callers can fall back gracefully.
 */
export async function getCachedCatalog(
  client: SquareClient,
  opts: { force?: boolean } = {},
): Promise<CatalogLoadResult> {
  const key = client.locationId;
  const now = Date.now();
  const hit = opts.force ? undefined : catalogCache.get(key);

  if (hit) {
    const age = now - hit.fetchedAt;
    if (age < CATALOG_TTL_MS) return { items: hit.items, cached: true };
    if (age < CATALOG_MAX_STALE_MS) {
      // Serve stale, refresh in the background — never on the voice path.
      void fetchCatalogEntry(client, key);
      return { items: hit.items, cached: true };
    }
  }

  const fresh = await fetchCatalogEntry(client, key);
  if (fresh) return { items: fresh.items, cached: false };
  // Load failed: prefer stale data over nothing.
  const stale = catalogCache.get(key);
  if (stale) return { items: stale.items, cached: true };
  return { items: [], cached: false, error: { status: 0, message: "Catalog unavailable" } };
}

/** Drop the cached catalog for a location (call after any catalog write). */
export function invalidateCatalog(locationId: string): void {
  catalogCache.delete(locationId);
}

// ── Inventory counts (micro-cache) ───────────────────────────────────────────
// Workflows run several inventory tools back-to-back over the same ids; a
// short TTL dedupes those into one Square round trip without hiding real
// stock changes for more than a few seconds.

interface InventoryEntry {
  counts: Map<string, number>;
  ids: Set<string>;
  fetchedAt: number;
}

const inventoryCache = new Map<string, InventoryEntry>();

export async function getCachedInventoryCounts(
  client: SquareClient,
  variationIds: string[],
): Promise<{ ok: boolean; counts: Map<string, number>; error?: SquareError }> {
  const key = client.locationId;
  const hit = inventoryCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < INVENTORY_TTL_MS && variationIds.every((id) => hit.ids.has(id))) {
    return { ok: true, counts: hit.counts };
  }
  const res = await fetchInventoryCounts(client, variationIds);
  if (res.ok) inventoryCache.set(key, { counts: res.counts, ids: new Set(variationIds), fetchedAt: Date.now() });
  return res;
}

/** Drop cached counts for a location (call after any inventory write). */
export function invalidateInventoryCounts(locationId: string): void {
  inventoryCache.delete(locationId);
}

// ── Location details ─────────────────────────────────────────────────────────

const locationCache = new Map<string, { location: SquareLocation | null; fetchedAt: number }>();

/** Details (timezone, currency) for the client's own location. */
export async function getCachedLocation(client: SquareClient): Promise<SquareLocation | null> {
  const key = client.locationId;
  const hit = locationCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < LOCATION_TTL_MS) return hit.location;
  const res = await listLocations(client);
  if (!res.ok) return hit?.location ?? null;
  const location = res.locations?.find((l) => l.id === key) ?? null;
  locationCache.set(key, { location, fetchedAt: Date.now() });
  return location;
}

/** Test hook. */
export function resetSquareCaches(): void {
  catalogCache.clear();
  catalogInFlight.clear();
  inventoryCache.clear();
  locationCache.clear();
}

// Bound memory: sweep entries past the hard stale limit.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of catalogCache) if (now - entry.fetchedAt > CATALOG_MAX_STALE_MS) catalogCache.delete(key);
  for (const [key, entry] of inventoryCache) if (now - entry.fetchedAt > INVENTORY_TTL_MS) inventoryCache.delete(key);
  for (const [key, entry] of locationCache) if (now - entry.fetchedAt > LOCATION_TTL_MS) locationCache.delete(key);
}, 5 * 60 * 1000);
if (typeof sweeper.unref === "function") sweeper.unref();
