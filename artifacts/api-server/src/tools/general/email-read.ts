/**
 * Gmail read/search/manage tools. Companion to send_email — gives the
 * general assistant the ability to triage the user's inbox by voice.
 *
 * Requires the user to have connected Gmail via OAuth (provider=gmail_oauth)
 * with `gmail.readonly` and `gmail.modify` scopes (see oauth-google.ts).
 */

import { db, emailCredentialsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { google, type gmail_v1 } from "googleapis";
import { decrypt } from "../../lib/secrets";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";

function tenantWhere(userId: number, organizationId?: string | null) {
  return organizationId
    ? or(
        eq(emailCredentialsTable.organizationId, organizationId),
        and(eq(emailCredentialsTable.userId, userId), isNull(emailCredentialsTable.organizationId)),
      )
    : eq(emailCredentialsTable.userId, userId);
}

async function gmailClient(ctx: ToolContext): Promise<
  | { ok: true; gmail: gmail_v1.Gmail }
  | { ok: false; error: string }
> {
  if (!ctx.userId) return { ok: false, error: "missing user context" };
  if (!db) return { ok: false, error: "database not configured" };

  const [creds] = await db
    .select()
    .from(emailCredentialsTable)
    .where(tenantWhere(ctx.userId, ctx.organizationId))
    .limit(1);
  if (!creds) return { ok: false, error: "no email account connected — connect Gmail in the dashboard" };
  if (creds.provider !== "gmail_oauth") {
    return { ok: false, error: `connected provider is "${creds.provider}", which does not support reading. Connect Gmail via OAuth.` };
  }
  if (!creds.oauthRefreshToken) {
    return { ok: false, error: "Gmail authorization missing — reconnect Gmail in the dashboard" };
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, error: "Gmail OAuth not configured on server" };

  let refreshToken: string;
  try { refreshToken = decrypt(creds.oauthRefreshToken); }
  catch { return { ok: false, error: "failed to decrypt Gmail credentials" }; }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return { ok: true, gmail: google.gmail({ version: "v1", auth }) };
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  const data = part.body?.data;
  if (data) {
    try {
      return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    } catch { return ""; }
  }
  if (part.parts) {
    // Prefer text/plain
    const plain = part.parts.find((p) => p.mimeType === "text/plain");
    if (plain) return decodeBody(plain);
    const html = part.parts.find((p) => p.mimeType === "text/html");
    if (html) return decodeBody(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    for (const p of part.parts) {
      const v = decodeBody(p);
      if (v) return v;
    }
  }
  return "";
}

function summarize(text: string, max = 600): string {
  const collapsed = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return collapsed.length > max ? collapsed.slice(0, max) + "…" : collapsed;
}

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "list_inbox",
    description:
      "List recent emails in the user's Gmail inbox. Use `query` to filter (Gmail search syntax, e.g. 'is:unread', 'from:boss@x.com newer_than:2d').",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional Gmail search query. Defaults to 'in:inbox'." },
        max_results: { type: "integer", description: "Max emails to return (1-25). Default 10." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "search_email",
    description:
      "Search the user's Gmail using Gmail search syntax (e.g. 'from:stripe subject:invoice', 'has:attachment newer_than:7d'). Returns matching message metadata.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query." },
        max_results: { type: "integer", description: "Max results (1-25). Default 10." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "read_email",
    description:
      "Fetch the full body of a specific email by its message id (returned by list_inbox or search_email).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Gmail message id." },
      },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "archive_email",
    description: "Archive a Gmail message (removes the INBOX label). Use after the user explicitly confirms.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Gmail message id." } },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "mark_email_read",
    description: "Mark a Gmail message as read (removes the UNREAD label).",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Gmail message id." } },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "trash_email",
    description: "Move a Gmail message to Trash. Always confirm with the user out loud first.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Gmail message id." } },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "create_email_draft",
    description:
      "Create a Gmail draft (does NOT send). Use this when the user wants to compose without sending immediately.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email." },
        subject: { type: "string", description: "Subject." },
        body: { type: "string", description: "Plain-text body." },
        cc: { type: "string", description: "Optional CC." },
      },
      required: ["to", "subject", "body"],
    },
  },
];

async function listInbox(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const c = await gmailClient(ctx);
  if (!c.ok) return { result: `list_inbox: ${c.error}` };
  const q = String(args.query ?? "in:inbox").trim() || "in:inbox";
  const max = Math.min(25, Math.max(1, Number(args.max_results ?? 10) || 10));
  try {
    const list = await c.gmail.users.messages.list({ userId: "me", q, maxResults: max });
    const ids = (list.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
    if (ids.length === 0) return { result: `No emails matched "${q}".` };
    const detailed = await Promise.all(
      ids.map((id) =>
        c.gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        }).then((r) => r.data),
      ),
    );
    const items = detailed.map((m) => ({
      id: m.id,
      from: header(m.payload?.headers, "From"),
      subject: header(m.payload?.headers, "Subject") || "(no subject)",
      date: header(m.payload?.headers, "Date"),
      snippet: m.snippet ?? "",
      unread: (m.labelIds ?? []).includes("UNREAD"),
    }));
    return { result: JSON.stringify({ query: q, count: items.length, messages: items }) };
  } catch (e: any) {
    return { result: `list_inbox error: ${String(e?.message ?? e).slice(0, 240)}` };
  }
}

async function searchEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const q = String(args.query ?? "").trim();
  if (!q) return { result: "search_email: query is required." };
  return listInbox({ query: q, max_results: args.max_results }, ctx);
}

async function readEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const c = await gmailClient(ctx);
  if (!c.ok) return { result: `read_email: ${c.error}` };
  const id = String(args.id ?? "").trim();
  if (!id) return { result: "read_email: id is required." };
  try {
    const r = await c.gmail.users.messages.get({ userId: "me", id, format: "full" });
    const m = r.data;
    const out = {
      id: m.id,
      from: header(m.payload?.headers, "From"),
      to: header(m.payload?.headers, "To"),
      cc: header(m.payload?.headers, "Cc"),
      subject: header(m.payload?.headers, "Subject"),
      date: header(m.payload?.headers, "Date"),
      body: summarize(decodeBody(m.payload ?? undefined) || m.snippet || ""),
      labels: m.labelIds ?? [],
    };
    return { result: JSON.stringify(out) };
  } catch (e: any) {
    return { result: `read_email error: ${String(e?.message ?? e).slice(0, 240)}` };
  }
}

async function archiveEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const c = await gmailClient(ctx);
  if (!c.ok) return { result: `archive_email: ${c.error}` };
  const id = String(args.id ?? "").trim();
  if (!id) return { result: "archive_email: id is required." };
  try {
    await c.gmail.users.messages.modify({
      userId: "me", id,
      requestBody: { removeLabelIds: ["INBOX"] },
    });
    return { result: `Archived ${id}.` };
  } catch (e: any) {
    return { result: `archive_email error: ${String(e?.message ?? e).slice(0, 240)}` };
  }
}

async function markEmailRead(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const c = await gmailClient(ctx);
  if (!c.ok) return { result: `mark_email_read: ${c.error}` };
  const id = String(args.id ?? "").trim();
  if (!id) return { result: "mark_email_read: id is required." };
  try {
    await c.gmail.users.messages.modify({
      userId: "me", id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    return { result: `Marked ${id} as read.` };
  } catch (e: any) {
    return { result: `mark_email_read error: ${String(e?.message ?? e).slice(0, 240)}` };
  }
}

async function trashEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const c = await gmailClient(ctx);
  if (!c.ok) return { result: `trash_email: ${c.error}` };
  const id = String(args.id ?? "").trim();
  if (!id) return { result: "trash_email: id is required." };
  try {
    await c.gmail.users.messages.trash({ userId: "me", id });
    return { result: `Moved ${id} to trash.` };
  } catch (e: any) {
    return { result: `trash_email error: ${String(e?.message ?? e).slice(0, 240)}` };
  }
}

async function createEmailDraft(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const c = await gmailClient(ctx);
  if (!c.ok) return { result: `create_email_draft: ${c.error}` };
  const to = String(args.to ?? "").trim();
  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!to || !subject || !body) return { result: "create_email_draft: to, subject, and body are required." };

  const cc = args.cc ? String(args.cc).trim() : "";
  // Look up the user's "from" address from creds
  let fromHeader = "";
  if (db && ctx.userId) {
    const [creds] = await db
      .select()
      .from(emailCredentialsTable)
      .where(tenantWhere(ctx.userId, ctx.organizationId))
      .limit(1);
    if (creds) {
      fromHeader = creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress;
    }
  }

  const lines = [
    ...(fromHeader ? [`From: ${fromHeader}`] : []),
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
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  try {
    const r = await c.gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });
    return { result: `Draft created (id=${r.data.id ?? "unknown"}) for ${to}.` };
  } catch (e: any) {
    return { result: `create_email_draft error: ${String(e?.message ?? e).slice(0, 240)}` };
  }
}

export const executors: Record<string, ToolExecutor> = {
  list_inbox: listInbox,
  search_email: searchEmail,
  read_email: readEmail,
  archive_email: archiveEmail,
  mark_email_read: markEmailRead,
  trash_email: trashEmail,
  create_email_draft: createEmailDraft,
};
