/**
 * Shared Square API helpers used by both POS and Inventory agents.
 */

export const SQUARE_BASE = "https://connect.squareup.com/v2";

export function squareHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  variationId?: string;
  name: string;
  price: number;
  category?: string;
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

// ── Catalog / Inventory helpers ───────────────────────────────────────────────

export function findCatalogItem(catalog: CatalogItem[], name: string): CatalogItem | undefined {
  return (
    catalog.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
    catalog.find(
      (c) =>
        c.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(c.name.toLowerCase()),
    )
  );
}

export async function getInventoryCount(
  token: string,
  locationId: string,
  variationId: string,
): Promise<number> {
  const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
    method: "POST",
    headers: squareHeaders(token),
    body: JSON.stringify({
      catalog_object_ids: [variationId],
      location_ids: [locationId],
    }),
  });
  const data = (await res.json()) as any;
  const count = data.counts?.find(
    (c: any) => c.catalog_object_id === variationId && c.state === "IN_STOCK",
  );
  return count ? parseFloat(count.quantity) : 0;
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
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  squareOrderId?: string;
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
): Promise<SyncResult> {
  if (!squareToken || !locationId) {
    console.warn("[LiveSync] Skipped — missing credentials", { hasToken: !!squareToken, hasLocation: !!locationId });
    return { ok: false, error: "Square credentials not configured for this venue" };
  }
  if (session.items.length === 0 && !session.squareOrderId) return { ok: true };

  const lineItems = session.items.map((item) => ({
    quantity: item.quantity.toString(),
    catalog_object_id: item.variationId || item.catalogItemId,
    ...(item.variationId
      ? {}
      : { base_price_money: { amount: Math.round(item.price * 100), currency: "USD" } }),
  }));

  try {
    if (!session.squareOrderId) {
      // ── CREATE a new live order ─────────────────────────────────────────
      const refId = `VOICE-LIVE-${Date.now()}`;
      const res = await fetch(`${SQUARE_BASE}/orders`, {
        method: "POST",
        headers: squareHeaders(squareToken),
        body: JSON.stringify({
          idempotency_key: `live-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          order: {
            location_id: locationId,
            reference_id: refId,
            source: { name: "BevPro Voice" },
            line_items: lineItems,
          },
        }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        const errMsg = data.errors?.[0]?.detail || JSON.stringify(data.errors);
        console.error("[LiveSync] Create order failed:", errMsg);
        return { ok: false, error: `Create order failed: ${errMsg}` };
      }
      session.squareOrderId = data.order.id;
      session.squareOrderVersion = data.order.version;
      session.squareOrderTotal = data.order.total_money?.amount ?? 0;
      session.referenceId = refId;
      console.log(`[LiveSync] Order created: ${data.order.id} v${data.order.version} | $${((session.squareOrderTotal ?? 0) / 100).toFixed(2)} | ref=${refId}`);
    } else if (session.items.length > 0) {
      // ── UPDATE existing order — clear old line items, set new ones ──────
      const res = await fetch(`${SQUARE_BASE}/orders/${session.squareOrderId}`, {
        method: "PUT",
        headers: squareHeaders(squareToken),
        body: JSON.stringify({
          order: {
            location_id: locationId,
            version: session.squareOrderVersion,
            line_items: lineItems,
          },
          fields_to_clear: ["line_items"],
        }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        const errMsg = data.errors?.[0]?.detail || JSON.stringify(data.errors);
        console.error("[LiveSync] Update order failed:", errMsg);
        return { ok: false, error: `Update order failed: ${errMsg}` };
      }
      session.squareOrderVersion = data.order.version;
      session.squareOrderTotal = data.order.total_money?.amount ?? 0;
      console.log(`[LiveSync] Order updated: ${session.squareOrderId} v${data.order.version} | $${((session.squareOrderTotal ?? 0) / 100).toFixed(2)}`);
    } else {
      // Items were all removed — update order to empty (keeps it open but empty)
      const res = await fetch(`${SQUARE_BASE}/orders/${session.squareOrderId}`, {
        method: "PUT",
        headers: squareHeaders(squareToken),
        body: JSON.stringify({
          order: {
            location_id: locationId,
            version: session.squareOrderVersion,
          },
          fields_to_clear: ["line_items"],
        }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        const errMsg = data.errors?.[0]?.detail || JSON.stringify(data.errors);
        console.error("[LiveSync] Clear items failed:", errMsg);
        return { ok: false, error: `Clear items failed: ${errMsg}` };
      }
      session.squareOrderVersion = data.order.version;
      session.squareOrderTotal = 0;
      console.log(`[LiveSync] Order emptied: ${session.squareOrderId} v${data.order.version}`);
    }
    return { ok: true, squareOrderId: session.squareOrderId };
  } catch (e: any) {
    console.error("[LiveSync] Sync error:", e.message);
    return { ok: false, error: `Sync error: ${e.message}` };
  }
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
  try {
    // To cancel we update the order state. Square requires paying or canceling OPEN orders.
    // We use the UpdateOrder endpoint with state: CANCELED.
    // Note: This only works if the order has no completed payments.
    const res = await fetch(`${SQUARE_BASE}/orders/${session.squareOrderId}`, {
      method: "PUT",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        order: {
          location_id: locationId,
          version: session.squareOrderVersion,
          state: "CANCELED",
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      console.warn("[LiveSync] Cancel failed:", JSON.stringify(data.errors));
    } else {
      console.log(`[LiveSync] Order canceled: ${session.squareOrderId}`);
    }
  } catch (e: any) {
    console.warn("[LiveSync] Cancel error:", e.message);
  }
  session.squareOrderId = undefined;
  session.squareOrderVersion = undefined;
  session.squareOrderTotal = undefined;
  session.referenceId = undefined;
}

/**
 * Complete a live order by recording an external payment.
 * The order already exists on the POS — this closes it out.
 */
export async function completeLiveOrder(
  session: LiveSession,
  squareToken: string,
  locationId: string,
): Promise<{ orderId: string; total: number; paymentId?: string; error?: string }> {
  if (!session.squareOrderId) throw new Error("No live order to complete");

  const orderId = session.squareOrderId;
  const orderTotal = session.squareOrderTotal ?? 0;

  try {
    const paymentRes = await fetch(`${SQUARE_BASE}/payments`, {
      method: "POST",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        idempotency_key: `pay-${orderId.slice(0, 22)}-${Date.now()}`,
        source_id: "EXTERNAL",
        amount_money: { amount: orderTotal, currency: "USD" },
        order_id: orderId,
        location_id: locationId,
        external_details: { type: "OTHER", source: "Pre-paid Event Package" },
        note: "Voice order — pre-paid event package",
      }),
    });
    const paymentData = (await paymentRes.json()) as any;
    if (!paymentRes.ok) {
      const errMsg = paymentData.errors?.[0]?.detail || "Payment failed";
      console.warn("[LiveSync] Payment failed:", JSON.stringify(paymentData.errors));
      return { orderId, total: orderTotal / 100, error: errMsg };
    }
    console.log(`[LiveSync] Payment completed: ${paymentData.payment?.id} for order ${orderId}`);
    return { orderId, total: orderTotal / 100, paymentId: paymentData.payment?.id };
  } catch (e: any) {
    console.error("[LiveSync] Payment error:", e.message);
    return { orderId, total: orderTotal / 100, error: e.message };
  }
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
): Promise<{ checkoutId?: string; error?: string }> {
  try {
    const res = await fetch(`${SQUARE_BASE}/terminals/checkouts`, {
      method: "POST",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        idempotency_key: `terminal-${orderId}-${Date.now()}`,
        checkout: {
          amount_money: { amount: totalCents, currency: "USD" },
          device_options: {
            device_id: deviceId,
            skip_receipt_screen: false,
            collect_signature: false,
          },
          order_id: orderId,
          reference_id: `VOICE-TERMINAL-${Date.now()}`,
          note: "Voice order — tap/insert/swipe card",
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      const errMsg = data.errors?.[0]?.detail || "Terminal checkout failed";
      console.error("[Terminal] Checkout failed:", JSON.stringify(data.errors));
      return { error: errMsg };
    }
    console.log(`[Terminal] Checkout created: ${data.checkout?.id} → device ${deviceId}`);
    return { checkoutId: data.checkout?.id };
  } catch (e: any) {
    console.error("[Terminal] Checkout error:", e.message);
    return { error: e.message };
  }
}

// ── Extended Square API helpers ────────────────────────────────────────────────
// These power the comprehensive BevPro voice agent.

/** Create a new catalog item (with one variation). */
export async function createCatalogItem(
  squareToken: string,
  locationId: string,
  name: string,
  priceCents: number,
  category?: string,
): Promise<{ ok: boolean; itemId?: string; error?: string }> {
  const idempotencyKey = `create-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const itemId = `#item-${Date.now()}`;
  const varId = `#var-${Date.now()}`;
  try {
    const res = await fetch(`${SQUARE_BASE}/catalog/object`, {
      method: "POST",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        object: {
          type: "ITEM",
          id: itemId,
          present_at_all_locations: true,
          item_data: {
            name,
            variations: [
              {
                type: "ITEM_VARIATION",
                id: varId,
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
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { ok: false, error: data.errors?.[0]?.detail || "Failed to create item" };
    return { ok: true, itemId: data.catalog_object?.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Update an existing catalog item's name or price. */
export async function updateCatalogItem(
  squareToken: string,
  catalogObjectId: string,
  updates: { name?: string; priceCents?: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Fetch current object first
    const getRes = await fetch(`${SQUARE_BASE}/catalog/object/${catalogObjectId}`, {
      headers: squareHeaders(squareToken),
    });
    const getData = (await getRes.json()) as any;
    if (!getRes.ok) return { ok: false, error: getData.errors?.[0]?.detail || "Item not found" };

    const obj = getData.object;
    if (updates.name) obj.item_data.name = updates.name;
    if (updates.priceCents !== undefined && obj.item_data.variations?.[0]) {
      obj.item_data.variations[0].item_variation_data.price_money = {
        amount: updates.priceCents,
        currency: "USD",
      };
    }

    const res = await fetch(`${SQUARE_BASE}/catalog/object`, {
      method: "POST",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        idempotency_key: `update-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        object: obj,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { ok: false, error: data.errors?.[0]?.detail || "Failed to update" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Delete a catalog item. */
export async function deleteCatalogItem(
  squareToken: string,
  catalogObjectId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${SQUARE_BASE}/catalog/object/${catalogObjectId}`, {
      method: "DELETE",
      headers: squareHeaders(squareToken),
    });
    if (!res.ok) {
      const data = (await res.json()) as any;
      return { ok: false, error: data.errors?.[0]?.detail || "Failed to delete" };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** List recent orders with summary. */
export async function listRecentOrders(
  squareToken: string,
  locationId: string,
  limit = 20,
): Promise<{ ok: boolean; orders?: any[]; error?: string }> {
  try {
    const res = await fetch(`${SQUARE_BASE}/orders/search`, {
      method: "POST",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        location_ids: [locationId],
        query: {
          sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
        },
        limit,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { ok: false, error: data.errors?.[0]?.detail || "Failed to list orders" };
    return { ok: true, orders: data.orders ?? [] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Get sales summary for a date range. */
export async function getSalesSummary(
  squareToken: string,
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<{ ok: boolean; summary?: { totalOrders: number; totalRevenue: number; avgOrder: number; topItems: Array<{ name: string; qty: number; revenue: number }> }; error?: string }> {
  try {
    const res = await fetch(`${SQUARE_BASE}/orders/search`, {
      method: "POST",
      headers: squareHeaders(squareToken),
      body: JSON.stringify({
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              created_at: { start_at: startDate, end_at: endDate },
            },
            state_filter: { states: ["COMPLETED"] },
          },
          sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
        },
        limit: 500,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { ok: false, error: data.errors?.[0]?.detail || "Failed to query orders" };

    const orders = data.orders ?? [];
    let totalRevenue = 0;
    const itemCounts = new Map<string, { qty: number; revenue: number }>();

    for (const order of orders) {
      totalRevenue += (order.total_money?.amount ?? 0);
      for (const li of order.line_items ?? []) {
        const name = li.name ?? "Unknown";
        const qty = parseInt(li.quantity ?? "0");
        const rev = li.total_money?.amount ?? 0;
        const existing = itemCounts.get(name) ?? { qty: 0, revenue: 0 };
        itemCounts.set(name, { qty: existing.qty + qty, revenue: existing.revenue + rev });
      }
    }

    const topItems = [...itemCounts.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([name, { qty, revenue }]) => ({ name, qty, revenue: revenue / 100 }));

    return {
      ok: true,
      summary: {
        totalOrders: orders.length,
        totalRevenue: totalRevenue / 100,
        avgOrder: orders.length > 0 ? (totalRevenue / 100) / orders.length : 0,
        topItems,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** List all Square locations for the merchant. */
export async function listLocations(
  squareToken: string,
): Promise<{ ok: boolean; locations?: Array<{ id: string; name: string; status: string }>; error?: string }> {
  try {
    const res = await fetch(`${SQUARE_BASE}/locations`, {
      headers: squareHeaders(squareToken),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { ok: false, error: data.errors?.[0]?.detail || "Failed to list locations" };
    const locations = (data.locations ?? []).map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status,
    }));
    return { ok: true, locations };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
