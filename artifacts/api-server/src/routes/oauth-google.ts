/**
 * Google OAuth2 flow for Gmail send access.
 *
 * - GET  /api/oauth/google/start    (auth required)  -> { url } popup target
 *                                                         user approves Gmail send scope
 * - GET  /api/oauth/google/callback                  -> token exchange + DB write,
 *                                                       redirects to frontend with result
 *
 * The callback redirects to the frontend origin (not the API origin) so the popup
 * shares the same origin as the parent window. This lets postMessage and localStorage
 * work in both local dev (Vite on :5173, API on :8080) and production (single server).
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
  const port = process.env.PORT ?? "8080";
  return `http://localhost:${port}/api/oauth/google/callback`;
}

function getFrontendOrigin(req: Request): string {
  const explicit = process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_API_URL ?? process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  const referer = req.headers.referer;
  if (referer) {
    try { return new URL(referer).origin; } catch {}
  }
  return `http://localhost:${process.env.PORT ?? "8080"}`;
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

// ── GET /api/oauth/google/start ──────────────────────────────────────────────

router.get("/start", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const client = getOAuthClient();
    const userId = (req as any).user.id as number;
    const fromAddress = typeof req.query.from === "string" ? req.query.from.trim() : "";
    const fromName = typeof req.query.fromName === "string" ? req.query.fromName.trim() : "";

    const frontendOrigin = getFrontendOrigin(req);

    const state = jwt.sign(
      { uid: userId, fromAddress, fromName, kind: "gmail-oauth", frontendOrigin },
      process.env.JWT_SECRET ?? "dev-secret",
      { expiresIn: STATE_TTL_SECONDS },
    );

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
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
  const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;

  interface OAuthClaim { uid: number; fromAddress?: string; fromName?: string; frontendOrigin?: string }
  let claim: OAuthClaim | null = null;
  if (state) {
    try {
      claim = jwt.verify(state, process.env.JWT_SECRET ?? "dev-secret") as OAuthClaim;
    } catch {}
  }

  const frontendOrigin = claim?.frontendOrigin ?? getFrontendOrigin(req);

  function redirectWithResult(result: { ok: boolean; email?: string; error?: string }) {
    const params = new URLSearchParams();
    params.set("gmail_oauth_result", JSON.stringify({ type: "gmail-oauth-result", ...result }));
    res.redirect(`${frontendOrigin}/data-sources?${params.toString()}`);
  }

  if (oauthError) {
    redirectWithResult({ ok: false, error: oauthError });
    return;
  }
  if (!code || !state) {
    redirectWithResult({ ok: false, error: "Missing code or state" });
    return;
  }

  if (!claim || !claim.uid) {
    redirectWithResult({ ok: false, error: "Invalid or expired state" });
    return;
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      redirectWithResult({
        ok: false,
        error: "Google did not return a refresh token. Revoke VoyceLab access in your Google Account and reconnect.",
      });
      return;
    }
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();
    const email = profile.data.email ?? claim.fromAddress;
    if (!email) {
      redirectWithResult({ ok: false, error: "Could not resolve Gmail address" });
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

    redirectWithResult({ ok: true, email });
  } catch (e: any) {
    console.error("[Gmail OAuth] callback error:", e?.message ?? e);
    redirectWithResult({ ok: false, error: e?.message ?? "Token exchange failed" });
  }
});

export default router;
