/**
 * Outbound email tool. Uses Resend's REST API when an email_credentials row
 * exists for the user. SMTP support is stubbed and returns a clear error.
 *
 * Confirmation policy: the assistant should always read back the recipient,
 * subject, and a 1-line summary of the body before invoking this tool. The
 * tool itself sends immediately — there is no draft / approval step.
 */

import { db, emailCredentialsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { decrypt } from "../../lib/secrets";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";

/**
 * In-memory rate limiter — caps sends per user per rolling hour. Survives
 * cold-starts only weakly, but it's defense against a runaway voice loop.
 */
const SEND_LIMIT_PER_HOUR = 15;
const sendLog = new Map<number, number[]>();

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
    .where(eq(emailCredentialsTable.userId, ctx.userId))
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

  return { result: `send_email: provider "${creds.provider}" is not implemented yet.` };
}

export const executors: Record<string, ToolExecutor> = {
  send_email: sendEmail,
};
