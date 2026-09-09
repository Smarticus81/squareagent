/**
 * Outbound email tool. Supports Resend, Gmail OAuth, Gmail SMTP and generic SMTP.
 */
import { db, emailCredentialsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import { decrypt } from "../../lib/secrets";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";

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

function safeMailError(error: unknown, fallback = "mail provider request failed"): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;
  return raw
    .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:re|ya29|sk)[A-Za-z0-9._-]{16,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted]")
    .slice(0, 240);
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

function cleanHtml(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "")
    .slice(0, 24_000);
}

function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function encodeGmailMessage(params: { from: string; to: string; cc?: string; subject: string; text: string; html?: string }): string {
  const subject = encodeHeaderValue(params.subject);
  const baseHeaders = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];

  let lines: string[];
  if (params.html) {
    const boundary = `voycelab_${Date.now().toString(36)}`;
    lines = [
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      params.text,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      params.html,
      `--${boundary}--`,
    ];
  } else {
    lines = [
      ...baseHeaders,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      params.text,
    ];
  }

  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "send_email",
    description: "Send an email from the user's configured outbound address.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Subject line" },
        body: { type: "string", description: "Plain-text body of the email" },
        html: { type: "string", description: "Optional HTML version of the same email" },
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
  const html = cleanHtml(args.html);
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
  if (!creds) return { result: "send_email: no email credentials configured. Add an email provider in the dashboard." };

  if (creds.provider === "resend") {
    if (!creds.apiKey) return { result: "send_email: Resend API key is missing." };
    const apiKey = decrypt(creds.apiKey);
    const cc = args.cc ? String(args.cc).trim() : undefined;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress,
          to: [to],
          ...(cc ? { cc: [cc] } : {}),
          subject,
          text: body,
          ...(html ? { html } : {}),
        }),
      });
      if (!res.ok) return { result: `send_email failed (Resend ${res.status}): ${safeMailError(await res.text())}` };
      const data = (await res.json()) as { id?: string };
      return { result: `Email sent to ${to} (id=${data.id ?? "unknown"}).` };
    } catch (e: any) {
      return { result: `send_email error: ${safeMailError(e)}` };
    }
  }

  if (creds.provider === "gmail_oauth") {
    if (!creds.oauthRefreshToken) return { result: "send_email: Gmail account is not connected. Reconnect Gmail in the dashboard." };
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { result: "send_email: Gmail OAuth is not configured on the server." };

    let refreshToken: string;
    try { refreshToken = decrypt(creds.oauthRefreshToken); }
    catch { return { result: "send_email: failed to decrypt Gmail credentials." }; }

    try {
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const cc = args.cc ? String(args.cc).trim() : undefined;
      const fromHeader = creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress;
      const raw = encodeGmailMessage({ from: fromHeader, to, cc, subject, text: body, html });
      const send = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
      return { result: `Email sent to ${to} (id=${send.data.id ?? "unknown"}).` };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/invalid_grant/i.test(msg)) return { result: "send_email: Gmail authorization expired or was revoked. Reconnect Gmail in the dashboard." };
      return { result: `send_email error: ${safeMailError(msg)}` };
    }
  }

  if (creds.provider === "gmail" || creds.provider === "smtp") {
    const cc = args.cc ? String(args.cc).trim() : undefined;
    const isGmail = creds.provider === "gmail";
    const host = isGmail ? "smtp.gmail.com" : (creds.smtpHost ?? "");
    const port = isGmail ? 465 : (creds.smtpPort ?? 587);
    const user = isGmail ? (creds.smtpUser ?? creds.fromAddress) : (creds.smtpUser ?? "");
    const passEnc = creds.smtpPass;
    if (!host || !user || !passEnc) return { result: `send_email: ${creds.provider} credentials are incomplete.` };

    let pass: string;
    try { pass = decrypt(passEnc); }
    catch { return { result: `send_email: failed to decrypt ${creds.provider} password.` }; }

    try {
      const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
      const info = await transporter.sendMail({
        from: creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress,
        to,
        ...(cc ? { cc } : {}),
        subject,
        text: body,
        ...(html ? { html } : {}),
      });
      return { result: `Email sent to ${to} (id=${info.messageId ?? "unknown"}).` };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (isGmail && /Username and Password not accepted|535/i.test(msg)) {
        return { result: "send_email: Gmail rejected the credentials. Make sure 2-Step Verification is on and use a Gmail App Password." };
      }
      return { result: `send_email error: ${safeMailError(msg)}` };
    }
  }

  return { result: `send_email: provider "${creds.provider}" is not supported for outbound mail.` };
}

export const executors: Record<string, ToolExecutor> = { send_email: sendEmail };
