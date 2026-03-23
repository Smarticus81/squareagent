/**
 * OpenAI Realtime API relay
 * Client WebSocket ↔ OpenAI Realtime WebSocket (wss://api.openai.com/v1/realtime)
 * - Relays all events bidirectionally
 * - Executes tool calls server-side, returns results to OpenAI + order commands to client
 * - Handles x.context_update custom events from client to keep catalog/order/credentials in session
 */

import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";

const REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17";

const SQUARE_BASE = "https://connect.squareup.com/v2";

function squareHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// ── Tool definitions (Realtime API format) ────────────────────────────────────

const TOOLS = [
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
    description: "Check the current stock level of an item in Square inventory",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item to check" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function",
    name: "adjust_inventory",
    description: "Add or remove stock for an item. Use positive quantity to add stock (received delivery), negative to remove (used, damaged).",
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
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  variationId?: string;
  name: string;
  price: number;
  category?: string;
}

interface OrderItem {
  item_id?: string;
  item_name: string;
  quantity: number;
  price: number;
}

// Server-side order tracking — not dependent on client context_update timing
interface SessionOrderItem {
  catalogItemId: string;
  variationId?: string;
  name: string;
  price: number;
  quantity: number;
}

interface OrderCommand {
  action: "add" | "remove" | "clear" | "submit";
  item_id?: string;
  item_name?: string;
  quantity?: number;
  price?: number;
}

// ── Square Inventory helpers ──────────────────────────────────────────────────

function findCatalogItem(catalog: CatalogItem[], name: string): CatalogItem | undefined {
  return catalog.find((c) => c.name.toLowerCase() === name.toLowerCase())
    ?? catalog.find((c) =>
      c.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(c.name.toLowerCase())
    );
}

async function getInventoryCount(token: string, locationId: string, variationId: string): Promise<number> {
  const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
    method: "POST",
    headers: squareHeaders(token),
    body: JSON.stringify({
      catalog_object_ids: [variationId],
      location_ids: [locationId],
    }),
  });
  const data = await res.json() as any;
  const count = data.counts?.find((c: any) => c.catalog_object_id === variationId && c.state === "IN_STOCK");
  return count ? parseFloat(count.quantity) : 0;
}

// ── Tool executor (async) ─────────────────────────────────────────────────────

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
        // Track server-side so submit_order can fire immediately without waiting for client context_update
        const existing = sessionOrder.find((i) => i.catalogItemId === match.id);
        if (existing) {
          existing.quantity += qty;
        } else {
          sessionOrder.push({ catalogItemId: match.id, variationId: match.variationId, name: match.name, price: match.price, quantity: qty });
        }
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
      // Remove from server-side tracking
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
      if (sessionOrder.length === 0) {
        return { result: "The order is empty — nothing to submit." };
      }
      if (!squareToken || !squareLocationId) {
        return { result: "Square is not configured for this session — cannot submit." };
      }
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
          console.error("[Realtime] Order failed:", JSON.stringify(orderData.errors));
          return { result: `Order failed: ${errMsg}` };
        }
        const orderId = orderData.order?.id;
        const orderTotal = orderData.order?.total_money?.amount ?? 0;
        console.log(`[Realtime] Order created: ${orderId} | total: ${orderTotal}`);

        // External payment so the order appears in Square's transaction history
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
        const paymentData = await paymentRes.json() as any;
        if (!paymentRes.ok) {
          console.warn("[Realtime] Payment failed (order still recorded):", JSON.stringify(paymentData.errors));
        } else {
          console.log(`[Realtime] Payment created: ${paymentData.payment?.id}`);
        }

        // Clear session order — already submitted
        sessionOrder.splice(0, sessionOrder.length);

        const total = orderTotal / 100;
        return {
          result: `Order submitted! Total: $${total.toFixed(2)}.`,
          command: { action: "submit" },
        };
      } catch (e: any) {
        console.error("[Realtime] submit_order error:", e.message);
        return { result: `Failed to submit order: ${e.message}` };
      }
    }

    case "search_menu": {
      const q = String(args.query ?? "").toLowerCase();
      const hits = catalog.filter(
        (c) => c.name.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q)
      );
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

    case "adjust_inventory": {
      const itemName = String(args.item_name ?? "");
      const quantity = Number(args.quantity ?? 0);
      const reason = String(args.reason ?? "received");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      if (!squareToken || !squareLocationId) return { result: "Square not connected — cannot adjust inventory." };
      const variationId = match.variationId ?? match.id;
      const isAdding = quantity > 0;
      try {
        const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `inv-adj-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            changes: [{
              type: "ADJUSTMENT",
              adjustment: {
                catalog_object_id: variationId,
                location_id: squareLocationId,
                from_state: isAdding ? "NONE" : "IN_STOCK",
                to_state: isAdding ? "IN_STOCK" : "WASTE",
                quantity: Math.abs(quantity).toString(),
                occurred_at: new Date().toISOString(),
              },
            }],
          }),
        });
        const data = await res.json() as any;
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
      if (!squareToken || !squareLocationId) return { result: "Square not connected — cannot set inventory." };
      const variationId = match.variationId ?? match.id;
      try {
        const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
          method: "POST",
          headers: squareHeaders(squareToken),
          body: JSON.stringify({
            idempotency_key: `inv-set-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            changes: [{
              type: "PHYSICAL_COUNT",
              physical_count: {
                catalog_object_id: variationId,
                location_id: squareLocationId,
                quantity: quantity.toString(),
                state: "IN_STOCK",
                occurred_at: new Date().toISOString(),
              },
            }],
          }),
        });
        const data = await res.json() as any;
        if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
        return { result: `${match.name} inventory set to ${quantity} in Square.` };
      } catch (e: any) {
        return { result: `Failed to set inventory: ${e.message}` };
      }
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildInstructions(catalog: CatalogItem[], order: OrderItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}`).join("\n")
      : "  (No catalog loaded — ask user to connect Square POS)";

  const orderStr =
    order.length > 0
      ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
      : "  (empty)";

  return `You are a bartender at an event bar (Square POS). Keep responses short — one or two sentences max.

Catalog:
${catalogStr}

Current order:
${orderStr}

Rules:
- Sound natural and warm. Short replies. No monologues.
- Only add items when the customer clearly orders ("I'll have a Fosters", "two Bud Lights").
- Never submit until they say so ("that's it", "ring it up", "I'm done"). Confirm briefly first.
- If they're browsing or chatting, just talk — don't push.
- Menu questions: mention a few highlights, don't list everything.
- If something's not on the menu, suggest what's close.
- Noisy environment — ignore background noise, only respond to direct speech. If unclear, ask.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign" or read digits.`;
}

// ── Relay ─────────────────────────────────────────────────────────────────────

export function attachRealtimeRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/api/realtime" });

  wss.on("connection", (clientWs, req) => {
    // Parse voice/speed preferences from query params
    const rawUrl = req.url ?? "";
    const qIdx = rawUrl.indexOf("?");
    const params = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "");
    const sessionVoice = params.get("voice") ?? "ash";
    const sessionSpeed = parseFloat(params.get("speed") ?? "0.9");

    console.log(`[Realtime] Client connected (voice=${sessionVoice} speed=${sessionSpeed})`);
    let catalog: CatalogItem[] = [];
    let order: OrderItem[] = [];
    let squareToken = "";
    let squareLocationId = "";
    // Server-side order tracking — updated immediately when tools fire, no client round-trip
    const sessionOrder: SessionOrderItem[] = [];

    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";

    const openaiWs = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.on("open", () => {
      console.log("[Realtime] Connected to OpenAI");
      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            voice: sessionVoice,
            speed: sessionSpeed,
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
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.6,
            instructions: buildInstructions(catalog, order),
          },
        })
      );
    });

    openaiWs.on("message", async (raw) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      const msg = raw.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(msg); } catch { return; }

      if (event.type === "response.function_call_arguments.done") {
        const name = String(event.name ?? "");
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(event.arguments ?? "{}")); } catch {}

        console.log(`[Realtime] Tool call: ${name}(${JSON.stringify(args)})`);
        try {
          const { result, command } = await executeTool(name, args, catalog, order, squareToken, squareLocationId, sessionOrder);
          console.log(`[Realtime] Tool result: ${result}`);

          openaiWs.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: result,
              },
            })
          );
          openaiWs.send(JSON.stringify({ type: "response.create" }));

          if (command) {
            clientWs.send(JSON.stringify({ type: "x.order_command", command }));
          }
        } catch (e: any) {
          console.error(`[Realtime] Tool error: ${e.message}`);
        }
      } else {
        clientWs.send(msg);
      }
    });

    clientWs.on("message", (raw) => {
      const msg = raw.toString();

      // Fast-path: audio data is the vast majority of messages.
      // Relay directly without JSON.parse overhead.
      if (msg.includes('"input_audio_buffer.append"') && !msg.includes('"x.context_update"')) {
        if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(msg);
        return;
      }

      let event: Record<string, unknown>;
      try { event = JSON.parse(msg); } catch { return; }

      if (event.type === "x.context_update") {
        if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
        if (Array.isArray(event.order)) order = event.order as OrderItem[];
        if (typeof event.squareToken === "string") squareToken = event.squareToken;
        if (typeof event.squareLocationId === "string") squareLocationId = event.squareLocationId;
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(
            JSON.stringify({
              type: "session.update",
              session: { instructions: buildInstructions(catalog, order) },
            })
          );
        }
      } else {
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(msg);
        }
      }
    });

    clientWs.on("close", () => {
      console.log("[Realtime] Client disconnected");
      openaiWs.close();
    });
    openaiWs.on("close", () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });
    openaiWs.on("error", (e) => {
      console.error("[Realtime] OpenAI WS error:", e.message);
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });
  });

  console.log("[Realtime] Relay attached at /api/realtime");
}
