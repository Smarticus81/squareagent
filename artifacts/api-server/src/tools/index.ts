/**
 * BevPro Tool Registry — single source of truth for ALL voice agent tools.
 *
 * Both realtime.ts (WebRTC REST) and ws-relay.ts (native WebSocket) import
 * from here instead of maintaining inline tool arrays.
 *
 * Adding a new tool:
 *   1. Add the ToolDefinition to the appropriate domain file (pos, inventory, etc.)
 *   2. Add the executor function to that domain file's `executors` map
 *   3. It automatically appears in ALL_TOOLS and executeToolCall()
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

import * as pos from "./pos";
import * as inventory from "./inventory";
import * as catalog from "./catalog";
import * as orders from "./orders";
import * as locations from "./locations";
import * as customers from "./customers";
import * as payments from "./payments";
import * as team from "./team";
import * as reports from "./reports";

// Re-export types for convenience
export type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

// ── Aggregate all domain modules ──────────────────────────────────────────────

const DOMAIN_MODULES = [
  pos,
  inventory,
  catalog,
  orders,
  locations,
  customers,
  payments,
  team,
  reports,
];

// ── ALL_TOOLS: flat array of every tool definition (for OpenAI session config) ─

export const ALL_TOOLS: ToolDefinition[] = DOMAIN_MODULES.flatMap((m) => m.definitions);

// ── Merged executor map ───────────────────────────────────────────────────────

const EXECUTOR_MAP: Record<string, ToolExecutor> = {};
for (const mod of DOMAIN_MODULES) {
  for (const [name, fn] of Object.entries(mod.executors)) {
    if (EXECUTOR_MAP[name]) {
      console.warn(`[ToolRegistry] Duplicate tool name: "${name}" — last module wins`);
    }
    EXECUTOR_MAP[name] = fn;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const executor = EXECUTOR_MAP[toolName];
  if (!executor) {
    return { result: `Unknown tool: ${toolName}` };
  }
  return executor(args, ctx);
}

/** Get the count of registered tools (useful for logs). */
export function toolCount(): number {
  return ALL_TOOLS.length;
}
