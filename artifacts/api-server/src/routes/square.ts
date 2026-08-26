import { Router, type IRouter, Request, Response } from "express";
import crypto from "crypto";
import { db, squareOAuthStatesTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { requireAuth } from "./auth";
import { ensureUserOrganization } from "./v1/_helpers";
import {
  peekPendingSquareOAuthToken,
  purgeExpiredSquareOAuthTokens,
  storePendingSquareOAuthToken,
} from "../lib/square-oauth-claims";

const router: IRouter = Router();

const SQUARE_BASE = "https://connect.squareup.com/v2";
const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";

function getRequestOrigin(req: Request): string | null {
  // Prefer forwarded headers for deployments behind reverse proxies/load balancers.
  const forwardedHost = req.get("x-forwarded-host");
  const forwardedProto = req.get("x-forwarded-proto");
  if (forwardedHost) {
    const proto = forwardedProto?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost.split(",")[0]?.trim()}`;
  }

  const host = req.get("host");
  if (!host) return null;

  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${host}`;
}

function getBrowserOrigin(req: Request): string | null {
  const rawOrigin = req.get("origin");
  const rawReferer = req.get("referer");
  const candidate = rawOrigin || rawReferer;
  if (!candidate) return null;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

function getRedirectUri(req?: Request): string {
  const explicitRedirectUri = process.env.SQUARE_REDIRECT_URI;
  if (explicitRedirectUri) return explicitRedirectUri;

  const explicitOrigin = process.env.PUBLIC_BASE_URL
    ?? process.env.PUBLIC_API_URL
    ?? process.env.APP_URL;

  if (explicitOrigin) {
    return `${explicitOrigin.replace(/\/$/, "")}/api/square/oauth/callback`;
  }

  const requestOrigin = req ? getRequestOrigin(req) : null;
  if (requestOrigin) {
    return `${requestOrigin}/api/square/oauth/callback`;
  }

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) {
    return `https://${railwayDomain}/api/square/oauth/callback`;
  }

  const domain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:8080";
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}/api/square/oauth/callback`;
}

function squareHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// ── In-memory state stores (TTL: 10 min) ─────────────────────────────────────

interface PendingState {
  timestamp: number;
  redirectUri: string;
  userId: number;
  organizationId: string | null;
  mode?: "redirect";
  returnUrl?: string;
  returnOrigin?: string;
}
const pendingStates = new Map<string, PendingState>();

async function storeOAuthState(state: string, pending: PendingState): Promise<void> {
  await db.insert(squareOAuthStatesTable).values({
    state,
    userId: pending.userId,
    organizationId: pending.organizationId,
    redirectUri: pending.redirectUri,
    mode: pending.mode ?? null,
    returnUrl: pending.returnUrl ?? null,
    returnOrigin: pending.returnOrigin ?? null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  }).catch(() => {});
  pendingStates.set(state, pending);
}

async function loadOAuthState(state: string): Promise<PendingState | undefined> {
  const cached = pendingStates.get(state);
  if (cached) return cached;
  const [row] = await db.select().from(squareOAuthStatesTable).where(eq(squareOAuthStatesTable.state, state)).limit(1);
  if (!row || row.expiresAt < new Date()) return undefined;
  const pending: PendingState = {
    timestamp: row.createdAt.getTime(),
    redirectUri: row.redirectUri,
    userId: row.userId,
    organizationId: row.organizationId,
    mode: row.mode ?? undefined,
    returnUrl: row.returnUrl ?? undefined,
    returnOrigin: row.returnOrigin ?? undefined,
  };
  pendingStates.set(state, pending);
  return pending;
}

async function deleteOAuthState(state: string): Promise<void> {
  pendingStates.delete(state);
  await db.delete(squareOAuthStatesTable).where(eq(squareOAuthStatesTable.state, state)).catch(() => {});
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingStates) if (v.timestamp < cutoff) pendingStates.delete(k);
  void purgeExpiredSquareOAuthTokens();
  void db.delete(squareOAuthStatesTable).where(lt(squareOAuthStatesTable.expiresAt, new Date())).catch(() => {});
}, 5 * 60 * 1000);

// ── OAuth routes ──────────────────────────────────────────────────────────────

// GET /api/square/oauth/authorize
// Default: returns { url, state } for popup flow.
// With ?mode=redirect&return_url=/path: redirects directly to Square OAuth,
// and the callback will redirect back to return_url with ?oauth_ts=<claim key>.
router.get("/oauth/authorize", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const appId = process.env.SQUARE_APPLICATION_ID;
  if (!appId) { res.status(500).json({ error: "SQUARE_APPLICATION_ID not configured" }); return; }
  const user = (req as any).user;
  const organizationId =
    (req as any).organization?.id ?? (await ensureUserOrganization(user)).id;

  const mode = req.query.mode as string | undefined;
  const returnUrl = req.query.return_url as string | undefined;
  const handoff = req.query.handoff as string | undefined;

  // Validate return_url to prevent open redirect attacks
  if (mode === "redirect") {
    if (!returnUrl || !returnUrl.startsWith("/") || returnUrl.includes("://") || returnUrl.includes("//")) {
      res.status(400).json({ error: "Invalid return_url — must be a relative path starting with /" });
      return;
    }
  }

  const state = crypto.randomUUID();
  const redirectUri = getRedirectUri(req);
  const pendingState: PendingState = {
    timestamp: Date.now(),
    redirectUri,
    userId: user.id,
    organizationId,
  };
  if (mode === "redirect" && returnUrl) {
    pendingState.mode = "redirect";
    pendingState.returnUrl = returnUrl;
    pendingState.returnOrigin = getBrowserOrigin(req) || undefined;
  }
  await storeOAuthState(state, pendingState);

  const params = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    scope: "MERCHANT_PROFILE_READ ITEMS_READ ITEMS_WRITE ORDERS_WRITE ORDERS_READ PAYMENTS_READ PAYMENTS_WRITE INVENTORY_READ INVENTORY_WRITE CUSTOMERS_READ CUSTOMERS_WRITE EMPLOYEES_READ TIMECARDS_READ TIMECARDS_WRITE DEVICE_CREDENTIAL_MANAGEMENT",
    state,
    redirect_uri: redirectUri,
    session: "false",
  });

  const oauthUrl = `${SQUARE_OAUTH_BASE}/authorize?${params}`;

  console.log(`[Square OAuth] authorize → redirect_uri=${redirectUri}`);

  if (mode === "redirect" && handoff !== "json") {
    // Full-page redirect — works in standalone PWA
    res.redirect(oauthUrl);
  } else {
    // Popup mode, or authenticated SPA handoff before full-page navigation.
    res.json({ url: oauthUrl, state, redirect_uri: redirectUri });
  }
});

// GET /api/square/oauth/callback?code=...&state=...
// Square redirects here after user authorizes. Exchanges code for token,
// stores it temporarily, then serves a page that postMessages to the opener.
router.get("/oauth/callback", async (req: Request, res: Response): Promise<void> => {
  console.log(`[Square OAuth] callback hit — code=${!!req.query.code} state=${!!req.query.state} error=${req.query.error || 'none'}`);
  const { code, state, error } = req.query as Record<string, string>;

  // Retrieve the pending state to check mode
  const pendingOAuthState = state ? await loadOAuthState(state) : undefined;
  const isRedirectMode = pendingOAuthState?.mode === "redirect";
  const returnUrl = pendingOAuthState?.returnUrl ?? "/";
  const returnTarget = pendingOAuthState?.returnOrigin
    ? `${pendingOAuthState.returnOrigin}${returnUrl}`
    : returnUrl;

  if (error) {
    if (isRedirectMode) {
      await deleteOAuthState(state);
      res.redirect(`${returnTarget}${returnTarget.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(error)}`);
    } else {
      res.send(popupHtml(null, `Square authorization failed: ${error}`));
    }
    return;
  }

  if (!state || !pendingOAuthState) {
    if (isRedirectMode) {
      res.redirect(`${returnTarget}${returnTarget.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent("Invalid or expired OAuth state")}`);
    } else {
      res.send(popupHtml(null, "Invalid or expired OAuth state. Please try again."));
    }
    return;
  }
  await deleteOAuthState(state);

  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  const redirectUri = pendingOAuthState.redirectUri || getRedirectUri(req);

  try {
    const tokenRes = await fetch(`${SQUARE_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": "2024-12-18" },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const data = await tokenRes.json() as any;

    if (!tokenRes.ok || !data.access_token) {
      const msg = data.message || data.errors?.[0]?.detail || "Token exchange failed";
      if (isRedirectMode) {
        // Full-page flows (onboarding, standalone PWA) must land back in the
        // app with oauth_error — a popup page here would strand the user.
        res.redirect(`${returnTarget}${returnTarget.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(msg)}`);
      } else {
        res.send(popupHtml(null, msg));
      }
      return;
    }

    const ts = await storePendingSquareOAuthToken({
      token: data.access_token,
      merchantId: data.merchant_id ?? "",
      userId: pendingOAuthState.userId,
      organizationId: pendingOAuthState.organizationId,
    });

    if (isRedirectMode) {
      // Redirect back to the app with claim key in URL
      res.redirect(`${returnTarget}${returnTarget.includes("?") ? "&" : "?"}oauth_ts=${encodeURIComponent(ts)}`);
    } else {
      res.send(popupHtml(ts, null));
    }
  } catch (e: any) {
    // Full detail (including the driver's cause) goes to the server log only.
    // The raw message can contain SQL parameters — never put it in a URL or
    // page the browser sees.
    console.error("[Square OAuth] callback failed:", e?.message ?? e, e?.cause ?? "");
    const safeMsg = "Could not save the Square connection. Please try again, and contact support if it keeps failing.";
    if (isRedirectMode) {
      res.redirect(`${returnTarget}${returnTarget.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(safeMsg)}`);
    } else {
      res.send(popupHtml(null, safeMsg));
    }
  }
});

// GET /api/square/oauth/token?ts=...
// Client claims OAuth metadata after callback. Square tokens stay server-side.
router.get("/oauth/token", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const { ts } = req.query as Record<string, string>;
  const user = (req as any).user;
  const organizationId =
    (req as any).organization?.id ?? (await ensureUserOrganization(user)).id;
  const pending = await peekPendingSquareOAuthToken({ claimId: ts, userId: user.id, organizationId });
  if (!pending) {
    res.status(404).json({ error: "Token not found, expired, or already claimed" });
    return;
  }
  res.json({ tokenState: ts, merchantId: pending.merchantId });
});

// ── Popup HTML helper ─────────────────────────────────────────────────────────

function popupHtml(tokenState: string | null, error: string | null): string {
  // Safely encode the payload for embedding in a <script> tag
  const payloadObj = tokenState
    ? { type: "square-oauth-success", tokenState }
    : { type: "square-oauth-error", error: error ?? "Unknown error" };
  // Use base64 encoding to avoid any HTML/JS injection issues
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${tokenState ? "Connecting…" : "Authorization Failed"}</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #e0e0e0;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    p { color: #999; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${tokenState ? "✅" : "❌"}</div>
    <h2>${tokenState ? "Connected!" : "Authorization Failed"}</h2>
    <p>${tokenState ? "Closing window…" : "Something went wrong. Please try again."}</p>
  </div>
  <script>
    try {
      var payload = JSON.parse(atob("${payloadB64}"));
      // Primary: write to localStorage (works reliably since popup callback is same-origin)
      // The parent window polls for this key.
      localStorage.setItem("voycelab_oauth_result", JSON.stringify(payload));
      // Secondary: also try postMessage in case window.opener survived cross-origin nav
      if (window.opener) {
        window.opener.postMessage(payload, '*');
      }
    } catch(e) { console.error('OAuth signal failed', e); }
    setTimeout(function() { try { window.close(); } catch(e) {} }, 1500);
  </script>
</body>
</html>`;
}

// Remaining Square helper routes require a VoyceLab session. OAuth callback
// routes above stay public because Square redirects to them server-to-server.
router.use(requireAuth as any);

function legacySquareProxyDisabled(res: Response): void {
  res.status(410).json({
    error: "legacy_square_proxy_disabled",
    message: "Square credentials are server-managed. Use /api/venues routes for catalog, orders, devices, and terminal actions.",
  });
}

// ── Square API proxy routes ───────────────────────────────────────────────────

// GET /api/square/locations
router.get("/locations", async (req: Request, res: Response): Promise<void> => {
  const claimId = typeof req.query.oauth_ts === "string" ? req.query.oauth_ts : "";
  if (!claimId) {
    res.status(400).json({ error: "oauth_ts is required" });
    return;
  }
  const user = (req as any).user;
  const organizationId =
    (req as any).organization?.id ?? (await ensureUserOrganization(user)).id;
  const pending = await peekPendingSquareOAuthToken({ claimId, userId: user.id, organizationId });
  const token = pending?.token;
  if (!token) { res.status(404).json({ error: "Square connection expired. Please connect again." }); return; }

  try {
    const response = await fetch(`${SQUARE_BASE}/locations`, {
      headers: squareHeaders(token),
    });
    const data = await response.json() as any;

    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to load locations" });
      return;
    }

    const locations = (data.locations || []).map((loc: any) => ({
      id: loc.id,
      name: loc.name,
      address: loc.address
        ? [loc.address.address_line_1, loc.address.locality, loc.address.administrative_district_level_1]
            .filter(Boolean).join(", ")
        : undefined,
    }));

    res.json({ locations });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to load locations" });
  }
});

// Legacy endpoint: catalog now uses authenticated /api/venues/:id/catalog.
router.get("/catalog", async (_req: Request, res: Response): Promise<void> => {
  legacySquareProxyDisabled(res);
});

// GET /api/square/orders/recent — search Square for orders at this location
router.get("/orders/recent", async (_req: Request, res: Response): Promise<void> => {
  legacySquareProxyDisabled(res);
});

// Legacy endpoint: order creation now uses authenticated /api/venues/:id/orders.
router.post("/orders", async (_req: Request, res: Response): Promise<void> => {
  legacySquareProxyDisabled(res);
});

// Legacy Square Terminal / Device endpoints ────────────────────────────────────────

// GET /api/square/devices — list paired Square Terminal devices at the location
router.get("/devices", async (_req: Request, res: Response): Promise<void> => {
  legacySquareProxyDisabled(res);
});

// POST /api/square/terminal/checkout — push a checkout to a Terminal device
router.post("/terminal/checkout", async (_req: Request, res: Response): Promise<void> => {
  legacySquareProxyDisabled(res);
});

// GET /api/square/terminal/checkout/:id — check status of a terminal checkout
router.get("/terminal/checkout/:id", async (_req: Request, res: Response): Promise<void> => {
  legacySquareProxyDisabled(res);
});

export default router;
