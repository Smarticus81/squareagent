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
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

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
): Promise<{ result: string; command?: OrderCommand }> {
  switch (name) {
    case "add_item": {
      const itemName = String(args.item_name ?? "");
      const qty = Number(args.quantity ?? 1);
      const match = findCatalogItem(catalog, itemName);
      if (match) {
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
      return { result: "Order cleared.", command: { action: "clear" } };

    case "submit_order": {
      const total = order.reduce((s, i) => s + i.price * i.quantity, 0);
      return {
        result: `Order submitted! Total: $${total.toFixed(2)}.`,
        command: { action: "submit" },
      };
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

  return `You are a friendly Square POS voice agent for an event bar.
You handle two modes by voice — order taking and inventory management.

Available catalog:
${catalogStr}

Current order:
${orderStr}

Order taking rules:
- Be brief and conversational (1–2 short sentences max).
- Always confirm actions ("Added 2 Fosters!", "Got it, removed the wine.").
- Use tools for every order action — never guess or describe without calling a tool.
- Match items by name flexibly.
- If item not found, say so and suggest what's available.
- On submit, confirm the total.

Inventory rules:
- Use check_inventory to report stock levels ("How many Coors Light do we have?").
- Use adjust_inventory to add stock ("We received 24 Fosters") or remove it ("We wasted 3 Amarula").
- Use set_inventory after a physical count ("Set Coors Light to 48").
- Always confirm the action and report the new stock level.`;
}

// ── Relay ─────────────────────────────────────────────────────────────────────

export function attachRealtimeRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/api/realtime" });

  wss.on("connection", (clientWs) => {
    console.log("[Realtime] Client connected");
    let catalog: CatalogItem[] = [];
    let order: OrderItem[] = [];
    let squareToken = "";
    let squareLocationId = "";

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
            voice: "alloy",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
            },
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.8,
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
          const { result, command } = await executeTool(name, args, catalog, order, squareToken, squareLocationId);
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
