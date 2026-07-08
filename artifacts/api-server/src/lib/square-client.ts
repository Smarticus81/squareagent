/**
 * SquareClient — resilient HTTP client for the Square API.
 *
 * Features:
 *   - Exponential backoff retry (3 attempts: 500ms → 1s → 2s)
 *   - Retry on transient errors (429, 500, 502, 503)
 *   - Per-venue circuit breaker (open after 5 failures in 60s, half-open after 30s)
 *   - Request timing & structured logging
 *   - Standardized error extraction from Square error format
 */

import { createComponentLogger } from "./logger";
import crypto from "crypto";

const log = createComponentLogger("square-client");

const SQUARE_BASE = "https://connect.squareup.com/v2";
const SQUARE_VERSION = "2024-12-18";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);

// ── Circuit Breaker ─────────────────────────────────────────────────────────

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

function recordSuccess(key: string) {
  const state = getCircuit(key);
  state.failures = 0;
  state.openedAt = null;
}

function recordFailure(key: string) {
  const state = getCircuit(key);
  const now = Date.now();
  // Reset counter if outside failure window
  if (now - state.lastFailure > CIRCUIT_FAILURE_WINDOW_MS) {
    state.failures = 0;
  }
  state.failures++;
  state.lastFailure = now;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openedAt = now;
    log.warn({ failures: CIRCUIT_FAILURE_THRESHOLD, windowS: CIRCUIT_FAILURE_WINDOW_MS / 1000 }, "circuit OPEN for venue");
  }
}

function isCircuitOpen(key: string): boolean {
  const state = getCircuit(key);
  if (!state.openedAt) return false;
  // Allow a test request after half-open period
  if (Date.now() - state.openedAt > CIRCUIT_HALF_OPEN_MS) {
    return false; // half-open: let one through
  }
  return true;
}

// ── Error extraction ────────────────────────────────────────────────────────

interface SquareError {
  status: number;
  message: string;
  code?: string;
  category?: string;
}

function extractError(status: number, data: any): SquareError {
  const err = data?.errors?.[0];
  return {
    status,
    message: err?.detail || err?.code || `HTTP ${status}`,
    code: err?.code,
    category: err?.category,
  };
}

// ── Client ──────────────────────────────────────────────────────────────────

export interface SquareResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: SquareError;
  durationMs: number;
}

export class SquareClient {
  private token: string;
  private locationId: string;
  private circuitKey: string;

  constructor(token: string, locationId: string) {
    this.token = token;
    this.locationId = locationId;
    this.circuitKey = `sq-${credentialFingerprint(token, locationId)}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    };
  }

  async get<T = any>(path: string): Promise<SquareResponse<T>> {
    return this.request<T>("GET", path);
  }

  async post<T = any>(path: string, body?: unknown): Promise<SquareResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  async put<T = any>(path: string, body?: unknown): Promise<SquareResponse<T>> {
    return this.request<T>("PUT", path, body);
  }

  async del<T = any>(path: string): Promise<SquareResponse<T>> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<SquareResponse<T>> {
    if (isCircuitOpen(this.circuitKey)) {
      return {
        ok: false,
        error: { status: 503, message: "Circuit breaker open — Square API temporarily unavailable. Will retry shortly." },
        durationMs: 0,
      };
    }

    const url = `${SQUARE_BASE}${path}`;
    const start = Date.now();
    let lastError: SquareError | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const res = await fetch(url, {
          method,
          headers: this.headers(),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });

        const durationMs = Date.now() - start;

        if (res.ok) {
          recordSuccess(this.circuitKey);
          // DELETE may return empty body
          if (res.status === 204 || res.headers.get("content-length") === "0") {
            return { ok: true, data: undefined as T, durationMs };
          }
          const data = await res.json();
          return { ok: true, data: data as T, durationMs };
        }

        const errData = await res.json().catch(() => ({}));
        lastError = extractError(res.status, errData);

        // Non-retryable error
        if (!RETRYABLE_STATUS.has(res.status)) {
          recordFailure(this.circuitKey);
          return { ok: false, error: lastError, durationMs };
        }

        // Retryable — log and continue
        log.warn({ method, path, status: res.status, attempt: attempt + 1, maxRetries: MAX_RETRIES }, "retryable error");
      } catch (e: any) {
        lastError = { status: 0, message: e.message || "Network error" };
        log.warn({ method, path, attempt: attempt + 1, maxRetries: MAX_RETRIES, err: e.message }, "network error");
      }
    }

    // All retries exhausted
    recordFailure(this.circuitKey);
    const durationMs = Date.now() - start;
    log.error({ method, path, maxRetries: MAX_RETRIES, durationMs }, "request FAILED after all retries");
    return { ok: false, error: lastError ?? { status: 0, message: "Max retries exceeded" }, durationMs };
  }

  /** Convenience: get the locationId this client was initialized with */
  getLocationId(): string {
    return this.locationId;
  }

  /** Convenience: get the raw token (for backward compat with helpers that need it) */
  getToken(): string {
    return this.token;
  }
}
