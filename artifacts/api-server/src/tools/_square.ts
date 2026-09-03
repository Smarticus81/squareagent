/**
 * Square access helpers shared by the tool modules.
 */

import type { ToolContext, ToolResult } from "./types";
import { getSquareClient, type SquareClient } from "../lib/square-client";
import { getCachedLocation } from "../lib/catalog-cache";
import { resolveTimeZone } from "../lib/venue-time";

export const NOT_CONNECTED: ToolResult = { result: "Square not connected." };

/**
 * The SquareClient for this tool call, or null when the session has no Square
 * credentials. Memoized on the context so every tool in a request shares one
 * client (and therefore one circuit breaker).
 */
export function squareFromCtx(ctx: ToolContext): SquareClient | null {
  if (ctx.squareClient) return ctx.squareClient;
  if (!ctx.squareToken || !ctx.squareLocationId) return null;
  ctx.squareClient = getSquareClient(ctx.squareToken, ctx.squareLocationId);
  return ctx.squareClient;
}

/**
 * Stable idempotency seed for Square writes made by this tool call. Present
 * only when the caller supplied a request id and a provider call id, so a
 * replayed voice command maps to the same Square operation.
 */
export function idempotencySeed(ctx: ToolContext, suffix: string): string | undefined {
  if (!ctx.requestId || !ctx.callId) return undefined;
  return `${ctx.requestId}-${ctx.callId}-${suffix}`;
}

/** IANA timezone of the venue's Square location (UTC when unknown). */
export async function venueTimeZone(client: SquareClient): Promise<string> {
  const location = await getCachedLocation(client);
  return resolveTimeZone(location?.timezone);
}

export function money(cents: number | undefined | null): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}
