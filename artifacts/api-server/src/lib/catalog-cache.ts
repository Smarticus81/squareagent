/**
 * Catalog Cache — per-venue catalog caching with 5-minute TTL.
 *
 * Avoids re-fetching the full Square catalog on every session or tool call.
 * The cache is keyed by venue (token + location) and stores CatalogItem[].
 */

import type { CatalogItem } from "./square-helpers";
import { SQUARE_BASE, squareHeaders } from "./square-helpers";

interface CachedCatalog {
  items: CatalogItem[];
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CachedCatalog>();

function cacheKey(squareToken: string, locationId: string): string {
  // Use last 8 chars of token + location for uniqueness without storing full token
  return `${squareToken.slice(-8)}:${locationId}`;
}

/**
 * Get the catalog for a venue, using cache when available.
 * Falls back to fetching from Square API on cache miss.
 */
export async function getCachedCatalog(
  squareToken: string,
  locationId: string,
): Promise<CatalogItem[]> {
  if (!squareToken || !locationId) return [];

  const key = cacheKey(squareToken, locationId);
  const cached = cache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.items;
  }

  // Cache miss — fetch from Square
  const items = await fetchCatalog(squareToken, locationId);
  cache.set(key, { items, expiresAt: Date.now() + TTL_MS });
  return items;
}

/**
 * Invalidate the cached catalog for a venue.
 * Call after catalog mutations (create/update/delete items).
 */
export function invalidateCatalog(squareToken: string, locationId: string): void {
  cache.delete(cacheKey(squareToken, locationId));
}

/** Number of cached catalogs (for diagnostics). */
export function catalogCacheSize(): number {
  return cache.size;
}

// ── Internal: fetch full catalog from Square ────────────────────────────────

async function fetchCatalog(squareToken: string, locationId: string): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  let cursor: string | undefined;

  try {
    do {
      const url = `${SQUARE_BASE}/catalog/list?types=ITEM${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await fetch(url, { headers: squareHeaders(squareToken) });
      if (!res.ok) {
        console.warn("[CatalogCache] Failed to fetch catalog:", res.status);
        break;
      }
      const data = (await res.json()) as any;
      const objects = data.objects ?? [];

      for (const obj of objects) {
        if (obj.type !== "ITEM" || !obj.item_data) continue;
        const variation = obj.item_data.variations?.[0];
        const price = variation?.item_variation_data?.price_money?.amount;
        // Only include items available at this location
        const atLocation =
          obj.present_at_all_locations ||
          (obj.present_at_location_ids ?? []).includes(locationId);
        if (!atLocation) continue;

        items.push({
          id: obj.id,
          variationId: variation?.id,
          name: obj.item_data.name ?? "Unnamed",
          price: price ? price / 100 : 0,
          category: obj.item_data.category?.name,
        });
      }

      cursor = data.cursor;
    } while (cursor);
  } catch (e: any) {
    console.error("[CatalogCache] Fetch error:", e.message);
  }

  console.log(`[CatalogCache] Loaded ${items.length} items for location ${locationId}`);
  return items;
}
