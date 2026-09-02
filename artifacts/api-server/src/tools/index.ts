/**
 * VoyceLab Tool Registry — single source of truth for ALL voice agent tools.
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
import { wrapExecutors, DEFAULT_MIDDLEWARES } from "./middleware";

import * as pos from "./pos";
import * as inventory from "./inventory";
import * as catalog from "./catalog";
import * as orders from "./orders";
import * as locations from "./locations";
import * as customers from "./customers";
import * as payments from "./payments";
import * as team from "./team";
import * as reports from "./reports";
import * as workflows from "../workflows";
import * as generalWeb from "./general/web";
import * as generalKnowledge from "./general/knowledge";
import * as generalEmail from "./general/email";
import * as generalEmailRead from "./general/email-read";
import * as generalDatabase from "./general/database";
import metaSkill from "../skills/meta.skill";
import { getSquareClient } from "../lib/square-client";

// Re-export types for convenience
export type { ToolDefinition } from "./types";

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
  workflows,
  generalWeb,
  generalKnowledge,
  generalEmail,
  generalEmailRead,
  generalDatabase,
];

// ── ALL_TOOLS: flat array of every tool definition (for OpenAI session config) ─

const ALL_TOOLS: ToolDefinition[] = [
  ...metaSkill.tools,
  ...DOMAIN_MODULES.flatMap((m) => m.definitions),
];

// ── Merged executor map (wrapped with middleware) ─────────────────────────────

const RAW_EXECUTORS: Record<string, ToolExecutor> = { ...metaSkill.executors };
for (const mod of DOMAIN_MODULES) {
  for (const [name, fn] of Object.entries(mod.executors)) {
    if (RAW_EXECUTORS[name]) {
      console.warn(`[ToolRegistry] Duplicate tool name: "${name}" — last module wins`);
    }
    RAW_EXECUTORS[name] = fn;
  }
}

// Apply default middleware stack (error handling, timing, logging)
const EXECUTOR_MAP: Record<string, ToolExecutor> = wrapExecutors(RAW_EXECUTORS, ...DEFAULT_MIDDLEWARES);

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
  if (!ctx.squareClient && ctx.squareToken && ctx.squareLocationId) {
    ctx.squareClient = getSquareClient(ctx.squareToken, ctx.squareLocationId);
  }
  return executor(args, ctx);
}

/** Get the count of registered tools (useful for logs). */
export function toolCount(): number {
  return ALL_TOOLS.length;
}
