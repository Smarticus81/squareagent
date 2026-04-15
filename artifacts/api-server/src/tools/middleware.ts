/**
 * Tool Middleware Pipeline — cross-cutting concerns for tool execution.
 *
 * Middlewares wrap tool executors with timing, logging, error handling, and rate limiting.
 * They compose via applyMiddleware() and execute in order (first middleware = outermost).
 */

import type { ToolExecutor, ToolContext, ToolResult } from "./types";

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
  const level = durationMs > 2000 ? "warn" : "log";
  console[level](`[Tool] ${toolName} completed in ${durationMs}ms`);
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
    console.error(`[Tool] ${toolName} threw:`, e.message);
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
  console.log(`[Tool] ${toolName} called:`, JSON.stringify(sanitized));
  return next(args, ctx);
};

/**
 * Rate limiting middleware — per-venue sliding window counter.
 * Limits to maxCalls per windowMs per Square token.
 */
export function rateLimitMiddleware(maxCalls = 60, windowMs = 60_000): ToolMiddleware {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return async (toolName, args, ctx, next) => {
    const key = ctx.squareToken?.slice(0, 8) ?? "anon";
    const now = Date.now();
    let window = windows.get(key);

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }

    window.count++;
    if (window.count > maxCalls) {
      console.warn(`[Tool] Rate limit hit for venue ${key}: ${window.count}/${maxCalls} in window`);
      return { result: "Too many requests — please slow down and try again in a moment." };
    }

    return next(args, ctx);
  };
}

// ── Default middleware stack ─────────────────────────────────────────────────

/** Standard middleware stack applied to all tool executors. */
export const DEFAULT_MIDDLEWARES: ToolMiddleware[] = [
  errorMiddleware,
  timingMiddleware,
  loggingMiddleware,
];
