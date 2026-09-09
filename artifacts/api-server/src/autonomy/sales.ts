import { readFile } from "fs/promises";
import path from "path";
import { pool } from "@workspace/db";
import { autonomyEnabled } from "./constitution";
import { structuredModel } from "./openai";
import { markActionExecuted, markActionFailed, recordAutonomousAction, recordBusinessEvent } from "./ledger";
import { optOutLead, resolveOperatorUserId } from "./growth";
import { executors as inboxExecutors } from "../tools/general/email-read";
import { executors as emailExecutors } from "../tools/general/email";

const SALES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "qualified", "canAutoRespond", "nextStage", "summary", "response"],
  properties: {
    intent: { type: "string", enum: ["positive", "question", "demo", "trial", "not_now", "negative", "opt_out", "procurement", "security", "other"] },
    qualified: { type: "boolean" },
    canAutoRespond: { type: "boolean" },
    nextStage: { type: "string", enum: ["replied_positive", "demo_requested", "trial_requested", "nurture", "closed_lost", "do_not_contact", "needs_founder"] },
    summary: { type: "string" },
    response: { type: "string" },
  },
} as const;

function salesEnabled(): boolean {
  return autonomyEnabled() && process.env.AUTONOMY_ENABLE_SALES !== "false" && process.env.AUTONOMY_ENABLE_SALES !== "0";
}

function senderEmail(from: string): string | null {
  const angled = from.match(/<([^>]+@[^>]+)>/);
  const plain = from.match(/\b[^\s<>]+@[^\s<>]+\.[^\s<>]+\b/);
  return (angled?.[1] ?? plain?.[0] ?? "").trim().toLowerCase() || null;
}

async function capabilities(): Promise<string> {
  try {
    return (await readFile(path.resolve(process.cwd(), "CAPABILITIES.md"), "utf8")).slice(0, 30_000);
  } catch {
    return "VoyceLab lets event-venue and bar teams use voice for permitted Square-connected POS, reporting and inventory tasks.";
  }
}

async function latestAttribution(leadId: string): Promise<{ campaign: string | null; experimentId: string | null; variant: string | null }> {
  if (!pool) return { campaign: null, experimentId: null, variant: null };
  const result = await pool.query<{ campaign: string | null; experiment_id: string | null; variant: string | null }>(
    `SELECT campaign, experiment_id::text, variant
     FROM business_events
     WHERE event_type='outbound_sent' AND properties->>'leadId'=$1
     ORDER BY occurred_at DESC LIMIT 1`,
    [leadId],
  );
  const row = result.rows[0];
  return { campaign: row?.campaign ?? null, experimentId: row?.experiment_id ?? null, variant: row?.variant ?? null };
}

function siteUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "https://voycelab.com").replace(/\/$/, "");
}

function trialUrl(attribution?: { campaign: string | null; variant: string | null }): string {
  const params = new URLSearchParams({ utm_source: "sales_reply", utm_medium: "email" });
  if (attribution?.campaign) params.set("utm_campaign", attribution.campaign);
  if (attribution?.variant) params.set("utm_content", attribution.variant);
  return `${siteUrl()}/signup?${params.toString()}`;
}

export async function runSalesInbox(runId?: string, maxMessages = 8): Promise<{ inspected: number; responded: number; positive: number; escalated: number; optedOut: number }> {
  if (!pool || !salesEnabled()) return { inspected: 0, responded: 0, positive: 0, escalated: 0, optedOut: 0 };

  let operatorUserId: number;
  try {
    operatorUserId = await resolveOperatorUserId();
  } catch (error) {
    console.error("[autonomy] sales inbox operator resolution failed", error instanceof Error ? error.message : error);
    return { inspected: 0, responded: 0, positive: 0, escalated: 0, optedOut: 0 };
  }
  const operatorOrgId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  const ctx = { userId: operatorUserId, organizationId: operatorOrgId } as any;
  const list = inboxExecutors.list_inbox;
  const read = inboxExecutors.read_email;
  const markRead = inboxExecutors.mark_email_read;
  const send = emailExecutors.send_email;
  if (!list || !read || !markRead || !send) throw new Error("Sales email executors are unavailable");

  const query = process.env.AUTONOMY_SALES_GMAIL_QUERY?.trim() || "in:inbox is:unread newer_than:14d";
  const listed = await list({ query, max_results: Math.max(1, Math.min(25, maxMessages * 2)) }, ctx);
  let parsed: any;
  try { parsed = JSON.parse(listed.result); } catch { return { inspected: 0, responded: 0, positive: 0, escalated: 0, optedOut: 0 }; }
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const productContext = await capabilities();

  let inspected = 0;
  let responded = 0;
  let positive = 0;
  let escalated = 0;
  let optedOut = 0;

  for (const metadata of messages) {
    if (inspected >= maxMessages) break;
    const id = String(metadata.id ?? "");
    if (!id) continue;
    const full = await read({ id }, ctx);
    let message: any;
    try { message = JSON.parse(full.result); } catch { continue; }
    const email = senderEmail(String(message.from ?? ""));
    if (!email) continue;

    const leadResult = await pool.query(
      `SELECT id,company_name,contact_name,contact_email,segment,stage,fit_score,evidence,profile,last_contacted_at
       FROM prospect_leads
       WHERE lower(contact_email)=lower($1)
         AND stage NOT IN ('do_not_contact','customer','closed_lost')
       ORDER BY last_contacted_at DESC NULLS LAST, updated_at DESC LIMIT 1`,
      [email],
    );
    const lead = leadResult.rows[0];
    if (!lead) continue;
    inspected += 1;

    const alreadyProcessed = await pool.query(`SELECT 1 FROM business_events WHERE dedupe_key=$1 LIMIT 1`, [`sales-reply:${id}`]);
    if (alreadyProcessed.rowCount) {
      const escalatedBefore = await pool.query(`SELECT 1 FROM business_events WHERE dedupe_key=$1 LIMIT 1`, [`sales-escalated:${id}`]);
      if (!escalatedBefore.rowCount) await markRead({ id }, ctx);
      continue;
    }

    const attribution = await latestAttribution(String(lead.id));
    await recordBusinessEvent({
      eventType: "outbound_replied",
      actorType: "prospect",
      actorId: String(lead.id),
      campaign: attribution.campaign,
      experimentId: attribution.experimentId,
      variant: attribution.variant,
      properties: { leadId: lead.id, segment: lead.segment, gmailMessageId: id },
      dedupeKey: `sales-reply:${id}`,
    });

    const triage = await structuredModel<{
      intent: "positive" | "question" | "demo" | "trial" | "not_now" | "negative" | "opt_out" | "procurement" | "security" | "other";
      qualified: boolean;
      canAutoRespond: boolean;
      nextStage: "replied_positive" | "demo_requested" | "trial_requested" | "nurture" | "closed_lost" | "do_not_contact" | "needs_founder";
      summary: string;
      response: string;
    }>(
      [
        "You are VoyceLab's sales reply agent for event venues and bars.",
        "Answer in plain English. Keep normal replies under 90 words. The recipient is busy.",
        "VoyceLab lets bartenders and venue managers use voice to get common Square tasks done instead of tapping through screens.",
        "Never use vague marketing jargon such as voice layer, orchestration, operational intelligence, workflow transformation, connected systems, streamline, unlock, leverage, or optimize.",
        "Use only the supplied email and product context. Never invent customers, results, discounts, integrations, security certifications, roadmap commitments, implementation dates, or pricing exceptions.",
        "For ordinary product questions, answer directly. If useful, say the live demo is already on the homepage at the supplied site URL.",
        "For demo interest: do NOT book or offer a meeting. Tell them the live demo is already on the homepage, then offer the Start Free URL.",
        "For trial or positive interest: send the Start Free URL. The preferred next action is signup, not a call.",
        "Set canAutoRespond=false and nextStage=needs_founder for procurement negotiations, custom contracts, security attestations, enterprise pricing exceptions, legal terms, or commitments not explicitly in context.",
        "For not_now, be respectful and concise. For negative, close politely. For opt_out, only acknowledge the opt-out.",
      ].join("\n"),
      {
        lead: { companyName: lead.company_name, contactName: lead.contact_name, segment: lead.segment, fitScore: lead.fit_score, evidence: lead.evidence, profile: lead.profile },
        message: { subject: message.subject, body: message.body },
        productContext,
        siteUrl: siteUrl(),
        startFreeUrl: trialUrl(attribution),
      },
      { schemaName: "voycelab_sales_reply", schema: SALES_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "medium", maxOutputTokens: 1200 },
    );

    if (triage.intent === "opt_out" || triage.nextStage === "do_not_contact") {
      await optOutLead(String(lead.id), "sales_reply_opt_out");
      await markRead({ id }, ctx);
      optedOut += 1;
      continue;
    }

    const isPositive = ["positive", "demo", "trial"].includes(triage.intent) || triage.qualified;
    if (isPositive) {
      await recordBusinessEvent({
        eventType: "outbound_positive_reply",
        actorType: "prospect",
        actorId: String(lead.id),
        campaign: attribution.campaign,
        experimentId: attribution.experimentId,
        variant: attribution.variant,
        properties: { leadId: lead.id, intent: triage.intent, nextStage: triage.nextStage, gmailMessageId: id },
        dedupeKey: `positive-reply:${id}`,
      });
      positive += 1;
    }

    if (triage.intent === "demo") {
      await recordBusinessEvent({ eventType: "demo_requested", actorType: "prospect", actorId: String(lead.id), campaign: attribution.campaign, experimentId: attribution.experimentId, variant: attribution.variant, properties: { leadId: lead.id, gmailMessageId: id, fulfillment: "onsite_demo" }, dedupeKey: `demo-request:${id}` });
    }
    if (triage.intent === "trial") {
      await recordBusinessEvent({ eventType: "trial_interest", actorType: "prospect", actorId: String(lead.id), campaign: attribution.campaign, experimentId: attribution.experimentId, variant: attribution.variant, properties: { leadId: lead.id, gmailMessageId: id }, dedupeKey: `trial-interest:${id}` });
    }

    const action = await recordAutonomousAction({
      runId,
      agent: "sales",
      actionType: triage.canAutoRespond ? "sales.respond" : "sales.escalate",
      riskLevel: triage.canAutoRespond ? "medium" : "low",
      input: { leadId: lead.id, gmailMessageId: id, intent: triage.intent, summary: triage.summary },
      expectedImpact: { metric: "paid_customer_conversion", leadingMetric: "signup_completed" },
      externalRef: id,
    });

    if (!triage.canAutoRespond || action.authority === "founder" || action.authority === "forbidden") {
      await pool.query(`UPDATE prospect_leads SET stage='needs_founder', next_contact_at=NULL, updated_at=now() WHERE id=$1`, [lead.id]);
      await recordBusinessEvent({ eventType: "sales_escalated", actorType: "agent", actorId: "sales", campaign: attribution.campaign, experimentId: attribution.experimentId, variant: attribution.variant, properties: { leadId: lead.id, intent: triage.intent, summary: triage.summary, gmailMessageId: id }, dedupeKey: `sales-escalated:${id}` });
      await markActionExecuted(action.id, { escalated: true, nextStage: "needs_founder" }, id);
      escalated += 1;
      continue;
    }

    try {
      const result = await send({ to: email, subject: `Re: ${String(message.subject ?? "VoyceLab")}`, body: triage.response }, ctx);
      if (/failed|error|missing|limit|rejected/i.test(result.result)) throw new Error(result.result);
      await markRead({ id }, ctx);
      await pool.query(`UPDATE prospect_leads SET stage=$2, next_contact_at=$3, updated_at=now() WHERE id=$1`, [lead.id, triage.nextStage, triage.nextStage === "nurture" ? new Date(Date.now() + 30 * 86_400_000) : null]);
      await recordBusinessEvent({ eventType: "sales_response_sent", actorType: "agent", actorId: "sales", campaign: attribution.campaign, experimentId: attribution.experimentId, variant: attribution.variant, properties: { leadId: lead.id, intent: triage.intent, nextStage: triage.nextStage, gmailMessageId: id, preferredCta: "signup" }, dedupeKey: `sales-response:${id}` });
      await markActionExecuted(action.id, { providerResult: result.result, nextStage: triage.nextStage, preferredCta: "signup" }, id);
      responded += 1;
    } catch (error) {
      await markActionFailed(action.id, { error: error instanceof Error ? error.message : String(error) });
      escalated += 1;
    }
  }

  return { inspected, responded, positive, escalated, optedOut };
}
