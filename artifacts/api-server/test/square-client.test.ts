import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SquareClient,
  SQUARE_API_VERSION,
  extractSquareError,
  getSquareClient,
  resetSquareCircuits,
} from "../src/lib/square-client";

type MockResponse = { status: number; body?: unknown; headers?: Record<string, string> };

function makeFetch(responses: MockResponse[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more mock responses");
    if (next.status === -1) {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      throw err;
    }
    // Status codes like 204 must carry a null body per the Fetch spec.
    const text = next.body === undefined ? null : JSON.stringify(next.body);
    return new Response(text, {
      status: next.status,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("SquareClient", () => {
  beforeEach(() => {
    resetSquareCircuits();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the pinned Square-Version and bearer token", async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: { ok: 1 } }]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.get("/locations");
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ ok: 1 });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Square-Version"]).toBe(SQUARE_API_VERSION);
    expect(headers.Authorization).toBe("Bearer tok");
    expect(calls[0].url).toBe("https://connect.squareup.com/v2/locations");
  });

  it("retries transient failures and succeeds", async () => {
    const { fetchImpl, calls } = makeFetch([
      { status: 503, body: { errors: [{ code: "SERVICE_UNAVAILABLE" }] } },
      { status: 200, body: { orders: [] } },
    ]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.post("/orders/search", { limit: 1 });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("does not retry 4xx and returns the Square error detail", async () => {
    const { fetchImpl, calls } = makeFetch([
      { status: 400, body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "BAD_REQUEST", detail: "quantity is invalid" }] } },
    ]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.post("/orders", {});
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("quantity is invalid");
    expect(res.error?.code).toBe("BAD_REQUEST");
    expect(calls).toHaveLength(1);
  });

  it("returns a speakable timeout error after exhausting retries", async () => {
    const { fetchImpl, calls } = makeFetch([{ status: -1 }, { status: -1 }, { status: -1 }]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.get("/catalog/list");
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/did not respond in time/);
    expect(calls).toHaveLength(3);
  });

  it("opens the circuit after repeated failures and fails fast", async () => {
    const responses: MockResponse[] = [];
    for (let i = 0; i < 20; i++) responses.push({ status: 500, body: {} });
    const { fetchImpl, calls } = makeFetch(responses);
    const client = new SquareClient("tok", "LOC-circuit", fetchImpl);
    // 5 failed requests (each retried 3x) trip the breaker.
    for (let i = 0; i < 5; i++) await client.get("/x");
    const before = calls.length;
    const res = await client.get("/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(res.error?.message).toMatch(/temporarily unavailable/);
    expect(calls.length).toBe(before);
  });

  it("follows cursors across pages", async () => {
    const { fetchImpl, calls } = makeFetch([
      { status: 200, body: { objects: [{ id: "a" }], cursor: "c1" } },
      { status: 200, body: { objects: [{ id: "b" }] } },
    ]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.getAllPages("/catalog/list?types=ITEM", (p: { objects?: unknown[] }) => p.objects ?? []);
    expect(res.ok).toBe(true);
    expect(res.items.map((o: any) => o.id)).toEqual(["a", "b"]);
    expect(calls[1].url).toContain("cursor=c1");
  });

  it("caps paginated searches at maxItems", async () => {
    const { fetchImpl } = makeFetch([
      { status: 200, body: { orders: [1, 2, 3], cursor: "c1" } },
      { status: 200, body: { orders: [4, 5, 6], cursor: "c2" } },
    ]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.postAllPages("/orders/search", {}, (p: { orders?: unknown[] }) => p.orders ?? [], 4);
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(true);
    expect(res.items).toEqual([1, 2, 3, 4]);
  });

  it("handles empty 204 bodies", async () => {
    const { fetchImpl } = makeFetch([{ status: 204 }]);
    const client = new SquareClient("tok", "LOC1", fetchImpl);
    const res = await client.del("/catalog/object/X");
    expect(res.ok).toBe(true);
    expect(res.data).toBeUndefined();
  });

  it("memoizes clients per credential", () => {
    const a = getSquareClient("tok", "LOC1");
    const b = getSquareClient("tok", "LOC1");
    const c = getSquareClient("tok", "LOC2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("extractSquareError", () => {
  it("falls back to code then HTTP status", () => {
    expect(extractSquareError(401, { errors: [{ code: "UNAUTHORIZED", category: "AUTHENTICATION_ERROR" }] })).toMatchObject({
      status: 401,
      message: "UNAUTHORIZED",
      category: "AUTHENTICATION_ERROR",
    });
    expect(extractSquareError(502, {}).message).toBe("HTTP 502");
  });
});
