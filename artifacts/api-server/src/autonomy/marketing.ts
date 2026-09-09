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

interface CampaignVariantProposal extends CampaignVariantPayload { id: string; }

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

const PRIMARY_METRIC = "outbound_subscription_attributed";

function campaignSlug(now = new Date()): string {
  const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const day = Math.floor((now.getTime() - first.getTime()) / 86_400_000);
  const week = Math.floor((day + first.getUTCDay()) / 7) + 1;
  return `paid-conversion-${now.getUTCFullYear()}-w${String(week).padStart(2, "0")}-${now.getTime().toString(36)}`;
}

async function existingRunningCampaign(): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query<{ slug: string }>(
    `SELECT slug FROM experiments
     WHERE status='running' AND primary_metric=$1
     ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [PRIMARY_METRIC],
  );
  return result.rows[0]?.slug ?? null;
}

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

  // Legacy reply-optimized campaigns are explicitly retired. They can remain in
  // history for learning, but they may not keep driving new sends.
  await pool.query(
    `UPDATE experiments
     SET status='superseded', ended_at=COALESCE(ended_at,now()), updated_at=now()
     WHERE status='running' AND primary_metric='outbound_positive_reply'`,
  );

  const segments = await pool.query(
    `SELECT segment,
       COUNT(*)::int AS leads,
       COUNT(*) FILTER (WHERE stage='customer')::int AS customers,
       COUNT(*) FILTER (WHERE stage IN ('replied_positive','demo_requested','trial_requested'))::int AS interested,
       AVG(fit_score)::float AS avg_fit
     FROM prospect_leads
     GROUP BY segment
     ORDER BY customers DESC, leads DESC`,
  );

  const recentSignals = await pool.query(
    `SELECT event_type, variant, campaign, value_cents, properties
     FROM business_events
     WHERE event_type IN (
       'outbound_sent','signup_completed','outbound_replied','outbound_positive_reply',
       'trial_interest','outbound_subscription_attributed','outreach_opt_out'
     )
       AND occurred_at >= now()-interval '60 days'
     ORDER BY occurred_at DESC LIMIT 300`,
  );

  const priorCampaigns = await pool.query(
    `SELECT slug,status,hypothesis,primary_metric,winner,result
     FROM experiments
     WHERE primary_metric IN ('outbound_subscription_attributed','outbound_positive_reply')
     ORDER BY created_at DESC LIMIT 10`,
  );

  const proposed = await structuredModel<{ campaignThesis: string; variants: CampaignVariantProposal[] }>(
    [
      "You are VoyceLab's B2B growth strategist. Your score is paid customer conversions and recurring revenue, not replies.",
      "Design exactly three materially different direct-response email angles for event venues and bars using Square.",
      "VoyceLab is simple: bartenders and venue managers can speak to get common Square tasks done instead of tapping through screens. Owners can get quick answers on sales, inventory and open tabs.",
      "Use current public information only to understand real operator pains. Prefer event venues, wedding venues, private-event spaces, bars, taprooms and breweries with live-event operations.",
      "Customer-facing language must be plain enough to understand in five seconds. Never use: voice layer, orchestration, operational intelligence, workflow transformation, connected systems, AI-powered operations, streamline, unlock, leverage, optimize, ecosystem, or platform transformation.",
      "The only CTA is Start Free. The live demo is already on the website. Never ask prospects to book a demo, schedule a call, reply for more information, or take a meeting.",
      "Each variant should express one concrete reason to sign up: less tapping during service, faster answers for managers, or clearer owner visibility during events.",
      "Do not invent customer results, statistics, testimonials, logos, integrations, discounts or capabilities.",
      "Use paid subscriptions and attributed MRR as the winner signal. Signup completion is a diagnostic leading indicator only. Replies and positive sentiment are not success.",
    ].join("\n"),
    { snapshot, leadSegments: segments.rows, recentSignals: recentSignals.rows, priorCampaigns: priorCampaigns.rows },
    {
      schemaName: "voycelab_paid_conversion_campaign",
      schema: CAMPAIGN_SCHEMA as unknown as Record<string, unknown>,
      useWebSearch: true,
      reasoningEffort: "medium",
      maxOutputTokens: 2600,
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
      cta: "Start Free",
    },
  }));

  const action = await recordAutonomousAction({
    runId,
    agent: "marketing",
    actionType: "marketing.campaign_launch",
    riskLevel: "low",
    input: { slug, campaignThesis: proposed.campaignThesis, variants },
    expectedImpact: { primaryMetric: PRIMARY_METRIC, leadingMetric: "signup_completed", diagnosticMetrics: ["outbound_replied", "outreach_opt_out"] },
  });

  const experimentId = await createExperiment({
    slug,
    hypothesis: proposed.campaignThesis,
    primaryMetric: PRIMARY_METRIC,
    variants,
    guardrails: [{ metric: "outreach_opt_out", max: 0.05 }],
  });

  await recordBusinessEvent({
    eventType: "campaign_created",
    actorType: "agent",
    actorId: "marketing",
    campaign: slug,
    experimentId,
    properties: { campaignThesis: proposed.campaignThesis, successDefinition: "paid_customer_and_mrr" },
    dedupeKey: `campaign-created:${slug}`,
  });
  await markActionExecuted(action.id, { experimentId, slug, primaryMetric: PRIMARY_METRIC });
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
