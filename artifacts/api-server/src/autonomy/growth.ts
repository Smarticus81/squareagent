import { pool } from "@workspace/db";
import { DEFAULT_AUTONOMY_BUDGET, outboundEnabled } from "./constitution";
import { structuredModel } from "./openai";
import { recordAutonomousAction, markActionExecuted, markActionFailed, recordBusinessEvent } from "./ledger";
import { executors as emailExecutors } from "../tools/general/email";

interface ResearchLead {
  companyName: string;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  segment: "wedding_venue" | "event_venue" | "bar_restaurant" | "hospitality_group" | "other";
  fitScore: number;
  reason: string;
  evidence: string[];
}

const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["leads", "marketObservation"],
  properties: {
    marketObservation: { type: "string" },
    leads: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["companyName", "website", "contactName", "contactEmail", "segment", "fitScore", "reason", "evidence"],
        properties: {
          companyName: { type: "string" },
          website: { type: ["string", "null"] },
          contactName: { type: ["string", "null"] },
          contactEmail: { type: ["string", "null"] },
          segment: { type: "string", enum: ["wedding_venue", "event_venue", "bar_restaurant", "hospitality_group", "other"] },
          fitScore: { type: "number", minimum: 0, maximum: 100 },
          reason: { type: "string" },
          evidence: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
    },
  },
} as const;

const EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
} as const;

function validEmail(value: string | null): value is string {
  return Boolean(value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

export async function researchProspects(runId?: string): Promise<{ discovered: number; marketObservation: string }> {
  if (!pool) throw new Error("Database is required for autonomous growth");
  const research = await structuredModel<{ leads: ResearchLead[]; marketObservation: string }>(
    [
      "You are VoyceLab's market intelligence worker. VoyceLab is a voice-powered operations assistant for hospitality venues, with Square-connected POS actions, inventory, reporting, customers/payments and team/labor workflows.",
      "Use current public web information to find real US businesses that appear to be strong prospects, prioritizing event venues, wedding venues, multi-location hospitality groups, and operational environments where staff repeatedly leave the floor to interact with POS/back-office systems.",
      "Only include contact names/emails when explicitly supported by public evidence. Never infer or fabricate an email address.",
      "Do not collect sensitive personal information. Business contact information only.",
      "Prefer high-intent evidence such as Square usage, event volume, multiple venues, active hiring, operational complexity, or public descriptions of their venue operations.",
      "Fit score should reflect likely product value and realistic salesability, not business prestige.",
    ].join("\n"),
    { target: "qualified VoyceLab customers", geography: "United States", maxLeads: 10 },
    { schemaName: "voycelab_growth_research", schema: LEAD_SCHEMA as unknown as Record<string, unknown>, useWebSearch: true, reasoningEffort: "medium", maxOutputTokens: 4200 },
  );

  let discovered = 0;
  for (const lead of research.leads) {
    if (!lead.companyName || lead.fitScore < 55) continue;
    const existing = await pool.query(
      `SELECT id FROM prospect_leads
       WHERE (website IS NOT NULL AND website=$1)
          OR (contact_email IS NOT NULL AND contact_email=$2)
       LIMIT 1`,
      [lead.website, lead.contactEmail],
    );
    if (existing.rowCount) continue;
    await pool.query(
      `INSERT INTO prospect_leads (company_name, website, contact_name, contact_email, segment, fit_score, evidence, profile, next_contact_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb, CASE WHEN $4 IS NULL THEN NULL ELSE now() END)`,
      [lead.companyName, lead.website, lead.contactName, validEmail(lead.contactEmail) ? lead.contactEmail : null, lead.segment, Math.round(lead.fitScore), JSON.stringify(lead.evidence), JSON.stringify({ reason: lead.reason })],
    );
    discovered += 1;
  }

  await recordBusinessEvent({
    eventType: "growth_research_completed",
    actorType: "agent",
    actorId: "growth-research",
    properties: { discovered, marketObservation: research.marketObservation, runId },
  });
  return { discovered, marketObservation: research.marketObservation };
}

async function sendsToday(): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM business_events WHERE event_type='outbound_sent' AND occurred_at >= date_trunc('day', now())`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function sendsToDomainToday(domain: string): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM business_events
     WHERE event_type='outbound_sent'
       AND occurred_at >= date_trunc('day', now())
       AND properties->>'domain'=$1`,
    [domain],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function runOutboundBatch(runId?: string, maxBatch = 12): Promise<{ sent: number; skipped: number }> {
  if (!pool) throw new Error("Database is required for autonomous outbound");
  if (!outboundEnabled()) return { sent: 0, skipped: 0 };

  const operatorUserId = Number(process.env.AUTONOMY_OPERATOR_USER_ID);
  const operatorOrgId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  if (!Number.isInteger(operatorUserId) || operatorUserId <= 0) {
    throw new Error("AUTONOMY_OPERATOR_USER_ID must identify the account whose configured outbound email will be used");
  }

  const alreadySent = await sendsToday();
  const remainingDaily = Math.max(0, DEFAULT_AUTONOMY_BUDGET.maxOutboundPerDay - alreadySent);
  const limit = Math.max(0, Math.min(maxBatch, remainingDaily));
  if (!limit) return { sent: 0, skipped: 0 };

  const leads = await pool.query(
    `SELECT * FROM prospect_leads
     WHERE stage IN ('new','nurture')
       AND contact_email IS NOT NULL
       AND (next_contact_at IS NULL OR next_contact_at <= now())
     ORDER BY fit_score DESC, created_at ASC
     LIMIT $1`,
    [limit * 3],
  );

  let sent = 0;
  let skipped = 0;
  for (const lead of leads.rows) {
    if (sent >= limit) break;
    const email = String(lead.contact_email ?? "").trim().toLowerCase();
    if (!validEmail(email) || lead.stage === "do_not_contact") { skipped += 1; continue; }
    const domain = email.split("@")[1];
    if (!domain || await sendsToDomainToday(domain) >= DEFAULT_AUTONOMY_BUDGET.maxOutboundPerDomainPerDay) { skipped += 1; continue; }

    const copy = await structuredModel<{ subject: string; body: string }>(
      [
        "Write a short, respectful B2B first-touch email for VoyceLab.",
        "Use ONLY the supplied public evidence for personalization; never imply a relationship, observation, integration, customer result, or capability that is not supported.",
        "VoyceLab lets hospitality teams operate connected systems such as Square through fast voice commands for POS, inventory, reporting and venue operations.",
        "The purpose is to earn a reply or trial, not to pressure the recipient. Plain text, under 120 words, one clear CTA, no fake urgency, no fabricated social proof.",
        "End with a simple opt-out sentence: 'If this isn't relevant, just say so and I won't follow up.'",
      ].join("\n"),
      { companyName: lead.company_name, contactName: lead.contact_name, segment: lead.segment, evidence: lead.evidence, fitScore: lead.fit_score },
      { schemaName: "voycelab_outbound_email", schema: EMAIL_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "low", maxOutputTokens: 700 },
    );

    const action = await recordAutonomousAction({
      runId,
      agent: "growth-outbound",
      actionType: "outreach.email",
      riskLevel: "medium",
      input: { leadId: lead.id, to: email, subject: copy.subject },
      expectedImpact: { goal: "qualified_reply_or_trial" },
    });
    if (action.authority === "founder" || action.authority === "forbidden") { skipped += 1; continue; }

    try {
      const executor = emailExecutors.send_email;
      if (!executor) throw new Error("send_email executor is unavailable");
      const result = await executor(
        { to: email, subject: copy.subject, body: copy.body },
        { userId: operatorUserId, organizationId: operatorOrgId } as any,
      );
      if (/failed|error|missing|limit|rejected/i.test(result.result)) throw new Error(result.result);

      await pool.query(
        `UPDATE prospect_leads SET stage='contacted', last_contacted_at=now(), next_contact_at=now()+interval '5 days', updated_at=now() WHERE id=$1`,
        [lead.id],
      );
      await recordBusinessEvent({
        eventType: "outbound_sent",
        actorType: "agent",
        actorId: "growth-outbound",
        source: "autonomous_outbound",
        properties: { leadId: lead.id, domain, segment: lead.segment, fitScore: lead.fit_score },
        dedupeKey: `outbound:${lead.id}:${new Date().toISOString().slice(0, 10)}`,
      });
      await markActionExecuted(action.id, { providerResult: result.result });
      sent += 1;
    } catch (error) {
      await markActionFailed(action.id, { error: error instanceof Error ? error.message : String(error) });
      skipped += 1;
    }
  }
  return { sent, skipped };
}

export async function optOutLead(leadId: string, reason = "recipient_opt_out"): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE prospect_leads SET stage='do_not_contact', next_contact_at=NULL, updated_at=now() WHERE id=$1`, [leadId]);
  await recordBusinessEvent({ eventType: "outreach_opt_out", actorType: "customer", properties: { leadId, reason }, dedupeKey: `optout:${leadId}` });
}
