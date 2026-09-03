/**
 * Inventory tools — stock checks, adjustments, transfers, history, low-stock reports.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { findCatalogItem, idempotencyKey, squareErrorMessage, type CatalogItem } from "../lib/square-helpers";
import { getCachedInventoryCounts, invalidateInventoryCounts } from "../lib/catalog-cache";
import { squareFromCtx, idempotencySeed, venueTimeZone, NOT_CONNECTED } from "./_square";
import type { SquareClient } from "../lib/square-client";
import { formatLocalDate } from "../lib/venue-time";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const LOW_STOCK_DEFAULT = 5;

function variationIdOf(item: CatalogItem): string {
  return item.variationId ?? item.id;
}

/** Map a removal reason to Square's inventory state so the audit trail is right. */
function reasonToState(reason: string): string {
  switch (reason.toLowerCase()) {
    case "sold": case "sale": return "SOLD";
    case "returned": case "return": return "RETURNED_BY_CUSTOMER";
    default: return "WASTE"; // damaged, waste, spoiled, expired, theft, shrinkage, loss
  }
}

function adjustmentChange(variationId: string, locationId: string, quantity: number, reason: string, occurredAt: string) {
  const isAdding = quantity > 0;
  return {
    type: "ADJUSTMENT",
    adjustment: {
      catalog_object_id: variationId,
      location_id: locationId,
      from_state: isAdding ? "NONE" : "IN_STOCK",
      to_state: isAdding ? "IN_STOCK" : reasonToState(reason),
      quantity: Math.abs(quantity).toString(),
      occurred_at: occurredAt,
    },
  };
}

async function batchCreateChanges(client: SquareClient, changes: unknown[], key: string): Promise<{ ok: boolean; error?: string }> {
  const res = await client.post("/inventory/changes/batch-create", { idempotency_key: key, changes });
  invalidateInventoryCounts(client.locationId);
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.error) };
  return { ok: true };
}

/** Counts for the whole catalog, or a spoken error. */
async function catalogCounts(ctx: ToolContext, client: SquareClient): Promise<{ counts: Map<string, number> } | { error: string }> {
  const res = await getCachedInventoryCounts(client, ctx.catalog.map(variationIdOf));
  if (!res.ok) return { error: squareErrorMessage(res.error, "Failed to read inventory") };
  return { counts: res.counts };
}

// ── Executors ─────────────────────────────────────────────────────────────────

async function checkInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return { result: "Square not connected — cannot check inventory." };
  const variationId = variationIdOf(match);
  const res = await getCachedInventoryCounts(client, [variationId]);
  if (!res.ok) return { result: `Failed to check inventory: ${squareErrorMessage(res.error)}` };
  return { result: `${match.name}: ${res.counts.get(variationId) ?? 0} in stock.` };
}

async function checkAllInventory(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (ctx.catalog.length === 0) return { result: "No catalog items loaded." };
  const counts = await catalogCounts(ctx, client);
  if ("error" in counts) return { result: `Failed to check inventory: ${counts.error}` };
  const lines = ctx.catalog.map((c) => `${c.name}: ${counts.counts.get(variationIdOf(c)) ?? 0}`);
  return { result: `Inventory:\n${lines.join("\n")}` };
}

async function adjustInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const quantity = Number(args.quantity ?? 0);
  const reason = String(args.reason ?? "received").toLowerCase();
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (!Number.isFinite(quantity) || quantity === 0) return { result: "Quantity cannot be zero." };
  const variationId = variationIdOf(match);
  const isAdding = quantity > 0;

  const write = await batchCreateChanges(
    client,
    [adjustmentChange(variationId, client.locationId, quantity, reason, new Date().toISOString())],
    idempotencyKey("adj", idempotencySeed(ctx, "adj")),
  );
  if (!write.ok) return { result: `Failed: ${write.error}` };

  const after = await getCachedInventoryCounts(client, [variationId]);
  const newQty = after.ok ? after.counts.get(variationId) ?? 0 : undefined;
  const action = isAdding ? `Added ${quantity}` : `Removed ${Math.abs(quantity)}`;
  const nowText = newQty === undefined ? "" : ` Now ${newQty} in stock.`;
  const lowWarning = newQty !== undefined && newQty <= LOW_STOCK_DEFAULT && !isAdding ? " LOW STOCK!" : "";
  return { result: `${action} ${match.name} (${reason}).${nowText}${lowWarning}` };
}

async function setInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const quantity = Number(args.quantity ?? 0);
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (!Number.isFinite(quantity) || quantity < 0) return { result: "Quantity must be zero or more." };
  const write = await batchCreateChanges(
    client,
    [{
      type: "PHYSICAL_COUNT",
      physical_count: {
        catalog_object_id: variationIdOf(match),
        location_id: client.locationId,
        quantity: quantity.toString(),
        state: "IN_STOCK",
        occurred_at: new Date().toISOString(),
      },
    }],
    idempotencyKey("set", idempotencySeed(ctx, "set")),
  );
  if (!write.ok) return { result: `Failed: ${write.error}` };
  return { result: `${match.name} inventory set to ${quantity}.` };
}

async function transferInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const quantity = Number(args.quantity ?? 0);
  const toLocationId = String(args.to_location_id ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (!toLocationId) return { result: "Destination location ID is required." };
  if (!Number.isFinite(quantity) || quantity <= 0) return { result: "Transfer quantity must be positive." };
  const write = await batchCreateChanges(
    client,
    [{
      type: "TRANSFER",
      transfer: {
        catalog_object_id: variationIdOf(match),
        from_location_id: client.locationId,
        to_location_id: toLocationId,
        quantity: quantity.toString(),
        occurred_at: new Date().toISOString(),
      },
    }],
    idempotencyKey("xfer", idempotencySeed(ctx, "xfer")),
  );
  if (!write.ok) return { result: `Failed: ${write.error}` };
  return { result: `Transferred ${quantity}x ${match.name} to location ${toLocationId}.` };
}

async function getInventoryChanges(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.post("/inventory/changes/batch-retrieve", {
    catalog_object_ids: [variationIdOf(match)],
    location_ids: [client.locationId],
    limit: 10,
  });
  if (!res.ok) return { result: `Failed to get changes: ${squareErrorMessage(res.error)}` };
  const changes: any[] = (res.data?.changes ?? []).slice(0, 10);
  if (changes.length === 0) return { result: `No recent changes for ${match.name}.` };
  const tz = await venueTimeZone(client);
  const lines = changes.map((ch) => {
    const detail = ch.adjustment || ch.physical_count || ch.transfer;
    const type = String(ch.type ?? "UNKNOWN").toLowerCase().replace(/_/g, " ");
    const qty = detail?.quantity ?? "?";
    const state = ch.adjustment ? ` to ${String(ch.adjustment.to_state ?? "").toLowerCase().replace(/_/g, " ")}` : "";
    return `${type}${state}: ${qty} on ${formatLocalDate(detail?.occurred_at ?? detail?.created_at, tz)}`;
  });
  return { result: `Recent changes for ${match.name}:\n${lines.join("\n")}` };
}

async function lowStockReport(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (ctx.catalog.length === 0) return { result: "No catalog items loaded." };
  const threshold = Number(args.threshold ?? LOW_STOCK_DEFAULT);
  const counts = await catalogCounts(ctx, client);
  if ("error" in counts) return { result: `Failed to generate report: ${counts.error}` };
  const low: string[] = [];
  for (const c of ctx.catalog) {
    const qty = counts.counts.get(variationIdOf(c)) ?? 0;
    if (qty <= threshold) low.push(`${c.name}: ${qty}`);
  }
  if (low.length === 0) return { result: `All items are above ${threshold} units.` };
  return { result: `Low stock (at or below ${threshold}):\n${low.join("\n")}` };
}

async function getItemDetails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const details = [
    `Name: ${match.name}`,
    `Price: $${match.price.toFixed(2)}`,
    `Category: ${match.category ?? "none"}`,
    match.description ? `Description: ${match.description}` : null,
    `Catalog ID: ${match.id}`,
    match.variationId ? `Variation ID: ${match.variationId}` : null,
  ].filter(Boolean).join("\n");
  return { result: details };
}

async function batchAdjustInventory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const adjustments = args.adjustments as Array<{ item_name: string; quantity: number; reason?: string }>;
  if (!Array.isArray(adjustments) || adjustments.length === 0) return { result: "No adjustments provided." };

  const changes: unknown[] = [];
  const matched: string[] = [];
  const notFound: string[] = [];
  const occurredAt = new Date().toISOString();

  for (const adj of adjustments) {
    const quantity = Number(adj?.quantity ?? 0);
    const match = findCatalogItem(ctx.catalog, String(adj?.item_name ?? ""));
    if (!match) { notFound.push(String(adj?.item_name ?? "?")); continue; }
    if (!Number.isFinite(quantity) || quantity === 0) continue;
    const reason = adj.reason ?? "received";
    changes.push(adjustmentChange(variationIdOf(match), client.locationId, quantity, reason, occurredAt));
    matched.push(`${match.name} ${quantity > 0 ? `+${quantity}` : quantity} (${reason})`);
  }

  if (changes.length === 0) return { result: `None of the items found: ${notFound.join(", ")}` };

  const write = await batchCreateChanges(client, changes, idempotencyKey("badj", idempotencySeed(ctx, "badj")));
  if (!write.ok) return { result: `Batch failed: ${write.error}` };
  let result = `Updated ${matched.length} items:\n${matched.join("\n")}`;
  if (notFound.length > 0) result += `\nNot found: ${notFound.join(", ")}`;
  return { result };
}

async function inventorySummary(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (ctx.catalog.length === 0) return { result: "No catalog items loaded." };
  const counts = await catalogCounts(ctx, client);
  if ("error" in counts) return { result: `Failed to generate summary: ${counts.error}` };

  let totalUnits = 0;
  const zeroStock: string[] = [];
  const lowStock: string[] = [];
  const wellStocked: string[] = [];

  for (const c of ctx.catalog) {
    const qty = counts.counts.get(variationIdOf(c)) ?? 0;
    totalUnits += qty;
    if (qty === 0) zeroStock.push(c.name);
    else if (qty <= LOW_STOCK_DEFAULT) lowStock.push(`${c.name}: ${qty}`);
    else wellStocked.push(`${c.name}: ${qty}`);
  }

  const lines = [
    `Inventory Summary`,
    `Items tracked: ${ctx.catalog.length}`,
    `Total units in stock: ${totalUnits}`,
    `Out of stock (${zeroStock.length}): ${zeroStock.length > 0 ? zeroStock.join(", ") : "none"}`,
    `Low stock at or below ${LOW_STOCK_DEFAULT} (${lowStock.length}): ${lowStock.length > 0 ? lowStock.join(", ") : "none"}`,
    `Well stocked (${wellStocked.length}): ${wellStocked.length > 0 ? wellStocked.slice(0, 10).join(", ") + (wellStocked.length > 10 ? ` and ${wellStocked.length - 10} more` : "") : "none"}`,
  ];
  return { result: lines.join("\n") };
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
