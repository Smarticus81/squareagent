/**
 * Location tools — list Square locations / venues.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { listLocations } from "../lib/square-helpers";
import { squareFromCtx, NOT_CONNECTED } from "./_square";

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
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const { ok, locations, error } = await listLocations(client);
  if (!ok) return { result: `Failed: ${error}` };
  if (!locations || locations.length === 0) return { result: "No locations found." };
  const lines = locations.map((l) => `${l.name} (${l.id}) - ${l.status}${l.id === client.locationId ? " (this venue)" : ""}`);
  return { result: `Locations:\n${lines.join("\n")}` };
}

export const executors: Record<string, ToolExecutor> = {
  list_locations: listLocationsExec,
};
