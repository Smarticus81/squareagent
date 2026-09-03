/**
 * Order tools — recent orders, sales reports, open tickets, order recall.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { listRecentOrders, getSalesSummary, searchOrders, squareErrorMessage } from "../lib/square-helpers";
import { squareFromCtx, venueTimeZone, NOT_CONNECTED, money } from "./_square";
import { normalizePeriod, periodRange, formatLocalDateTime } from "../lib/venue-time";

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
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10) || 10), 50);
  const [{ ok, orders, error }, tz] = await Promise.all([listRecentOrders(client, limit), venueTimeZone(client)]);
  if (!ok) return { result: `Failed: ${error}` };
  if (!orders || orders.length === 0) return { result: "No recent orders found." };
  const lines = orders.map((o: any) => {
    const state = o.state ?? "UNKNOWN";
    const items = (o.line_items ?? []).length;
    return `${formatLocalDateTime(o.created_at, tz)} - ${money(o.total_money?.amount)} (${state}, ${items} items)`;
  });
  return { result: `Recent orders:\n${lines.join("\n")}` };
}

async function salesReport(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const period = normalizePeriod(args.period);
  const tz = await venueTimeZone(client);
  const { start, end } = periodRange(period, tz);
  const { ok, summary, error } = await getSalesSummary(client, start, end);
  if (!ok) return { result: `Failed: ${error}` };
  if (!summary) return { result: "No data available." };
  const lines = [
    `Period: ${period.replace(/_/g, " ")}`,
    `Total orders: ${summary.totalOrders}${summary.truncated ? "+" : ""}`,
    `Total revenue: $${summary.totalRevenue.toFixed(2)}`,
    `Average ticket: $${summary.avgOrder.toFixed(2)}`,
  ];
  if (summary.topItems.length > 0) {
    lines.push("Top sellers:");
    for (const item of summary.topItems.slice(0, 5)) {
      lines.push(`  ${item.name}: ${item.qty} sold, $${item.revenue.toFixed(2)}`);
    }
  }
  if (summary.truncated) lines.push("(Large period: figures cover the most recent orders only.)");
  return { result: lines.join("\n") };
}

async function listOpenOrders(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const res = await searchOrders(client, { states: ["OPEN"], limit: 50, maxItems: 50 });
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  if (res.orders.length === 0) return { result: "No open orders right now." };
  const lines = res.orders.map((o: any) => {
    const ref = o.ticket_name ?? o.reference_id ?? String(o.id).slice(0, 8);
    const items = (o.line_items ?? []).map((li: any) => `${li.quantity}x ${li.name}`).join(", ");
    return `${ref}: ${money(o.total_money?.amount)} - ${items || "no items"}`;
  });
  return { result: `Open orders (${res.orders.length}):\n${lines.join("\n")}` };
}

async function getOrderDetails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const orderId = String(args.order_id ?? "").trim();
  if (!orderId) return { result: "Order ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const [res, tz] = await Promise.all([client.get(`/orders/${encodeURIComponent(orderId)}`), venueTimeZone(client)]);
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error, "Order not found")}` };
  const o = res.data.order;
  const lines = [
    `Order: ${o.id}`,
    `State: ${o.state}`,
    `Created: ${formatLocalDateTime(o.created_at, tz)}`,
    `Total: ${money(o.total_money?.amount)}`,
    `Items:`,
  ];
  for (const li of o.line_items ?? []) {
    lines.push(`  ${li.quantity}x ${li.name} - ${money(li.total_money?.amount)}`);
  }
  if (o.discounts?.length) {
    lines.push(`Discounts:`);
    for (const d of o.discounts) {
      lines.push(`  ${d.name}: -${money(d.applied_money?.amount)}`);
    }
  }
  return { result: lines.join("\n") };
}

export const executors: Record<string, ToolExecutor> = {
  list_orders: listOrdersExec,
  sales_report: salesReport,
  list_open_orders: listOpenOrders,
  get_order_details: getOrderDetails,
};
