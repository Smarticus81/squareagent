/**
 * Catalog tools — create, update, delete items; categories; modifiers; discounts.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import {
  findCatalogItem,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  idempotencyKey,
  squareErrorMessage,
} from "../lib/square-helpers";
import { invalidateCatalog } from "../lib/catalog-cache";
import { squareFromCtx, idempotencySeed, NOT_CONNECTED, money } from "./_square";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "create_item",
    description: "Create a new item in the Square catalog with a name and price",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the new item" },
        price: { type: "number", description: "Price in USD (e.g. 8.50)" },
        category: { type: "string", description: "Optional category name" },
      },
      required: ["item_name", "price"],
    },
  },
  {
    type: "function",
    name: "update_item",
    description: "Update an existing catalog item's name or price",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Current name of the item to update" },
        new_name: { type: "string", description: "New name for the item (optional)" },
        new_price: { type: "number", description: "New price in USD (optional)" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function",
    name: "delete_item",
    description: "Remove an item from the Square catalog permanently",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Name of the item to delete" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function",
    name: "list_categories",
    description: "List all catalog categories",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "create_category",
    description: "Create a new catalog category",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Category name (e.g. Beer, Wine, Spirits)" },
      },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "list_modifiers",
    description: "List all modifier lists (e.g. sizes, add-ons, toppings)",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "apply_discount",
    description: "Apply a percentage or fixed discount to the current order or a specific item",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Discount name (e.g. 'Happy Hour', 'Staff Discount')" },
        type: { type: "string", description: "Discount type: 'percentage' or 'fixed'", enum: ["percentage", "fixed"] },
        amount: { type: "number", description: "Discount amount — percentage (e.g. 20 for 20%) or fixed USD (e.g. 5.00)" },
        item_name: { type: "string", description: "Optional: apply to a specific item only" },
      },
      required: ["name", "type", "amount"],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

async function createItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "").trim();
  const price = Number(args.price ?? 0);
  if (!itemName || !(price > 0)) return { result: "Need a name and price to create an item." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const existing = findCatalogItem(ctx.catalog, itemName);
  if (existing && existing.name.toLowerCase() === itemName.toLowerCase()) {
    return { result: `"${existing.name}" already exists at $${existing.price.toFixed(2)}. Use update_item to change it.` };
  }
  const priceCents = Math.round(price * 100);
  const { ok, itemId, error } = await createCatalogItem(client, itemName, priceCents, idempotencySeed(ctx, "create"));
  if (!ok) return { result: `Failed to create item: ${error}` };
  invalidateCatalog(client.locationId);
  return { result: `Created "${itemName}" at $${price.toFixed(2)}. Catalog ID: ${itemId}. It's now available on the POS.` };
}

async function updateItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const updates: { name?: string; priceCents?: number } = {};
  if (args.new_name) updates.name = String(args.new_name);
  if (args.new_price !== undefined) updates.priceCents = Math.round(Number(args.new_price) * 100);
  if (!updates.name && updates.priceCents === undefined) return { result: "No changes specified." };
  const { ok, error } = await updateCatalogItem(client, match.id, updates, idempotencySeed(ctx, "update"));
  if (!ok) return { result: `Failed to update: ${error}` };
  invalidateCatalog(client.locationId);
  const changes = [];
  if (updates.name) changes.push(`name to "${updates.name}"`);
  if (updates.priceCents !== undefined) changes.push(`price to ${money(updates.priceCents)}`);
  return { result: `Updated ${match.name}: ${changes.join(", ")}. Changes are live on the POS.` };
}

async function deleteItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const { ok, error } = await deleteCatalogItem(client, match.id);
  if (!ok) return { result: `Failed to delete: ${error}` };
  invalidateCatalog(client.locationId);
  return { result: `Deleted "${match.name}" from the catalog. It's been removed from the POS.` };
}

async function listCategories(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.getAllPages("/catalog/list?types=CATEGORY", (page: { objects?: any[] }) => page.objects ?? []);
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  const categories = res.items.map((o: any) => o.category_data?.name).filter(Boolean);
  if (categories.length === 0) return { result: "No categories found." };
  return { result: `Categories: ${categories.join(", ")}` };
}

async function createCategory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const name = String(args.name ?? "").trim();
  if (!name) return { result: "Category name is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.post("/catalog/object", {
    idempotency_key: idempotencyKey("cat", idempotencySeed(ctx, "cat")),
    object: { type: "CATEGORY", id: "#cat", category_data: { name } },
  });
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  invalidateCatalog(client.locationId);
  return { result: `Created category "${name}".` };
}

async function listModifiers(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await client.getAllPages("/catalog/list?types=MODIFIER_LIST", (page: { objects?: any[] }) => page.objects ?? []);
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  const modLists = res.items.map((o: any) => {
    const name = o.modifier_list_data?.name ?? "Unnamed";
    const mods = (o.modifier_list_data?.modifiers ?? []).map((m: any) => m.modifier_data?.name).filter(Boolean);
    return `${name}: ${mods.join(", ") || "no modifiers"}`;
  });
  if (modLists.length === 0) return { result: "No modifier lists found." };
  return { result: `Modifier lists:\n${modLists.join("\n")}` };
}

async function applyDiscount(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const discountName = String(args.name ?? "").trim() || "Discount";
  const discountType = String(args.type ?? "percentage");
  const amount = Number(args.amount ?? 0);
  const itemName = args.item_name ? String(args.item_name) : undefined;

  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  if (!ctx.session.squareOrderId) return { result: "No active order to apply a discount to. Add items first." };
  if (!(amount > 0)) return { result: "Discount amount must be positive." };
  if (discountType !== "fixed" && amount > 100) return { result: "A percentage discount can't exceed 100%." };

  const discountUid = `disc-${Date.now()}`;
  const discount: Record<string, unknown> = {
    uid: discountUid,
    name: discountName,
    type: discountType === "fixed" ? "FIXED_AMOUNT" : "FIXED_PERCENTAGE",
    scope: itemName ? "LINE_ITEM" : "ORDER",
    ...(discountType === "fixed"
      ? { amount_money: { amount: Math.round(amount * 100), currency: "USD" } }
      : { percentage: amount.toString() }),
  };

  const order: Record<string, unknown> = {
    location_id: client.locationId,
    version: ctx.session.squareOrderVersion,
    discounts: [discount],
  };

  if (itemName) {
    // Line-item scope needs the discount attached to the matching line's uid.
    const target = ctx.session.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase())
      ?? ctx.session.items.find((i) => i.name.toLowerCase().includes(itemName.toLowerCase()));
    const uids = ctx.session.lineItemUids ?? [];
    const idx = target ? ctx.session.items.indexOf(target) : -1;
    const lineUid = idx >= 0 ? uids[idx] : undefined;
    if (!lineUid) return { result: `"${itemName}" isn't on the current order.` };
    order.line_items = [{ uid: lineUid, applied_discounts: [{ discount_uid: discountUid }] }];
  }

  const res = await client.put(`/orders/${ctx.session.squareOrderId}`, { order });
  if (!res.ok) return { result: `Failed to apply discount: ${squareErrorMessage(res.error)}` };
  ctx.session.squareOrderVersion = res.data.order?.version;
  ctx.session.squareOrderTotal = res.data.order?.total_money?.amount ?? ctx.session.squareOrderTotal;
  ctx.session.lineItemUids = (res.data.order?.line_items ?? []).map((li: any) => li.uid);
  const amountStr = discountType === "fixed" ? `$${amount.toFixed(2)}` : `${amount}%`;
  return { result: `Applied "${discountName}" (${amountStr} off${itemName ? ` ${itemName}` : ""}). New total: ${money(ctx.session.squareOrderTotal)}.` };
}

export const executors: Record<string, ToolExecutor> = {
  create_item: createItem,
  update_item: updateItem,
  delete_item: deleteItem,
  list_categories: listCategories,
  create_category: createCategory,
  list_modifiers: listModifiers,
  apply_discount: applyDiscount,
};
