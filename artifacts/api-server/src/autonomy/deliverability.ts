import { lookup, resolveMx } from "node:dns/promises";
import { isIP } from "node:net";
import { pool } from "@workspace/db";
import { recordBusinessEvent } from "./ledger";
import { executors as inboxExecutors } from "../tools/general/email-read";

export interface ContactVerificationInput {
  email: string;
  website: string | null;
  contactSourceUrl: string | null;
}

export interface ContactVerificationResult {
  verified: boolean;
  reason: string;
  checkedAt: string;
  mxCount: number;
  sourceUrl: string | null;
}

export interface DeliverabilityHealth {
  state: "green" | "caution" | "veto";
  sent7d: number;
  hardBounces7d: number;
  hardBounceRate: number;
  batchCap: number | null;
  reason: string | null;
}

const RESERVED_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "yopmail.com",
]);

const AUTOMATED_LOCAL_PARTS = [
  "mailer-daemon",
  "postmaster",
  "noreply",
  "no-reply",
  "notifications",
  "notification",
  "notifications-bot",
];

function parseEmail(value: string): { local: string; domain: string } | null {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const at = email.lastIndexOf("@");
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function sameWebsiteHost(a: string, b: string): boolean {
  const left = normalizedHost(a);
  const right = normalizedHost(b);
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("2001:db8");
  }
  return true;
}

async function publicHostname(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (!lower || lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal") || lower.endsWith(".lan")) return false;
  if (isIP(lower)) return !isPrivateAddress(lower);
  try {
    const addresses = await lookup(lower, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

function decodeEmailEntities(html: string): string {
  return html
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/&amp;/gi, "&")
    .toLowerCase();
}

async function fetchPublicContactSource(urlText: string, expectedWebsite: string, email: string): Promise<{ ok: boolean; reason: string }> {
  let source: URL;
  let website: URL;
  try {
    source = new URL(urlText);
    website = new URL(expectedWebsite);
  } catch {
    return { ok: false, reason: "invalid_public_source_url" };
  }
  if (!['http:', 'https:'].includes(source.protocol) || !['http:', 'https:'].includes(website.protocol)) return { ok: false, reason: "unsupported_public_source_protocol" };
  if (!sameWebsiteHost(source.hostname, website.hostname)) return { ok: false, reason: "contact_source_not_on_official_website" };
  if (!(await publicHostname(source.hostname))) return { ok: false, reason: "contact_source_not_public" };

  try {
    const response = await fetch(source, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(7_000),
      headers: { "User-Agent": "VoyceLab-Contact-Verifier/1.0" },
    });
    if (!response.ok) return { ok: false, reason: `contact_source_http_${response.status}` };
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 2_000_000) return { ok: false, reason: "contact_source_too_large" };
    const body = decodeEmailEntities((await response.text()).slice(0, 750_000));
    if (!body.includes(email.toLowerCase())) return { ok: false, reason: "email_not_visible_on_official_source" };
    return { ok: true, reason: "verified_public_business_contact" };
  } catch {
    return { ok: false, reason: "contact_source_unreachable" };
  }
}

export async function verifyPublicBusinessContact(input: ContactVerificationInput): Promise<ContactVerificationResult> {
  const checkedAt = new Date().toISOString();
  const parsed = parseEmail(input.email);
  if (!parsed) return { verified: false, reason: "invalid_email_syntax", checkedAt, mxCount: 0, sourceUrl: input.contactSourceUrl };
  if (AUTOMATED_LOCAL_PARTS.some((part) => parsed.local === part || parsed.local.startsWith(`${part}+`))) {
    return { verified: false, reason: "automated_or_system_mailbox", checkedAt, mxCount: 0, sourceUrl: input.contactSourceUrl };
  }
  if (RESERVED_DOMAINS.has(parsed.domain) || DISPOSABLE_DOMAINS.has(parsed.domain)) {
    return { verified: false, reason: "reserved_or_disposable_domain", checkedAt, mxCount: 0, sourceUrl: input.contactSourceUrl };
  }
  if (!input.website || !input.contactSourceUrl) {
    return { verified: false, reason: "missing_official_contact_source", checkedAt, mxCount: 0, sourceUrl: input.contactSourceUrl };
  }

  let mxCount = 0;
  try {
    const mx = await resolveMx(parsed.domain);
    mxCount = mx.length;
  } catch {
    return { verified: false, reason: "email_domain_has_no_mx", checkedAt, mxCount: 0, sourceUrl: input.contactSourceUrl };
  }
  if (mxCount === 0) return { verified: false, reason: "email_domain_has_no_mx", checkedAt, mxCount: 0, sourceUrl: input.contactSourceUrl };

  const source = await fetchPublicContactSource(input.contactSourceUrl, input.website, input.email);
  return { verified: source.ok, reason: source.reason, checkedAt, mxCount, sourceUrl: input.contactSourceUrl };
}

export function isAutomatedSystemMessage(message: { from?: string; subject?: string; autoSubmitted?: string; returnPath?: string }): boolean {
  const from = String(message.from ?? "").toLowerCase();
  const subject = String(message.subject ?? "").toLowerCase();
  const autoSubmitted = String(message.autoSubmitted ?? "").toLowerCase();
  const returnPath = String(message.returnPath ?? "").trim();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (returnPath === "<>") return true;
  if (/mailer-daemon|postmaster|no-?reply|notifications(?:-bot)?@github\.com/.test(from)) return true;
  if (/delivery status notification|undeliverable|delivery incomplete|address not found|mail delivery subsystem|automatic reply|out of office/.test(subject)) return true;
  return false;
}

function extractFailedRecipients(message: { failedRecipients?: unknown; body?: string }): string[] {
  const found = new Set<string>();
  if (Array.isArray(message.failedRecipients)) {
    for (const value of message.failedRecipients) {
      if (typeof value === "string" && parseEmail(value)) found.add(value.trim().toLowerCase());
    }
  }
  const body = String(message.body ?? "");
  const patterns = [
    /wasn['’]t delivered to\s+([^\s<>]+@[^\s<>]+\.[^\s<>]+)/gi,
    /delivery has failed to (?:these recipients or groups:\s*)?([^\s<>]+@[^\s<>]+\.[^\s<>]+)/gi,
    /failed recipient(?:s)?:\s*([^\s<>]+@[^\s<>]+\.[^\s<>]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const value = match[1]?.replace(/[),.;:]+$/, "").toLowerCase();
      if (value && parseEmail(value)) found.add(value);
    }
  }
  return [...found];
}

function bounceKind(message: { subject?: string; body?: string }): "hard" | "soft" | "unknown" {
  const text = `${message.subject ?? ""}\n${message.body ?? ""}`.toLowerCase();
  if (/5\.1\.1|does not exist|couldn['’]t be found|address not found|domain .*couldn['’]t be found|no such user|recipient address rejected/.test(text)) return "hard";
  if (/mailbox is full|temporar(?:y|ily)|4\.\d\.\d|try again later|rate limit/.test(text)) return "soft";
  return "unknown";
}

async function resolveOperatorUserIdForMail(): Promise<number> {
  if (!pool) throw new Error("Database is required for delivery-failure reconciliation");
  const raw = process.env.AUTONOMY_OPERATOR_USER_ID?.trim();
  if (!raw) throw new Error("AUTONOMY_OPERATOR_USER_ID is required for delivery-failure reconciliation");
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  const result = await pool.query<{ id: number }>(`SELECT id FROM users WHERE clerk_user_id=$1::text OR lower(email)=lower($1::text) LIMIT 1`, [raw]);
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Unable to resolve autonomy operator for delivery-failure reconciliation");
  return id;
}

export async function runDeliveryFailureInbox(runId?: string, maxMessages = 25): Promise<{ inspected: number; matchedProspects: number; hardSuppressed: number; softSuppressed: number; ignored: number }> {
  if (!pool) return { inspected: 0, matchedProspects: 0, hardSuppressed: 0, softSuppressed: 0, ignored: 0 };
  const userId = await resolveOperatorUserIdForMail();
  const organizationId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  const ctx = { userId, organizationId } as any;
  const list = inboxExecutors.list_inbox;
  const read = inboxExecutors.read_email;
  const markRead = inboxExecutors.mark_email_read;
  if (!list || !read || !markRead) throw new Error("Gmail inbox executors are unavailable for delivery reconciliation");

  const listed = await list({ query: "in:inbox newer_than:30d {from:mailer-daemon@googlemail.com from:postmaster@microsoft.com}", max_results: Math.max(1, Math.min(25, maxMessages)) }, ctx);
  let parsed: any;
  try { parsed = JSON.parse(listed.result); } catch { return { inspected: 0, matchedProspects: 0, hardSuppressed: 0, softSuppressed: 0, ignored: 0 }; }
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];

  let inspected = 0;
  let matchedProspects = 0;
  let hardSuppressed = 0;
  let softSuppressed = 0;
  let ignored = 0;

  for (const metadata of messages) {
    const id = String(metadata.id ?? "");
    if (!id) continue;
    const result = await read({ id }, ctx);
    let message: any;
    try { message = JSON.parse(result.result); } catch { continue; }
    if (!isAutomatedSystemMessage(message)) continue;
    inspected += 1;

    const kind = bounceKind(message);
    const recipients = extractFailedRecipients(message);
    let matchedThisMessage = false;
    for (const recipient of recipients) {
      const leadResult = await pool.query<{ id: string; stage: string }>(
        `SELECT id::text,stage FROM prospect_leads WHERE lower(contact_email)=lower($1) ORDER BY updated_at DESC LIMIT 1`,
        [recipient],
      );
      const lead = leadResult.rows[0];
      if (!lead) continue;
      matchedThisMessage = true;
      matchedProspects += 1;

      const attribution = await pool.query<{ campaign: string | null; experiment_id: string | null; variant: string | null }>(
        `SELECT campaign,experiment_id::text,variant FROM business_events
         WHERE event_type='outbound_sent' AND properties->>'leadId'=$1
         ORDER BY occurred_at DESC LIMIT 1`,
        [lead.id],
      );
      const attr = attribution.rows[0] ?? { campaign: null, experiment_id: null, variant: null };

      if (kind === "hard") {
        await pool.query(
          `UPDATE prospect_leads
           SET stage='do_not_contact',next_contact_at=NULL,updated_at=now(),
               profile=COALESCE(profile,'{}'::jsonb) || jsonb_build_object('deliverability',jsonb_build_object('verified',false,'status','hard_bounce','suppressedAt',now(),'reason','provider_hard_bounce'))
           WHERE id=$1::uuid`,
          [lead.id],
        );
        await recordBusinessEvent({
          eventType: "outbound_hard_bounce",
          actorType: "system",
          actorId: "deliverability",
          campaign: attr.campaign,
          experimentId: attr.experiment_id,
          variant: attr.variant,
          properties: { leadId: lead.id, source: "provider_dsn", runId },
          dedupeKey: `hard-bounce:${id}:${lead.id}`,
        });
        hardSuppressed += 1;
      } else if (kind === "soft") {
        await pool.query(
          `UPDATE prospect_leads
           SET stage=CASE WHEN stage IN ('customer','do_not_contact','closed_lost') THEN stage ELSE 'nurture' END,
               next_contact_at=CASE WHEN stage IN ('customer','do_not_contact','closed_lost') THEN next_contact_at ELSE now()+interval '30 days' END,
               updated_at=now(),
               profile=COALESCE(profile,'{}'::jsonb) || jsonb_build_object('deliverability',jsonb_build_object('verified',false,'status','soft_bounce','suppressedUntil',now()+interval '30 days','reason','provider_soft_bounce'))
           WHERE id=$1::uuid`,
          [lead.id],
        );
        await recordBusinessEvent({
          eventType: "outbound_soft_bounce",
          actorType: "system",
          actorId: "deliverability",
          campaign: attr.campaign,
          experimentId: attr.experiment_id,
          variant: attr.variant,
          properties: { leadId: lead.id, source: "provider_dsn", runId },
          dedupeKey: `soft-bounce:${id}:${lead.id}`,
        });
        softSuppressed += 1;
      }
    }
    if (!matchedThisMessage) ignored += 1;
    await markRead({ id }, ctx);
  }

  return { inspected, matchedProspects, hardSuppressed, softSuppressed, ignored };
}

export async function collectDeliverabilityHealth(): Promise<DeliverabilityHealth> {
  if (!pool) return { state: "green", sent7d: 0, hardBounces7d: 0, hardBounceRate: 0, batchCap: null, reason: null };
  const result = await pool.query<{ sent: number; hard_bounces: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type='outbound_sent')::int AS sent,
       COUNT(*) FILTER (WHERE event_type='outbound_hard_bounce')::int AS hard_bounces
     FROM business_events
     WHERE occurred_at >= now()-interval '7 days'
       AND event_type IN ('outbound_sent','outbound_hard_bounce')`,
  );
  const sent7d = Number(result.rows[0]?.sent ?? 0);
  const hardBounces7d = Number(result.rows[0]?.hard_bounces ?? 0);
  const hardBounceRate = sent7d > 0 ? hardBounces7d / sent7d : 0;

  if (hardBounces7d >= 3 || (sent7d >= 20 && hardBounceRate >= 0.05)) {
    return { state: "veto", sent7d, hardBounces7d, hardBounceRate, batchCap: 0, reason: "hard_bounce_rate_or_count_exceeded" };
  }
  if (hardBounces7d >= 1 || (sent7d >= 20 && hardBounceRate >= 0.02)) {
    return { state: "caution", sent7d, hardBounces7d, hardBounceRate, batchCap: 3, reason: "deliverability_recovery_canary" };
  }
  return { state: "green", sent7d, hardBounces7d, hardBounceRate, batchCap: null, reason: null };
}
