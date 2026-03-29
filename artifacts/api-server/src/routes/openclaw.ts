/**
 * OpenClaw Bridge — REST endpoint for OpenClaw skill tool execution
 *
 * POST /api/openclaw/tool  → Execute a BevPro tool call from OpenClaw agent
 * GET  /api/openclaw/catalog → Get the full catalog for a venue
 *
 * OpenClaw's agent sends tool calls here based on the bevpro SKILL.md instructions.
 * This route reuses the same executeTool logic from realtime.ts.
 */

import { Router } from "express";
import { db, venuesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requirePlan } from "./auth";
import {
  SQUARE_BASE,
  squareHeaders,
  findCatalogItem,
  getInventoryCount,
  syncLiveOrderToSquare,
  cancelLiveOrder,
  completeLiveOrder,
  pushToTerminal,
  type CatalogItem,
  type OrderItem,
  type SessionOrderItem,
  type OrderCommand,
  type LiveSession,
  type SyncResult,
} from "../lib/square-helpers";

const router = Router();

// ── Per-session state (keyed by session_id from OpenClaw) ─────────────────────

interface OpenClawSession {
  liveSession: LiveSession;
  catalog: CatalogItem[];
  squareToken: string;
  squareLocationId: string;
  lastAccess: number;
}

const sessions = new Map<string, OpenClawSession>();

// Clean up stale sessions every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [key, sess] of sessions) {
    if (sess.lastAccess < cutoff) {
      // Cancel any open live order before removing
      if (sess.liveSession.squareOrderId) {
        cancelLiveOrder(sess.liveSession, sess.squareToken, sess.squareLocationId).catch(() => {});
      }
      sessions.delete(key);
    }
  }
}, 30 * 60 * 1000);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function lookupVenueCredentials(userId: number, venueId: number) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, userId)));
  if (!venue) return null;
  return {
    squareToken: venue.squareAccessToken ?? "",
    squareLocationId: venue.squareLocationId ?? "",
  };
}

async function loadCatalog(squareToken: string, locationId: string): Promise<CatalogItem[]> {
  if (!squareToken || !locationId) return [];
  try {
    const res = await fetch(`${SQUARE_BASE}/catalog/list?types=ITEM`, {
      headers: squareHeaders(squareToken),
    });
    const data = (await res.json()) as any;
    const items: CatalogItem[] = [];
    for (const obj of data.objects ?? []) {
      if (obj.type !== "ITEM") continue;
      const itemData = obj.item_data;
      if (!itemData) continue;
      for (const variation of itemData.variations ?? []) {
        const vData = variation.item_variation_data;
        const price = vData?.price_money?.amount
          ? vData.price_money.amount / 100
          : 0;
        items.push({
          id: obj.id,
          variationId: variation.id,
          name: itemData.name ?? "Unknown",
          price,
          category: itemData.category_id ?? undefined,
        });
      }
    }
    return items;
  } catch (e: any) {
    console.error("[OpenClaw] Failed to load catalog:", e.message);
    return [];
  }
}

async function getOrCreateSession(
  sessionId: string,
  userId: number,
  venueId: number,
): Promise<OpenClawSession | null> {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }

  const creds = await lookupVenueCredentials(userId, venueId);
  if (!creds) return null;

  const catalog = await loadCatalog(creds.squareToken, creds.squareLocationId);

  const session: OpenClawSession = {
    liveSession: { items: [] },
    catalog,
    squareToken: creds.squareToken,
    squareLocationId: creds.squareLocationId,
    lastAccess: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

// ── Tool executor (reuses same logic as realtime.ts) ──────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sess: OpenClawSession,
): Promise<{ result: string; command?: OrderCommand }> {
  const { catalog, squareToken, squareLocationId, liveSession: session } = sess;
  const sessionOrder = session.items;

  switch (name) {
    case "add_item": {
      const itemName = String(args.item_name ?? "");
      const qty = Number(args.quantity ?? 1);
      const match = findCatalogItem(catalog, itemName);
      if (match) {
        const existing = sessionOrder.find((i) => i.catalogItemId === match.id);
        if (existing) existing.quantity += qty;
        else sessionOrder.push({ catalogItemId: match.id, variationId: match.variationId, name: match.name, price: match.price, quantity: qty });
        const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId);
        const posStatus = sync.ok && session.squareOrderId
          ? " Showing on POS."
          : sync.error ? ` (POS sync issue: ${sync.error})` : "";
        return {
          result: `Added ${qty}x ${match.name} ($${(match.price * qty).toFixed(2)}) to the order.${posStatus}`,
          command: { action: "add", item_id: match.id, item_name: match.name, quantity: qty, price: match.price, squareOrderId: session.squareOrderId },
        };
      }
      const names = catalog.slice(0, 5).map((c) => c.name).join(", ");
      return { result: `Item "${itemName}" not found. Available: ${names || "none"}` };
    }

    case "remove_item": {
      const itemName = String(args.item_name ?? "");
      const qty = Number(args.quantity ?? 1);
      const n = itemName.toLowerCase();
      const idx = sessionOrder.findIndex(
        (i) => i.name.toLowerCase() === n || i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase()),
      );
      if (idx >= 0) {
        sessionOrder[idx].quantity -= qty;
        if (sessionOrder[idx].quantity <= 0) sessionOrder.splice(idx, 1);
      }
      const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId);
      const posStatus = sync.ok && session.squareOrderId ? " POS updated." : sync.error ? ` (POS sync issue: ${sync.error})` : "";
      return {
        result: `Removed ${qty}x ${itemName} from the order.${posStatus}`,
        command: { action: "remove", item_name: itemName, quantity: qty, squareOrderId: session.squareOrderId },
      };
    }

    case "get_order": {
      if (sessionOrder.length === 0) return { result: "The order is currently empty." };
      const lines = sessionOrder.map((i) => `${i.quantity}x ${i.name} @ $${i.price.toFixed(2)}`);
      const total = sessionOrder.reduce((s, i) => s + i.price * i.quantity, 0);
      const posNote = session.squareOrderId ? ` (live on POS: ${session.referenceId ?? session.squareOrderId})` : "";
      return { result: `Current order${posNote}:\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}` };
    }

    case "clear_order":
      await cancelLiveOrder(session, squareToken, squareLocationId);
      sessionOrder.splice(0, sessionOrder.length);
      return { result: "Order cleared. Removed from POS.", command: { action: "clear" } };

    case "submit_order": {
      if (sessionOrder.length === 0) return { result: "The order is empty — nothing to submit." };
      if (!squareToken || !squareLocationId) return { result: "Square is not configured — cannot submit." };
      try {
        if (session.squareOrderId) {
          const { orderId, total, paymentId, error } = await completeLiveOrder(session, squareToken, squareLocationId);
          sessionOrder.splice(0, sessionOrder.length);
          session.squareOrderId = undefined;
          session.squareOrderVersion = undefined;
          session.squareOrderTotal = undefined;
          session.referenceId = undefined;
          return {
            result: `Order submitted! Total: $${total.toFixed(2)}.${error ? ` Warning: ${error}` : ""}`,
            command: { action: "submit", squareOrderId: orderId },
          };
        }
        // Fallback: create order + payment
        const lineItems = sessionOrder.map((item) => ({
          quantity: item.quantity.toString(),
          catalog_object_id: item.variationId || item.catalogItemId,
          ...(item.variationId
            ? {}
            : { base_price_money: { amount: Math.round(item.price * 100), currency: "USD" } }),
        }));
        const ticketRef = `VOICE-${Date.now()}`;
        const orderRes = await fetch(`${SQUARE_BASE}/orders`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            order: { location_id: squareLocationId, reference_id: ticketRef, line_items: lineItems },
          }),
        });
        const orderData = await orderRes.json() as any;
        if (!orderRes.ok) return { result: `Order failed: ${orderData.errors?.[0]?.detail || "Unknown error"}` };
        const orderId = orderData.order?.id;
        const orderTotal = orderData.order?.total_money?.amount ?? 0;
        const paymentRes = await fetch(`${SQUARE_BASE}/payments`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `payment-${orderId}`,
            source_id: "EXTERNAL",
            amount_money: { amount: orderTotal, currency: "USD" },
            order_id: orderId,
            location_id: squareLocationId,
            external_details: { type: "OTHER", source: "Pre-paid Event Package" },
            note: "Voice order — pre-paid event package",
          }),
        });
        if (!paymentRes.ok) {
          const pd = await paymentRes.json() as any;
          console.warn("[OpenClaw] Payment failed:", JSON.stringify(pd.errors));
        }
        sessionOrder.splice(0, sessionOrder.length);
        return { result: `Order submitted! Total: $${(orderTotal / 100).toFixed(2)}.`, command: { action: "submit" } };
      } catch (e: any) {
        return { result: `Failed to submit order: ${e.message}` };
      }
    }

    case "send_to_terminal": {
      if (sessionOrder.length === 0) return { result: "The order is empty — nothing to send to the terminal." };
      if (!squareToken || !squareLocationId) return { result: "Square is not configured — cannot send to terminal." };
      if (!session.squareOrderId) {
        const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId);
        if (!sync.ok) return { result: `Could not create the order in Square: ${sync.error}. Try submitting instead.` };
      }
      if (!session.squareOrderId) return { result: "Could not create the order in Square. Try submitting instead." };
      try {
        const devRes = await fetch(`${SQUARE_BASE}/devices?location_id=${squareLocationId}`, { headers: squareHeaders(squareToken) });
        const devData = (await devRes.json()) as any;
        const devices = devData.devices ?? [];
        if (devices.length === 0) return { result: "No Square Terminal devices found at this location." };
        const { checkoutId, error } = await pushToTerminal(squareToken, squareLocationId, devices[0].id, session.squareOrderId, session.squareOrderTotal ?? 0);
        if (error) return { result: `Couldn't send to terminal: ${error}. The order is still open on the POS.` };
        return { result: `Sent to the terminal! Total: $${((session.squareOrderTotal ?? 0) / 100).toFixed(2)}. Customer can tap or swipe.` };
      } catch (e: any) {
        return { result: `Failed to send to terminal: ${e.message}` };
      }
    }

    case "search_menu": {
      const q = String(args.query ?? "").toLowerCase();
      const hits = catalog.filter((c) => c.name.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q));
      if (hits.length === 0) return { result: `No menu items matching "${q}".` };
      return { result: hits.map((c) => `${c.name}: $${c.price.toFixed(2)}`).join(", ") };
    }

    case "check_inventory": {
      const itemName = String(args.item_name ?? "");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      const variationId = match.variationId ?? match.id;
      try {
        const qty = await getInventoryCount(squareToken, squareLocationId, variationId);
        return { result: `${match.name}: ${qty} in stock.` };
      } catch (e: any) {
        return { result: `Failed to check inventory: ${e.message}` };
      }
    }

    case "check_all_inventory": {
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      if (catalog.length === 0) return { result: "No catalog items loaded." };
      try {
        const ids = catalog.map((c) => c.variationId ?? c.id);
        const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({ catalog_object_ids: ids, location_ids: [squareLocationId] }),
        });
        const data = (await res.json()) as any;
        const counts = data.counts ?? [];
        const lines = catalog.map((c) => {
          const vid = c.variationId ?? c.id;
          const count = counts.find((ct: any) => ct.catalog_object_id === vid && ct.state === "IN_STOCK");
          const qty = count ? parseFloat(count.quantity) : 0;
          return `${c.name}: ${qty}`;
        });
        return { result: `Inventory:\n${lines.join("\n")}` };
      } catch (e: any) {
        return { result: `Failed to check inventory: ${e.message}` };
      }
    }

    case "adjust_inventory": {
      const itemName = String(args.item_name ?? "");
      const quantity = Number(args.quantity ?? 0);
      const reason = String(args.reason ?? "received");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      const variationId = match.variationId ?? match.id;
      const isAdding = quantity > 0;
      try {
        const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `inv-adj-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            changes: [{ type: "ADJUSTMENT", adjustment: { catalog_object_id: variationId, location_id: squareLocationId, from_state: isAdding ? "NONE" : "IN_STOCK", to_state: isAdding ? "IN_STOCK" : "WASTE", quantity: Math.abs(quantity).toString(), occurred_at: new Date().toISOString() } }],
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
        const action = isAdding ? `Added ${quantity}` : `Removed ${Math.abs(quantity)}`;
        const newQty = await getInventoryCount(squareToken, squareLocationId, variationId);
        return { result: `${action} ${match.name} (reason: ${reason}). Now ${newQty} in stock.` };
      } catch (e: any) {
        return { result: `Failed to adjust inventory: ${e.message}` };
      }
    }

    case "set_inventory": {
      const itemName = String(args.item_name ?? "");
      const quantity = Number(args.quantity ?? 0);
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      const variationId = match.variationId ?? match.id;
      try {
        const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `inv-set-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            changes: [{ type: "PHYSICAL_COUNT", physical_count: { catalog_object_id: variationId, location_id: squareLocationId, quantity: quantity.toString(), state: "IN_STOCK", occurred_at: new Date().toISOString() } }],
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
        return { result: `${match.name} inventory set to ${quantity}.` };
      } catch (e: any) {
        return { result: `Failed to set inventory: ${e.message}` };
      }
    }

    case "transfer_inventory": {
      const itemName = String(args.item_name ?? "");
      const quantity = Number(args.quantity ?? 0);
      const toLocationId = String(args.to_location_id ?? "");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      if (!toLocationId) return { result: "Destination location ID is required." };
      const variationId = match.variationId ?? match.id;
      try {
        const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `inv-xfer-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            changes: [{ type: "TRANSFER", transfer: { catalog_object_id: variationId, from_location_id: squareLocationId, to_location_id: toLocationId, quantity: quantity.toString(), occurred_at: new Date().toISOString() } }],
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
        return { result: `Transferred ${quantity}x ${match.name} to location ${toLocationId}.` };
      } catch (e: any) {
        return { result: `Failed to transfer: ${e.message}` };
      }
    }

    case "get_inventory_changes": {
      const itemName = String(args.item_name ?? "");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      const variationId = match.variationId ?? match.id;
      try {
        const res = await fetch(`${SQUARE_BASE}/inventory/changes?catalog_object_id=${variationId}&location_ids=${squareLocationId}`, { headers: squareHeaders(squareToken) });
        const data = (await res.json()) as any;
        const changes = (data.changes ?? []).slice(0, 10);
        if (changes.length === 0) return { result: `No recent changes for ${match.name}.` };
        const lines = changes.map((ch: any) => {
          const adj = ch.adjustment || ch.physical_count || ch.transfer;
          const type = ch.type ?? "UNKNOWN";
          const qty = adj?.quantity ?? "?";
          const at = adj?.occurred_at ? new Date(adj.occurred_at).toLocaleDateString() : "?";
          return `${type}: ${qty} on ${at}`;
        });
        return { result: `Recent changes for ${match.name}:\n${lines.join("\n")}` };
      } catch (e: any) {
        return { result: `Failed to get changes: ${e.message}` };
      }
    }

    case "low_stock_report": {
      if (!squareToken || !squareLocationId) return { result: "Square not connected." };
      if (catalog.length === 0) return { result: "No catalog items loaded." };
      const threshold = Number(args.threshold ?? 5);
      try {
        const ids = catalog.map((c) => c.variationId ?? c.id);
        const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({ catalog_object_ids: ids, location_ids: [squareLocationId] }),
        });
        const data = (await res.json()) as any;
        const counts = data.counts ?? [];
        const low: string[] = [];
        for (const c of catalog) {
          const vid = c.variationId ?? c.id;
          const count = counts.find((ct: any) => ct.catalog_object_id === vid && ct.state === "IN_STOCK");
          const qty = count ? parseFloat(count.quantity) : 0;
          if (qty <= threshold) low.push(`${c.name}: ${qty}`);
        }
        if (low.length === 0) return { result: `All items are above ${threshold} units.` };
        return { result: `Low stock (≤${threshold}):\n${low.join("\n")}` };
      } catch (e: any) {
        return { result: `Failed to generate report: ${e.message}` };
      }
    }

    case "get_item_details": {
      const itemName = String(args.item_name ?? "");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      const details = [`Name: ${match.name}`, `Price: $${match.price.toFixed(2)}`, `Category: ${match.category ?? "none"}`, `Catalog ID: ${match.id}`, match.variationId ? `Variation ID: ${match.variationId}` : null].filter(Boolean).join("\n");
      return { result: details };
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// ── POST /tool — Execute a tool call from OpenClaw ────────────────────────────

router.post("/tool", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const { tool_name, arguments: args = {}, venue_id, session_id } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }
  if (!venue_id) {
    res.status(400).json({ error: "venue_id is required" });
    return;
  }

  const sid = session_id || `openclaw-${req.user.id}-${venue_id}`;

  try {
    const sess = await getOrCreateSession(sid, req.user.id, Number(venue_id));
    if (!sess) {
      res.status(404).json({ error: "Venue not found or not authorized" });
      return;
    }

    const { result, command } = await executeTool(tool_name, args, sess);

    res.json({
      result,
      ...(command ? { command } : {}),
    });
  } catch (e: any) {
    console.error("[OpenClaw] Tool error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /catalog — Get the catalog for a venue ────────────────────────────────

router.get("/catalog", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const venueId = Number(req.query.venue_id);
  if (!venueId) {
    res.status(400).json({ error: "venue_id is required" });
    return;
  }

  const creds = await lookupVenueCredentials(req.user.id, venueId);
  if (!creds) {
    res.status(404).json({ error: "Venue not found or not authorized" });
    return;
  }

  const catalog = await loadCatalog(creds.squareToken, creds.squareLocationId);
  res.json({ catalog });
});

// ── POST /session/end — End an OpenClaw session (cancel open orders) ──────────

router.post("/session/end", requireAuth as any, async (req: any, res: any) => {
  const { session_id } = req.body ?? {};
  if (!session_id) {
    res.status(400).json({ error: "session_id is required" });
    return;
  }

  const sess = sessions.get(session_id);
  if (sess) {
    if (sess.liveSession.squareOrderId) {
      await cancelLiveOrder(sess.liveSession, sess.squareToken, sess.squareLocationId);
    }
    sessions.delete(session_id);
  }

  res.json({ ok: true });
});

export default router;
