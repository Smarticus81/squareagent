/**
 * Catalog tools — create, update, delete items; categories; modifiers; discounts.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import {
  findCatalogItem,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  SQUARE_BASE,
  squareHeaders,
} from "../lib/square-helpers";

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
  const itemName = String(args.item_name ?? "");
  const price = Number(args.price ?? 0);
  if (!itemName || price <= 0) return { result: "Need a name and price to create an item." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  const priceCents = Math.round(price * 100);
  const { ok, itemId, error } = await createCatalogItem(ctx.squareToken, ctx.squareLocationId, itemName, priceCents);
  if (!ok) return { result: `Failed to create item: ${error}` };
  return { result: `Created "${itemName}" at $${price.toFixed(2)}. Catalog ID: ${itemId}. It's now available on the POS.` };
}

async function updateItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken) return { result: "Square not connected." };
  const updates: { name?: string; priceCents?: number } = {};
  if (args.new_name) updates.name = String(args.new_name);
  if (args.new_price !== undefined) updates.priceCents = Math.round(Number(args.new_price) * 100);
  if (!updates.name && updates.priceCents === undefined) return { result: "No changes specified." };
  const { ok, error } = await updateCatalogItem(ctx.squareToken, match.id, updates);
  if (!ok) return { result: `Failed to update: ${error}` };
  const changes = [];
  if (updates.name) changes.push(`name → "${updates.name}"`);
  if (updates.priceCents !== undefined) changes.push(`price → $${(updates.priceCents / 100).toFixed(2)}`);
  return { result: `Updated ${match.name}: ${changes.join(", ")}. Changes are live on the POS.` };
}

async function deleteItem(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const itemName = String(args.item_name ?? "");
  const match = findCatalogItem(ctx.catalog, itemName);
  if (!match) return { result: `"${itemName}" not found in catalog.` };
  if (!ctx.squareToken) return { result: "Square not connected." };
  const { ok, error } = await deleteCatalogItem(ctx.squareToken, match.id);
  if (!ok) return { result: `Failed to delete: ${error}` };
  return { result: `Deleted "${match.name}" from the catalog. It's been removed from the POS.` };
}

async function listCategories(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/catalog/list?types=CATEGORY`, {
      headers: squareHeaders(ctx.squareToken),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const categories = (data.objects ?? []).map((o: any) => o.category_data?.name ?? "Unnamed").filter(Boolean);
    if (categories.length === 0) return { result: "No categories found." };
    return { result: `Categories: ${categories.join(", ")}` };
  } catch (e: any) {
    return { result: `Failed to list categories: ${e.message}` };
  }
}

async function createCategory(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const name = String(args.name ?? "");
  if (!name) return { result: "Category name is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/catalog/object`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        idempotency_key: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        object: {
          type: "CATEGORY",
          id: `#cat-${Date.now()}`,
          category_data: { name },
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `Created category "${name}".` };
  } catch (e: any) {
    return { result: `Failed to create category: ${e.message}` };
  }
}

async function listModifiers(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/catalog/list?types=MODIFIER_LIST`, {
      headers: squareHeaders(ctx.squareToken),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const modLists = (data.objects ?? []).map((o: any) => {
      const name = o.modifier_list_data?.name ?? "Unnamed";
      const mods = (o.modifier_list_data?.modifiers ?? []).map((m: any) => m.modifier_data?.name).filter(Boolean);
      return `${name}: ${mods.join(", ") || "no modifiers"}`;
    });
    if (modLists.length === 0) return { result: "No modifier lists found." };
    return { result: `Modifier lists:\n${modLists.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed to list modifiers: ${e.message}` };
  }
}

async function applyDiscount(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const discountName = String(args.name ?? "");
  const discountType = String(args.type ?? "percentage");
  const amount = Number(args.amount ?? 0);
  const itemName = args.item_name ? String(args.item_name) : undefined;

  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  if (!ctx.session.squareOrderId) return { result: "No active order to apply a discount to. Add items first." };
  if (amount <= 0) return { result: "Discount amount must be positive." };

  try {
    // Build discount object
    const discountUid = `disc-${Date.now()}`;
    const discount: any = {
      uid: discountUid,
      name: discountName,
      type: discountType === "fixed" ? "FIXED_AMOUNT" : "FIXED_PERCENTAGE",
      scope: itemName ? "LINE_ITEM" : "ORDER",
    };

    if (discountType === "fixed") {
      discount.amount_money = { amount: Math.round(amount * 100), currency: "USD" };
    } else {
      discount.percentage = amount.toString();
    }

    // We need to update the order with the discount
    const res = await fetch(`${SQUARE_BASE}/orders/${ctx.session.squareOrderId}`, {
      method: "PUT",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        order: {
          location_id: ctx.squareLocationId,
          version: ctx.session.squareOrderVersion,
          discounts: [discount],
        },
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed to apply discount: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    ctx.session.squareOrderVersion = data.order?.version;
    ctx.session.squareOrderTotal = data.order?.total_money?.amount ?? ctx.session.squareOrderTotal;
    const amountStr = discountType === "fixed" ? `$${amount.toFixed(2)}` : `${amount}%`;
    return { result: `Applied "${discountName}" (${amountStr} off). New total: $${((ctx.session.squareOrderTotal ?? 0) / 100).toFixed(2)}.` };
  } catch (e: any) {
    return { result: `Failed to apply discount: ${e.message}` };
  }
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  create_item: createItem,
  update_item: updateItem,
  delete_item: deleteItem,
  list_categories: listCategories,
  create_category: createCategory,
  list_modifiers: listModifiers,
  apply_discount: applyDiscount,
};
