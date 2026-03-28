/**
 * Shared types for the BevPro tool registry.
 * Every domain module (pos, inventory, catalog, etc.) exports tools
 * conforming to these interfaces.
 */

import type { CatalogItem, OrderItem, LiveSession, OrderCommand } from "../lib/square-helpers";

// ── OpenAI Realtime tool schema (JSON-Schema subset) ──────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: ToolParameter;
}

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

// ── Execution context passed to every tool executor ───────────────────────────

export interface ToolContext {
  catalog: CatalogItem[];
  order: OrderItem[];
  squareToken: string;
  squareLocationId: string;
  session: LiveSession;
}

// ── Result returned by every tool executor ────────────────────────────────────

export interface ToolResult {
  result: string;
  command?: OrderCommand;
}

// ── A tool module exports definitions + an executor map ───────────────────────

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;
