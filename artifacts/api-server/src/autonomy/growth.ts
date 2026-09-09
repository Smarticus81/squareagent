import { pool } from "@workspace/db";
import { DEFAULT_AUTONOMY_BUDGET, outboundEnabled } from "./constitution";
import { structuredModel } from "./openai";
import { recordAutonomousAction, markActionExecuted, markActionFailed, recordBusinessEvent } from "./ledger";
import { assignOutboundCampaign } from "./marketing";
import { extractProviderMessageId } from "./outbound-reconciliation";
import { collectDeliverabilityHealth, verifyPublicBusinessContact } from "./deliverability";
import { executors as emailExecutors } from "../tools/general/email";

interface ResearchLead {
  companyName: string;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactSourceUrl: string | null;
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
        required: ["companyName", "website", "contactName", "contactEmail", "contactSourceUrl", "segment", "fitScore", "reason", "evidence"],
        properties: {
          companyName: { type: "string" },
          website: { type: ["string", "null"] },
          contactName: { type: ["string", "null"] },
          contactEmail: { type: ["string", "null"] },
          contactSourceUrl: { type: ["string", "null"] },
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

function profileObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
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

export async function researchProspects(runId?: string): Promise<{ discovered: number; rejected: number; refreshed: number; marketObservation: string }> {
  if (!pool) throw new Error("Database is required for autonomous growth");
  const research = await structuredModel<{ leads: ResearchLead[]; marketObservation: string }>(
    [
      "You are VoyceLab's market intelligence worker. Your job is to find real, currently operating businesses with verified public contact information, not merely plausible leads.",
      "Find real US prospects where VoyceLab's voice control for Square is immediately understandable and useful.",
      "Priority order: event venues, wedding venues, private-event spaces, bars/taprooms/breweries with significant live-event business, then multi-location hospitality groups with strong bar/event operations.",
      "Every lead must have a real official business website that appears current and active.",
      "Only return a contactEmail when that exact email address is visibly published on the business's own official website. Never infer, guess, pattern-generate, scrape a people-search site, or use a third-party directory as the source of an email.",
      "When contactEmail is non-null, contactSourceUrl MUST be the exact page on the official business website where that exact email is publicly visible. If you cannot find such a page, set contactEmail and contactSourceUrl to null.",
      "Free-mail addresses such as Gmail are acceptable only when the exact address is visibly published on the official business website.",
      "Strongly prefer businesses with public evidence of Square usage plus event-day operational complexity. Generic restaurants or cafes without meaningful event/bar operations should score lower.",
      "VoyceLab lets bartenders and venue managers use voice for permitted Square-connected POS, inventory and reporting tasks while they keep serving guests.",
      "Do not collect sensitive personal information. Business contact information only.",
      "Fit score should reflect realistic likelihood of becoming a paying customer and confidence the business/contact are genuine, not business prestige.",
    ].join("\n"),
    { target: "verified event venues and bars likely to become paid VoyceLab customers", geography: "United States", maxLeads: 10 },
    { schemaName: "voycelab_verified_growth_research", schema: LEAD_SCHEMA as unknown as Record<string, unknown>, useWebSearch: true, reasoningEffort: "medium", maxOutputTokens: 4800 },
  );

  let discovered = 0;
  let rejected = 0;
  let refreshed = 0;
  for (const lead of research.leads) {
    if (!lead.companyName || lead.fitScore < 60 || !validEmail(lead.contactEmail)) { rejected++; continue; }

    const verification = await verifyPublicBusinessContact({
      email: lead.contactEmail,
      website: lead.website,
      contactSourceUrl: lead.contactSourceUrl,
    });
    if (!verification.verified) { rejected++; continue; }

    const existing = await pool.query<{ id: string; stage: string; contact_email: string | null }>(
      `SELECT id::text,stage,contact_email FROM prospect_leads
       WHERE (website IS NOT NULL AND website=$1::text)
          OR (contact_email IS NOT NULL AND lower(contact_email)=lower($2::text))
       ORDER BY updated_at DESC LIMIT 1`,
      [lead.website, lead.contactEmail],
    );
    const prior = existing.rows[0];
    const profile = {
      reason: lead.reason,
      contactSourceUrl: lead.contactSourceUrl,
      deliverability: verification,
    };

    if (prior) {
      if (["customer", "do_not_contact", "closed_lost"].includes(prior.stage)) continue;
      const sameEmail = String(prior.contact_email ?? "").toLowerCase() === lead.contactEmail.toLowerCase();
      if (sameEmail) {
        const bounce = await pool.query<{ event_type: string; occurred_at: Date }>(
          `SELECT event_type,occurred_at FROM business_events
           WHERE event_type IN ('outbound_hard_bounce','outbound_soft_bounce')
             AND properties->>'leadId'=$1
           ORDER BY occurred_at DESC LIMIT 1`,
          [prior.id],
        );
        const latest = bounce.rows[0];
        if (latest?.event_type === "outbound_hard_bounce") { rejected++; continue; }
        if (latest?.event_type === "outbound_soft_bounce" && new Date(latest.occurred_at).getTime() > Date.now() - 30 * 86_400_000) { rejected++; continue; }
      }
      await pool.query(
        `UPDATE prospect_leads
         SET company_name=$2,website=$3,contact_name=$4,contact_email=$5,segment=$6,fit_score=$7,evidence=$8::jsonb,profile=$9::jsonb,
             stage=CASE WHEN stage IN ('invalid_email','needs_verification') THEN 'new' ELSE stage END,
             next_contact_at=CASE WHEN stage IN ('invalid_email','needs_verification') THEN now() ELSE next_contact_at END,
             updated_at=now()
         WHERE id=$1::uuid`,
        [prior.id, lead.companyName, lead.website, lead.contactName, lead.contactEmail, lead.segment, Math.round(lead.fitScore), JSON.stringify(lead.evidence), JSON.stringify(profile)],
      );
      refreshed++;
      continue;
    }

    await pool.query(
      `INSERT INTO prospect_leads
       (company_name,website,contact_name,contact_email,segment,fit_score,evidence,profile,next_contact_at)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::integer,$7::jsonb,$8::jsonb,now())`,
      [lead.companyName, lead.website, lead.contactName, lead.contactEmail, lead.segment, Math.round(lead.fitScore), JSON.stringify(lead.evidence), JSON.stringify(profile)],
    );
    discovered++;
  }
  await recordBusinessEvent({
    eventType: "growth_research_completed",
    actorType: "agent",
    actorId: "growth-research",
    properties: { discovered, rejected, refreshed, marketObservation: research.marketObservation, runId, verificationPolicy: "official_site_exact_email_plus_mx" },
  });
  return { discovered, rejected, refreshed, marketObservation: research.marketObservation };
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

async function quarantineLeadForVerification(lead: any, reason: string): Promise<void> {
  if (!pool) return;
  const profile = profileObject(lead.profile);
  await pool.query(
    `UPDATE prospect_leads SET stage='needs_verification',next_contact_at=NULL,updated_at=now(),profile=$2::jsonb WHERE id=$1::uuid`,
    [lead.id, JSON.stringify({ ...profile, deliverability: { ...(profile.deliverability ?? {}), verified: false, checkedAt: new Date().toISOString(), reason } })],
  );
}

export async function runOutboundBatch(runId?: string, maxBatch = 12): Promise<{ sent: number; skipped: number; deliverability: Awaited<ReturnType<typeof collectDeliverabilityHealth>> }> {
  if (!pool) throw new Error("Database is required for autonomous outbound");
  const deliverability = await collectDeliverabilityHealth();
  if (!outboundEnabled() || deliverability.state === "veto") {
    if (deliverability.state === "veto") {
      await recordBusinessEvent({ eventType: "outbound_paused_deliverability", actorType: "system", actorId: "deliverability", properties: deliverability, dedupeKey: `deliverability-veto:${new Date().toISOString().slice(0,10)}` });
    }
    return { sent: 0, skipped: 0, deliverability };
  }

  const operatorUserId = await resolveOperatorUserId();
  const operatorOrgId = process.env.AUTONOMY_OPERATOR_ORG_ID?.trim() || null;
  const remaining = Math.max(0, DEFAULT_AUTONOMY_BUDGET.maxOutboundPerDay - await sendsToday());
  const healthCap = deliverability.batchCap == null ? maxBatch : Math.min(maxBatch, deliverability.batchCap);
  const limit = Math.max(0, Math.min(healthCap, remaining));
  if (!limit) return { sent: 0, skipped: 0, deliverability };

  const leads = await pool.query(
    `SELECT * FROM prospect_leads
     WHERE stage IN ('new','nurture')
       AND contact_email IS NOT NULL
       AND COALESCE(profile->'deliverability'->>'verified','false')='true'
       AND profile->>'contactSourceUrl' IS NOT NULL
       AND (next_contact_at IS NULL OR next_contact_at<=now())
     ORDER BY fit_score DESC,created_at ASC
     LIMIT $1::integer`,
    [limit * 4],
  );

  let sent = 0;
  let skipped = 0;
  for (const lead of leads.rows) {
    if (sent >= limit) break;
    const email = String(lead.contact_email ?? "").trim().toLowerCase();
    if (!validEmail(email)) { skipped++; await quarantineLeadForVerification(lead, "invalid_email_syntax"); continue; }
    const domain = email.split("@")[1];
    if (!domain || await sendsToDomainToday(domain) >= DEFAULT_AUTONOMY_BUDGET.maxOutboundPerDomainPerDay) { skipped++; continue; }

    const profile = profileObject(lead.profile);
    const verification = await verifyPublicBusinessContact({
      email,
      website: typeof lead.website === "string" ? lead.website : null,
      contactSourceUrl: typeof profile.contactSourceUrl === "string" ? profile.contactSourceUrl : null,
    });
    if (!verification.verified) {
      skipped++;
      await quarantineLeadForVerification(lead, verification.reason);
      continue;
    }

    const campaign = await assignOutboundCampaign(String(lead.id));
    const ctaUrl = signupUrl(campaign ? { slug: campaign.slug, variantId: campaign.variantId } : null);
    const copy = await structuredModel<{ subject: string; body: string }>(
      [
        "Write an extremely short first-touch email for VoyceLab to an event venue or bar operator.",
        "Plain English only. The reader is busy and should understand the product in five seconds.",
        "State directly that VoyceLab lets bartenders and venue managers use voice to get things done in Square instead of tapping through screens.",
        "Use at most one short personalization sentence and only if supplied public evidence makes it useful.",
        "Body must be 30-55 words, 2-3 short paragraphs, no marketing jargon and no technical terminology.",
        "Never use phrases like voice layer, orchestration, operational intelligence, workflow transformation, connected systems, AI-powered operations, streamline, unlock, leverage, or optimize.",
        "Do not ask for a call, meeting, reply, demo booking, or calendar time. The demo is already on the website.",
        "Do not invent results, integrations, customers, urgency, discounts or capabilities.",
        "The subject must be concrete and under 45 characters. Use ASCII punctuation only: straight apostrophes and normal hyphens, never curly quotes, smart apostrophes, or em dashes.",
        "Do not put a URL, 'Start Free', 'Try it', 'Sign up', or any CTA phrase in the generated body. The system adds the single Start Free button and link after the body.",
      ].join("\n"),
      {
        companyName: lead.company_name,
        contactName: lead.contact_name,
        segment: lead.segment,
        evidence: lead.evidence,
        verifiedPublicContactSource: profile.contactSourceUrl,
        campaign: campaign ? { variantId: campaign.variantId, strategy: campaign.payload } : null,
      },
      { schemaName: "voycelab_outbound_email", schema: EMAIL_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "low", maxOutputTokens: 420 },
    );

    const plainBody = `${copy.body.trim()}\n\nStart free: ${ctaUrl}\n\nIf this isn't relevant, just say so and I won't follow up.`;
    const html = brandedEmailHtml({ body: copy.body.trim(), ctaUrl });

    const action = await recordAutonomousAction({
      runId,
      agent: "growth-outbound",
      actionType: "outreach.email",
      riskLevel: "medium",
      input: { leadId: lead.id, to: email, subject: copy.subject, campaign: campaign?.slug ?? null, variant: campaign?.variantId ?? null, ctaUrl, contactVerifiedAt: verification.checkedAt },
      expectedImpact: { goal: "paid_customer_conversion", primaryMetric: "outbound_subscription_attributed", leadingMetric: "signup_completed", guardrail: "hard_bounce_rate" },
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
         SET stage='contacted',last_contacted_at=now(),next_contact_at=now()+interval '5 days',updated_at=now(),
             profile=COALESCE(profile,'{}'::jsonb) || jsonb_build_object('deliverability',$2::jsonb)
         WHERE id=$1::uuid`,
        [lead.id, JSON.stringify(verification)],
      );

      await recordBusinessEvent({
        eventType: "outbound_sent",
        actorType: "agent",
        actorId: "growth-outbound",
        source: "autonomous_outbound",
        campaign: campaign?.slug ?? null,
        experimentId: campaign?.experimentId ?? null,
        variant: campaign?.variantId ?? null,
        properties: { leadId: lead.id, domain, segment: lead.segment, fitScore: lead.fit_score, cta: "signup", contactVerification: "official_site_exact_email_plus_mx", ...(providerMessageId ? { providerMessageId } : {}) },
        dedupeKey: providerMessageId ? `outbound-provider:${providerMessageId}` : `outbound:${lead.id}:${new Date().toISOString().slice(0, 10)}`,
      });
      await markActionExecuted(
        action.id,
        { providerResult: result.result, campaign: campaign?.slug ?? null, variant: campaign?.variantId ?? null, providerMessageId, cta: "signup", contactVerification: verification },
        providerMessageId ?? undefined,
      );
      sent++;
    } catch (error) {
      await markActionFailed(action.id, { error: error instanceof Error ? error.message : String(error) });
      skipped++;
    }
  }
  return { sent, skipped, deliverability };
}

export async function optOutLead(leadId: string, reason = "recipient_opt_out"): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE prospect_leads SET stage='do_not_contact',next_contact_at=NULL,updated_at=now() WHERE id=$1::uuid`, [leadId]);
  await recordBusinessEvent({ eventType: "outreach_opt_out", actorType: "customer", properties: { leadId, reason }, dedupeKey: `optout:${leadId}` });
}
