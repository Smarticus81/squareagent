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
    description: "Add or remove stock. Positive quantity = add (delivery received), negative = remove (sold, used, damaged, waste).",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item" },
        quantity: { type: "number", description: "Amount to add (positive) or remove (negative)" },
        reason: { type: "string", description: "Reason: received, sold, used, damaged, waste, correction, returned, theft, shrinkage", default: "received" },
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
  {
    type: "function",
    name: "batch_adjust_inventory",
    description: "Adjust stock for multiple items at once (e.g. receiving a delivery with many items). Each item has a name, quantity, and optional reason.",
    parameters: {
      type: "object",
      properties: {
        adjustments: {
          type: "array",
          description: "List of adjustments to make",
          items: {
            type: "object",
            properties: {
              item_name: { type: "string", description: "Name of the item" },
              quantity: { type: "number", description: "Amount to add (positive) or remove (negative)" },
              reason: { type: "string", description: "Reason: received, sold, damaged, waste, correction", default: "received" },
            },
            required: ["item_name", "quantity"],
          },
        },
      },
      required: ["adjustments"],
    },
  },
  {
    type: "function",
    name: "inventory_summary",
    description: "Get a full inventory overview: total items tracked, total units in stock, items with zero stock, and low stock items. Good for a quick health check.",
    parameters: { type: "object", properties: {} },
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
  const reason = String(args.reason ?? "received").toLowerCase();
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  if (quantity === 0) return { result: "Quantity cannot be zero." };
  const variationId = match.variationId ?? match.id;
  const isAdding = quantity > 0;

  // Map reason to Square inventory state for proper audit trail
  let toState = "WASTE";
  if (isAdding) {
    toState = "IN_STOCK";
  } else {
    switch (reason) {
      case "sold": case "sale": toState = "SOLD"; break;
      case "returned": case "return": toState = "RETURNED_BY_CUSTOMER"; break;
      case "damaged": case "damage": toState = "WASTE"; break;
      case "waste": case "spoiled": case "expired": toState = "WASTE"; break;
      case "theft": case "shrinkage": case "loss": toState = "WASTE"; break;
      default: toState = "WASTE"; break;
    }
  }

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
            to_state: toState,
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
    const lowWarning = newQty <= 5 && !isAdding ? ` ⚠ LOW STOCK!` : "";
    return { result: `${action} ${match.name} (${reason}). Now ${newQty} in stock.${lowWarning}` };
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

/** Map reason string to Square inventory to_state for removals */
function reasonToState(reason: string): string {
  switch (reason.toLowerCase()) {
    case "sold": case "sale": return "SOLD";
    case "returned": case "return": return "RETURNED_BY_CUSTOMER";
    default: return "WASTE";
  }
}

async function batchAdjustInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const adjustments = args.adjustments as Array<{ item_name: string; quantity: number; reason?: string }>;
  if (!Array.isArray(adjustments) || adjustments.length === 0) return { result: "No adjustments provided." };

  const changes: any[] = [];
  const matched: string[] = [];
  const notFound: string[] = [];

  for (const adj of adjustments) {
    const match = findCatalogItem(ctx.catalog, adj.item_name);
    if (!match) { notFound.push(adj.item_name); continue; }
    const variationId = match.variationId ?? match.id;
    const isAdding = adj.quantity > 0;
    const reason = adj.reason ?? "received";
    changes.push({
      type: "ADJUSTMENT",
      adjustment: {
        catalog_object_id: variationId,
        location_id: ctx.squareLocationId,
        from_state: isAdding ? "NONE" : "IN_STOCK",
        to_state: isAdding ? "IN_STOCK" : reasonToState(reason),
        quantity: Math.abs(adj.quantity).toString(),
        occurred_at: new Date().toISOString(),
      },
    });
    const action = isAdding ? `+${adj.quantity}` : `${adj.quantity}`;
    matched.push(`${match.name} ${action} (${reason})`);
  }

  if (changes.length === 0) return { result: `None of the items found: ${notFound.join(", ")}` };

  try {
    const res = await fetch(`${SQUARE_BASE}/inventory/changes/batch-create`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `inv-batch-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        changes,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Batch failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    let result = `Updated ${matched.length} items:\n${matched.join("\n")}`;
    if (notFound.length > 0) result += `\nNot found: ${notFound.join(", ")}`;
    return { result };
  } catch (e: any) {
    return { result: `Batch adjust failed: ${e.message}` };
  }
}

async function inventorySummary(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
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

    let totalUnits = 0;
    const zeroStock: string[] = [];
    const lowStock: string[] = [];
    const wellStocked: string[] = [];

    for (const c of ctx.catalog) {
      const vid = c.variationId ?? c.id;
      const count = counts.find((ct: any) => ct.catalog_object_id === vid && ct.state === "IN_STOCK");
      const qty = count ? parseFloat(count.quantity) : 0;
      totalUnits += qty;
      if (qty === 0) zeroStock.push(c.name);
      else if (qty <= 5) lowStock.push(`${c.name}: ${qty}`);
      else wellStocked.push(`${c.name}: ${qty}`);
    }

    const lines = [
      `📊 Inventory Summary`,
      `Items tracked: ${ctx.catalog.length}`,
      `Total units in stock: ${totalUnits}`,
      `Out of stock (${zeroStock.length}): ${zeroStock.length > 0 ? zeroStock.join(", ") : "none"}`,
      `Low stock ≤5 (${lowStock.length}): ${lowStock.length > 0 ? lowStock.join(", ") : "none"}`,
      `Well stocked (${wellStocked.length}): ${wellStocked.length > 0 ? wellStocked.slice(0, 10).join(", ") + (wellStocked.length > 10 ? ` and ${wellStocked.length - 10} more` : "") : "none"}`,
    ];
    return { result: lines.join("\n") };
  } catch (e: any) {
    return { result: `Failed to generate summary: ${e.message}` };
  }
}

export const executors: Record<string, ToolExecutor> = {
  check_inventory: checkInventory,
  check_all_inventory: checkAllInventory,
  adjust_inventory: adjustInventory,
  set_inventory: setInventory,
  transfer_inventory: transferInventory,
  get_inventory_changes: getInventoryChanges,
  low_stock_report: lowStockReport,
  get_item_details: getItemDetails,
  batch_adjust_inventory: batchAdjustInventory,
  inventory_summary: inventorySummary,
};
