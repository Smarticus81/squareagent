/**
 * POS tools — ordering, terminal payments, menu search.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import {
  findCatalogItem,
  normalizeItemName,
  syncLiveOrderToSquare,
  cancelLiveOrder,
  completeLiveOrder,
  detachLiveOrder,
  pushToTerminal,
  listLocationDevices,
  externalPaymentBody,
  idempotencyKey,
  redactSquareId,
  squareErrorMessage,
} from "../lib/square-helpers";
import { squareFromCtx, idempotencySeed, money } from "./_square";
import { createComponentLogger } from "../lib/logger";

const log = createComponentLogger("tool:pos");

function squareIdempotencyKey(ctx: ToolContext, suffix: string): string | undefined {
  const seed = idempotencySeed(ctx, suffix);
  return seed ? idempotencyKey("v", seed) : undefined;
}

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

function sessionTotal(ctx: ToolContext): number {
  return ctx.session.items.reduce((s, i) => s + i.price * i.quantity, 0);
}

async function addItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { catalog, session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
  const itemName = String(args.item_name ?? "");
  const qty = Math.max(1, Math.round(Number(args.quantity ?? 1)) || 1);
  // No menu loaded — we can't see what's available, so we can't take an order.
  // Refuse truthfully instead of adding an item we can't verify or price. This
  // backstops the prompt: the assistant only takes orders when it can actually
  // see the catalog.
  if (catalog.length === 0) {
    return {
      result:
        "MENU NOT AVAILABLE: no menu is loaded, so there are no items to order from. Do not claim anything was added. Tell the user you can't see their menu yet and they need to sign in and connect Square from the dashboard before you can take orders.",
    };
  }
  const byId = typeof args.item_id === "string" && args.item_id
    ? catalog.find((c) => c.id === args.item_id || c.variationId === args.item_id)
    : undefined;
  const match = byId ?? findCatalogItem(catalog, itemName);
  if (!match) {
    const names = catalog.slice(0, 5).map((c) => c.name).join(", ");
    return { result: `Item "${itemName}" not found. Available: ${names || "none"}` };
  }
  const lineKey = match.variationId ?? match.id;
  const existing = sessionOrder.find((i) => (i.variationId ?? i.catalogItemId) === lineKey);
  if (existing) existing.quantity += qty;
  else sessionOrder.push({ catalogItemId: match.id, variationId: match.variationId, name: match.name, price: match.price, quantity: qty });
  const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId, squareIdempotencyKey(ctx, "add"));
  const posStatus = sync.ok && session.squareOrderId
    ? " Showing on POS."
    : sync.error ? ` (POS sync issue: ${sync.error})` : "";
  return {
    result: `Added ${qty}x ${match.name} ($${(match.price * qty).toFixed(2)}) to the order.${posStatus}`,
    command: { action: "add", item_id: match.id, item_name: match.name, quantity: qty, price: match.price, squareOrderId: session.squareOrderId },
  };
}

async function removeItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
  const itemName = String(args.item_name ?? "");
  const qty = Math.max(1, Math.round(Number(args.quantity ?? 1)) || 1);
  const n = normalizeItemName(itemName);
  const idx = sessionOrder.findIndex((i) => {
    const name = normalizeItemName(i.name);
    return name === n || name.includes(n) || n.includes(name);
  });
  if (idx < 0) {
    return { result: `"${itemName}" isn't on the order.${sessionOrder.length ? ` Currently: ${sessionOrder.map((i) => `${i.quantity}x ${i.name}`).join(", ")}.` : ""}` };
  }
  const removedName = sessionOrder[idx].name;
  sessionOrder[idx].quantity -= qty;
  if (sessionOrder[idx].quantity <= 0) sessionOrder.splice(idx, 1);
  const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId, squareIdempotencyKey(ctx, "rm"));
  const posStatus = sync.ok && session.squareOrderId ? " POS updated." : sync.error ? ` (POS sync issue: ${sync.error})` : "";
  return {
    result: `Removed ${qty}x ${removedName} from the order.${posStatus}`,
    command: { action: "remove", item_name: removedName, quantity: qty, squareOrderId: session.squareOrderId },
  };
}

async function getOrder(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionOrder = ctx.session.items;
  if (sessionOrder.length === 0) return { result: "The order is currently empty." };
  const lines = sessionOrder.map((i) => `${i.quantity}x ${i.name} @ $${i.price.toFixed(2)}`);
  const total = typeof ctx.session.squareOrderTotal === "number" ? ctx.session.squareOrderTotal / 100 : sessionTotal(ctx);
  const posNote = ctx.session.squareOrderId ? ` (live on POS: ${ctx.session.referenceId ?? ctx.session.squareOrderId})` : "";
  return { result: `Current order${posNote}:\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}` };
}

async function clearOrder(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const hadLiveOrder = Boolean(ctx.session.squareOrderId);
  await cancelLiveOrder(ctx.session, ctx.squareToken, ctx.squareLocationId);
  ctx.session.items.splice(0, ctx.session.items.length);
  return { result: hadLiveOrder ? "Order cleared. Removed from POS." : "Order cleared.", command: { action: "clear" } };
}

async function submitOrder(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
  if (sessionOrder.length === 0) return { result: "The order is empty — nothing to submit." };
  const client = squareFromCtx(ctx);
  if (!client) return { result: "Square is not configured for this session — cannot submit." };

  const holdForReview = ctx.orderHandlingMode === "hold_for_review";

  if (holdForReview) {
    // Hold-for-review: park the order on the POS as an OPEN ticket so the team
    // can settle it at close-out. Never take payment here.
    if (!session.squareOrderId) {
      const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId, squareIdempotencyKey(ctx, "add"));
      if (!sync.ok || !session.squareOrderId) {
        return { result: `Couldn't park the order on the POS${sync.error ? `: ${sync.error}` : ""}.` };
      }
    }
    const heldOrderId = session.squareOrderId;
    const reference = session.referenceId ?? heldOrderId;
    const total = typeof session.squareOrderTotal === "number" ? session.squareOrderTotal / 100 : sessionTotal(ctx);
    log.info({ order: redactSquareId(heldOrderId), ref: reference }, "order held for review");
    // Detach the session from the parked ticket without paying or cancelling,
    // so the OPEN order stays on the POS and the next conversation starts clean.
    sessionOrder.splice(0, sessionOrder.length);
    detachLiveOrder(session);
    return {
      result: `Sent to the POS for review. Total: $${total.toFixed(2)}. It's parked as an open ticket (${reference}) for close-out — no payment taken.`,
      command: { action: "submit", squareOrderId: heldOrderId },
    };
  }

  if (session.squareOrderId) {
    const { orderId, total, paymentId, error } = await completeLiveOrder(
      session, squareToken, squareLocationId, squareIdempotencyKey(ctx, "pay"),
    );
    if (error) log.warn({ order: redactSquareId(orderId), err: error }, "live payment failed");
    else log.info({ order: redactSquareId(orderId), payment: redactSquareId(paymentId) }, "live order completed");
    sessionOrder.splice(0, sessionOrder.length);
    detachLiveOrder(session);
    return {
      result: `Order submitted! Total: $${total.toFixed(2)}.${error ? ` Warning: ${error}` : ""}`,
      command: { action: "submit", squareOrderId: orderId },
    };
  }

  // Fallback: no live order — create + pay in one go.
  const lineItems = sessionOrder.map((item) => ({
    quantity: item.quantity.toString(),
    ...(item.variationId
      ? { catalog_object_id: item.variationId }
      : { name: item.name, base_price_money: { amount: Math.round(item.price * 100), currency: "USD" } }),
  }));
  const orderRes = await client.post("/orders", {
    idempotency_key: squareIdempotencyKey(ctx, "order") ?? idempotencyKey("order"),
    order: { location_id: squareLocationId, reference_id: `VOICE-${Date.now()}`, line_items: lineItems },
  });
  if (!orderRes.ok) {
    log.error({ err: orderRes.error }, "order create failed");
    return { result: `Order failed: ${squareErrorMessage(orderRes.error, "Failed to create order")}` };
  }
  const orderId: string = orderRes.data.order?.id;
  const orderTotal: number = orderRes.data.order?.total_money?.amount ?? 0;

  const paymentRes = await client.post("/payments", {
    idempotency_key: squareIdempotencyKey(ctx, "pay") ?? idempotencyKey("pay", orderId),
    ...externalPaymentBody(orderId, orderTotal, squareLocationId),
  });
  const paymentError = paymentRes.ok ? undefined : squareErrorMessage(paymentRes.error, "Payment failed");
  if (paymentError) log.warn({ order: redactSquareId(orderId), err: paymentError }, "payment failed");

  sessionOrder.splice(0, sessionOrder.length);
  return {
    result: `Order submitted! Total: ${money(orderTotal)}.${paymentError ? ` Warning: ${paymentError}` : ""}`,
    command: { action: "submit", squareOrderId: orderId },
  };
}

async function sendToTerminal(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session, squareToken, squareLocationId } = ctx;
  const sessionOrder = session.items;
  if (sessionOrder.length === 0) return { result: "The order is empty — nothing to send to the terminal." };
  const client = squareFromCtx(ctx);
  if (!client) return { result: "Square is not configured — cannot send to terminal." };

  if (!session.squareOrderId) {
    const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId, squareIdempotencyKey(ctx, "add"));
    if (!sync.ok) return { result: `Could not create the order in Square: ${sync.error}. Try submitting instead.` };
  }
  if (!session.squareOrderId) return { result: "Could not create the order in Square. Try submitting instead." };

  const devices = await listLocationDevices(client);
  if (!devices.ok) {
    return { result: `Couldn't look up terminals: ${squareErrorMessage(devices.error)}. The order is still open on the POS.` };
  }
  const total = money(session.squareOrderTotal);
  if (devices.terminals.length === 0) {
    if (devices.posDevices.length > 0) {
      return { result: `Your location has an iPad/POS but no Square Terminal hardware. The order (${total}) is already live on your iPad POS as an open ticket — just tap it there to take payment.` };
    }
    // No devices at all — order is still live on any POS signed into this location
    return { result: `No Square Terminal devices found at this location. The order (${total}) is live on the POS — open the ticket on your iPad to complete payment.` };
  }

  const device = devices.terminals[0];
  const { checkoutId, error } = await pushToTerminal(
    squareToken,
    squareLocationId,
    device.id,
    session.squareOrderId,
    session.squareOrderTotal ?? 0,
    squareIdempotencyKey(ctx, "term"),
  );
  if (error) return { result: `Couldn't send to terminal: ${error}. The order is still open on the POS.` };
  log.info({ checkout: redactSquareId(checkoutId) }, "terminal checkout sent");
  return {
    result: `Sent to the terminal! Total: ${total}. Customer can tap or swipe.`,
    command: { action: "submit", squareOrderId: session.squareOrderId },
  };
}

async function searchMenu(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const q = normalizeItemName(String(args.query ?? ""));
  if (!q) return { result: "What should I search for?" };
  const hits = ctx.catalog.filter((c) =>
    normalizeItemName(c.name).includes(q) || (c.category ? normalizeItemName(c.category).includes(q) : false),
  );
  if (hits.length === 0) {
    const fuzzy = findCatalogItem(ctx.catalog, q);
    if (fuzzy) return { result: `${fuzzy.name}: $${fuzzy.price.toFixed(2)}` };
    return { result: `No menu items matching "${args.query}".` };
  }
  const shown = hits.slice(0, 15);
  const more = hits.length > shown.length ? ` (and ${hits.length - shown.length} more)` : "";
  return { result: shown.map((c) => `${c.name}: $${c.price.toFixed(2)}`).join(", ") + more };
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
