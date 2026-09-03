/**
 * Shared Square domain helpers used by the voice tools, workflows, and the
 * dashboard routes. All HTTP goes through SquareClient (retry, timeout,
 * circuit breaker); this module owns the domain logic on top of it.
 */

import {
  SQUARE_BASE,
  SQUARE_OAUTH_BASE,
  SQUARE_API_VERSION,
  getSquareClient,
  squareHeaders,
  type SquareClient,
  type SquareError,
} from "./square-client";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("square");

export { SQUARE_BASE, SQUARE_OAUTH_BASE, SQUARE_API_VERSION, squareHeaders, getSquareClient };

export function redactSquareId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) return "unknown";
  if (id.length <= 8) return `${id.slice(0, 2)}...${id.slice(-2)}`;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function squareErrorSummary(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return "unknown_error";
  return errors
    .slice(0, 2)
    .map((err) => {
      if (!err || typeof err !== "object") return "unknown_error";
      const e = err as Record<string, unknown>;
      return [e.category, e.code, e.detail ? "detail_present" : null].filter(Boolean).join(":");
    })
    .join(",");
}

/** Speakable message for a failed SquareResponse. */
export function squareErrorMessage(error: SquareError | undefined, fallback = "Square request failed"): string {
  return error?.message || fallback;
}

/**
 * Idempotency keys must be unique per logical operation and ≤ 45 chars.
 * Callers pass a stable seed (request + call id) when they have one so a
 * retried voice command never double-creates on Square.
 */
export function idempotencyKey(prefix: string, seed?: string): string {
  const base = seed
    ? `${prefix}-${seed}`
    : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return base.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 45);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  variationId?: string;
  name: string;
  price: number;
  category?: string;
  description?: string;
}

export interface OrderItem {
  item_id?: string;
  item_name: string;
  quantity: number;
  price: number;
}

export interface SessionOrderItem {
  catalogItemId: string;
  variationId?: string;
  name: string;
  price: number;
  quantity: number;
}

export interface OrderCommand {
  action: "add" | "remove" | "clear" | "submit";
  item_id?: string;
  item_name?: string;
  quantity?: number;
  price?: number;
  squareOrderId?: string;          // Live order ID on Square POS
}

// ── Catalog matching ──────────────────────────────────────────────────────────

const APOSTROPHE_RE = /['\u2019]/g;
const NAME_NOISE_RE = /[^a-z0-9\s]/g;

/** Normalize a spoken or catalog name for comparison ("Foster's Lager!" -> "fosters lager"). */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(APOSTROPHE_RE, "")
    .replace(/&/g, " and ")
    .replace(NAME_NOISE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the catalog item a spoken name refers to.
 *
 * Voice transcripts are noisy ("two fosters" for "Foster's Lager", "the ipa"
 * for "Hazy IPA (Pint)"), so matching runs in tiers, most specific first:
 *   1. exact normalized name
 *   2. one side contains the other (prefer the shortest catalog name — "IPA"
 *      should pick "IPA" over "Hazy IPA (Pint)")
 *   3. best word overlap, requiring every spoken word to appear
 */
export function findCatalogItem(catalog: CatalogItem[], name: string): CatalogItem | undefined {
  const query = normalizeItemName(name ?? "");
  if (!query || catalog.length === 0) return undefined;

  let containment: CatalogItem | undefined;
  let containmentLength = Infinity;
  const queryWords = query.split(" ");
  let best: CatalogItem | undefined;
  let bestScore = 0;

  for (const item of catalog) {
    const candidate = normalizeItemName(item.name);
    if (!candidate) continue;
    if (candidate === query) return item;

    if (candidate.includes(query) || query.includes(candidate)) {
      if (candidate.length < containmentLength) {
        containment = item;
        containmentLength = candidate.length;
      }
      continue;
    }

    const candidateWords = new Set(candidate.split(" "));
    let hits = 0;
    for (const word of queryWords) if (candidateWords.has(word)) hits++;
    if (hits === queryWords.length) {
      const score = hits / candidateWords.size;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
  }

  return containment ?? best;
}

// ── Catalog loading ───────────────────────────────────────────────────────────

type RawCatalogObject = Record<string, any>;

/**
 * Flatten Square catalog objects into voice-friendly items: one entry per
 * sellable variation, with the category name resolved (Square returns only
 * ids). Handles both the legacy `category_id` and the current `categories[]`
 * / `reporting_category` shapes.
 */
export function mapCatalogObjects(objects: RawCatalogObject[]): CatalogItem[] {
  const categoryNames = new Map<string, string>();
  for (const obj of objects) {
    if (obj?.type === "CATEGORY" && obj.id && obj.category_data?.name) {
      categoryNames.set(obj.id, obj.category_data.name);
    }
  }

  const items: CatalogItem[] = [];
  for (const obj of objects) {
    if (obj?.type !== "ITEM" || obj.is_deleted) continue;
    const itemData = obj.item_data;
    if (!itemData?.name) continue;
    const variations: RawCatalogObject[] = (itemData.variations ?? []).filter((v: RawCatalogObject) => !v?.is_deleted);
    if (variations.length === 0) continue;

    const categoryId: string | undefined =
      itemData.reporting_category?.id ?? itemData.categories?.[0]?.id ?? itemData.category_id;
    const category = categoryId ? categoryNames.get(categoryId) ?? categoryId : undefined;
    const description: string = itemData.description_plaintext ?? itemData.description ?? "";

    for (const variation of variations) {
      const varData = variation.item_variation_data;
      if (!varData) continue;
      const variationName = varData.name && variations.length > 1 && varData.name !== "Regular"
        ? `${itemData.name} (${varData.name})`
        : itemData.name;
      items.push({
        id: obj.id,
        variationId: variation.id,
        name: variationName,
        price: varData.price_money ? Number(varData.price_money.amount ?? 0) / 100 : 0,
        category,
        description,
      });
    }
  }
  return items;
}

/** Fetch the full sellable catalog for a client's merchant (all pages). */
export async function loadCatalog(client: SquareClient): Promise<{ ok: boolean; items: CatalogItem[]; error?: SquareError }> {
  const res = await client.getAllPages(
    "/catalog/list?types=ITEM,CATEGORY&include_deleted_objects=false",
    (page: { objects?: RawCatalogObject[] }) => page.objects ?? [],
  );
  if (!res.ok) return { ok: false, items: [], error: res.error };
  return { ok: true, items: mapCatalogObjects(res.items) };
}

// ── Inventory ─────────────────────────────────────────────────────────────────

const INVENTORY_BATCH_SIZE = 100;

/**
 * IN_STOCK counts for a set of variation ids at the client's location, as a
 * Map for O(1) lookups. Chunks the request and follows cursors so large
 * catalogs are never silently truncated. Missing ids are simply absent.
 */
export async function fetchInventoryCounts(
  client: SquareClient,
  variationIds: string[],
): Promise<{ ok: boolean; counts: Map<string, number>; error?: SquareError }> {
  const counts = new Map<string, number>();
  const unique = [...new Set(variationIds.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += INVENTORY_BATCH_SIZE) chunks.push(unique.slice(i, i + INVENTORY_BATCH_SIZE));

  const results = await Promise.all(
    chunks.map((ids) =>
      client.postAllPages(
        "/inventory/counts/batch-retrieve",
        { catalog_object_ids: ids, location_ids: [client.locationId], states: ["IN_STOCK"] },
        (page: { counts?: any[] }) => page.counts ?? [],
        10_000,
      ),
    ),
  );

  for (const res of results) {
    if (!res.ok) return { ok: false, counts, error: res.error };
    for (const c of res.items) {
      if (c?.state === "IN_STOCK" && typeof c.catalog_object_id === "string") {
        counts.set(c.catalog_object_id, parseFloat(c.quantity ?? "0") || 0);
      }
    }
  }
  return { ok: true, counts };
}

export async function getInventoryCount(client: SquareClient, variationId: string): Promise<number> {
  const res = await fetchInventoryCounts(client, [variationId]);
  if (!res.ok) throw new Error(squareErrorMessage(res.error, "Failed to read inventory"));
  return res.counts.get(variationId) ?? 0;
}

// ── Live POS Order Sync ───────────────────────────────────────────────────────
// Creates / updates a Square order in real-time so it appears on the POS device
// as an open ticket while the customer is ordering via voice.

export interface LiveSession {
  items: SessionOrderItem[];
  squareOrderId?: string;
  squareOrderVersion?: number;
  squareOrderTotal?: number;       // cents
  referenceId?: string;            // e.g. VOICE-LIVE-1234567890
  lineItemUids?: string[];         // Track Square UIDs for proper UpdateOrder
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  squareOrderId?: string;
}

/** Reset the Square-side fields of a session after the order is closed or detached. */
export function detachLiveOrder(session: LiveSession): void {
  session.squareOrderId = undefined;
  session.squareOrderVersion = undefined;
  session.squareOrderTotal = undefined;
  session.referenceId = undefined;
  session.lineItemUids = undefined;
}

function buildLineItems(items: SessionOrderItem[]) {
  return items.map((item) => ({
    quantity: item.quantity.toString(),
    // Square requires a variation ID for catalog items; fall back to ad-hoc pricing
    ...(item.variationId
      ? { catalog_object_id: item.variationId }
      : {
          name: item.name,
          base_price_money: { amount: Math.round(item.price * 100), currency: "USD" },
        }),
  }));
}

function applyOrderResponse(session: LiveSession, order: any): void {
  session.squareOrderVersion = order?.version;
  session.squareOrderTotal = order?.total_money?.amount ?? 0;
  session.lineItemUids = (order?.line_items ?? []).map((li: any) => li.uid);
}

/**
 * Sync the current session items to Square as a live open order.
 * Creates the order on first call, updates on subsequent calls.
 * Returns status so callers can surface errors.
 */
export async function syncLiveOrderToSquare(
  session: LiveSession,
  squareToken: string,
  locationId: string,
  idempotencyKeyOverride?: string,
): Promise<SyncResult> {
  if (!squareToken || !locationId) {
    log.warn({ hasToken: !!squareToken, hasLocation: !!locationId }, "live sync skipped — missing credentials");
    return { ok: false, error: "Square credentials not configured for this venue" };
  }
  if (session.items.length === 0 && !session.squareOrderId) return { ok: true };

  const client = getSquareClient(squareToken, locationId);
  const lineItems = buildLineItems(session.items);

  if (!session.squareOrderId) {
    // ── CREATE a new live order ─────────────────────────────────────────
    const refId = `VOICE-LIVE-${Date.now()}`;
    const ticketName = `Voice #${Date.now().toString().slice(-4)}`;
    const res = await client.post("/orders", {
      idempotency_key: idempotencyKeyOverride ?? idempotencyKey("live"),
      order: {
        location_id: locationId,
        reference_id: refId,
        // ticket_name makes the order appear as an Open Ticket in Square POS.
        // Staff taps it in the ticket drawer to load all items into the register.
        // Requires: Square POS → Settings → Checkout → Open Tickets = ON
        ticket_name: ticketName,
        source: { name: "VoyceLab Voice" },
        line_items: lineItems,
        // No fulfillment — we want this as an Open Ticket on the register,
        // not routed to the "Orders" tab.
      },
    });
    if (!res.ok) {
      log.error({ err: res.error }, "live order create failed");
      return { ok: false, error: `Create order failed: ${squareErrorMessage(res.error)}` };
    }
    session.squareOrderId = res.data.order.id;
    session.referenceId = refId;
    applyOrderResponse(session, res.data.order);
    log.info({ order: redactSquareId(session.squareOrderId), itemCount: session.lineItemUids?.length ?? 0 }, "live order created");
    return { ok: true, squareOrderId: session.squareOrderId };
  }

  // ── UPDATE existing order — replace line items by UID ──────────────────
  const uidsToRemove = (session.lineItemUids ?? []).map((uid) => `line_items[${uid}]`);
  if (session.items.length === 0 && uidsToRemove.length === 0) {
    session.squareOrderTotal = 0;
    return { ok: true, squareOrderId: session.squareOrderId };
  }
  const res = await client.put(`/orders/${session.squareOrderId}`, {
    order: {
      location_id: locationId,
      version: session.squareOrderVersion,
      ...(session.items.length > 0 ? { line_items: lineItems } : {}),
    },
    ...(uidsToRemove.length > 0 ? { fields_to_clear: uidsToRemove } : {}),
  });
  if (!res.ok) {
    log.error({ order: redactSquareId(session.squareOrderId), err: res.error }, "live order update failed");
    return { ok: false, error: `Update order failed: ${squareErrorMessage(res.error)}` };
  }
  applyOrderResponse(session, res.data.order);
  log.info({ order: redactSquareId(session.squareOrderId), itemCount: session.lineItemUids?.length ?? 0 }, "live order updated");
  return { ok: true, squareOrderId: session.squareOrderId };
}

/**
 * Cancel a live order in Square (marks it as CANCELED on the POS).
 */
export async function cancelLiveOrder(
  session: LiveSession,
  squareToken: string,
  locationId: string,
): Promise<void> {
  if (!session.squareOrderId || !squareToken || !locationId) return;
  const client = getSquareClient(squareToken, locationId);
  // Only OPEN orders with no completed payment can be canceled this way.
  const res = await client.put(`/orders/${session.squareOrderId}`, {
    order: { location_id: locationId, version: session.squareOrderVersion, state: "CANCELED" },
  });
  if (!res.ok) log.warn({ order: redactSquareId(session.squareOrderId), err: res.error }, "live order cancel failed");
  else log.info({ order: redactSquareId(session.squareOrderId) }, "live order canceled");
  detachLiveOrder(session);
}

/**
 * Complete a live order by recording an external payment.
 * The order already exists on the POS — this closes it out.
 */
export async function completeLiveOrder(
  session: LiveSession,
  squareToken: string,
  locationId: string,
  idempotencyKeyOverride?: string,
): Promise<{ orderId: string; total: number; paymentId?: string; error?: string }> {
  if (!session.squareOrderId) throw new Error("No live order to complete");
  const orderId = session.squareOrderId;
  const orderTotal = session.squareOrderTotal ?? 0;
  const client = getSquareClient(squareToken, locationId);

  const res = await client.post("/payments", {
    idempotency_key: idempotencyKeyOverride ?? idempotencyKey("pay", orderId),
    ...externalPaymentBody(orderId, orderTotal, locationId),
  });
  if (!res.ok) {
    log.warn({ order: redactSquareId(orderId), err: res.error }, "external payment failed");
    return { orderId, total: orderTotal / 100, error: squareErrorMessage(res.error, "Payment failed") };
  }
  log.info({ order: redactSquareId(orderId), payment: redactSquareId(res.data.payment?.id) }, "payment completed");
  return { orderId, total: orderTotal / 100, paymentId: res.data.payment?.id };
}

/** Payment body for closing a pre-paid voice order with an EXTERNAL source. */
export function externalPaymentBody(orderId: string, amountCents: number, locationId: string) {
  return {
    source_id: "EXTERNAL",
    amount_money: { amount: amountCents, currency: "USD" },
    order_id: orderId,
    location_id: locationId,
    external_details: { type: "OTHER", source: "Pre-paid Event Package" },
    note: "Voice order — pre-paid event package",
  };
}

/**
 * Push a live order to a Square Terminal device for card payment.
 */
export async function pushToTerminal(
  squareToken: string,
  locationId: string,
  deviceId: string,
  orderId: string,
  totalCents: number,
  idempotencyKeyOverride?: string,
): Promise<{ checkoutId?: string; error?: string }> {
  const client = getSquareClient(squareToken, locationId);
  const res = await client.post("/terminals/checkouts", {
    idempotency_key: idempotencyKeyOverride ?? idempotencyKey("term", orderId),
    checkout: {
      amount_money: { amount: totalCents, currency: "USD" },
      device_options: { device_id: deviceId, skip_receipt_screen: false, collect_signature: false },
      order_id: orderId,
      reference_id: `VOICE-TERMINAL-${Date.now()}`,
      note: "Voice order — tap/insert/swipe card",
    },
  });
  if (!res.ok) {
    log.error({ device: redactSquareId(deviceId), err: res.error }, "terminal checkout failed");
    return { error: squareErrorMessage(res.error, "Terminal checkout failed") };
  }
  log.info({ checkout: redactSquareId(res.data.checkout?.id), device: redactSquareId(deviceId) }, "terminal checkout created");
  return { checkoutId: res.data.checkout?.id };
}

/** Paired devices at the client's location, split into Terminal hardware vs POS apps. */
export async function listLocationDevices(
  client: SquareClient,
): Promise<{ ok: boolean; terminals: any[]; posDevices: any[]; error?: SquareError }> {
  const res = await client.getAllPages(
    `/devices?location_id=${encodeURIComponent(client.locationId)}`,
    (page: { devices?: any[] }) => page.devices ?? [],
  );
  if (!res.ok) return { ok: false, terminals: [], posDevices: [], error: res.error };
  const typeOf = (d: any) => String(d?.attributes?.type ?? d?.type ?? "").toUpperCase();
  return {
    ok: true,
    terminals: res.items.filter((d) => typeOf(d) === "TERMINAL"),
    posDevices: res.items.filter((d) => typeOf(d) !== "TERMINAL"),
  };
}

// ── Catalog management ────────────────────────────────────────────────────────

/** Create a new catalog item (with one variation). */
export async function createCatalogItem(
  client: SquareClient,
  name: string,
  priceCents: number,
  seed?: string,
): Promise<{ ok: boolean; itemId?: string; error?: string }> {
  const res = await client.post("/catalog/object", {
    idempotency_key: idempotencyKey("item", seed),
    object: {
      type: "ITEM",
      id: "#item",
      present_at_all_locations: true,
      item_data: {
        name,
        variations: [
          {
            type: "ITEM_VARIATION",
            id: "#var",
            present_at_all_locations: true,
            item_variation_data: {
              name: "Regular",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: priceCents, currency: "USD" },
            },
          },
        ],
      },
    },
  });
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error, "Failed to create item") };
  return { ok: true, itemId: res.data.catalog_object?.id };
}

/** Update an existing catalog item's name or price. */
export async function updateCatalogItem(
  client: SquareClient,
  catalogObjectId: string,
  updates: { name?: string; priceCents?: number },
  seed?: string,
): Promise<{ ok: boolean; error?: string }> {
  const current = await client.get(`/catalog/object/${encodeURIComponent(catalogObjectId)}`);
  if (!current.ok) return { ok: false, error: squareErrorMessage(current.error, "Item not found") };

  const obj = current.data.object;
  if (updates.name) obj.item_data.name = updates.name;
  if (updates.priceCents !== undefined && obj.item_data.variations?.[0]) {
    obj.item_data.variations[0].item_variation_data.price_money = { amount: updates.priceCents, currency: "USD" };
  }

  const res = await client.post("/catalog/object", { idempotency_key: idempotencyKey("upd", seed), object: obj });
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error, "Failed to update") };
  return { ok: true };
}

/** Delete a catalog item. */
export async function deleteCatalogItem(
  client: SquareClient,
  catalogObjectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await client.del(`/catalog/object/${encodeURIComponent(catalogObjectId)}`);
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error, "Failed to delete") };
  return { ok: true };
}

// ── Orders & reporting ────────────────────────────────────────────────────────

export interface OrderSearchOptions {
  startAt?: string;
  endAt?: string;
  states?: string[];
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  /** Cap on total orders across pages (default 2000). */
  maxItems?: number;
}

/** Search orders at the client's location, following cursors up to `maxItems`. */
export async function searchOrders(
  client: SquareClient,
  opts: OrderSearchOptions = {},
): Promise<{ ok: boolean; orders: any[]; truncated: boolean; error?: SquareError }> {
  const filter: Record<string, unknown> = {};
  if (opts.startAt || opts.endAt) {
    filter.date_time_filter = { created_at: { ...(opts.startAt ? { start_at: opts.startAt } : {}), ...(opts.endAt ? { end_at: opts.endAt } : {}) } };
  }
  if (opts.states?.length) filter.state_filter = { states: opts.states };
  const body = {
    location_ids: [client.locationId],
    query: {
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
      sort: { sort_field: "CREATED_AT", sort_order: opts.sortOrder ?? "DESC" },
    },
    limit: Math.min(opts.limit ?? 500, 1000),
  };
  const res = await client.postAllPages("/orders/search", body, (page: { orders?: any[] }) => page.orders ?? [], opts.maxItems ?? 2_000);
  return { ok: res.ok, orders: res.items, truncated: res.truncated, error: res.error };
}

/** List recent orders with summary. */
export async function listRecentOrders(
  client: SquareClient,
  limit = 20,
): Promise<{ ok: boolean; orders?: any[]; error?: string }> {
  const res = await searchOrders(client, { limit, maxItems: limit });
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error, "Failed to list orders") };
  return { ok: true, orders: res.orders };
}

export interface SalesSummary {
  totalOrders: number;
  totalRevenue: number;
  avgOrder: number;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  truncated: boolean;
}

/** Aggregate completed orders in a window into revenue + top sellers. */
export function summarizeOrders(orders: any[], topN = 10, truncated = false): SalesSummary {
  let totalRevenue = 0;
  const itemCounts = new Map<string, { qty: number; revenue: number }>();
  for (const order of orders) {
    totalRevenue += order.total_money?.amount ?? 0;
    for (const li of order.line_items ?? []) {
      const name = li.name ?? "Unknown";
      const qty = parseInt(li.quantity ?? "0", 10) || 0;
      const rev = li.total_money?.amount ?? 0;
      const existing = itemCounts.get(name) ?? { qty: 0, revenue: 0 };
      itemCounts.set(name, { qty: existing.qty + qty, revenue: existing.revenue + rev });
    }
  }
  const topItems = [...itemCounts.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, topN)
    .map(([name, { qty, revenue }]) => ({ name, qty, revenue: revenue / 100 }));
  return {
    totalOrders: orders.length,
    totalRevenue: totalRevenue / 100,
    avgOrder: orders.length > 0 ? totalRevenue / 100 / orders.length : 0,
    topItems,
    truncated,
  };
}

/** Get sales summary for a date range. */
export async function getSalesSummary(
  client: SquareClient,
  startDate: string,
  endDate: string,
): Promise<{ ok: boolean; summary?: SalesSummary; error?: string }> {
  const res = await searchOrders(client, { startAt: startDate, endAt: endDate, states: ["COMPLETED"] });
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error, "Failed to query orders") };
  return { ok: true, summary: summarizeOrders(res.orders, 10, res.truncated) };
}

// ── Locations ─────────────────────────────────────────────────────────────────

export interface SquareLocation {
  id: string;
  name: string;
  status: string;
  timezone?: string;
  currency?: string;
}

/** List all Square locations for the merchant. */
export async function listLocations(
  client: SquareClient,
): Promise<{ ok: boolean; locations?: SquareLocation[]; error?: string }> {
  const res = await client.get("/locations");
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error, "Failed to list locations") };
  const locations = (res.data.locations ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    status: l.status,
    timezone: l.timezone,
    currency: l.currency,
  }));
  return { ok: true, locations };
}
