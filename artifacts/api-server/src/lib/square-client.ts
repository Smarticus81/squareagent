/**
 * SquareClient — the single HTTP path to the Square API.
 *
 * Every Square call the voice agents make (tools, live order sync, workflows,
 * dashboard proxy routes) goes through this client so they all share:
 *   - One API version and header set (SQUARE_API_VERSION, env-overridable)
 *   - A hard per-request timeout (a Square stall must never hang a voice turn)
 *   - Exponential backoff retry on transient failures (429/5xx/network), honoring
 *     Retry-After on 429
 *   - A per-credential circuit breaker (opens after 5 failures in 60s, probes
 *     again after 30s) so a Square outage fails fast instead of piling up
 *   - Cursor pagination helpers for list/search endpoints
 *   - Uniform error extraction from Square's { errors: [...] } envelope
 */

import crypto from "crypto";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("square-client");

export const SQUARE_BASE = "https://connect.squareup.com/v2";
export const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";

/**
 * Pinned Square API version. Bump deliberately: a version string Square does
 * not recognise fails every request. Override per deployment with
 * SQUARE_API_VERSION when validating a newer release.
 */
export const SQUARE_API_VERSION = process.env.SQUARE_API_VERSION?.trim() || "2025-04-16";

const DEFAULT_TIMEOUT_MS = Number(process.env.SQUARE_REQUEST_TIMEOUT_MS) || 10_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;
const MAX_RETRY_DELAY_MS = 4_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Headers for a raw Square API request (OAuth routes need these without a client). */
export function squareHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_API_VERSION,
  };
}

// ── Circuit breaker ──────────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  openedAt: number | null;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_HALF_OPEN_MS = 30_000;

const circuits = new Map<string, CircuitState>();

function credentialFingerprint(token: string, locationId: string): string {
  return crypto.createHash("sha256").update(`${token}:${locationId}`).digest("hex").slice(0, 16);
}

function getCircuit(key: string): CircuitState {
  let state = circuits.get(key);
  if (!state) {
    state = { failures: 0, lastFailure: 0, openedAt: null };
    circuits.set(key, state);
  }
  return state;
}

function recordSuccess(key: string): void {
  const state = getCircuit(key);
  if (state.openedAt) log.info({ circuit: key }, "circuit CLOSED");
  state.failures = 0;
  state.openedAt = null;
}

function recordFailure(key: string): void {
  const state = getCircuit(key);
  const now = Date.now();
  if (now - state.lastFailure > CIRCUIT_FAILURE_WINDOW_MS) state.failures = 0;
  state.failures++;
  state.lastFailure = now;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD && !state.openedAt) {
    state.openedAt = now;
    log.warn({ circuit: key, failures: state.failures }, "circuit OPEN");
  }
}

function isCircuitOpen(key: string): boolean {
  const state = circuits.get(key);
  if (!state?.openedAt) return false;
  // Half-open after the cool-down: let one request probe Square.
  return Date.now() - state.openedAt <= CIRCUIT_HALF_OPEN_MS;
}

/** Test hook — clears all breaker state. */
export function resetSquareCircuits(): void {
  circuits.clear();
}

// ── Errors ───────────────────────────────────────────────────────────────────

export interface SquareError {
  status: number;
  message: string;
  code?: string;
  category?: string;
}

export function extractSquareError(status: number, data: unknown): SquareError {
  const err = (data as { errors?: Array<Record<string, unknown>> } | null)?.errors?.[0];
  const detail = typeof err?.detail === "string" ? err.detail : undefined;
  const code = typeof err?.code === "string" ? err.code : undefined;
  const category = typeof err?.category === "string" ? err.category : undefined;
  return { status, message: detail || code || `HTTP ${status}`, code, category };
}

/** Whether an error means the stored OAuth token is no longer accepted. */
export function isSquareAuthError(error: SquareError | undefined): boolean {
  return error?.status === 401 || error?.category === "AUTHENTICATION_ERROR";
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface SquareResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: SquareError;
  durationMs: number;
}

export interface RequestOptions {
  /** Override the default request timeout. */
  timeoutMs?: number;
  /** Disable retries for this call. */
  noRetry?: boolean;
}

export type FetchLike = typeof fetch;

export class SquareClient {
  readonly locationId: string;
  private readonly token: string;
  private readonly circuitKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(token: string, locationId: string, fetchImpl: FetchLike = fetch) {
    this.token = token;
    this.locationId = locationId;
    this.circuitKey = `sq-${credentialFingerprint(token, locationId)}`;
    this.fetchImpl = fetchImpl;
  }

  /** Stable key for per-credential caches. Never log the token itself. */
  get cacheKey(): string {
    return this.circuitKey;
  }

  /** Convenience: get the locationId this client was initialized with */
  getLocationId(): string {
    return this.locationId;
  }

  /** Raw token, for the few call sites (OAuth revoke) that need it. */
  getToken(): string {
    return this.token;
  }

  get<T = any>(path: string, opts?: RequestOptions): Promise<SquareResponse<T>> {
    return this.request<T>("GET", path, undefined, opts);
  }

  post<T = any>(path: string, body?: unknown, opts?: RequestOptions): Promise<SquareResponse<T>> {
    return this.request<T>("POST", path, body, opts);
  }

  put<T = any>(path: string, body?: unknown, opts?: RequestOptions): Promise<SquareResponse<T>> {
    return this.request<T>("PUT", path, body, opts);
  }

  del<T = any>(path: string, opts?: RequestOptions): Promise<SquareResponse<T>> {
    return this.request<T>("DELETE", path, undefined, opts);
  }

  /**
   * Follow a cursor-paginated GET (e.g. /catalog/list?types=ITEM). Stops on
   * the first failed page and returns what was collected plus the error.
   */
  async getAllPages<T = any>(
    path: string,
    pick: (page: T) => unknown[],
    maxPages = 50,
  ): Promise<{ ok: boolean; items: any[]; error?: SquareError }> {
    const items: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const url = cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : path;
      const res = await this.get<T & { cursor?: string }>(url);
      if (!res.ok || !res.data) return { ok: false, items, error: res.error };
      items.push(...pick(res.data));
      cursor = res.data.cursor;
      if (!cursor) break;
    }
    return { ok: true, items };
  }

  /**
   * Follow a cursor-paginated POST search (e.g. /orders/search). `maxItems`
   * caps the total so a huge history can't blow up a voice turn.
   */
  async postAllPages<T = any>(
    path: string,
    body: Record<string, unknown>,
    pick: (page: T) => unknown[],
    maxItems = 2_000,
  ): Promise<{ ok: boolean; items: any[]; truncated: boolean; error?: SquareError }> {
    const items: any[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await this.post<T & { cursor?: string }>(path, cursor ? { ...body, cursor } : body);
      if (!res.ok || !res.data) return { ok: false, items, truncated: false, error: res.error };
      items.push(...pick(res.data));
      cursor = res.data.cursor;
      if (!cursor) return { ok: true, items, truncated: false };
      if (items.length >= maxItems) return { ok: true, items: items.slice(0, maxItems), truncated: true };
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<SquareResponse<T>> {
    if (isCircuitOpen(this.circuitKey)) {
      return {
        ok: false,
        status: 503,
        error: { status: 503, message: "Square is temporarily unavailable. Please try again in a moment." },
        durationMs: 0,
      };
    }

    const url = path.startsWith("http") ? path : `${SQUARE_BASE}${path}`;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attempts = opts.noRetry ? 1 : MAX_ATTEMPTS;
    const start = Date.now();
    let lastError: SquareError | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: squareHeaders(this.token),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const durationMs = Date.now() - start;

        if (res.ok) {
          recordSuccess(this.circuitKey);
          const text = await res.text();
          const data = text ? (JSON.parse(text) as T) : (undefined as T);
          return { ok: true, status: res.status, data, durationMs };
        }

        const errData = await res.json().catch(() => ({}));
        lastError = extractSquareError(res.status, errData);

        if (!RETRYABLE_STATUS.has(res.status)) {
          // 4xx are the caller's problem (bad args, stale version, auth) — they
          // are not a Square outage, so they do not trip the breaker.
          if (res.status >= 500) recordFailure(this.circuitKey);
          return { ok: false, status: res.status, error: lastError, durationMs };
        }

        if (attempt < attempts - 1) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS)
            : backoffDelay(attempt);
          log.warn({ method, path, status: res.status, attempt: attempt + 1, delay }, "retryable Square error");
          await sleep(delay);
        }
      } catch (e: any) {
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        lastError = {
          status: 0,
          message: timedOut ? "Square did not respond in time. Please try again." : e?.message || "Network error",
        };
        log.warn({ method, path, attempt: attempt + 1, err: lastError.message }, "Square network error");
        if (attempt < attempts - 1) await sleep(backoffDelay(attempt));
      }
    }

    recordFailure(this.circuitKey);
    const durationMs = Date.now() - start;
    log.error({ method, path, attempts, durationMs, err: lastError?.message }, "Square request failed");
    return { ok: false, status: lastError?.status ?? 0, error: lastError ?? { status: 0, message: "Max retries exceeded" }, durationMs };
  }
}

function backoffDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  // Full jitter keeps a burst of voice commands from retrying in lock-step.
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base / 2 + Math.random() * base / 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Client registry ──────────────────────────────────────────────────────────
// Tool executors receive raw credentials from the session store; memoizing the
// client per credential keeps one object per venue instead of one per call.

const clientRegistry = new Map<string, SquareClient>();
const CLIENT_REGISTRY_MAX = 500;

export function getSquareClient(token: string, locationId: string): SquareClient {
  const key = credentialFingerprint(token, locationId);
  const existing = clientRegistry.get(key);
  if (existing) return existing;
  if (clientRegistry.size >= CLIENT_REGISTRY_MAX) {
    const oldest = clientRegistry.keys().next().value;
    if (oldest) clientRegistry.delete(oldest);
  }
  const client = new SquareClient(token, locationId);
  clientRegistry.set(key, client);
  return client;
}
