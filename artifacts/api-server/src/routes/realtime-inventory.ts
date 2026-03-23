/**
 * Inventory Agent — REST endpoints for WebRTC-based Realtime API
 *
 * POST /session  → Mint ephemeral OpenAI token with inventory tools + instructions
 * POST /tools    → Execute an inventory tool call server-side
 */

import { Router } from "express";
import {
  SQUARE_BASE,
  squareHeaders,
  findCatalogItem,
  getInventoryCount,
  type CatalogItem,
} from "../lib/square-helpers";

const router = Router();

const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

// ── Tool definitions (Inventory agent) ────────────────────────────────────────

const INVENTORY_TOOLS = [
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
    name: "search_menu",
    description: "Search the catalog for items",
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

// ── System prompt (inventory manager) ─────────────────────────────────────────

function buildInstructions(catalog: CatalogItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)} (${c.category ?? "uncategorized"})`).join("\n")
      : "  (No catalog loaded — ask user to connect Square)";

  return `You are BevPro Inventory, a voice assistant for managing bar and venue inventory on Square. You help staff count stock, receive deliveries, flag low items, and keep inventory accurate.

Catalog:
${catalogStr}

Persona:
- Professional, efficient, detail-oriented. You're an inventory specialist.
- Short, precise responses. Read back numbers clearly.
- Understand bar inventory terms: "we got a case of" = add 24, "86'd" = out of stock, "count" = check levels.

Rules:
- Always confirm quantities before making changes: "Adjusting Bud Light up 24, that right?"
- For bulk operations, summarize what you'll do before executing.
- Low stock alerts: proactively mention if an item drops below 5 units after an adjustment.
- Say numbers clearly: "twenty-four" not "24". 
- Noisy environment — only respond to direct speech. If unclear, ask.`;
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  catalog: CatalogItem[],
  squareToken: string,
  squareLocationId: string,
): Promise<{ result: string }> {
  switch (name) {
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
          const count = counts.find(
            (ct: any) => ct.catalog_object_id === vid && ct.state === "IN_STOCK",
          );
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
            changes: [
              {
                type: "ADJUSTMENT",
                adjustment: {
                  catalog_object_id: variationId,
                  location_id: squareLocationId,
                  from_state: isAdding ? "NONE" : "IN_STOCK",
                  to_state: isAdding ? "IN_STOCK" : "WASTE",
                  quantity: Math.abs(quantity).toString(),
                  occurred_at: new Date().toISOString(),
                },
              },
            ],
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
            changes: [
              {
                type: "PHYSICAL_COUNT",
                physical_count: {
                  catalog_object_id: variationId,
                  location_id: squareLocationId,
                  quantity: quantity.toString(),
                  state: "IN_STOCK",
                  occurred_at: new Date().toISOString(),
                },
              },
            ],
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
            changes: [
              {
                type: "TRANSFER",
                transfer: {
                  catalog_object_id: variationId,
                  from_location_id: squareLocationId,
                  to_location_id: toLocationId,
                  quantity: quantity.toString(),
                  occurred_at: new Date().toISOString(),
                },
              },
            ],
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
        const res = await fetch(
          `${SQUARE_BASE}/inventory/changes?catalog_object_id=${variationId}&location_ids=${squareLocationId}`,
          { headers: squareHeaders(squareToken) },
        );
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
          const count = counts.find(
            (ct: any) => ct.catalog_object_id === vid && ct.state === "IN_STOCK",
          );
          const qty = count ? parseFloat(count.quantity) : 0;
          if (qty <= threshold) low.push(`${c.name}: ${qty}`);
        }
        if (low.length === 0) return { result: `All items are above ${threshold} units.` };
        return { result: `Low stock (≤${threshold}):\n${low.join("\n")}` };
      } catch (e: any) {
        return { result: `Failed to generate report: ${e.message}` };
      }
    }

    case "search_menu": {
      const q = String(args.query ?? "").toLowerCase();
      const hits = catalog.filter(
        (c) => c.name.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q),
      );
      if (hits.length === 0) return { result: `No items matching "${q}".` };
      return { result: hits.map((c) => `${c.name}: $${c.price.toFixed(2)}`).join(", ") };
    }

    case "get_item_details": {
      const itemName = String(args.item_name ?? "");
      const match = findCatalogItem(catalog, itemName);
      if (!match) return { result: `"${itemName}" not found in catalog.` };
      const details = [
        `Name: ${match.name}`,
        `Price: $${match.price.toFixed(2)}`,
        `Category: ${match.category ?? "none"}`,
        `Catalog ID: ${match.id}`,
        match.variationId ? `Variation ID: ${match.variationId}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return { result: details };
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const { voice = "ash", speed = 0.9, catalog = [] } = req.body ?? {};

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
        instructions: buildInstructions(catalog),
        tools: INVENTORY_TOOLS,
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
      console.error("[Inventory] Ephemeral token failed:", errText);
      res.status(response.status).json({ error: "Failed to create session" });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    console.error("[Inventory] Session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /tools — Execute a tool call ─────────────────────────────────────────

router.post("/tools", async (req, res) => {
  const {
    tool_name,
    arguments: args = {},
    catalog = [],
    squareToken = "",
    squareLocationId = "",
  } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }

  try {
    const { result } = await executeTool(tool_name, args, catalog, squareToken, squareLocationId);
    res.json({ result });
  } catch (e: any) {
    console.error(`[Inventory] Tool error (${tool_name}):`, e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
