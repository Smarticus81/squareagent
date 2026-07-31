/**
 * Location tools — list Square locations / venues.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { listLocations } from "../lib/square-helpers";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "list_locations",
    description: "List all Square locations / venues for this merchant",
    parameters: { type: "object", properties: {} },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

async function listLocationsExec(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken) return { result: "Square not connected." };
  const { ok, locations, error } = await listLocations(ctx.squareToken);
  if (!ok) return { result: `Failed: ${error}` };
  if (!locations || locations.length === 0) return { result: "No locations found." };
  const lines = locations.map((l) => `${l.name} (${l.id}) — ${l.status}`);
  return { result: `Locations:\n${lines.join("\n")}` };
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  list_locations: listLocationsExec,
};
