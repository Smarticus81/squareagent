import { pool } from "@workspace/db";
import { getPlan } from "@workspace/voicelab-core/pricing";
import type { BusinessSnapshot } from "./metrics";
import { structuredModel } from "./openai";
import { assignExperiment, createExperiment, type ExperimentVariant } from "./experiments";
import { markActionExecuted, recordAutonomousAction, recordBusinessEvent } from "./ledger";

interface CampaignVariantPayload {
  angle: string;
  targetPain: string;
  promise: string;
  proofConstraint: string;
  cta: string;
}

interface CampaignVariantProposal extends CampaignVariantPayload {
  id: string;
}

const CAMPAIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["campaignThesis", "variants"],
  properties: {
    campaignThesis: { type: "string" },
    variants: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "angle", "targetPain", "promise", "proofConstraint", "cta"],
        properties: {
          id: { type: "string" },
          angle: { type: "string" },
          targetPain: { type: "string" },
          promise: { type: "string" },
          proofConstraint: { type: "string" },
          cta: { type: "string" },
        },
      },
    },
  },
} as const;

function campaignSlug(now = new Date()): string {
  const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const day = Math.floor((now.getTime() - first.getTime()) / 86_400_000);
  const week = Math.floor((day + first.getUTCDay()) / 7) + 1;
  return `outbound-positioning-${now.getUTCFullYear()}-w${String(week).padStart(2, "0")}`;
}

async function existingRunningCampaign(): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query<{ slug: string }>(
    `SELECT slug FROM experiments
     WHERE status='running' AND primary_metric='outbound_positive_reply'
     ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT 1`,
  );
  return result.rows[0]?.slug ?? null;
}

/**
 * Attribution bridge from outbound prospect -> same-email VoyceLab account ->
 * paid subscription. This intentionally requires a deterministic email match;
 * ambiguous cross-email identity is never guessed.
 */
export async function reconcileOutboundSubscriptionAttribution(): Promise<{ attributed: number }> {
  if (!pool) return { attributed: 0 };
  const result = await pool.query<{
    lead_id: string;
    subscription_id: number;
    plan: string;
    campaign: string | null;
    experiment_id: string | null;
    variant: string | null;
  }>(
    `SELECT p.id::text AS lead_id,
            s.id AS subscription_id,
            s.plan,
            sent.campaign,
            sent.experiment_id::text,
            sent.variant
     FROM prospect_leads p
     JOIN users u ON lower(u.email)=lower(p.contact_email)
     JOIN subscriptions s ON s.user_id=u.id
       AND s.plan <> 'trial' AND s.status IN ('active','paid')
     JOIN LATERAL (
       SELECT campaign, experiment_id, variant
       FROM business_events
       WHERE event_type='outbound_sent'
         AND properties->>'leadId'=p.id::text
       ORDER BY occurred_at DESC
       LIMIT 1
     ) sent ON true
     WHERE p.contact_email IS NOT NULL`,
  );

  let attributed = 0;
  for (const row of result.rows) {
    const plan = getPlan(row.plan);
    const eventId = await recordBusinessEvent({
      eventType: "outbound_subscription_attributed",
      actorType: "system",
      actorId: "marketing-attribution",
      campaign: row.campaign,
      experimentId: row.experiment_id,
      variant: row.variant,
      valueCents: plan ? Math.round(plan.monthlyPriceUsd * 100) : null,
      properties: { leadId: row.lead_id, subscriptionId: row.subscription_id, plan: row.plan },
      dedupeKey: `outbound-subscription:${row.lead_id}:${row.subscription_id}`,
    });
    if (eventId) attributed += 1;
    await pool.query(`UPDATE prospect_leads SET stage='customer', next_contact_at=NULL, updated_at=now() WHERE id=$1`, [row.lead_id]);
  }
  return { attributed };
}

export async function ensureOutboundCampaign(snapshot: BusinessSnapshot, runId?: string): Promise<string | null> {
  if (!pool) return null;
  const running = await existingRunningCampaign();
  if (running) return running;

  const segments = await pool.query(
    `SELECT segment,
       COUNT(*)::int AS leads,
       COUNT(*) FILTER (WHERE stage IN ('replied_positive','demo_requested','trial_requested','customer'))::int AS positive,
       AVG(fit_score)::float AS avg_fit
     FROM prospect_leads
     GROUP BY segment
     ORDER BY leads DESC`,
  );

  const recentSignals = await pool.query(
    `SELECT event_type, variant, campaign, value_cents, properties
     FROM business_events
     WHERE event_type IN (
       'outbound_sent','outbound_replied','outbound_positive_reply','demo_requested',
       'trial_interest','outbound_subscription_attributed','outreach_opt_out'
     )
       AND occurred_at >= now()-interval '60 days'
     ORDER BY occurred_at DESC LIMIT 200`,
  );

  const priorCampaigns = await pool.query(
    `SELECT slug,status,hypothesis,winner,result
     FROM experiments
     WHERE primary_metric='outbound_positive_reply'
     ORDER BY created_at DESC LIMIT 8`,
  );

  const proposed = await structuredModel<{ campaignThesis: string; variants: CampaignVariantProposal[] }>(
    [
      "You are VoyceLab's autonomous B2B growth strategist.",
      "Design exactly three materially different outbound positioning variants for real hospitality operators.",
      "VoyceLab is a voice-powered operations assistant that can connect to systems such as Square and perform permitted POS, reporting, inventory, customer/payment and team/labor actions by voice.",
      "Use current public web information to ground the pains operators actually discuss now. Prefer event venues, wedding venues, bars/restaurants and multi-location hospitality groups when the data supports them.",
      "Learn from prior campaign winners, opt-outs, positive replies, demos, trial interest and attributed paid subscriptions supplied in the data. Do not merely rename a losing variant.",
      "Do not invent customer results, integrations, statistics, testimonials, logos or capabilities. proofConstraint must explicitly state what the copy writer must NOT claim.",
      "Variants must differ in strategic angle, not just wording. Each CTA should be low-friction: reply, try the live demo, start a trial, or book a demo.",
      "Optimize durable paid conversion while using qualified positive reply as the faster experimental signal. Avoid variants that increase opt-outs.",
    ].join("\n"),
    { snapshot, leadSegments: segments.rows, recentSignals: recentSignals.rows, priorCampaigns: priorCampaigns.rows },
    {
      schemaName: "voycelab_outbound_campaign",
      schema: CAMPAIGN_SCHEMA as unknown as Record<string, unknown>,
      useWebSearch: true,
      reasoningEffort: "medium",
      maxOutputTokens: 3000,
    },
  );

  const slug = campaignSlug();
  const variants: ExperimentVariant[] = proposed.variants.map((variant, index) => ({
    id: variant.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `variant-${index + 1}`,
    weight: 1,
    payload: {
      angle: variant.angle,
      targetPain: variant.targetPain,
      promise: variant.promise,
      proofConstraint: variant.proofConstraint,
      cta: variant.cta,
    },
  }));

  const action = await recordAutonomousAction({
    runId,
    agent: "marketing",
    actionType: "marketing.campaign_launch",
    riskLevel: "low",
    input: { slug, campaignThesis: proposed.campaignThesis, variants },
    expectedImpact: { primaryMetric: "outbound_positive_reply", longTermMetric: "outbound_subscription_attributed" },
  });

  const experimentId = await createExperiment({
    slug,
    hypothesis: proposed.campaignThesis,
    primaryMetric: "outbound_positive_reply",
    variants,
    guardrails: [{ metric: "outreach_opt_out", max: 0.05 }],
  });

  await recordBusinessEvent({
    eventType: "campaign_created",
    actorType: "agent",
    actorId: "marketing",
    campaign: slug,
    experimentId,
    properties: { campaignThesis: proposed.campaignThesis },
    dedupeKey: `campaign-created:${slug}`,
  });
  await markActionExecuted(action.id, { experimentId, slug });
  return slug;
}

export async function assignOutboundCampaign(leadId: string): Promise<{
  slug: string;
  experimentId: string;
  variantId: string;
  payload: CampaignVariantPayload;
} | null> {
  const slug = await existingRunningCampaign();
  if (!slug) return null;
  const assignment = await assignExperiment(slug, leadId);
  if (!assignment) return null;
  return {
    slug,
    experimentId: assignment.experimentId,
    variantId: assignment.variant.id,
    payload: (assignment.variant.payload ?? {}) as unknown as CampaignVariantPayload,
  };
}
