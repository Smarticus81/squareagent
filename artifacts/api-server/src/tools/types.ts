/**
 * Shared types for the VoyceLab tool registry.
 * Every domain module (pos, inventory, catalog, etc.) exports tools
 * conforming to these interfaces.
 */

import type { CatalogItem, OrderItem, LiveSession, OrderCommand } from "../lib/square-helpers";
import type { SquareClient } from "../lib/square-client";
import type { NoiseMode } from "@workspace/voicelab-core/noise";

// ── OpenAI Realtime tool schema (JSON-Schema subset) ──────────────────────────

interface ToolParameter {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
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
  /** Resilient Square API client (with retry + circuit breaker). */
  squareClient?: SquareClient;
  /** Unique request ID for tracing (optional). */
  requestId?: string;
  /** Authenticated user id — used by general-assistant tools to scope queries. */
  userId?: number;
  /** Authenticated user organization role. */
  userRole?: string | null;
  /** Active workspace id for shared knowledge, database, and email integrations. */
  organizationId?: string | null;
  /** Active venue id — used to filter knowledge / db / email rows by venue. */
  venueId?: number;
  /** Which assistant kind invoked this tool. Helpful for branching behaviour. */
  assistantKind?: "venue" | "general";
  /** Noise mode for the current session — drives confirmation thresholds. */
  noiseMode?: NoiseMode;
  /**
   * How submitted orders settle in Square. "hold_for_review" leaves the order
   * OPEN on the POS for end-of-day review instead of recording payment.
   */
  orderHandlingMode?: "auto_complete" | "hold_for_review";
  /** Whether the caller has already confirmed this tool invocation. */
  confirmed?: boolean;
  /** Signed confirmation token returned by a previous REQUIRES_CONFIRMATION response. */
  confirmationToken?: string;
  /** Server-internal bypass for trusted orchestrations such as workflows. */
  confirmationTrusted?: boolean;
  /** Provider call_id for idempotent Square operations on retry. */
  callId?: string;
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
