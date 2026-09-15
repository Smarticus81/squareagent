import { describe, expect, it, vi } from "vitest";
import {
  findCatalogItem,
  normalizeItemName,
  mapCatalogObjects,
  summarizeOrders,
  idempotencyKey,
  fetchInventoryCounts,
  syncLiveOrderToSquare,
  type CatalogItem,
  type LiveSession,
} from "../src/lib/square-helpers";
import { SquareClient, resetSquareCircuits } from "../src/lib/square-client";

const catalog: CatalogItem[] = [
  { id: "i1", variationId: "v1", name: "Foster's Lager", price: 6 },
  { id: "i2", variationId: "v2", name: "Hazy IPA (Pint)", price: 8 },
  { id: "i2", variationId: "v3", name: "Hazy IPA (Half)", price: 4.5 },
  { id: "i3", variationId: "v4", name: "IPA", price: 7 },
  { id: "i4", variationId: "v5", name: "Loaded Nachos", price: 12 },
  { id: "i5", variationId: "v6", name: "Margarita", price: 11 },
];

describe("normalizeItemName", () => {
  it("strips punctuation and case", () => {
    expect(normalizeItemName("Foster's  Lager!")).toBe("fosters lager");
    expect(normalizeItemName("Fish & Chips")).toBe("fish and chips");
  });
});

describe("findCatalogItem", () => {
  it("matches exact names case-insensitively", () => {
    expect(findCatalogItem(catalog, "margarita")?.variationId).toBe("v6");
  });

  it("ignores apostrophes and plurals spoken loosely", () => {
    expect(findCatalogItem(catalog, "fosters")?.variationId).toBe("v1");
  });

  it("prefers the shortest containing name", () => {
    // "IPA" is contained by three items; the exact one wins.
    expect(findCatalogItem(catalog, "ipa")?.variationId).toBe("v4");
    expect(findCatalogItem(catalog, "hazy ipa pint")?.variationId).toBe("v2");
  });

  it("matches on word overlap when order differs", () => {
    expect(findCatalogItem(catalog, "nachos loaded")?.variationId).toBe("v5");
  });

  it("returns undefined for unrelated names", () => {
    expect(findCatalogItem(catalog, "espresso martini")).toBeUndefined();
    expect(findCatalogItem(catalog, "")).toBeUndefined();
  });
});

describe("mapCatalogObjects", () => {
  it("flattens variations and resolves category names", () => {
    const items = mapCatalogObjects([
      { type: "CATEGORY", id: "cat1", category_data: { name: "Beer" } },
      {
        type: "ITEM",
        id: "item1",
        item_data: {
          name: "Lager",
          categories: [{ id: "cat1" }],
          description_plaintext: "Cold one",
          variations: [
            { type: "ITEM_VARIATION", id: "var1", item_variation_data: { name: "Pint", price_money: { amount: 700, currency: "USD" } } },
            { type: "ITEM_VARIATION", id: "var2", item_variation_data: { name: "Half", price_money: { amount: 400, currency: "USD" } } },
            { type: "ITEM_VARIATION", id: "var3", is_deleted: true, item_variation_data: { name: "Old" } },
          ],
        },
      },
      {
        type: "ITEM",
        id: "item2",
        item_data: {
          name: "Nachos",
          category_id: "cat-missing",
          variations: [{ type: "ITEM_VARIATION", id: "var4", item_variation_data: { name: "Regular", price_money: { amount: 1200 } } }],
        },
      },
      { type: "ITEM", id: "item3", is_deleted: true, item_data: { name: "Gone", variations: [{ id: "x", item_variation_data: {} }] } },
      { type: "ITEM", id: "item4", item_data: { name: "No variations", variations: [] } },
    ]);
    expect(items).toEqual([
      { id: "item1", variationId: "var1", name: "Lager (Pint)", price: 7, category: "Beer", description: "Cold one" },
      { id: "item1", variationId: "var2", name: "Lager (Half)", price: 4, category: "Beer", description: "Cold one" },
      { id: "item2", variationId: "var4", name: "Nachos", price: 12, category: "cat-missing", description: "" },
    ]);
  });
});

describe("summarizeOrders", () => {
  it("aggregates revenue and ranks items", () => {
    const summary = summarizeOrders([
      { total_money: { amount: 1000 }, line_items: [{ name: "A", quantity: "2", total_money: { amount: 1000 } }] },
      { total_money: { amount: 500 }, line_items: [{ name: "B", quantity: "1", total_money: { amount: 500 } }] },
    ], 5);
    expect(summary.totalOrders).toBe(2);
    expect(summary.totalRevenue).toBe(15);
    expect(summary.avgOrder).toBe(7.5);
    expect(summary.topItems[0]).toEqual({ name: "A", qty: 2, revenue: 10 });
  });
});

describe("idempotencyKey", () => {
  it("is deterministic for a seed and within Square's length limit", () => {
    const a = idempotencyKey("v", "sess-1-call_abc-add");
    const b = idempotencyKey("v", "sess-1-call_abc-add");
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(45);
    expect(a).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("is unique without a seed", () => {
    expect(idempotencyKey("x")).not.toBe(idempotencyKey("x"));
  });
});

function jsonFetch(handler: (url: string, init: RequestInit) => unknown): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    new Response(JSON.stringify(handler(String(url), init ?? {})), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("fetchInventoryCounts", () => {
  it("chunks ids and maps IN_STOCK counts", async () => {
    resetSquareCircuits();
    const ids = Array.from({ length: 250 }, (_, i) => `v${i}`);
    const batches: number[] = [];
    const fetchImpl = jsonFetch((_url, init) => {
      const body = JSON.parse(String(init.body));
      batches.push(body.catalog_object_ids.length);
      return {
        counts: body.catalog_object_ids.map((id: string) => ({ catalog_object_id: id, state: "IN_STOCK", quantity: "3" })),
      };
    });
    const client = new SquareClient("tok", "LOC", fetchImpl);
    const res = await fetchInventoryCounts(client, ids);
    expect(res.ok).toBe(true);
    expect(batches).toEqual([100, 100, 50]);
    expect(res.counts.get("v249")).toBe(3);
    expect(res.counts.size).toBe(250);
  });
});

describe("syncLiveOrderToSquare", () => {
  it("creates then updates the live order, tracking line item uids", async () => {
    resetSquareCircuits();
    const calls: Array<{ url: string; method?: string; body: any }> = [];
    const fetchImpl = jsonFetch((url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, method: init.method, body });
      const lineItems = (body.order.line_items ?? []).map((li: any, i: number) => ({ ...li, uid: `uid${calls.length}-${i}` }));
      return { order: { id: "ORD1", version: calls.length, total_money: { amount: 1200 }, line_items: lineItems } };
    });
    // Route the memoized client through our fetch by constructing it under the same credential.
    const token = `tok-${Date.now()}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl as any);
    try {
      const session: LiveSession = { items: [{ catalogItemId: "i1", variationId: "v1", name: "Lager", price: 6, quantity: 2 }] };
      const first = await syncLiveOrderToSquare(session, token, "LOC");
      expect(first.ok).toBe(true);
      expect(session.squareOrderId).toBe("ORD1");
      expect(session.lineItemUids).toEqual(["uid1-0"]);
      expect(calls[0].method).toBe("POST");
      expect(calls[0].body.order.ticket_name).toMatch(/^Voice #/);

      session.items.push({ catalogItemId: "i2", variationId: "v2", name: "IPA", price: 8, quantity: 1 });
      const second = await syncLiveOrderToSquare(session, token, "LOC");
      expect(second.ok).toBe(true);
      expect(calls[1].method).toBe("PUT");
      expect(calls[1].body.fields_to_clear).toEqual(["line_items[uid1-0]"]);
      expect(calls[1].body.order.version).toBe(1);
      expect(session.lineItemUids).toEqual(["uid2-0", "uid2-1"]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
