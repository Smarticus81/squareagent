/**
 * Reporting tools — hourly sales, item performance, labor cost, daily summary.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { searchOrders, summarizeOrders, squareErrorMessage } from "../lib/square-helpers";
import { squareFromCtx, venueTimeZone, NOT_CONNECTED, money } from "./_square";
import { dayRange, normalizePeriod, periodRange, hourInZone } from "../lib/venue-time";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "hourly_sales",
    description: "Get an hour-by-hour sales breakdown for today or a specific date",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format (default: today)" },
      },
    },
  },
  {
    type: "function",
    name: "item_performance",
    description: "See which items sold the most over a period — ranked by revenue or quantity",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", description: "Time period: 'today', 'yesterday', 'this_week', 'last_7_days', 'this_month'", default: "today" },
        sort_by: { type: "string", description: "'revenue' or 'quantity'", default: "revenue" },
        limit: { type: "integer", description: "Number of items to show (default 10)", default: 10 },
      },
    },
  },
  {
    type: "function",
    name: "daily_summary",
    description: "Get a complete daily summary — orders, revenue, top items, busiest hours",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format (default: today)" },
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  return `${h.toString().padStart(2, "0")}:00`;
}

async function completedOrders(ctx: ToolContext, range: { start: string; end: string }) {
  const client = squareFromCtx(ctx)!;
  return searchOrders(client, { startAt: range.start, endAt: range.end, states: ["COMPLETED"], sortOrder: "ASC" });
}

// ── Executors ─────────────────────────────────────────────────────────────────

async function hourlySales(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const tz = await venueTimeZone(client);
  const res = await completedOrders(ctx, dayRange(args.date as string | undefined, tz));
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  if (res.orders.length === 0) return { result: "No completed orders for this date." };

  const hourly = new Map<number, { count: number; revenue: number }>();
  for (const o of res.orders) {
    const hour = hourInZone(o.created_at, tz);
    const existing = hourly.get(hour) ?? { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += o.total_money?.amount ?? 0;
    hourly.set(hour, existing);
  }

  const lines: string[] = [];
  for (let h = 0; h < 24; h++) {
    const data = hourly.get(h);
    if (data) lines.push(`${hourLabel(h)} - ${data.count} orders, ${money(data.revenue)}`);
  }
  return { result: `Hourly breakdown:\n${lines.join("\n")}${res.truncated ? "\n(Busy day: most recent orders only.)" : ""}` };
}

async function itemPerformance(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const period = normalizePeriod(args.period);
  const sortBy = String(args.sort_by ?? "revenue") === "quantity" ? "quantity" : "revenue";
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10) || 10), 50);
  const tz = await venueTimeZone(client);
  const res = await completedOrders(ctx, periodRange(period, tz));
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  if (res.orders.length === 0) return { result: "No completed orders for this period." };

  const summary = summarizeOrders(res.orders, Number.MAX_SAFE_INTEGER, res.truncated);
  const sorted = [...summary.topItems]
    .sort((a, b) => (sortBy === "quantity" ? b.qty - a.qty : b.revenue - a.revenue))
    .slice(0, limit);
  const lines = sorted.map((item, i) => `${i + 1}. ${item.name}: ${item.qty} sold, $${item.revenue.toFixed(2)}`);
  return { result: `Top items (${period.replace(/_/g, " ")}, by ${sortBy}):\n${lines.join("\n")}` };
}

async function dailySummary(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const tz = await venueTimeZone(client);
  const res = await completedOrders(ctx, dayRange(args.date as string | undefined, tz));
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  if (res.orders.length === 0) return { result: "No completed orders for this date." };

  const summary = summarizeOrders(res.orders, 5, res.truncated);
  const hourly = new Map<number, number>();
  for (const o of res.orders) {
    const hour = hourInZone(o.created_at, tz);
    hourly.set(hour, (hourly.get(hour) ?? 0) + 1);
  }
  let busiestHour = 0;
  let busiestCount = 0;
  for (const [h, count] of hourly) {
    if (count > busiestCount) { busiestHour = h; busiestCount = count; }
  }

  const lines = [
    `Daily Summary:`,
    `Total orders: ${summary.totalOrders}${summary.truncated ? "+" : ""}`,
    `Total revenue: $${summary.totalRevenue.toFixed(2)}`,
    `Average ticket: $${summary.avgOrder.toFixed(2)}`,
    `Busiest hour: ${hourLabel(busiestHour)} (${busiestCount} orders)`,
    `Top sellers:`,
    ...summary.topItems.map((item) => `  ${item.name}: ${item.qty} sold, $${item.revenue.toFixed(2)}`),
  ];
  return { result: lines.join("\n") };
}

export const executors: Record<string, ToolExecutor> = {
  hourly_sales: hourlySales,
  item_performance: itemPerformance,
  daily_summary: dailySummary,
};
