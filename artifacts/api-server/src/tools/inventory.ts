/**
 * Inventory tools — stock checks, adjustments, transfers, history, low-stock reports.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import {
  findCatalogItem,
  getInventoryCount,
  SQUARE_BASE,
  squareHeaders,
} from "../lib/square-helpers";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
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

// ── Executors ─────────────────────────────────────────────────────────────────

async function checkInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected — cannot check inventory." };
  const variationId = match.variationId ?? match.id;
  try {
    const qty = await getInventoryCount(ctx.squareToken, ctx.squareLocationId, variationId);
    return { result: `${match.name}: ${qty} in stock.` };
  } catch (e: any) {
    return { result: `Failed to check inventory: ${e.message}` };
  }
}

async function checkAllInventory(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  if (ctx.catalog.length === 0) return { result: "No catalog items loaded." };
  try {
    const ids = ctx.catalog.map((c) => c.variationId ?? c.id);
    const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({ catalog_object_ids: ids, location_ids: [ctx.squareLocationId] }),
    });
    const data = (await res.json()) as any;
    const counts = data.counts ?? [];
    const lines = ctx.catalog.map((c) => {
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

async function adjustInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const quantity = Number(args.quantity ?? 0);
  const reason = String(args.reason ?? "received");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const variationId = match.variationId ?? match.id;
  const isAdding = quantity > 0;
  try {
    const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `inv-adj-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        changes: [{
          type: "ADJUSTMENT",
          adjustment: {
            catalog_object_id: variationId,
            location_id: ctx.squareLocationId,
            from_state: isAdding ? "NONE" : "IN_STOCK",
            to_state: isAdding ? "IN_STOCK" : "WASTE",
            quantity: Math.abs(quantity).toString(),
            occurred_at: new Date().toISOString(),
          },
        }],
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const action = isAdding ? `Added ${quantity}` : `Removed ${Math.abs(quantity)}`;
    const newQty = await getInventoryCount(ctx.squareToken, ctx.squareLocationId, variationId);
    return { result: `${action} ${match.name} (reason: ${reason}). Now ${newQty} in stock.` };
  } catch (e: any) {
    return { result: `Failed to adjust inventory: ${e.message}` };
  }
}

async function setInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const quantity = Number(args.quantity ?? 0);
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const variationId = match.variationId ?? match.id;
  try {
    const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `inv-set-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        changes: [{
          type: "PHYSICAL_COUNT",
          physical_count: {
            catalog_object_id: variationId,
            location_id: ctx.squareLocationId,
            quantity: quantity.toString(),
            state: "IN_STOCK",
            occurred_at: new Date().toISOString(),
          },
        }],
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `${match.name} inventory set to ${quantity}.` };
  } catch (e: any) {
    return { result: `Failed to set inventory: ${e.message}` };
  }
}

async function transferInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const quantity = Number(args.quantity ?? 0);
  const toLocationId = String(args.to_location_id ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  if (!toLocationId) return { result: "Destination location ID is required." };
  const variationId = match.variationId ?? match.id;
  try {
    const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `inv-xfer-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        changes: [{
          type: "TRANSFER",
          transfer: {
            catalog_object_id: variationId,
            from_location_id: ctx.squareLocationId,
            to_location_id: toLocationId,
            quantity: quantity.toString(),
            occurred_at: new Date().toISOString(),
          },
        }],
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `Transferred ${quantity}x ${match.name} to location ${toLocationId}.` };
  } catch (e: any) {
    return { result: `Failed to transfer: ${e.message}` };
  }
}

async function getInventoryChanges(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const variationId = match.variationId ?? match.id;
  try {
    const res = await fetch(
      `${SQUARE_BASE}/inventory/changes?catalog_object_id=${variationId}&location_ids=${ctx.squareLocationId}`,
      { headers: squareHeaders(ctx.squareToken) },
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

async function lowStockReport(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  if (ctx.catalog.length === 0) return { result: "No catalog items loaded." };
  const threshold = Number(args.threshold ?? 5);
  try {
    const ids = ctx.catalog.map((c) => c.variationId ?? c.id);
    const res = await fetch(`${SQUARE_BASE}/inventory/counts/batch-retrieve`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({ catalog_object_ids: ids, location_ids: [ctx.squareLocationId] }),
    });
    const data = (await res.json()) as any;
    const counts = data.counts ?? [];
    const low: string[] = [];
    for (const c of ctx.catalog) {
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

async function getItemDetails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const details = [
    `Name: ${match.name}`,
    `Price: $${match.price.toFixed(2)}`,
    `Category: ${match.category ?? "none"}`,
    `Catalog ID: ${match.id}`,
    match.variationId ? `Variation ID: ${match.variationId}` : null,
  ].filter(Boolean).join("\n");
  return { result: details };
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  check_inventory: checkInventory,
  check_all_inventory: checkAllInventory,
  adjust_inventory: adjustInventory,
  set_inventory: setInventory,
  transfer_inventory: transferInventory,
  get_inventory_changes: getInventoryChanges,
  low_stock_report: lowStockReport,
  get_item_details: getItemDetails,
};
