import { Router, type IRouter, Request, Response } from "express";
import crypto from "crypto";

const router: IRouter = Router();

const SQUARE_BASE = "https://connect.squareup.com/v2";
const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";

function squareHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  };
}

// ── In-memory state stores (TTL: 10 min) ─────────────────────────────────────

interface PendingState { timestamp: number }
interface PendingToken { token: string; merchantId: string; timestamp: number }

const pendingStates = new Map<string, PendingState>();
const pendingTokens = new Map<string, PendingToken>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingStates) if (v.timestamp < cutoff) pendingStates.delete(k);
  for (const [k, v] of pendingTokens) if (v.timestamp < cutoff) pendingTokens.delete(k);
}, 5 * 60 * 1000);

// ── OAuth routes ──────────────────────────────────────────────────────────────

// GET /api/square/oauth/authorize
// Returns { url, state } — client opens url in a popup
router.get("/oauth/authorize", (req: Request, res: Response): void => {
  const appId = process.env.SQUARE_APPLICATION_ID;
  if (!appId) { res.status(500).json({ error: "SQUARE_APPLICATION_ID not configured" }); return; }

  const state = crypto.randomUUID();
  pendingStates.set(state, { timestamp: Date.now() });

  const redirectUri = `https://${process.env.REPLIT_DEV_DOMAIN}/api/square/oauth/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    scope: "MERCHANT_PROFILE_READ ITEMS_READ ORDERS_WRITE",
    state,
    redirect_uri: redirectUri,
    session: "false",
  });

  res.json({ url: `${SQUARE_OAUTH_BASE}/authorize?${params}`, state });
});

// GET /api/square/oauth/callback?code=...&state=...
// Square redirects here after user authorizes. Exchanges code for token,
// stores it temporarily, then serves a page that postMessages to the opener.
router.get("/oauth/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.send(popupHtml(null, `Square authorization failed: ${error}`));
    return;
  }

  if (!state || !pendingStates.has(state)) {
    res.send(popupHtml(null, "Invalid or expired OAuth state. Please try again."));
    return;
  }
  pendingStates.delete(state);

  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  const redirectUri = `https://${process.env.REPLIT_DEV_DOMAIN}/api/square/oauth/callback`;

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
      res.send(popupHtml(null, msg));
      return;
    }

    const ts = crypto.randomUUID();
    pendingTokens.set(ts, {
      token: data.access_token,
      merchantId: data.merchant_id ?? "",
      timestamp: Date.now(),
    });

    res.send(popupHtml(ts, null));
  } catch (e: any) {
    res.send(popupHtml(null, e.message || "Unexpected error during token exchange"));
  }
});

// GET /api/square/oauth/token?ts=...
// Client polls this once after receiving tokenState from postMessage
router.get("/oauth/token", (req: Request, res: Response): void => {
  const { ts } = req.query as Record<string, string>;
  const pending = pendingTokens.get(ts);
  if (!pending) { res.status(404).json({ error: "Token not found or already claimed" }); return; }
  pendingTokens.delete(ts);
  res.json({ token: pending.token, merchantId: pending.merchantId });
});

// ── Popup HTML helper ─────────────────────────────────────────────────────────

function popupHtml(tokenState: string | null, error: string | null): string {
  const payload = tokenState
    ? JSON.stringify({ type: "square-oauth-success", tokenState })
    : JSON.stringify({ type: "square-oauth-error", error });

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
    <p>${tokenState ? "Closing window…" : (error ?? "Unknown error")}</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage(${payload}, '*');
      }
    } catch(e) {}
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>`;
}

// ── Square API proxy routes ───────────────────────────────────────────────────

// GET /api/square/locations
router.get("/locations", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  if (!token) { res.status(401).json({ error: "Missing Square access token" }); return; }

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

// GET /api/square/catalog
router.get("/catalog", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  if (!token) { res.status(401).json({ error: "Missing Square access token" }); return; }

  try {
    const response = await fetch(
      `${SQUARE_BASE}/catalog/list?types=ITEM&include_deleted_objects=false`,
      { headers: squareHeaders(token) }
    );

    const data = await response.json() as any;

    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to load catalog" });
      return;
    }

    const items: any[] = [];
    for (const obj of data.objects || []) {
      if (obj.type !== "ITEM") continue;
      const itemData = obj.item_data;
      if (!itemData) continue;

      for (const variation of itemData.variations || []) {
        const varData = variation.item_variation_data;
        if (!varData) continue;
        const priceMoney = varData.price_money;
        const price = priceMoney ? priceMoney.amount / 100 : 0;
        items.push({
          id: obj.id,
          variationId: variation.id,
          name: itemData.name,
          price,
          category: itemData.category_id,
          description: itemData.description || "",
        });
        break;
      }
    }

    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to load catalog" });
  }
});

// POST /api/square/orders
router.post("/orders", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  const locationId = req.headers["x-square-location"] as string;
  if (!token) { res.status(401).json({ error: "Missing Square access token" }); return; }
  if (!locationId) { res.status(400).json({ error: "Missing location ID" }); return; }

  try {
    const { items } = req.body;
    if (!items || items.length === 0) { res.status(400).json({ error: "No items provided" }); return; }

    const lineItems = items.map((item: any) => ({
      quantity: item.quantity.toString(),
      catalog_object_id: item.variationId || item.catalogItemId,
      base_price_money: item.variationId ? undefined : {
        amount: Math.round(item.price * 100),
        currency: "USD",
      },
    }));

    const idempotencyKey = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const response = await fetch(`${SQUARE_BASE}/orders`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        order: { location_id: locationId, line_items: lineItems },
      }),
    });

    const data = await response.json() as any;
    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to create order" });
      return;
    }

    res.json({
      success: true,
      orderId: data.order?.id,
      total: data.order?.total_money?.amount ? data.order.total_money.amount / 100 : 0,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to create order" });
  }
});

export default router;
