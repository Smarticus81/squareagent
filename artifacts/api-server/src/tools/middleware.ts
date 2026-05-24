/**
 * Tool Middleware Pipeline — cross-cutting concerns for tool execution.
 *
 * Middlewares wrap tool executors with timing, logging, error handling, and rate limiting.
 * They compose via applyMiddleware() and execute in order (first middleware = outermost).
 */

import type { ToolExecutor, ToolContext, ToolResult } from "./types";
import { requiresConfirmation, getToolRisk } from "@workspace/voicelab-core/confirmation";
import { createComponentLogger } from "../lib/logger";
import { db, toolCallsTable } from "@workspace/db";

const log = createComponentLogger("tool");

const SENSITIVE_KEY_RE = /password|token|secret|key/i;

// ── Middleware type ─────────────────────────────────────────────────────────

export type NextFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export type ToolMiddleware = (
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  next: NextFn,
) => Promise<ToolResult>;

// ── Compose middleware around an executor ────────────────────────────────────

export function applyMiddleware(
  executor: ToolExecutor,
  ...middlewares: ToolMiddleware[]
): ToolExecutor {
  // Build the chain from inside out
  let chain: NextFn = (args, ctx) => executor(args, ctx);

  // Apply middlewares in reverse so the first one in the array is the outermost
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i];
    const next = chain;
    chain = (args, ctx) => mw("", args, ctx, next);
  }

  return chain;
}

/**
 * Wrap an entire executor map with middleware, preserving tool names in the middleware context.
 */
export function wrapExecutors(
  executors: Record<string, ToolExecutor>,
  ...middlewares: ToolMiddleware[]
): Record<string, ToolExecutor> {
  const wrapped: Record<string, ToolExecutor> = {};

  for (const [toolName, executor] of Object.entries(executors)) {
    let chain: NextFn = (args, ctx) => executor(args, ctx);

    for (let i = middlewares.length - 1; i >= 0; i--) {
      const mw = middlewares[i];
      const next = chain;
      chain = (args, ctx) => mw(toolName, args, ctx, next);
    }

    wrapped[toolName] = chain;
  }

  return wrapped;
}

// ── Built-in middlewares ─────────────────────────────────────────────────────

/**
 * Timing middleware — logs execution duration for every tool call.
 */
export const timingMiddleware: ToolMiddleware = async (toolName, args, ctx, next) => {
  const start = Date.now();
  const result = await next(args, ctx);
  const durationMs = Date.now() - start;
  if (durationMs > 2000) {
    log.warn({ toolName, durationMs }, "tool completed (slow)");
  } else {
    log.info({ toolName, durationMs }, "tool completed");
  }
  return result;
};

/**
 * Error middleware — catches thrown errors and returns a normalized ToolResult
 * instead of crashing the request.
 */
export const errorMiddleware: ToolMiddleware = async (toolName, args, ctx, next) => {
  try {
    return await next(args, ctx);
  } catch (e: any) {
    log.error({ toolName, err: e.message }, "tool threw");
    return { result: `Tool error: ${e.message}` };
  }
};

/**
 * Logging middleware — logs tool invocations with sanitized args.
 */
export const loggingMiddleware: ToolMiddleware = async (toolName, args, ctx, next) => {
  // Sanitize args: omit large fields, truncate long strings
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === "string" && val.length > 100) {
      sanitized[key] = val.slice(0, 100) + "...";
    } else {
      sanitized[key] = val;
    }
  }
  log.info({ toolName, args: sanitized }, "tool called");
  return next(args, ctx);
};

/**
 * Audit middleware — fire-and-forget insert into toolCallsTable after execution.
 * Runs after the executor so it can capture the result and duration.
 */
export const auditMiddleware: ToolMiddleware = async (toolName, args, ctx, next) => {
  const start = Date.now();
  const result = await next(args, ctx);
  const durationMs = Date.now() - start;

  setImmediate(() => {
    try {
      const sanitizedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        sanitizedArgs[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : v;
      }

      const isError = result.result?.startsWith("Tool error:");
      db.insert(toolCallsTable)
        .values({
          toolName,
          args: sanitizedArgs,
          result: { result: result.result },
          status: isError ? "failed" : "succeeded",
          errorMessage: isError ? result.result : null,
          durationMs,
          userId: ctx.userId ?? null,
          venueId: ctx.venueId ?? null,
        })
        .catch((err: any) => {
          log.warn({ toolName, err: err.message }, "audit insert failed");
        });
    } catch {
      // never block the response
    }
  });

  return result;
};

/**
 * Confirmation middleware — blocks tool execution when the tool's risk level
 * exceeds the threshold for the session's noise mode, unless the caller has
 * already set `confirmed: true` in the context. Returns a structured
 * REQUIRES_CONFIRMATION result so the client can prompt the user.
 */
export const confirmationMiddleware: ToolMiddleware = async (toolName, args, ctx, next) => {
  const noiseMode = ctx.noiseMode ?? "standard";
  const confirmed = ctx.confirmed ?? false;

  const riskLevel = getToolRisk(toolName);
  const needsConfirmation = requiresConfirmation(toolName, riskLevel, noiseMode);

  if (needsConfirmation && !confirmed) {
    return {
      result: JSON.stringify({
        status: "REQUIRES_CONFIRMATION",
        confirmation: {
          tool_name: toolName,
          args,
          risk_level: riskLevel,
          prompt: `Confirm ${toolName}?`,
        },
      }),
    };
  }
  return next(args, ctx);
};

// ── Default middleware stack ─────────────────────────────────────────────────

/** Standard middleware stack applied to all tool executors. */
export const DEFAULT_MIDDLEWARES: ToolMiddleware[] = [
  errorMiddleware,
  timingMiddleware,
  loggingMiddleware,
  auditMiddleware,
];
