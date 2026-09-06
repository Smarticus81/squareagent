import { pool } from "@workspace/db";
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

export async function ensureOutboundCampaign(snapshot: BusinessSnapshot, runId?: string): Promise<string | null> {
  if (!pool) return null;
  const running = await existingRunningCampaign();
  if (running) return running;

  const segments = await pool.query(
    `SELECT segment,
       COUNT(*)::int AS leads,
       COUNT(*) FILTER (WHERE stage IN ('replied_positive','demo_requested','trial_requested'))::int AS positive,
       AVG(fit_score)::float AS avg_fit
     FROM prospect_leads
     GROUP BY segment
     ORDER BY leads DESC`,
  );

  const recentSignals = await pool.query(
    `SELECT event_type, variant, campaign, properties
     FROM business_events
     WHERE event_type IN ('outbound_sent','outbound_replied','outbound_positive_reply','demo_requested','trial_interest')
       AND occurred_at >= now()-interval '60 days'
     ORDER BY occurred_at DESC LIMIT 150`,
  );

  const proposed = await structuredModel<{ campaignThesis: string; variants: CampaignVariantProposal[] }>(
    [
      "You are VoyceLab's autonomous B2B growth strategist.",
      "Design exactly three materially different outbound positioning variants for real hospitality operators.",
      "VoyceLab is a voice-powered operations assistant that can connect to systems such as Square and perform permitted POS, reporting, inventory, customer/payment and team/labor actions by voice.",
      "Use current public web information to ground the pains operators actually discuss now. Prefer event venues, wedding venues, bars/restaurants and multi-location hospitality groups when the data supports them.",
      "Do not invent customer results, integrations, statistics, testimonials, logos or capabilities. proofConstraint must explicitly state what the copy writer must NOT claim.",
      "Variants must differ in strategic angle, not just wording. Each CTA should be low-friction: reply, try the live demo, start a trial, or book a demo.",
      "Optimize positive qualified replies and eventual subscriptions, not opens or raw response volume.",
    ].join("\n"),
    { snapshot, leadSegments: segments.rows, recentSignals: recentSignals.rows },
    {
      schemaName: "voycelab_outbound_campaign",
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
      cta: variant.cta,
    },
  }));

  const action = await recordAutonomousAction({
    runId,
    agent: "marketing",
    actionType: "marketing.campaign_launch",
    riskLevel: "low",
    input: { slug, campaignThesis: proposed.campaignThesis, variants },
    expectedImpact: { primaryMetric: "outbound_positive_reply" },
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
