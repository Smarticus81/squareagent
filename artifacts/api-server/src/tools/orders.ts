/**
 * Order tools — recent orders, sales reports, open tickets, order recall.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import {
  listRecentOrders,
  getSalesSummary,
  SQUARE_BASE,
  squareHeaders,
} from "../lib/square-helpers";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDatePeriod(period: string): { start: string; end: string } {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start: Date;
  switch (period) {
    case "yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      start = new Date(y.getFullYear(), y.getMonth(), y.getDate());
      const end = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "this_week": {
      const day = now.getDay(); const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(now.getFullYear(), now.getMonth(), diff);
      return { start: start.toISOString(), end: endOfDay.toISOString() };
    }
    case "last_7_days":
      start = new Date(now); start.setDate(start.getDate() - 7);
      return { start: start.toISOString(), end: endOfDay.toISOString() };
    case "this_month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start.toISOString(), end: endOfDay.toISOString() };
    case "last_30_days":
      start = new Date(now); start.setDate(start.getDate() - 30);
      return { start: start.toISOString(), end: endOfDay.toISOString() };
    case "today":
    default:
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start: start.toISOString(), end: endOfDay.toISOString() };
  }
}

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "list_orders",
    description: "List recent orders with totals and status",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Number of orders to show (default 10)", default: 10 },
      },
    },
  },
  {
    type: "function",
    name: "sales_report",
    description: "Get a sales summary — total revenue, order count, average ticket, and top items. Specify a time range like 'today', 'this week', 'last 7 days', or specific dates.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", description: "Time period: 'today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_30_days'", default: "today" },
      },
    },
  },
  {
    type: "function",
    name: "list_open_orders",
    description: "List currently open (in-progress) orders on the POS",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "get_order_details",
    description: "Get full details of a specific order by its ID",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Square order ID" },
      },
      required: ["order_id"],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

async function listOrdersExec(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const limit = Number(args.limit ?? 10);
  const { ok, orders, error } = await listRecentOrders(ctx.squareToken, ctx.squareLocationId, limit);
  if (!ok) return { result: `Failed: ${error}` };
  if (!orders || orders.length === 0) return { result: "No recent orders found." };
  const lines = orders.map((o: any) => {
    const total = ((o.total_money?.amount ?? 0) / 100).toFixed(2);
    const state = o.state ?? "UNKNOWN";
    const date = o.created_at ? new Date(o.created_at).toLocaleString() : "?";
    const items = (o.line_items ?? []).length;
    return `${date} — $${total} (${state}, ${items} items)`;
  });
  return { result: `Recent orders:\n${lines.join("\n")}` };
}

async function salesReport(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const period = String(args.period ?? "today");
  const { start, end } = parseDatePeriod(period);
  const { ok, summary, error } = await getSalesSummary(ctx.squareToken, ctx.squareLocationId, start, end);
  if (!ok) return { result: `Failed: ${error}` };
  if (!summary) return { result: "No data available." };
  const lines = [
    `Period: ${period.replace(/_/g, " ")}`,
    `Total orders: ${summary.totalOrders}`,
    `Total revenue: $${summary.totalRevenue.toFixed(2)}`,
    `Average ticket: $${summary.avgOrder.toFixed(2)}`,
  ];
  if (summary.topItems.length > 0) {
    lines.push("Top sellers:");
    for (const item of summary.topItems.slice(0, 5)) {
      lines.push(`  ${item.name}: ${item.qty} sold, $${item.revenue.toFixed(2)}`);
    }
  }
  return { result: lines.join("\n") };
}

async function listOpenOrders(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/orders/search`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        location_ids: [ctx.squareLocationId],
        query: {
          filter: { state_filter: { states: ["OPEN"] } },
          sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
        },
        limit: 50,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const orders = data.orders ?? [];
    if (orders.length === 0) return { result: "No open orders right now." };
    const lines = orders.map((o: any) => {
      const total = ((o.total_money?.amount ?? 0) / 100).toFixed(2);
      const ref = o.reference_id ?? o.id.slice(0, 8);
      const items = (o.line_items ?? []).map((li: any) => `${li.quantity}x ${li.name}`).join(", ");
      return `${ref}: $${total} — ${items || "no items"}`;
    });
    return { result: `Open orders (${orders.length}):\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed to list open orders: ${e.message}` };
  }
}

async function getOrderDetails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const orderId = String(args.order_id ?? "");
  if (!orderId) return { result: "Order ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/orders/${orderId}`, {
      headers: squareHeaders(ctx.squareToken),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Order not found"}` };
    const o = data.order;
    const lines = [
      `Order: ${o.id}`,
      `State: ${o.state}`,
      `Created: ${o.created_at ? new Date(o.created_at).toLocaleString() : "?"}`,
      `Total: $${((o.total_money?.amount ?? 0) / 100).toFixed(2)}`,
      `Items:`,
    ];
    for (const li of o.line_items ?? []) {
      lines.push(`  ${li.quantity}x ${li.name} — $${((li.total_money?.amount ?? 0) / 100).toFixed(2)}`);
    }
    if (o.discounts?.length) {
      lines.push(`Discounts:`);
      for (const d of o.discounts) {
        lines.push(`  ${d.name}: -$${((d.applied_money?.amount ?? 0) / 100).toFixed(2)}`);
      }
    }
    return { result: lines.join("\n") };
  } catch (e: any) {
    return { result: `Failed to get order details: ${e.message}` };
  }
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  list_orders: listOrdersExec,
  sales_report: salesReport,
  list_open_orders: listOpenOrders,
  get_order_details: getOrderDetails,
};
