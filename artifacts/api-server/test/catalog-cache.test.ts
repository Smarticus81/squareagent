import { beforeEach, describe, expect, it } from "vitest";
import { SquareClient, resetSquareCircuits } from "../src/lib/square-client";
import { getCachedCatalog, getCachedInventoryCounts, invalidateCatalog, invalidateInventoryCounts, resetSquareCaches } from "../src/lib/catalog-cache";

function catalogFetch(counter: { calls: number }, fail = false): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    counter.calls++;
    if (fail) return new Response(JSON.stringify({ errors: [{ code: "SERVICE_UNAVAILABLE" }] }), { status: 503 });
    const u = String(url);
    if (u.includes("/catalog/list")) {
      return new Response(JSON.stringify({
        objects: [
          { type: "ITEM", id: "i1", item_data: { name: "Lager", variations: [{ id: "v1", item_variation_data: { price_money: { amount: 600 } } }] } },
        ],
      }), { status: 200 });
    }
    if (u.includes("/inventory/counts/batch-retrieve")) {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        counts: body.catalog_object_ids.map((id: string) => ({ catalog_object_id: id, state: "IN_STOCK", quantity: "7" })),
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

describe("catalog cache", () => {
  beforeEach(() => {
    resetSquareCaches();
    resetSquareCircuits();
  });

  it("loads once and serves subsequent reads from cache", async () => {
    const counter = { calls: 0 };
    const client = new SquareClient("tok", "LOC-A", catalogFetch(counter));
    const first = await getCachedCatalog(client);
    expect(first.cached).toBe(false);
    expect(first.items).toHaveLength(1);
    const second = await getCachedCatalog(client);
    expect(second.cached).toBe(true);
    expect(counter.calls).toBe(1);
  });

  it("dedupes concurrent misses into one fetch", async () => {
    const counter = { calls: 0 };
    const client = new SquareClient("tok", "LOC-B", catalogFetch(counter));
    const results = await Promise.all([getCachedCatalog(client), getCachedCatalog(client), getCachedCatalog(client)]);
    expect(results.every((r) => r.items.length === 1)).toBe(true);
    expect(counter.calls).toBe(1);
  });

  it("reloads after invalidation or force", async () => {
    const counter = { calls: 0 };
    const client = new SquareClient("tok", "LOC-C", catalogFetch(counter));
    await getCachedCatalog(client);
    invalidateCatalog("LOC-C");
    await getCachedCatalog(client);
    await getCachedCatalog(client, { force: true });
    expect(counter.calls).toBe(3);
  });

  it("returns an empty catalog with an error when Square is down and nothing is cached", async () => {
    const counter = { calls: 0 };
    const client = new SquareClient("tok", "LOC-D", catalogFetch(counter, true));
    const res = await getCachedCatalog(client);
    expect(res.items).toEqual([]);
    expect(res.error).toBeDefined();
  });

  it("discards a fetch whose load overlapped an invalidation instead of caching it", async () => {
    // Reproduces the race: a fetch in flight when invalidateCatalog() runs
    // (catalog write / Square reconnect) must NOT repopulate the cache with its
    // pre-invalidation result. A gate holds the first /catalog/list response
    // open until after invalidation.
    const counter = { calls: 0 };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchFn = (async (url: string | URL | Request) => {
      counter.calls++;
      if (String(url).includes("/catalog/list")) {
        await gate;
        return new Response(JSON.stringify({
          objects: [
            { type: "ITEM", id: "i1", item_data: { name: "Lager", variations: [{ id: "v1", item_variation_data: { price_money: { amount: 600 } } }] } },
          ],
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const client = new SquareClient("tok", "LOC-RACE", fetchFn);

    const inFlight = getCachedCatalog(client); // cold miss → fetch started, awaiting the gate
    invalidateCatalog("LOC-RACE");             // generation bumped while the fetch is in flight
    release();                                 // let the (now-stale) fetch resolve
    await inFlight;

    // The discarded result must not have been cached: the next read fetches again.
    const after = await getCachedCatalog(client);
    expect(after.items).toHaveLength(1);
    expect(counter.calls).toBe(2);
  });
});

describe("inventory count cache", () => {
  beforeEach(() => {
    resetSquareCaches();
    resetSquareCircuits();
  });

  it("serves a subset of already-fetched ids without another round trip", async () => {
    const counter = { calls: 0 };
    const client = new SquareClient("tok", "LOC-E", catalogFetch(counter));
    const all = await getCachedInventoryCounts(client, ["v1", "v2", "v3"]);
    expect(all.counts.get("v2")).toBe(7);
    const one = await getCachedInventoryCounts(client, ["v2"]);
    expect(one.counts.get("v2")).toBe(7);
    expect(counter.calls).toBe(1);
    invalidateInventoryCounts("LOC-E");
    await getCachedInventoryCounts(client, ["v2"]);
    expect(counter.calls).toBe(2);
  });
});
