import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_AHEAD_MS, refreshSquareAccessToken, shouldRefreshSquareToken } from "../src/lib/square-oauth";

describe("shouldRefreshSquareToken", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");

  it("is false without an expiry", () => {
    expect(shouldRefreshSquareToken(null, now)).toBe(false);
    expect(shouldRefreshSquareToken("not a date", now)).toBe(false);
  });

  it("refreshes inside the look-ahead window and after expiry", () => {
    const soon = new Date(now + REFRESH_AHEAD_MS - 1000).toISOString();
    const later = new Date(now + REFRESH_AHEAD_MS + 60_000).toISOString();
    const past = new Date(now - 1000);
    expect(shouldRefreshSquareToken(soon, now)).toBe(true);
    expect(shouldRefreshSquareToken(later, now)).toBe(false);
    expect(shouldRefreshSquareToken(past, now)).toBe(true);
  });
});

describe("refreshSquareAccessToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SQUARE_APPLICATION_ID;
    delete process.env.SQUARE_APPLICATION_SECRET;
  });

  it("fails cleanly when app credentials are missing", async () => {
    const res = await refreshSquareAccessToken("r1");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/);
  });

  it("posts a refresh grant and keeps the old refresh token when Square does not rotate it", async () => {
    process.env.SQUARE_APPLICATION_ID = "app";
    process.env.SQUARE_APPLICATION_SECRET = "secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new-token", expires_at: "2026-10-01T00:00:00Z", merchant_id: "M1" }), { status: 200 }),
    );
    const res = await refreshSquareAccessToken("r1");
    expect(res.ok).toBe(true);
    expect(res.tokens).toEqual({ accessToken: "new-token", refreshToken: "r1", expiresAt: "2026-10-01T00:00:00Z", merchantId: "M1" });
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("r1");
  });

  it("surfaces Square's error and status on failure", async () => {
    process.env.SQUARE_APPLICATION_ID = "app";
    process.env.SQUARE_APPLICATION_SECRET = "secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Not authorized", type: "service.not_authorized" }), { status: 401 }),
    );
    const res = await refreshSquareAccessToken("r1");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toBe("Not authorized");
  });
});
