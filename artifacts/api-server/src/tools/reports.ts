/**
 * Reporting tools — hourly sales, item performance, labor cost, daily summary.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { SQUARE_BASE, squareHeaders } from "../lib/square-helpers";

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

function parseDateRange(dateStr?: string): { start: string; end: string } {
  const d = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
}

function parsePeriod(period: string): { start: string; end: string } {
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
    case "today":
    default:
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start: start.toISOString(), end: endOfDay.toISOString() };
  }
}

async function fetchOrders(squareToken: string, locationId: string, startAt: string, endAt: string, states?: string[]) {
  const res = await fetch(`${SQUARE_BASE}/orders/search`, {
    method: "POST",
    headers: squareHeaders(squareToken),
    body: JSON.stringify({
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startAt, end_at: endAt } },
          ...(states ? { state_filter: { states } } : {}),
        },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
    }),
  });
  const data = (await res.json()) as any;
  return data.orders ?? [];
}

// ── Executors ─────────────────────────────────────────────────────────────────

async function hourlySales(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const { start, end } = parseDateRange(args.date as string | undefined);
  try {
    const orders = await fetchOrders(ctx.squareToken, ctx.squareLocationId, start, end, ["COMPLETED"]);
    if (orders.length === 0) return { result: "No completed orders for this date." };

    const hourly = new Map<number, { count: number; revenue: number }>();
    for (const o of orders) {
      const hour = new Date(o.created_at).getHours();
      const existing = hourly.get(hour) ?? { count: 0, revenue: 0 };
      existing.count++;
      existing.revenue += (o.total_money?.amount ?? 0);
      hourly.set(hour, existing);
    }

    const lines: string[] = [];
    for (let h = 0; h < 24; h++) {
      const data = hourly.get(h);
      if (data) {
        const timeLabel = `${h.toString().padStart(2, "0")}:00`;
        lines.push(`${timeLabel} — ${data.count} orders, $${(data.revenue / 100).toFixed(2)}`);
      }
    }
    return { result: `Hourly breakdown:\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed: ${e.message}` };
  }
}

async function itemPerformance(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const period = String(args.period ?? "today");
  const sortBy = String(args.sort_by ?? "revenue");
  const limit = Number(args.limit ?? 10);
  const { start, end } = parsePeriod(period);

  try {
    const orders = await fetchOrders(ctx.squareToken, ctx.squareLocationId, start, end, ["COMPLETED"]);
    if (orders.length === 0) return { result: "No completed orders for this period." };

    const items = new Map<string, { qty: number; revenue: number }>();
    for (const o of orders) {
      for (const li of o.line_items ?? []) {
        const name = li.name ?? "Unknown";
        const qty = parseInt(li.quantity ?? "0");
        const rev = li.total_money?.amount ?? 0;
        const existing = items.get(name) ?? { qty: 0, revenue: 0 };
        items.set(name, { qty: existing.qty + qty, revenue: existing.revenue + rev });
      }
    }

    const sorted = [...items.entries()].sort((a, b) =>
      sortBy === "quantity" ? b[1].qty - a[1].qty : b[1].revenue - a[1].revenue,
    ).slice(0, limit);

    const lines = sorted.map(([name, { qty, revenue }], i) =>
      `${i + 1}. ${name}: ${qty} sold, $${(revenue / 100).toFixed(2)}`,
    );
    return { result: `Top items (${period.replace(/_/g, " ")}, by ${sortBy}):\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed: ${e.message}` };
  }
}

async function dailySummary(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken || !ctx.squareLocationId) return { result: "Square not connected." };
  const { start, end } = parseDateRange(args.date as string | undefined);

  try {
    const orders = await fetchOrders(ctx.squareToken, ctx.squareLocationId, start, end, ["COMPLETED"]);
    if (orders.length === 0) return { result: "No completed orders for this date." };

    let totalRevenue = 0;
    const hourly = new Map<number, number>();
    const items = new Map<string, { qty: number; revenue: number }>();

    for (const o of orders) {
      totalRevenue += (o.total_money?.amount ?? 0);
      const hour = new Date(o.created_at).getHours();
      hourly.set(hour, (hourly.get(hour) ?? 0) + 1);
      for (const li of o.line_items ?? []) {
        const name = li.name ?? "Unknown";
        const qty = parseInt(li.quantity ?? "0");
        const rev = li.total_money?.amount ?? 0;
        const existing = items.get(name) ?? { qty: 0, revenue: 0 };
        items.set(name, { qty: existing.qty + qty, revenue: existing.revenue + rev });
      }
    }

    // Find busiest hour
    let busiestHour = 0;
    let busiestCount = 0;
    for (const [h, count] of hourly) {
      if (count > busiestCount) { busiestHour = h; busiestCount = count; }
    }

    // Top 5 items
    const topItems = [...items.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);

    const lines = [
      `Daily Summary:`,
      `Total orders: ${orders.length}`,
      `Total revenue: $${(totalRevenue / 100).toFixed(2)}`,
      `Average ticket: $${(totalRevenue / 100 / orders.length).toFixed(2)}`,
      `Busiest hour: ${busiestHour.toString().padStart(2, "0")}:00 (${busiestCount} orders)`,
      `Top sellers:`,
      ...topItems.map(([name, { qty, revenue }]) => `  ${name}: ${qty} sold, $${(revenue / 100).toFixed(2)}`),
    ];
    return { result: lines.join("\n") };
  } catch (e: any) {
    return { result: `Failed: ${e.message}` };
  }
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  hourly_sales: hourlySales,
  item_performance: itemPerformance,
  daily_summary: dailySummary,
};
