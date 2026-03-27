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
