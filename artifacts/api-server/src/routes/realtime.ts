/**
 * POS Agent — REST endpoints for WebRTC-based Realtime API
 *
 * POST /session  → Mint ephemeral OpenAI token, return tools + instructions
 * POST /tools    → Execute a tool call server-side, return result + optional order command
 *
 * The client connects directly to OpenAI via WebRTC using the ephemeral token.
 * Tool calls arrive on the data channel, the client POSTs here, then sends the
 * result back to OpenAI via the data channel.
 */

import { Router } from "express";
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

const router = Router();

const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

// ── Tool definitions (POS agent — bartender-facing) ───────────────────────────

const POS_TOOLS = [
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

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// ── System prompt (bartender's personal assistant) ────────────────────────────

function buildInstructions(catalog: CatalogItem[], order: OrderItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}`).join("\n")
      : "  (No catalog loaded — ask bartender to connect Square)";

  const orderStr =
    order.length > 0
      ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
      : "  (empty)";

  return `You are BevPro, a bartender's voice assistant running on Square POS. You help the bartender ring up orders, check stock, and find menu info — fast and hands-free.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona:
- Professional, warm, efficient. You're a co-worker, not a customer-facing bot.
- Speak like bar staff: short, punchy, no fluff. One or two sentences max.
- Understand bartender slang: "86 it" = remove/out of stock, "ring it up" / "close it out" = submit, "tab it" = add to order, "what's on the ticket" = get order.

Rules:
- Add items only on clear intent ("two Fosters", "tab a Bud Light").
- Never submit until they say so ("ring it up", "close it out", "that's it"). Confirm the total first.
- If browsing or chatting, just talk — don't push items.
- Menu questions: mention a few options, don't dump the whole list.
- If something's not on the menu, suggest what's close.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.`;
}

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const { voice = "ash", speed = 0.9, catalog = [], order = [] } = req.body ?? {};

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_REALTIME_MODEL,
        modalities: ["text", "audio"],
        voice,
        instructions: buildInstructions(catalog, order),
        tools: POS_TOOLS,
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
        speed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[POS] Ephemeral token failed:", errText);
      res.status(response.status).json({ error: "Failed to create session" });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    console.error("[POS] Session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /tools — Execute a tool call ─────────────────────────────────────────

const sessionOrders = new Map<string, SessionOrderItem[]>();

router.post("/tools", async (req, res) => {
  const {
    session_id,
    tool_name,
    arguments: args = {},
    catalog = [],
    order = [],
    squareToken = "",
    squareLocationId = "",
  } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }

  const sessionId = String(session_id || "default");
  if (!sessionOrders.has(sessionId)) {
    sessionOrders.set(sessionId, []);
  }
  const sessionOrder = sessionOrders.get(sessionId)!;

  try {
    const { result, command } = await executeTool(
      tool_name,
      args,
      catalog,
      order,
      squareToken,
      squareLocationId,
      sessionOrder,
    );

    if (sessionOrder.length === 0) {
      sessionOrders.delete(sessionId);
    }

    res.json({ result, command: command ?? null });
  } catch (e: any) {
    console.error(`[POS] Tool error (${tool_name}):`, e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
