/**
 * Outbound email tool. Supports Resend (REST), Gmail (SMTP via app password),
 * and generic SMTP. The assistant should always read back recipient, subject,
 * and a 1-line summary before calling this tool — the tool sends immediately
 * with no draft step.
 */

import { db, emailCredentialsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import { decrypt } from "../../lib/secrets";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";

/**
 * In-memory rate limiter — caps sends per user per rolling hour. Survives
 * cold-starts only weakly, but it's defense against a runaway voice loop.
 */
const SEND_LIMIT_PER_HOUR = 15;
const sendLog = new Map<number, number[]>();

function tenantWhere(userId: number, organizationId?: string | null) {
  return organizationId
    ? or(
        eq(emailCredentialsTable.organizationId, organizationId),
        and(eq(emailCredentialsTable.userId, userId), isNull(emailCredentialsTable.organizationId)),
      )
    : eq(emailCredentialsTable.userId, userId);
}

function checkSendLimit(userId: number): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const arr = (sendLog.get(userId) ?? []).filter((t) => t > hourAgo);
  if (arr.length >= SEND_LIMIT_PER_HOUR) {
    const oldest = arr[0];
    return { allowed: false, remaining: 0, resetMs: oldest + 60 * 60 * 1000 - now };
  }
  arr.push(now);
  sendLog.set(userId, arr);
  return { allowed: true, remaining: SEND_LIMIT_PER_HOUR - arr.length, resetMs: 0 };
}

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "send_email",
    description:
      "Send an email from the user's configured outbound address. ALWAYS confirm recipient, subject, and a one-line body summary out loud before calling this tool.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Subject line" },
        body: { type: "string", description: "Plain-text body of the email" },
        cc: { type: "string", description: "Optional CC address" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

async function sendEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.userId) return { result: "send_email: missing user context." };
  if (!db) return { result: "send_email: database is not configured." };

  const to = String(args.to ?? "").trim();
  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!to || !subject || !body) return { result: "send_email: to, subject, and body are required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { result: `send_email: ${to} is not a valid email address.` };

  const limit = checkSendLimit(ctx.userId);
  if (!limit.allowed) {
    const mins = Math.ceil(limit.resetMs / 60_000);
    return { result: `send_email: hourly limit (${SEND_LIMIT_PER_HOUR}) reached. Try again in ${mins} minute(s).` };
  }

  const [creds] = await db
    .select()
    .from(emailCredentialsTable)
    .where(tenantWhere(ctx.userId, ctx.organizationId))
    .limit(1);
  if (!creds) {
    return { result: "send_email: no email credentials configured. Add a Resend API key in the dashboard." };
  }

  if (creds.provider === "resend") {
    if (!creds.apiKey) return { result: "send_email: Resend API key is missing." };
    const apiKey = decrypt(creds.apiKey);
    const cc = args.cc ? String(args.cc).trim() : undefined;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress,
          to: [to],
          ...(cc ? { cc: [cc] } : {}),
          subject,
          text: body,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        return { result: `send_email failed (Resend ${res.status}): ${detail.slice(0, 200)}` };
      }
      const data = (await res.json()) as { id?: string };
      return { result: `Email sent to ${to} (id=${data.id ?? "unknown"}).` };
    } catch (e: any) {
      return { result: `send_email error: ${e.message}` };
    }
  }

  if (creds.provider === "gmail_oauth") {
    if (!creds.oauthRefreshToken) {
      return { result: "send_email: Gmail account is not connected. Reconnect Gmail in the dashboard." };
    }
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return { result: "send_email: Gmail OAuth is not configured on the server." };
    }
    let refreshToken: string;
    try {
      refreshToken = decrypt(creds.oauthRefreshToken);
    } catch {
      return { result: "send_email: failed to decrypt Gmail credentials." };
    }
    try {
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2 });

      const cc = args.cc ? String(args.cc).trim() : undefined;
      const fromHeader = creds.fromName
        ? `${creds.fromName} <${creds.fromAddress}>`
        : creds.fromAddress;

      // Build a minimal RFC 5322 message and base64url-encode it.
      const lines = [
        `From: ${fromHeader}`,
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        body,
      ];
      const raw = Buffer.from(lines.join("\r\n"), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const send = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
      return { result: `Email sent to ${to} (id=${send.data.id ?? "unknown"}).` };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/invalid_grant/i.test(msg)) {
        return {
          result:
            "send_email: Gmail authorization expired or was revoked. Reconnect Gmail in the dashboard.",
        };
      }
      return { result: `send_email error: ${msg.slice(0, 240)}` };
    }
  }

  if (creds.provider === "gmail" || creds.provider === "smtp") {
    const cc = args.cc ? String(args.cc).trim() : undefined;
    const isGmail = creds.provider === "gmail";
    const host = isGmail ? "smtp.gmail.com" : (creds.smtpHost ?? "");
    const port = isGmail ? 465 : (creds.smtpPort ?? 587);
    const user = isGmail ? (creds.smtpUser ?? creds.fromAddress) : (creds.smtpUser ?? "");
    const passEnc = isGmail ? creds.smtpPass : creds.smtpPass;
    if (!host || !user || !passEnc) {
      return { result: `send_email: ${creds.provider} credentials are incomplete.` };
    }
    let pass: string;
    try {
      pass = decrypt(passEnc);
    } catch {
      return { result: `send_email: failed to decrypt ${creds.provider} password.` };
    }
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      const info = await transporter.sendMail({
        from: creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress,
        to,
        ...(cc ? { cc } : {}),
        subject,
        text: body,
      });
      return { result: `Email sent to ${to} (id=${info.messageId ?? "unknown"}).` };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // Map the most common Gmail failure to actionable language.
      if (isGmail && /Username and Password not accepted|535/i.test(msg)) {
        return {
          result:
            "send_email: Gmail rejected the credentials. Make sure 2-Step Verification is on and you generated a 16-character App Password (not your normal Gmail password).",
        };
      }
      return { result: `send_email error: ${msg.slice(0, 240)}` };
    }
  }

  return {
    result:
      `send_email: provider "${creds.provider}" is not supported for outbound mail. Use Gmail sign-in, Resend, Gmail SMTP, or generic SMTP.`,
  };
}

export const executors: Record<string, ToolExecutor> = {
  send_email: sendEmail,
};
