import { pool } from "@workspace/db";
import { DEFAULT_AUTONOMY_BUDGET, outboundEnabled } from "./constitution";
import { structuredModel } from "./openai";
import { recordAutonomousAction, markActionExecuted, markActionFailed, recordBusinessEvent } from "./ledger";
import { assignOutboundCampaign } from "./marketing";
import { extractProviderMessageId } from "./outbound-reconciliation";
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
  properties: { subject: { type: "string" }, body: { type: "string" } },
} as const;

function validEmail(v: string | null): v is string {
  return Boolean(v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function signupUrl(campaign: { slug: string; variantId: string } | null): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://voycelab.com").replace(/\/$/, "");
  const params = new URLSearchParams({ utm_source: "autonomous_email", utm_medium: "email" });
  if (campaign?.slug) params.set("utm_campaign", campaign.slug);
  if (campaign?.variantId) params.set("utm_content", campaign.variantId);
  return `${base}/signup?${params.toString()}`;
}

function brandedEmailHtml(params: { body: string; ctaUrl: string }): string {
  const body = escapeHtml(params.body).replace(/\n+/g, "<br><br>");
  const url = escapeHtml(params.ctaUrl);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#152033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #dbe4f0"><tr><td style="padding:26px 28px;background:#07111f;color:#ffffff"><div style="font-size:19px;font-weight:700;letter-spacing:-.3px"><span style="color:#65a8ff">▂▅█▅▂</span>&nbsp; Voyce<span style="color:#65a8ff">Lab</span></div><div style="margin-top:18px;font-size:28px;line-height:1.05;font-weight:750;letter-spacing:-.8px">Voice for event venues.</div><div style="margin-top:9px;font-size:15px;line-height:1.45;color:#b8c9df">Your bartenders can speak instead of tapping through Square.</div></td></tr><tr><td style="padding:26px 28px"><div style="font-size:15px;line-height:1.65;color:#34445a">${body}</div><table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:24px"><tr><td style="border-radius:12px;background:#3f8df7"><a href="${url}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Start free →</a></td></tr></table><div style="margin-top:18px;font-size:12px;color:#7b8ba1">The demo is already on voycelab.com. No meeting required.</div></td></tr></table></td></tr></table></body></html>`;
}

export async function resolveOperatorUserId(): Promise<number> {
  if (!pool) throw new Error("Database is required for operator resolution");
  const raw = process.env.AUTONOMY_OPERATOR_USER_ID?.trim();
  if (!raw) throw new Error("AUTONOMY_OPERATOR_USER_ID is required for autonomous outbound");
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  const r = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE clerk_user_id=$1::text OR lower(email)=lower($1::text) LIMIT 1`,
    [raw],
  );
  const id = Number(r.rows[0]?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("AUTONOMY_OPERATOR_USER_ID must be a local user id, Clerk user id, or account email linked to VoyceLab");
  }
  return id;
}

export async function researchProspects(runId?: string): Promise<{ discovered: number; marketObservation: string }> {
  if (!pool) throw new Error("Database is required for autonomous growth");
  const research = await structuredModel<{ leads: ResearchLead[]; marketObservation: string }>(
    [
      "You are VoyceLab's market intelligence worker.",
      "Find real US prospects where VoyceLab's voice control for Square is immediately understandable and useful.",
      "Priority order: event venues, wedding venues, private-event spaces, bars/taprooms/breweries with significant live-event business, then multi-location hospitality groups with strong bar/event operations.",
      "Strongly prefer businesses with public evidence of Square usage plus event-day operational complexity. Generic restaurants or cafes without meaningful event/bar operations should score lower.",
      "VoyceLab lets bartenders and venue managers use voice for permitted Square-connected POS, inventory and reporting tasks while they keep serving guests.",
      "Only include contact names/emails when explicitly supported by public evidence. Never infer or fabricate an email address.",
      "Do not collect sensitive personal information. Business contact information only.",
      "Fit score should reflect realistic likelihood of becoming a paying customer, not business prestige.",
    ].join("\n"),
    { target: "event venues and bars likely to become paid VoyceLab customers", geography: "United States", maxLeads: 10 },
    { schemaName: "voycelab_growth_research", schema: LEAD_SCHEMA as unknown as Record<string, unknown>, useWebSearch: true, reasoningEffort: "medium", maxOutputTokens: 4200 },
  );

  let discovered = 0;
  for (const lead of research.leads) {
    if (!lead.companyName || lead.fitScore < 60) continue;
    const existing = await pool.query(
      `SELECT id FROM prospect_leads
       WHERE (website IS NOT NULL AND website=$1::text)
          OR (contact_email IS NOT NULL AND contact_email=$2::text)
       LIMIT 1`,
      [lead.website, lead.contactEmail],
    );
    if (existing.rowCount) continue;
    await pool.query(
      `INSERT INTO prospect_leads
       (company_name,website,contact_name,contact_email,segment,fit_score,evidence,profile,next_contact_at)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::integer,$7::jsonb,$8::jsonb,
               CASE WHEN $4::text IS NULL THEN NULL ELSE now() END)`,
      [lead.companyName, lead.website, lead.contactName, validEmail(lead.contactEmail) ? lead.contactEmail : null, lead.segment, Math.round(lead.fitScore), JSON.stringify(lead.evidence), JSON.stringify({ reason: lead.reason })],
    );
    discovered++;
  }
  await recordBusinessEvent({
    eventType: "growth_research_completed",
    actorType: "agent",
    actorId: "growth-research",
    properties: { discovered, marketObservation: research.marketObservation, runId },
  });
  return { discovered, marketObservation: research.marketObservation };
}

async function sendsToday() {
  if (!pool) return 0;
  const r = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM business_events
     WHERE event_type='outbound_sent' AND occurred_at>=date_trunc('day',now())`,
  );
  return Number(r.rows[0]?.count ?? 0);
}

async function sendsToDomainToday(domain: string) {
  if (!pool) return 0;
  const r = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM business_events
     WHERE event_type='outbound_sent'
       AND occurred_at>=date_trunc('day',now())
       AND properties->>'domain'=$1::text`,
    [domain],
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function runOutboundBatch(runId?: string, maxBatch = 12): Promise<{ sent: number; skipped: number }> {
  if (!pool) throw new Error("Database is required for autonomous outbound");
  if (!outboundEnabled()) return { sent: 0, skipped: 0 };

  const operatorUserId = await resolveOperatorUserId();
  const operatorOrgId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  const remaining = Math.max(0, DEFAULT_AUTONOMY_BUDGET.maxOutboundPerDay - await sendsToday());
  const limit = Math.max(0, Math.min(maxBatch, remaining));
  if (!limit) return { sent: 0, skipped: 0 };

  const leads = await pool.query(
    `SELECT * FROM prospect_leads
     WHERE stage IN ('new','nurture')
       AND contact_email IS NOT NULL
       AND (next_contact_at IS NULL OR next_contact_at<=now())
     ORDER BY fit_score DESC,created_at ASC
     LIMIT $1::integer`,
    [limit * 3],
  );

  let sent = 0;
  let skipped = 0;
  for (const lead of leads.rows) {
    if (sent >= limit) break;
    const email = String(lead.contact_email ?? "").trim().toLowerCase();
    if (!validEmail(email) || lead.stage === "do_not_contact") { skipped++; continue; }
    const domain = email.split("@")[1];
    if (!domain || await sendsToDomainToday(domain) >= DEFAULT_AUTONOMY_BUDGET.maxOutboundPerDomainPerDay) { skipped++; continue; }

    const campaign = await assignOutboundCampaign(String(lead.id));
    const ctaUrl = signupUrl(campaign ? { slug: campaign.slug, variantId: campaign.variantId } : null);
    const copy = await structuredModel<{ subject: string; body: string }>(
      [
        "Write an extremely short first-touch email for VoyceLab to an event venue or bar operator.",
        "Plain English only. The reader is busy and should understand the product in five seconds.",
        "State directly that VoyceLab lets bartenders and venue managers use voice to get things done in Square instead of tapping through screens.",
        "Use at most one short personalization sentence and only if supplied public evidence makes it useful.",
        "Body must be 35-65 words, 2-4 short paragraphs, no marketing jargon and no technical terminology.",
        "Never use phrases like voice layer, orchestration, operational intelligence, workflow transformation, connected systems, AI-powered operations, streamline, unlock, leverage, or optimize.",
        "Do not ask for a call, meeting, reply, demo booking, or calendar time. The demo is already on the website.",
        "Do not invent results, integrations, customers, urgency, discounts or capabilities.",
        "The subject should be concrete and under 45 characters. Examples of the tone: 'Use voice with Square at your venue' or 'Less tapping behind the bar'.",
        "Do not put a URL in the generated body; the system appends the Start Free link.",
      ].join("\n"),
      {
        companyName: lead.company_name,
        contactName: lead.contact_name,
        segment: lead.segment,
        evidence: lead.evidence,
        campaign: campaign ? { variantId: campaign.variantId, strategy: campaign.payload } : null,
      },
      { schemaName: "voycelab_outbound_email", schema: EMAIL_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "low", maxOutputTokens: 500 },
    );

    const plainBody = `${copy.body.trim()}\n\nStart free: ${ctaUrl}\n\nIf this isn't relevant, just say so and I won't follow up.`;
    const html = brandedEmailHtml({ body: copy.body.trim(), ctaUrl });

    const action = await recordAutonomousAction({
      runId,
      agent: "growth-outbound",
      actionType: "outreach.email",
      riskLevel: "medium",
      input: { leadId: lead.id, to: email, subject: copy.subject, campaign: campaign?.slug ?? null, variant: campaign?.variantId ?? null, ctaUrl },
      expectedImpact: { goal: "paid_customer_conversion", primaryMetric: "outbound_subscription_attributed", leadingMetric: "signup_completed" },
    });
    if (action.authority === "founder" || action.authority === "forbidden") { skipped++; continue; }

    try {
      const executor = emailExecutors.send_email;
      if (!executor) throw new Error("send_email executor is unavailable");
      const result = await executor({ to: email, subject: copy.subject, body: plainBody, html }, { userId: operatorUserId, organizationId: operatorOrgId } as any);
      if (/failed|error|missing|limit|rejected/i.test(result.result)) throw new Error(result.result);

      const providerMessageId = extractProviderMessageId(result.result);
      await pool.query(
        `UPDATE prospect_leads
         SET stage='contacted',last_contacted_at=now(),next_contact_at=now()+interval '5 days',updated_at=now()
         WHERE id=$1::uuid`,
        [lead.id],
      );

      await recordBusinessEvent({
        eventType: "outbound_sent",
        actorType: "agent",
        actorId: "growth-outbound",
        source: "autonomous_outbound",
        campaign: campaign?.slug ?? null,
        experimentId: campaign?.experimentId ?? null,
        variant: campaign?.variantId ?? null,
        properties: { leadId: lead.id, domain, segment: lead.segment, fitScore: lead.fit_score, cta: "signup", ...(providerMessageId ? { providerMessageId } : {}) },
        dedupeKey: providerMessageId ? `outbound-provider:${providerMessageId}` : `outbound:${lead.id}:${new Date().toISOString().slice(0, 10)}`,
      });
      await markActionExecuted(
        action.id,
        { providerResult: result.result, campaign: campaign?.slug ?? null, variant: campaign?.variantId ?? null, providerMessageId, cta: "signup" },
        providerMessageId ?? undefined,
      );
      sent++;
    } catch (error) {
      await markActionFailed(action.id, { error: error instanceof Error ? error.message : String(error) });
      skipped++;
    }
  }
  return { sent, skipped };
}

export async function optOutLead(leadId: string, reason = "recipient_opt_out"): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE prospect_leads SET stage='do_not_contact',next_contact_at=NULL,updated_at=now() WHERE id=$1::uuid`, [leadId]);
  await recordBusinessEvent({ eventType: "outreach_opt_out", actorType: "customer", properties: { leadId, reason }, dedupeKey: `optout:${leadId}` });
}
