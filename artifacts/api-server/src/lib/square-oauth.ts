/**
 * Square OAuth token lifecycle — code exchange, refresh, revoke.
 *
 * Square issues 30-day access tokens (the authorize flow uses session=false)
 * together with a refresh token. Every stored connection carries the refresh
 * token and expiry so the credential cache can renew the access token before
 * it lapses instead of the venue silently disconnecting a month after setup.
 */

import { SQUARE_OAUTH_BASE, SQUARE_API_VERSION } from "./square-client";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("square-oauth");
const OAUTH_TIMEOUT_MS = 15_000;

export interface SquareTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** RFC3339 access-token expiry from Square, when provided. */
  expiresAt: string | null;
  merchantId: string;
}

export interface SquareTokenResult {
  ok: boolean;
  tokens?: SquareTokenSet;
  error?: string;
  status?: number;
}

function appCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SQUARE_APPLICATION_ID;
  const clientSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function tokenRequest(body: Record<string, unknown>): Promise<SquareTokenResult> {
  try {
    const res = await fetch(`${SQUARE_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok || typeof data.access_token !== "string") {
      const error = data.message || data.errors?.[0]?.detail || data.error_description || data.error || "Token request failed";
      return { ok: false, error: String(error), status: res.status };
    }
    return {
      ok: true,
      tokens: {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
        expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
        merchantId: typeof data.merchant_id === "string" ? data.merchant_id : "",
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Token request failed" };
  }
}

/** Exchange an authorization code for tokens (OAuth callback). */
export async function exchangeSquareAuthorizationCode(code: string, redirectUri: string): Promise<SquareTokenResult> {
  const app = appCredentials();
  if (!app) return { ok: false, error: "Square application credentials not configured" };
  return tokenRequest({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

/** Renew an access token. Square may rotate the refresh token; callers must store the returned one. */
export async function refreshSquareAccessToken(refreshToken: string): Promise<SquareTokenResult> {
  const app = appCredentials();
  if (!app) return { ok: false, error: "Square application credentials not configured" };
  const result = await tokenRequest({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (result.ok && result.tokens && !result.tokens.refreshToken) {
    // Square keeps the existing refresh token valid when it does not rotate it.
    result.tokens.refreshToken = refreshToken;
  }
  if (!result.ok) log.warn({ status: result.status, err: result.error }, "Square token refresh failed");
  return result;
}

/** Best-effort revoke on disconnect. */
export async function revokeSquareAccessToken(accessToken: string): Promise<void> {
  const app = appCredentials();
  if (!app) return;
  try {
    await fetch(`${SQUARE_OAUTH_BASE}/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
        Authorization: `Client ${app.clientSecret}`,
      },
      body: JSON.stringify({ client_id: app.clientId, access_token: accessToken }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch (e: any) {
    log.warn({ err: e?.message }, "Square token revoke failed");
  }
}

/** How long before expiry we proactively refresh (3 days). */
export const REFRESH_AHEAD_MS = Number(process.env.SQUARE_TOKEN_REFRESH_AHEAD_MS) || 3 * 24 * 60 * 60 * 1000;

/** True when an access token with this expiry should be refreshed now. */
export function shouldRefreshSquareToken(expiresAt: string | Date | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(at)) return false;
  return at - now <= REFRESH_AHEAD_MS;
}
