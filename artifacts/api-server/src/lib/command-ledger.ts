/**
 * Command execution ledger — idempotent tool call tracking via PostgreSQL.
 * Prevents duplicate Square mutations on transport retries.
 */

import { db, toolCallsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("command-ledger");

const STALE_PENDING_MS = 30_000;

export interface LedgerEntry {
  status: "pending" | "succeeded" | "failed";
  result?: string;
  command?: unknown;
}

export async function beginCommandExecution(params: {
  sessionId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  userId?: number;
  organizationId?: string | null;
  venueId?: number;
  agentProfileId?: string | null;
}): Promise<{ action: "execute" | "replay" | "wait"; entry?: LedgerEntry }> {
  if (!params.callId) {
    return { action: "execute" };
  }

  const [existing] = await db
    .select({
      status: toolCallsTable.status,
      result: toolCallsTable.result,
      createdAt: toolCallsTable.createdAt,
    })
    .from(toolCallsTable)
    .where(
      and(
        eq(toolCallsTable.sessionId, params.sessionId),
        eq(toolCallsTable.callId, params.callId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === "succeeded" || existing.status === "failed") {
      const resultObj = existing.result as { result?: string; command?: unknown } | null;
      return {
        action: "replay",
        entry: {
          status: existing.status as "succeeded" | "failed",
          result: resultObj?.result,
          command: resultObj?.command,
        },
      };
    }
    // Pending — check if stale
    const age = Date.now() - new Date(existing.createdAt).getTime();
    if (age < STALE_PENDING_MS) {
      return { action: "wait" };
    }
    // Stale pending — allow retry
    return { action: "execute" };
  }

  try {
    await db.insert(toolCallsTable).values({
      sessionId: params.sessionId,
      callId: params.callId,
      toolName: params.toolName,
      args: params.args,
      status: "pending",
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      venueId: params.venueId ?? null,
      agentProfileId: params.agentProfileId ?? null,
    });
  } catch (err: any) {
    // Unique constraint race — another instance claimed it
    if (err?.code === "23505") {
      return beginCommandExecution(params);
    }
    log.warn({ sessionId: params.sessionId, callId: params.callId, err: err.message }, "ledger insert failed");
  }

  return { action: "execute" };
}

export async function completeCommandExecution(params: {
  sessionId: string;
  callId: string;
  status: "succeeded" | "failed";
  result: string;
  command?: unknown;
  durationMs?: number;
  errorMessage?: string;
}): Promise<void> {
  if (!params.callId) return;

  await db
    .update(toolCallsTable)
    .set({
      status: params.status,
      result: { result: params.result, command: params.command ?? null },
      durationMs: params.durationMs ?? null,
      errorMessage: params.errorMessage ?? null,
    })
    .where(
      and(
        eq(toolCallsTable.sessionId, params.sessionId),
        eq(toolCallsTable.callId, params.callId),
      ),
    );
}
