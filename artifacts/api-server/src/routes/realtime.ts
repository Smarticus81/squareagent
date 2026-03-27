/**
 * Unified BevPro Agent — REST endpoints for WebRTC-based Realtime API
 *
 * POST /session  → Mint ephemeral OpenAI token, return tools + instructions
 * POST /tools    → Execute a tool call server-side, return result + optional order command
 *
 * The client connects directly to OpenAI via WebRTC using the ephemeral token.
 * Tool calls arrive on the data channel, the client POSTs here, then sends the
 * result back to OpenAI via the data channel.
 *
 * This single agent handles both POS (ordering) and Inventory management.
 */

import { Router } from "express";
import { db, venuesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requirePlan } from "./auth";
import {
  SQUARE_BASE,
  squareHeaders,
  findCatalogItem,
  getInventoryCount,
  syncLiveOrderToSquare,
  cancelLiveOrder,
  completeLiveOrder,
  pushToTerminal,
  type CatalogItem,
  type OrderItem,
  type SessionOrderItem,
  type OrderCommand,
  type LiveSession,
  type SyncResult,
} from "../lib/square-helpers";

const router = Router();

/** Look up Square credentials from DB for the authenticated user's venue. */
async function lookupVenueCredentials(userId: number, venueId: number) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, userId)));
  if (!venue) return null;
  return { squareToken: venue.squareAccessToken ?? "", squareLocationId: venue.squareLocationId ?? "" };
}

const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

// ── Tool definitions (unified POS + Inventory agent) ──────────────────────────

const TOOLS = [
  // ── POS tools ───────────────
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
    name: "send_to_terminal",
    description: "Send the current order to the Square Terminal for card payment. Use when the customer wants to pay by card on the physical terminal.",
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
  // ── Inventory tools ─────────
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

// ── Tool executor (unified — handles both POS and inventory tools) ────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  catalog: CatalogItem[],
  order: OrderItem[],
  squareToken: string,
  squareLocationId: string,
  session: LiveSession,
): Promise<{ result: string; command?: OrderCommand }> {
  const sessionOrder = session.items;

  switch (name) {
    // ── POS tools ─────────────────────────────────────────────────────────────
    case "add_item": {
      const itemName = String(args.item_name ?? "");
      const qty = Number(args.quantity ?? 1);
      const match = findCatalogItem(catalog, itemName);
      if (match) {
        const existing = sessionOrder.find((i) => i.catalogItemId === match.id);
        if (existing) {
          existing.quantity += qty;
        } else {
          sessionOrder.push({ catalogItemId: match.id, variationId: match.variationId, name: match.name, price: match.price, quantity: qty });
        }
        // ── Live POS sync: push change to Square immediately ──────────────
        const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId);
        const posStatus = sync.ok && session.squareOrderId
          ? " Showing on POS."
          : sync.error ? ` (POS sync issue: ${sync.error})` : "";
        return {
          result: `Added ${qty}x ${match.name} ($${(match.price * qty).toFixed(2)}) to the order.${posStatus}`,
          command: { action: "add", item_id: match.id, item_name: match.name, quantity: qty, price: match.price, squareOrderId: session.squareOrderId },
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
      // ── Live POS sync: update Square order ──────────────────────────────
      const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId);
      const posStatus = sync.ok && session.squareOrderId ? " POS updated." : sync.error ? ` (POS sync issue: ${sync.error})` : "";
      return {
        result: `Removed ${qty}x ${itemName} from the order.${posStatus}`,
        command: { action: "remove", item_name: itemName, quantity: qty, squareOrderId: session.squareOrderId },
      };
    }

    case "get_order": {
      if (sessionOrder.length === 0) return { result: "The order is currently empty." };
      const lines = sessionOrder.map((i) => `${i.quantity}x ${i.name} @ $${i.price.toFixed(2)}`);
      const total = sessionOrder.reduce((s, i) => s + i.price * i.quantity, 0);
      const posNote = session.squareOrderId ? ` (live on POS: ${session.referenceId ?? session.squareOrderId})` : "";
      return { result: `Current order${posNote}:\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}` };
    }

    case "clear_order":
      // ── Cancel the live order on POS ────────────────────────────────────
      await cancelLiveOrder(session, squareToken, squareLocationId);
      sessionOrder.splice(0, sessionOrder.length);
      return { result: "Order cleared. Removed from POS.", command: { action: "clear" } };

    case "submit_order": {
      if (sessionOrder.length === 0) {
        return { result: "The order is empty — nothing to submit." };
      }
      if (!squareToken || !squareLocationId) {
        return { result: "Square is not configured for this session — cannot submit." };
      }
      try {
        // If we have a live order, just complete it with payment (no need to re-create)
        if (session.squareOrderId) {
          const { orderId, total, paymentId, error } = await completeLiveOrder(
            session, squareToken, squareLocationId,
          );
          if (error) {
            console.warn(`[Realtime] Live payment failed: ${error}`);
          } else {
            console.log(`[Realtime] Live order completed: ${orderId} | $${total.toFixed(2)} | payment=${paymentId}`);
          }
          // Clear session
          sessionOrder.splice(0, sessionOrder.length);
          session.squareOrderId = undefined;
          session.squareOrderVersion = undefined;
          session.squareOrderTotal = undefined;
          session.referenceId = undefined;
          return {
            result: `Order submitted! Total: $${total.toFixed(2)}.${error ? ` Warning: ${error}` : ""}`,
            command: { action: "submit", squareOrderId: orderId },
          };
        }

        // Fallback: no live order exists — create order + payment (original flow)
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

    case "send_to_terminal": {
      if (sessionOrder.length === 0) {
        return { result: "The order is empty — nothing to send to the terminal." };
      }
      if (!squareToken || !squareLocationId) {
        return { result: "Square is not configured — cannot send to terminal." };
      }
      // Ensure we have a live order in Square first
      if (!session.squareOrderId) {
        const sync = await syncLiveOrderToSquare(session, squareToken, squareLocationId);
        if (!sync.ok) {
          return { result: `Could not create the order in Square: ${sync.error}. Try submitting instead.` };
        }
      }
      if (!session.squareOrderId) {
        return { result: "Could not create the order in Square. Try submitting instead." };
      }
      try {
        // Find the first available terminal device at this location
        const devRes = await fetch(
          `${SQUARE_BASE}/devices?location_id=${squareLocationId}`,
          { headers: squareHeaders(squareToken) },
        );
        const devData = (await devRes.json()) as any;
        const devices = devData.devices ?? [];
        if (devices.length === 0) {
          return { result: "No Square Terminal devices found at this location. The order is live on the POS — complete it from there." };
        }
        const device = devices[0]; // Use first available device
        const { checkoutId, error } = await pushToTerminal(
          squareToken, squareLocationId, device.id,
          session.squareOrderId, session.squareOrderTotal ?? 0,
        );
        if (error) {
          return { result: `Couldn't send to terminal: ${error}. The order is still open on the POS.` };
        }
        // Don't clear the session yet — terminal payment is async
        return {
          result: `Sent to the terminal! Total: $${((session.squareOrderTotal ?? 0) / 100).toFixed(2)}. Customer can tap or swipe.`,
          command: { action: "submit", squareOrderId: session.squareOrderId },
        };
      } catch (e: any) {
        console.error("[Realtime] send_to_terminal error:", e.message);
        return { result: `Failed to send to terminal: ${e.message}` };
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

    // ── Inventory tools ───────────────────────────────────────────────────────
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

// ── System prompt (unified BevPro — POS + Inventory) ──────────────────────────

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
- Items appear on the Square POS in real-time as they're added — mention this naturally: "got it, that's on the screen" or "added, check the register".
- If they want to pay by card, use send_to_terminal. Say "sent to the terminal, go ahead and tap".

Inventory Rules:
- Always confirm quantities before making changes: "Adjusting Bud Light up 24, that right?"
- For bulk operations, summarize what you'll do before executing.
- Low stock alerts: proactively mention if an item drops below 5 units after an adjustment.
- Say numbers clearly: "twenty-four" not "24".

General:
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.`;
}

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const { voice = "ash", speed = 0.9, catalog = [], order = [], venueId } = req.body ?? {};

  // Look up credentials server-side if venueId provided
  let squareToken = "";
  let squareLocationId = "";
  if (venueId) {
    const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

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
        speed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Realtime] Ephemeral token failed:", errText);
      res.status(response.status).json({ error: "Failed to create session" });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    console.error("[Realtime] Session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /tools — Execute a tool call ─────────────────────────────────────────

const sessionOrders = new Map<string, LiveSession>();

router.post("/tools", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const {
    session_id,
    tool_name,
    arguments: args = {},
    catalog = [],
    order = [],
    venueId,
  } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }

  // Server-side credential lookup
  let squareToken = "";
  let squareLocationId = "";
  if (venueId) {
    const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  const sessionId = String(session_id || "default");
  if (!sessionOrders.has(sessionId)) {
    sessionOrders.set(sessionId, { items: [] });
  }
  const session = sessionOrders.get(sessionId)!;

  try {
    const { result, command } = await executeTool(
      tool_name,
      args,
      catalog,
      order,
      squareToken,
      squareLocationId,
      session,
    );

    if (session.items.length === 0 && !session.squareOrderId) {
      sessionOrders.delete(sessionId);
    }

    res.json({ result, command: command ?? null });
  } catch (e: any) {
    console.error(`[Realtime] Tool error (${tool_name}):`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /test-sync — Diagnostic: test Square order creation ──────────────────
router.post("/test-sync", requireAuth as any, async (req: any, res: any) => {
  const { venueId } = req.body ?? {};
  if (!venueId) {
    res.status(400).json({ error: "venueId is required" });
    return;
  }

  const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
  if (!creds) {
    res.json({ ok: false, error: "Venue not found or not owned by user" });
    return;
  }
  if (!creds.squareToken) {
    res.json({ ok: false, error: "No Square access token — reconnect Square OAuth" });
    return;
  }
  if (!creds.squareLocationId) {
    res.json({ ok: false, error: "No Square location ID — complete setup" });
    return;
  }

  // Try creating a test order, then cancel it
  const testSession: LiveSession = {
    items: [{
      catalogItemId: "test",
      name: "Sync Test",
      price: 0.01,
      quantity: 1,
    }],
  };

  const sync = await syncLiveOrderToSquare(testSession, creds.squareToken, creds.squareLocationId);
  if (!sync.ok) {
    res.json({ ok: false, error: sync.error, step: "create_order" });
    return;
  }

  // Cancel the test order
  await cancelLiveOrder(testSession, creds.squareToken, creds.squareLocationId);

  res.json({
    ok: true,
    message: "Square order sync is working. Test order created and canceled.",
    testOrderId: sync.squareOrderId,
  });
});

export default router;
