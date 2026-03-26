/**
 * WebSocket Relay for Native (iOS/Android) Voice Agent
 *
 * Accepts WebSocket upgrades on /api/realtime path.
 * Authenticates via ?token=JWT&venueId=ID query params.
 * Opens a relay WebSocket to OpenAI Realtime API.
 * Handles tool calls server-side, just like the REST endpoints do for WebRTC.
 */

import { IncomingMessage } from "http";
import { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { db, venuesTable, sessionsTable, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  SQUARE_BASE,
  squareHeaders,
  findCatalogItem,
  getInventoryCount,
  type CatalogItem,
  type OrderItem,
  type SessionOrderItem,
  type OrderCommand,
} from "../lib/square-helpers";

const JWT_SECRET = process.env.JWT_SECRET ?? "bevpro-dev-secret-change-in-production";
const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function authenticateToken(token: string): Promise<{ userId: number; subscription: any } | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; sid: string };
    if (!payload?.sub || !payload?.sid) return null;

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, payload.sid));
    if (!session || session.expiresAt < new Date()) return null;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
    if (!user) return null;

    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    return { userId: user.id, subscription: subscription ?? null };
  } catch {
    return null;
  }
}

function checkPlan(subscription: any): string | null {
  if (!subscription) return "No active subscription";

  if (subscription.status === "trialing") {
    if (subscription.trialEndsAt && new Date(subscription.trialEndsAt) < new Date()) {
      return "Trial expired. Please subscribe to continue.";
    }
    return null;
  }

  if (subscription.status !== "active") return "Subscription inactive";

  return null;
}

async function lookupVenueCredentials(userId: number, venueId: number) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, userId)));
  if (!venue) return null;
  return { squareToken: venue.squareAccessToken ?? "", squareLocationId: venue.squareLocationId ?? "" };
}

// ── Unified tool definitions (same as realtime.ts) ───────────────────────────

const TOOLS = [
  // POS tools
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
  {
    type: "function",
    name: "check_inventory",
    description: "Check the current stock level of a specific item",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item to check" },
      },
      required: ["item_name"],
    },
  },
  // Inventory tools
  {
    type: "function",
    name: "check_all_inventory",
    description: "Get stock levels for all items in the catalog",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "adjust_inventory",
    description: "Add or remove stock. Positive quantity = add (delivery received), negative = remove (used, damaged, waste).",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item" },
        quantity: { type: "number", description: "Amount to add (positive) or remove (negative)" },
        reason: { type: "string", description: "Reason: received, used, damaged, correction, waste", default: "received" },
      },
      required: ["item_name", "quantity"],
    },
  },
  {
    type: "function",
    name: "set_inventory",
    description: "Set the absolute stock count for an item (e.g. after a physical count)",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item" },
        quantity: { type: "number", description: "New absolute stock count" },
      },
      required: ["item_name", "quantity"],
    },
  },
  {
    type: "function",
    name: "transfer_inventory",
    description: "Transfer stock of an item from one location to another",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item" },
        quantity: { type: "number", description: "Quantity to transfer" },
        to_location_id: { type: "string", description: "Destination Square location ID" },
      },
      required: ["item_name", "quantity", "to_location_id"],
    },
  },
  {
    type: "function",
    name: "get_inventory_changes",
    description: "Get recent inventory changes/history for a specific item",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function",
    name: "low_stock_report",
    description: "Get items that are low in stock (below a threshold)",
    parameters: {
      type: "object",
      properties: {
        threshold: { type: "number", description: "Stock level threshold (default 5)", default: 5 },
      },
    },
  },
  {
    type: "function",
    name: "get_item_details",
    description: "Get full details for a specific item including variations, pricing, and category",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item" },
      },
      required: ["item_name"],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  catalog: CatalogItem[],
  order: OrderItem[],
  squareToken: string,
  squareLocationId: string,
  sessionOrder: SessionOrderItem[],
): Promise<{ result: string; command?: OrderCommand }> {
  switch (name) {
    case "add_item": {
      const itemName = String(args.item_name ?? "");
      const qty = Number(args.quantity ?? 1);
      const match = findCatalogItem(catalog, itemName);
      if (match) {
        const existing = sessionOrder.find((i) => i.catalogItemId === match.id);
        if (existing) existing.quantity += qty;
        else sessionOrder.push({ catalogItemId: match.id, variationId: match.variationId, name: match.name, price: match.price, quantity: qty });
        return {
          result: `Added ${qty}x ${match.name} ($${(match.price * qty).toFixed(2)}) to the order.`,
          command: { action: "add", item_id: match.id, item_name: match.name, quantity: qty, price: match.price },
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
      return {
        result: `Removed ${qty}x ${itemName} from the order.`,
        command: { action: "remove", item_name: itemName, quantity: qty },
      };
    }
    case "get_order": {
      if (order.length === 0) return { result: "The order is currently empty." };
      const lines = order.map((i) => `${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`);
      const total = order.reduce((s, i) => s + i.price * i.quantity, 0);
      return { result: `Current order:\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}` };
    }
    case "clear_order":
      sessionOrder.splice(0, sessionOrder.length);
      return { result: "Order cleared.", command: { action: "clear" } };
    case "submit_order": {
      if (sessionOrder.length === 0) return { result: "The order is empty — nothing to submit." };
      if (!squareToken || !squareLocationId) return { result: "Square is not configured — cannot submit." };
      try {
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
        if (!orderRes.ok) {
          const errMsg = orderData.errors?.[0]?.detail || "Failed to create order";
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
          console.warn("[WS-Relay] Payment failed:", JSON.stringify(pd.errors));
        }
        sessionOrder.splice(0, sessionOrder.length);
        return { result: `Order submitted! Total: $${(orderTotal / 100).toFixed(2)}.`, command: { action: "submit" } };
      } catch (e: any) {
        return { result: `Failed to submit order: ${e.message}` };
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
      if (!squareToken || !squareLocationId) return { result: "Square not connected — cannot check inventory." };
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

// ── Build instructions ────────────────────────────────────────────────────────

function buildInstructions(catalog: CatalogItem[], order: OrderItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
      : "  (No catalog loaded — ask user to connect Square)";

  const orderStr =
    order.length > 0
      ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
      : "  (empty)";

  return `You are BevPro, a voice assistant for bars and venues running on Square. You handle ordering (POS), inventory management, and menu lookups — all in one.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona:
- Professional, warm, efficient. You're a co-worker, not a customer-facing bot.
- Speak like bar staff: short, punchy, no fluff. One or two sentences max.
- Understand bartender slang: "86 it" = remove/out of stock, "ring it up" / "close it out" = submit, "tab it" = add to order, "what's on the ticket" = get order.
- Understand inventory terms: "we got a case of" = add 24, "count" = check levels.

POS Rules:
- Add items only on clear intent ("two Fosters", "tab a Bud Light").
- Never submit until they say so ("ring it up", "close it out", "that's it"). Confirm the total first.
- If browsing or chatting, just talk — don't push items.
- Menu questions: mention a few options, don't dump the whole list.
- If something's not on the menu, suggest what's close.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".

Inventory Rules:
- Always confirm quantities before making changes: "Adjusting Bud Light up 24, that right?"
- For bulk operations, summarize what you'll do before executing.
- Low stock alerts: proactively mention if an item drops below 5 units after an adjustment.
- Say numbers clearly: "twenty-four" not "24".

General:
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.`;
}

// ── Attach WebSocket server to HTTP server ────────────────────────────────────

export function attachWebSocketRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Only handle /api/realtime WebSocket upgrades
    if (url.pathname !== "/api/realtime") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    const venueIdStr = url.searchParams.get("venueId");

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate
    const auth = await authenticateToken(token);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Check subscription plan
    const planError = checkPlan(auth.subscription);
    if (planError) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // Lookup venue credentials
    let squareToken = "";
    let squareLocationId = "";
    if (venueIdStr) {
      const creds = await lookupVenueCredentials(auth.userId, Number(venueIdStr));
      if (creds) {
        squareToken = creds.squareToken;
        squareLocationId = creds.squareLocationId;
      }
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, req, {
        userId: auth.userId,
        venueId: venueIdStr ? Number(venueIdStr) : null,
        squareToken,
        squareLocationId,
      });
    });
  });

  wss.on("connection", (clientWs: WebSocket, _req: IncomingMessage, ctx: {
    userId: number;
    venueId: number | null;
    squareToken: string;
    squareLocationId: string;
  }) => {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "OpenAI API key not configured" } }));
      clientWs.close();
      return;
    }

    // Session state
    let catalog: CatalogItem[] = [];
    let order: OrderItem[] = [];
    const sessionOrder: SessionOrderItem[] = [];
    let sessionSquareToken = ctx.squareToken;
    let sessionLocationId = ctx.squareLocationId;

    // Connect to OpenAI Realtime API
    const openaiUrl = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`;
    const openaiWs = new WebSocket(openaiUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    let openaiReady = false;
    let pendingFromClient: string[] = [];

    openaiWs.on("open", () => {
      console.log(`[WS-Relay] OpenAI connected for user ${ctx.userId}`);
      openaiReady = true;

      // Configure session
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          voice: "ash",
          instructions: buildInstructions(catalog, order),
          tools: TOOLS,
          tool_choice: "auto",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.35,
            prefix_padding_ms: 200,
            silence_duration_ms: 400,
            create_response: true,
          },
          temperature: 0.6,
        },
      };
      openaiWs.send(JSON.stringify(sessionConfig));

      // Flush any messages that arrived before OpenAI was ready
      for (const msg of pendingFromClient) {
        openaiWs.send(msg);
      }
      pendingFromClient = [];
    });

    // Handle messages FROM OpenAI → relay to client (intercept tool calls)
    openaiWs.on("message", async (data) => {
      const raw = data.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { clientWs.send(raw); return; }

      // Intercept tool call completion → execute server-side
      if (event.type === "response.function_call_arguments.done") {
        const toolName = String(event.name ?? "");
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(event.arguments ?? "{}")); } catch {}
        const callId = String(event.call_id ?? "");

        console.log(`[WS-Relay] Tool call: ${toolName}(${JSON.stringify(args)})`);

        try {
          const { result, command } = await executeTool(
            toolName, args, catalog, order,
            sessionSquareToken, sessionLocationId, sessionOrder,
          );

          // Send tool output back to OpenAI
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: result,
            },
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));

          // Send order command to client
          if (command) {
            clientWs.send(JSON.stringify({ type: "x.order_command", command }));
          }
        } catch (e: any) {
          console.error(`[WS-Relay] Tool error:`, e.message);
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: `Error: ${e.message}`,
            },
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        }

        // Still forward the event to client for transcript/UI purposes
        clientWs.send(raw);
        return;
      }

      // Forward all other events to client
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(raw);
      }
    });

    openaiWs.on("error", (err) => {
      console.error("[WS-Relay] OpenAI WS error:", err.message);
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    });

    openaiWs.on("close", () => {
      console.log("[WS-Relay] OpenAI WS closed");
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    // Handle messages FROM client → relay to OpenAI (intercept context updates)
    clientWs.on("message", (data) => {
      const raw = data.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch {
        if (openaiReady) openaiWs.send(raw);
        else pendingFromClient.push(raw);
        return;
      }

      // Intercept custom context update — update local state, send session.update to OpenAI
      if (event.type === "x.context_update") {
        if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
        if (Array.isArray(event.order)) order = event.order as OrderItem[];
        if (event.squareToken) sessionSquareToken = String(event.squareToken);
        if (event.squareLocationId) sessionLocationId = String(event.squareLocationId);

        // Update voice and speed if provided
        const voice = event.voice ? String(event.voice) : undefined;

        // Send updated instructions to OpenAI
        if (openaiReady) {
          openaiWs.send(JSON.stringify({
            type: "session.update",
            session: {
              instructions: buildInstructions(catalog, order),
              ...(voice ? { voice } : {}),
            },
          }));
        }
        return;
      }

      // Forward standard Realtime API messages to OpenAI
      if (openaiReady) {
        openaiWs.send(raw);
      } else {
        pendingFromClient.push(raw);
      }
    });

    clientWs.on("close", () => {
      console.log(`[WS-Relay] Client disconnected (user ${ctx.userId})`);
      if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) {
        openaiWs.close();
      }
    });

    clientWs.on("error", (err) => {
      console.error("[WS-Relay] Client WS error:", err.message);
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });
  });

  console.log("[WS-Relay] WebSocket relay attached for /api/realtime");
}
