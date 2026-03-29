/**
 * POS tools — ordering, terminal payments, menu search.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import {
  findCatalogItem,
  syncLiveOrderToSquare,
  cancelLiveOrder,
  completeLiveOrder,
  pushToTerminal,
  SQUARE_BASE,
  squareHeaders,
} from "../lib/square-helpers";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "add_item",
    description: "Add an item to the current order",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the menu item" },
        quantity: { type: "integer", description: "Quantity to add (default 1)", default: 1 },
        item_id: { type: "string", description: "Catalog item ID if known" },
        price: { type: "number", description: "Item price in USD if known" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function",
    name: "remove_item",
    description: "Remove an item from the current order",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the menu item to remove" },
        quantity: { type: "integer", description: "Quantity to remove (default 1)", default: 1 },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function",
    name: "get_order",
    description: "Get the current order contents and total",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "clear_order",
    description: "Clear all items from the current order",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "submit_order",
    description: "Submit the current order to Square POS",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "send_to_terminal",
    description: "Send the current order to the Square Terminal for card payment. Use when the customer wants to pay by card on the physical terminal.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "search_menu",
    description: "Search the menu catalog for available items",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term" },
      },
      required: ["query"],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

async function addItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { catalog, session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
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

async function removeItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
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

async function getOrder(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionOrder = ctx.session.items;
  if (sessionOrder.length === 0) return { result: "The order is currently empty." };
  const lines = sessionOrder.map((i) => `${i.quantity}x ${i.name} @ $${i.price.toFixed(2)}`);
  const total = sessionOrder.reduce((s, i) => s + i.price * i.quantity, 0);
  const posNote = ctx.session.squareOrderId ? ` (live on POS: ${ctx.session.referenceId ?? ctx.session.squareOrderId})` : "";
  return { result: `Current order${posNote}:\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}` };
}

async function clearOrder(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  await cancelLiveOrder(ctx.session, ctx.squareToken, ctx.squareLocationId);
  ctx.session.items.splice(0, ctx.session.items.length);
  return { result: "Order cleared. Removed from POS.", command: { action: "clear" } };
}

async function submitOrder(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
  if (sessionOrder.length === 0) return { result: "The order is empty — nothing to submit." };
  if (!squareToken || !squareLocationId) return { result: "Square is not configured for this session — cannot submit." };

  try {
    if (session.squareOrderId) {
      const { orderId, total, paymentId, error } = await completeLiveOrder(session, squareToken, squareLocationId);
      if (error) console.warn(`[Tools/POS] Live payment failed: ${error}`);
      else console.log(`[Tools/POS] Live order completed: ${orderId} | $${total.toFixed(2)} | payment=${paymentId}`);
      sessionOrder.splice(0, sessionOrder.length);
      session.squareOrderId = undefined;
      session.squareOrderVersion = undefined;
      session.squareOrderTotal = undefined;
      session.referenceId = undefined;
      session.lineItemUids = undefined;
      return {
        result: `Order submitted! Total: $${total.toFixed(2)}.${error ? ` Warning: ${error}` : ""}`,
        command: { action: "submit", squareOrderId: orderId },
      };
    }

    // Fallback: no live order — create + pay
    const lineItems = sessionOrder.map((item) => ({
      quantity: item.quantity.toString(),
      catalog_object_id: item.variationId || item.catalogItemId,
      ...(item.variationId ? {} : { base_price_money: { amount: Math.round(item.price * 100), currency: "USD" } }),
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
    if (!orderRes.ok) {
      const errMsg = orderData.errors?.[0]?.detail || "Failed to create order";
      console.error("[Tools/POS] Order failed:", JSON.stringify(orderData.errors));
      return { result: `Order failed: ${errMsg}` };
    }
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
      console.warn("[Tools/POS] Payment failed:", JSON.stringify(pd.errors));
    }

    sessionOrder.splice(0, sessionOrder.length);
    const total = orderTotal / 100;
    return { result: `Order submitted! Total: $${total.toFixed(2)}.`, command: { action: "submit" } };
  } catch (e: any) {
    console.error("[Tools/POS] submit_order error:", e.message);
    return { result: `Failed to submit order: ${e.message}` };
  }
}

async function sendToTerminal(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
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
    if (devices.length === 0) return { result: "No Square Terminal devices found at this location. The order is live on the POS — complete it from there." };
    const device = devices[0];
    const { checkoutId, error } = await pushToTerminal(squareToken, squareLocationId, device.id, session.squareOrderId, session.squareOrderTotal ?? 0);
    if (error) return { result: `Couldn't send to terminal: ${error}. The order is still open on the POS.` };
    return {
      result: `Sent to the terminal! Total: $${((session.squareOrderTotal ?? 0) / 100).toFixed(2)}. Customer can tap or swipe.`,
      command: { action: "submit", squareOrderId: session.squareOrderId },
    };
  } catch (e: any) {
    console.error("[Tools/POS] send_to_terminal error:", e.message);
    return { result: `Failed to send to terminal: ${e.message}` };
  }
}

async function searchMenu(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const q = String(args.query ?? "").toLowerCase();
  const hits = ctx.catalog.filter((c) => c.name.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q));
  if (hits.length === 0) return { result: `No menu items matching "${q}".` };
  return { result: hits.map((c) => `${c.name}: $${c.price.toFixed(2)}`).join(", ") };
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  add_item: addItem,
  remove_item: removeItem,
  get_order: getOrder,
  clear_order: clearOrder,
  submit_order: submitOrder,
  send_to_terminal: sendToTerminal,
  search_menu: searchMenu,
};
