/**
 * Google OAuth2 flow for Gmail send access.
 *
 * - GET  /api/oauth/google/start    (auth required)  -> { url } popup target
 *                                                         user approves Gmail send scope
 * - GET  /api/oauth/google/callback                  -> token exchange + DB write,
 *                                                       returns popup HTML that
 *                                                       posts result to opener
 *
 * Refresh tokens are encrypted at rest in email_credentials.oauth_refresh_token.
 * The send_email tool (provider=gmail_oauth) uses googleapis to mint short-lived
 * access tokens on demand.
 */

import { Router, type IRouter, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import { db, emailCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { encrypt } from "../lib/secrets";

const router: IRouter = Router();

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

const STATE_TTL_SECONDS = 10 * 60;

function getRedirectUri(): string {
  const explicit =
    process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_API_URL ?? process.env.APP_URL;
  if (explicit) return `${explicit.replace(/\/$/, "")}/api/oauth/google/callback`;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/oauth/google/callback`;
  }
  const domain = process.env.REPLIT_DEV_DOMAIN ?? `localhost:${process.env.PORT ?? 8080}`;
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}/api/oauth/google/callback`;
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

function popupHtml(payload: { ok: true; email: string } | { ok: false; error: string }): string {
  const payloadB64 = Buffer.from(JSON.stringify({ type: "gmail-oauth-result", ...payload })).toString("base64");
  const ok = payload.ok;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${ok ? "Gmail connected" : "Gmail authorization failed"}</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #FBF7F1; color: #0E1B2C;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    p { color: rgba(14,27,44,0.62); margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${ok ? "✅" : "❌"}</div>
    <h2>${ok ? "Gmail connected!" : "Authorization failed"}</h2>
    <p>${ok ? "Closing window…" : "You can close this window and try again."}</p>
  </div>
  <script>
    try {
      var payload = JSON.parse(atob("${payloadB64}"));
      localStorage.setItem("voycelab_gmail_oauth_result", JSON.stringify(payload));
      if (window.opener) { window.opener.postMessage(payload, '*'); }
    } catch(e) { console.error('Gmail OAuth signal failed', e); }
    setTimeout(function() { try { window.close(); } catch(e) {} }, 1500);
  </script>
</body>
</html>`;
}

// ── GET /api/oauth/google/start ──────────────────────────────────────────────
// Requires auth. Returns a Google consent URL the client opens in a popup.

router.get("/start", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const client = getOAuthClient();
    const userId = (req as any).user.id as number;
    const fromAddress = typeof req.query.from === "string" ? req.query.from.trim() : "";
    const fromName = typeof req.query.fromName === "string" ? req.query.fromName.trim() : "";

    const state = jwt.sign(
      { uid: userId, fromAddress, fromName, kind: "gmail-oauth" },
      process.env.JWT_SECRET ?? "dev-secret",
      { expiresIn: STATE_TTL_SECONDS },
    );

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // force a refresh token even on subsequent connects
      scope: GMAIL_SCOPES,
      state,
      include_granted_scopes: true,
    });

    res.json({ url });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Failed to start Gmail OAuth" });
  }
});

// ── GET /api/oauth/google/callback ───────────────────────────────────────────

router.get("/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) {
    res.status(400).send(popupHtml({ ok: false, error }));
    return;
  }
  if (!code || !state) {
    res.status(400).send(popupHtml({ ok: false, error: "Missing code or state" }));
    return;
  }

  let claim: { uid: number; fromAddress?: string; fromName?: string };
  try {
    claim = jwt.verify(state, process.env.JWT_SECRET ?? "dev-secret") as any;
    if (!claim.uid) throw new Error("Invalid state payload");
  } catch (e: any) {
    res.status(400).send(popupHtml({ ok: false, error: "Invalid or expired state" }));
    return;
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      res.status(400).send(popupHtml({
        ok: false,
        error: "Google did not return a refresh token. Revoke VoyceLab access in your Google Account and reconnect.",
      }));
      return;
    }
    client.setCredentials(tokens);

    // Resolve the authenticated Gmail address.
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();
    const email = profile.data.email ?? claim.fromAddress;
    if (!email) {
      res.status(400).send(popupHtml({ ok: false, error: "Could not resolve Gmail address" }));
      return;
    }

    const encryptedRefresh = encrypt(tokens.refresh_token);
    const fromAddress = email;
    const fromName = claim.fromName?.trim() || null;

    const existing = await db
      .select()
      .from(emailCredentialsTable)
      .where(eq(emailCredentialsTable.userId, claim.uid))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(emailCredentialsTable)
        .set({
          provider: "gmail_oauth",
          apiKey: null,
          smtpHost: null,
          smtpPort: null,
          smtpUser: null,
          smtpPass: null,
          oauthRefreshToken: encryptedRefresh,
          fromAddress,
          fromName,
          updatedAt: new Date(),
        })
        .where(eq(emailCredentialsTable.id, existing[0].id));
    } else {
      await db.insert(emailCredentialsTable).values({
        userId: claim.uid,
        provider: "gmail_oauth",
        oauthRefreshToken: encryptedRefresh,
        fromAddress,
        fromName,
      });
    }

    res.send(popupHtml({ ok: true, email }));
  } catch (e: any) {
    console.error("[Gmail OAuth] callback error:", e?.message ?? e);
    res.status(500).send(popupHtml({ ok: false, error: e?.message ?? "Token exchange failed" }));
  }
});

export default router;
