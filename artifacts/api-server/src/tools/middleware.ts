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
import { createHmac, timingSafeEqual } from "crypto";

const log = createComponentLogger("tool");

const SENSITIVE_KEY_RE = /(password|token|secret|key|credential|authorization|email|recipient|subject|body|message|text|query|sql|connection|string|address|phone|name)/i;
const CONFIRMATION_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEV_CONFIRMATION_SECRET = "voycelab-dev-confirmation-secret-change-in-production";

function getConfirmationSecret(): string {
  const secret =
    process.env.CONFIRMATION_TOKEN_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("FATAL: CONFIRMATION_TOKEN_SECRET or JWT_SECRET must be set in production.");
  }
  return DEV_CONFIRMATION_SECRET;
}

const CONFIRMATION_SECRET = getConfirmationSecret();

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
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (Array.isArray(val)) {
      sanitized[key] = `array(${val.length})`;
    } else if (val && typeof val === "object") {
      sanitized[key] = "object";
    } else if (typeof val === "string" && val.length > 100) {
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
          result: { status: isError ? "failed" : "succeeded" },
          status: isError ? "failed" : "succeeded",
          errorMessage: isError ? "Command failed. See server logs for diagnostic details." : null,
          durationMs,
          userId: ctx.userId ?? null,
          organizationId: ctx.organizationId ?? null,
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

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function argsHash(args: Record<string, unknown>): string {
  return createHmac("sha256", CONFIRMATION_SECRET)
    .update(stableStringify(args))
    .digest("base64url");
}

function confirmationScope(toolName: string, args: Record<string, unknown>, ctx: ToolContext): Record<string, unknown> {
  return {
    toolName,
    argsHash: argsHash(args),
    userId: ctx.userId ?? null,
    organizationId: ctx.organizationId ?? null,
    venueId: ctx.venueId ?? null,
  };
}

function signPayload(payload: Record<string, unknown>): string {
  return createHmac("sha256", CONFIRMATION_SECRET)
    .update(stableStringify(payload))
    .digest("base64url");
}

function createConfirmationToken(toolName: string, args: Record<string, unknown>, ctx: ToolContext): string {
  const payload = {
    ...confirmationScope(toolName, args, ctx),
    exp: Date.now() + CONFIRMATION_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signPayload(payload)}`;
}

function isConfirmationTokenValid(token: string | undefined, toolName: string, args: Record<string, unknown>, ctx: ToolContext): boolean {
  if (!token || !token.includes(".")) return false;
  const [body, signature] = token.split(".", 2);
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    const expectedScope = confirmationScope(toolName, args, ctx);
    for (const [key, value] of Object.entries(expectedScope)) {
      if (payload[key] !== value) return false;
    }
    const expectedSignature = signPayload(payload);
    const provided = Buffer.from(signature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

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

  if (needsConfirmation && confirmed) {
    if (ctx.confirmationTrusted || isConfirmationTokenValid(ctx.confirmationToken, toolName, args, ctx)) {
      return next(args, ctx);
    }
    return {
      result: JSON.stringify({
        status: "REQUIRES_CONFIRMATION",
        confirmation: {
          tool_name: toolName,
          args,
          risk_level: riskLevel,
          prompt: `Confirm ${toolName}?`,
          token: createConfirmationToken(toolName, args, ctx),
        },
      }),
    };
  }

  if (needsConfirmation && !confirmed) {
    return {
      result: JSON.stringify({
        status: "REQUIRES_CONFIRMATION",
        confirmation: {
          tool_name: toolName,
          args,
          risk_level: riskLevel,
          prompt: `Confirm ${toolName}?`,
          token: createConfirmationToken(toolName, args, ctx),
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
  confirmationMiddleware,
  auditMiddleware,
];
