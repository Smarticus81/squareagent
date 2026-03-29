import { Router, type IRouter, Request, Response } from "express";
import crypto from "crypto";

const router: IRouter = Router();

const SQUARE_BASE = "https://connect.squareup.com/v2";
const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";

function getRedirectUri(): string {
  const explicitOrigin = process.env.PUBLIC_BASE_URL
    ?? process.env.PUBLIC_API_URL
    ?? process.env.APP_URL;

  if (explicitOrigin) {
    return `${explicitOrigin.replace(/\/$/, "")}/api/square/oauth/callback`;
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

interface PendingState { timestamp: number; mode?: "redirect"; returnUrl?: string }
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
// Default: returns { url, state } for popup flow.
// With ?mode=redirect&return_url=/path: redirects directly to Square OAuth,
// and the callback will redirect back to return_url with ?oauth_ts=<claim key>.
router.get("/oauth/authorize", (req: Request, res: Response): void => {
  const appId = process.env.SQUARE_APPLICATION_ID;
  if (!appId) { res.status(500).json({ error: "SQUARE_APPLICATION_ID not configured" }); return; }

  const mode = req.query.mode as string | undefined;
  const returnUrl = req.query.return_url as string | undefined;

  // Validate return_url to prevent open redirect attacks
  if (mode === "redirect") {
    if (!returnUrl || !returnUrl.startsWith("/") || returnUrl.includes("://") || returnUrl.includes("//")) {
      res.status(400).json({ error: "Invalid return_url — must be a relative path starting with /" });
      return;
    }
  }

  const state = crypto.randomUUID();
  const pendingState: PendingState = { timestamp: Date.now() };
  if (mode === "redirect" && returnUrl) {
    pendingState.mode = "redirect";
    pendingState.returnUrl = returnUrl;
  }
  pendingStates.set(state, pendingState);

  const redirectUri = getRedirectUri();
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

  if (mode === "redirect") {
    // Full-page redirect — works in standalone PWA
    res.redirect(oauthUrl);
  } else {
    // Popup mode — client opens URL in window.open()
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
  const pendingOAuthState = state ? pendingStates.get(state) : undefined;
  const isRedirectMode = pendingOAuthState?.mode === "redirect";
  const returnUrl = pendingOAuthState?.returnUrl ?? "/";

  if (error) {
    if (isRedirectMode) {
      pendingStates.delete(state);
      res.redirect(`${returnUrl}${returnUrl.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(error)}`);
    } else {
      res.send(popupHtml(null, `Square authorization failed: ${error}`));
    }
    return;
  }

  if (!state || !pendingOAuthState) {
    if (isRedirectMode) {
      res.redirect(`${returnUrl}${returnUrl.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent("Invalid or expired OAuth state")}`);
    } else {
      res.send(popupHtml(null, "Invalid or expired OAuth state. Please try again."));
    }
    return;
  }
  pendingStates.delete(state);

  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  const redirectUri = getRedirectUri();

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

    if (isRedirectMode) {
      // Redirect back to the app with claim key in URL
      res.redirect(`${returnUrl}${returnUrl.includes("?") ? "&" : "?"}oauth_ts=${encodeURIComponent(ts)}`);
    } else {
      res.send(popupHtml(ts, null));
    }
  } catch (e: any) {
    if (isRedirectMode) {
      res.redirect(`${returnUrl}${returnUrl.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(e.message || "Unexpected error")}`);
    } else {
      res.send(popupHtml(null, e.message || "Unexpected error during token exchange"));
    }
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
      localStorage.setItem("bevpro_oauth_result", JSON.stringify(payload));
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
    const items: any[] = [];
    let cursor: string | undefined;

    // Follow pagination cursors so all items load regardless of catalog size
    do {
      const url = `${SQUARE_BASE}/catalog/list?types=ITEM&include_deleted_objects=false${cursor ? `&cursor=${cursor}` : ""}`;
      const response = await fetch(url, { headers: squareHeaders(token) });
      const data = await response.json() as any;

      if (!response.ok) {
        res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to load catalog" });
        return;
      }

      for (const obj of data.objects || []) {
        if (obj.type !== "ITEM") continue;
        const itemData = obj.item_data;
        if (!itemData) continue;

        const variations = itemData.variations || [];
        if (variations.length === 0) continue;

        if (variations.length === 1) {
          // Single variation — use item name directly
          const varData = variations[0].item_variation_data;
          const price = varData?.price_money ? varData.price_money.amount / 100 : 0;
          items.push({
            id: obj.id,
            variationId: variations[0].id,
            name: itemData.name,
            price,
            category: itemData.category_id,
            description: itemData.description || "",
          });
        } else {
          // Multiple variations (e.g. Small/Medium/Large) — add each as its own item
          for (const variation of variations) {
            const varData = variation.item_variation_data;
            if (!varData) continue;
            const price = varData.price_money ? varData.price_money.amount / 100 : 0;
            const varName = varData.name && varData.name !== "Regular"
              ? `${itemData.name} (${varData.name})`
              : itemData.name;
            items.push({
              id: obj.id,
              variationId: variation.id,
              name: varName,
              price,
              category: itemData.category_id,
              description: itemData.description || "",
            });
          }
        }
      }

      cursor = data.cursor;
    } while (cursor);

    console.log(`[Square] Catalog loaded: ${items.length} items`);
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to load catalog" });
  }
});

// GET /api/square/orders/recent — search Square for orders at this location
router.get("/orders/recent", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  const locationId = req.headers["x-square-location"] as string;
  if (!token) { res.status(401).json({ error: "Missing token" }); return; }
  if (!locationId) { res.status(400).json({ error: "Missing location" }); return; }

  try {
    const response = await fetch(`${SQUARE_BASE}/orders/search`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        location_ids: [locationId],
        query: { sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
        limit: 10,
      }),
    });
    const data = await response.json() as any;
    console.log("[Square] Recent orders search:", JSON.stringify(data).slice(0, 500));
    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Search failed", raw: data });
      return;
    }
    res.json({
      count: data.orders?.length ?? 0,
      orders: (data.orders || []).map((o: any) => ({
        id: o.id,
        state: o.state,
        source: o.source?.name,
        total: o.total_money?.amount,
        created_at: o.created_at,
        location_id: o.location_id,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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

    // Verify which merchant account this token belongs to before creating the order
    const merchantRes = await fetch(`${SQUARE_BASE}/merchants/me`, { headers: squareHeaders(token) });
    const merchantData = await merchantRes.json() as any;
    const merchant = merchantData.merchant;
    console.log("[Square] Token belongs to merchant:", merchant?.business_name, "| id:", merchant?.id, "| country:", merchant?.country, "| status:", merchant?.status);

    console.log("[Square] Creating order — location:", locationId, "items:", JSON.stringify(lineItems));

    const ticketRef = `VOICE-${Date.now()}`;
    const response = await fetch(`${SQUARE_BASE}/orders`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        order: {
          location_id: locationId,
          reference_id: ticketRef,
          line_items: lineItems,
        },
      }),
    });

    const data = await response.json() as any;
    if (!response.ok) {
      const errMsg = data.errors?.[0]?.detail || "Failed to create order";
      console.error("[Square] Order failed:", JSON.stringify(data.errors));
      res.status(response.status).json({ error: errMsg });
      return;
    }

    const orderId = data.order?.id;
    const orderTotal = data.order?.total_money?.amount ?? 0;
    console.log("[Square] Order created:", orderId, "| state:", data.order?.state, "| total:", orderTotal);

    // Create an external payment to mark the order as a completed transaction
    // so it appears in Square's sales reports and transaction history
    const paymentRes = await fetch(`${SQUARE_BASE}/payments`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        idempotency_key: `payment-${orderId}`,
        source_id: "EXTERNAL",
        amount_money: { amount: orderTotal, currency: "USD" },
        order_id: orderId,
        location_id: locationId,
        external_details: {
          type: "OTHER",
          source: "Pre-paid Event Package",
        },
        note: "Voice order — pre-paid event package",
      }),
    });

    const paymentData = await paymentRes.json() as any;
    const paymentError = !paymentRes.ok
      ? paymentData.errors?.[0]?.detail || "Order created but external payment could not be recorded"
      : null;

    if (paymentError) {
      console.warn("[Square] Payment failed (order still created):", JSON.stringify(paymentData.errors));
    } else {
      console.log("[Square] Payment created:", paymentData.payment?.id, "| status:", paymentData.payment?.status);
    }

    res.json({
      success: true,
      orderId,
      total: orderTotal / 100,
      paymentRecorded: !paymentError,
      paymentId: paymentData.payment?.id,
      warning: paymentError,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to create order" });
  }
});

// ── Square Terminal / Device endpoints ────────────────────────────────────────

// GET /api/square/devices — list paired Square Terminal devices at the location
router.get("/devices", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  const locationId = req.headers["x-square-location"] as string;
  if (!token) { res.status(401).json({ error: "Missing Square access token" }); return; }

  try {
    // List all devices associated with the merchant
    const url = new URL(`${SQUARE_BASE}/devices`);
    if (locationId) {
      // Filter to devices at this location via query param
      url.searchParams.set("location_id", locationId);
    }
    const response = await fetch(url.toString(), {
      headers: squareHeaders(token),
    });
    const data = await response.json() as any;

    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to list devices" });
      return;
    }

    const devices = (data.devices || []).map((dev: any) => ({
      id: dev.id,
      name: dev.name || dev.attributes?.name || "Square Terminal",
      type: dev.attributes?.type || "TERMINAL",
      status: dev.status?.category || "UNKNOWN",
      locationId: dev.location_id,
      serialNumber: dev.attributes?.serial_number,
    }));

    console.log(`[Square] Devices listed: ${devices.length}`);
    res.json({ devices });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to list devices" });
  }
});

// POST /api/square/terminal/checkout — push a checkout to a Terminal device
router.post("/terminal/checkout", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  const locationId = req.headers["x-square-location"] as string;
  if (!token) { res.status(401).json({ error: "Missing Square access token" }); return; }
  if (!locationId) { res.status(400).json({ error: "Missing location ID" }); return; }

  const { deviceId, orderId, amountCents, note } = req.body;
  if (!deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }
  if (!amountCents && !orderId) { res.status(400).json({ error: "orderId or amountCents required" }); return; }

  try {
    const checkoutBody: Record<string, unknown> = {
      amount_money: { amount: amountCents || 0, currency: "USD" },
      device_options: {
        device_id: deviceId,
        skip_receipt_screen: false,
        collect_signature: false,
      },
      reference_id: `VOICE-TERMINAL-${Date.now()}`,
      note: note || "Voice order — tap/insert/swipe card",
    };
    if (orderId) checkoutBody.order_id = orderId;

    const response = await fetch(`${SQUARE_BASE}/terminals/checkouts`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        idempotency_key: `terminal-${orderId || Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        checkout: checkoutBody,
      }),
    });
    const data = await response.json() as any;

    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Terminal checkout failed" });
      return;
    }

    console.log(`[Square] Terminal checkout created: ${data.checkout?.id} → device ${deviceId}`);
    res.json({
      success: true,
      checkoutId: data.checkout?.id,
      status: data.checkout?.status,
      deviceId,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Terminal checkout failed" });
  }
});

// GET /api/square/terminal/checkout/:id — check status of a terminal checkout
router.get("/terminal/checkout/:id", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-square-token"] as string;
  if (!token) { res.status(401).json({ error: "Missing Square access token" }); return; }

  try {
    const response = await fetch(`${SQUARE_BASE}/terminals/checkouts/${req.params.id}`, {
      headers: squareHeaders(token),
    });
    const data = await response.json() as any;

    if (!response.ok) {
      res.status(response.status).json({ error: data.errors?.[0]?.detail || "Failed to get checkout" });
      return;
    }

    res.json({
      checkoutId: data.checkout?.id,
      status: data.checkout?.status,
      orderId: data.checkout?.order_id,
      paymentIds: data.checkout?.payment_ids,
      amountMoney: data.checkout?.amount_money,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to get checkout status" });
  }
});

export default router;
