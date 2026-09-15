import { pool } from "@workspace/db";
import { recordBusinessEvent } from "./ledger";

const RESPONSE_EVENT_TYPES = [
  "outbound_replied",
  "outbound_positive_reply",
  "demo_requested",
  "trial_interest",
  "sales_escalated",
  "sales_response_sent",
] as const;

type ActionRow = {
  id: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  external_ref: string | null;
  executed_at: Date | string | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function extractProviderMessageId(providerResult: unknown): string | null {
  if (typeof providerResult !== "string") return null;
  const match = providerResult.match(/\(id=([^\)]+)\)/i);
  const id = match?.[1]?.trim();
  return id && id !== "unknown" ? id : null;
}

function emailDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const at = value.lastIndexOf("@");
  if (at < 0 || at === value.length - 1) return null;
  return value.slice(at + 1).trim().toLowerCase() || null;
}

async function experimentIdForCampaign(campaign: string | null, cache: Map<string, string | null>): Promise<string | null> {
  if (!pool || !campaign) return null;
  if (cache.has(campaign)) return cache.get(campaign) ?? null;
  const result = await pool.query<{ id: string }>(`SELECT id::text FROM experiments WHERE slug=$1 LIMIT 1`, [campaign]);
  const id = result.rows[0]?.id ?? null;
  cache.set(campaign, id);
  return id;
}

/**
 * Rebuilds outbound_sent business events from executed outreach actions whose
 * provider result proves that Gmail/SMTP accepted the message. This makes the
 * provider delivery receipt authoritative instead of relying on a best-effort
 * ledger write after the send call.
 */
export async function reconcileOutboundDeliveryReceipts(windowDays = 30): Promise<{
  inspected: number;
  inserted: number;
  enriched: number;
  actionRefsRepaired: number;
  responseAttributionRepaired: number;
}> {
  if (!pool) return { inspected: 0, inserted: 0, enriched: 0, actionRefsRepaired: 0, responseAttributionRepaired: 0 };
  const days = Math.max(1, Math.min(365, Math.floor(windowDays)));
  const actions = await pool.query<ActionRow>(
    `SELECT id,input,output,external_ref,executed_at
     FROM autonomous_actions
     WHERE action_type='outreach.email'
       AND status='executed'
       AND executed_at >= now() - ($1::text || ' days')::interval
     ORDER BY executed_at ASC`,
    [days],
  );

  let inserted = 0;
  let enriched = 0;
  let actionRefsRepaired = 0;
  const experimentCache = new Map<string, string | null>();

  for (const action of actions.rows) {
    const input = objectValue(action.input);
    const output = objectValue(action.output);
    const providerMessageId = action.external_ref || extractProviderMessageId(output.providerResult);
    const leadId = typeof input.leadId === "string" ? input.leadId : null;
    if (!providerMessageId || !leadId) continue;

    const campaign = typeof input.campaign === "string" ? input.campaign : null;
    const variant = typeof input.variant === "string" ? input.variant : null;
    const experimentId = await experimentIdForCampaign(campaign, experimentCache);
    const occurredAt = action.executed_at ? new Date(action.executed_at) : new Date();
    const domain = emailDomain(input.to);

    const existing = await pool.query<{ id: string }>(
      `SELECT id::text
       FROM business_events
       WHERE event_type='outbound_sent'
         AND (
           properties->>'providerMessageId'=$1::text
           OR (
             properties->>'leadId'=$2::text
             AND occurred_at BETWEEN $3::timestamp - interval '10 minutes' AND $3::timestamp + interval '10 minutes'
           )
         )
       ORDER BY occurred_at DESC LIMIT 1`,
      [providerMessageId, leadId, occurredAt],
    );

    if (existing.rows[0]?.id) {
      await pool.query(
        `UPDATE business_events
         SET campaign=COALESCE(campaign,$2::text),
             experiment_id=COALESCE(experiment_id,$3::uuid),
             variant=COALESCE(variant,$4::text),
             properties=properties || $5::jsonb
         WHERE id=$1::uuid`,
        [existing.rows[0].id, campaign, experimentId, variant, JSON.stringify({ providerMessageId, reconciledFrom: "provider_delivery_receipt", ...(domain ? { domain } : {}) })],
      );
      enriched += 1;
    } else {
      const eventId = await recordBusinessEvent({
        eventType: "outbound_sent",
        actorType: "agent",
        actorId: "growth-outbound",
        source: "autonomous_outbound",
        campaign,
        experimentId,
        variant,
        properties: { leadId, providerMessageId, reconciledFrom: "provider_delivery_receipt", ...(domain ? { domain } : {}) },
        dedupeKey: `outbound-provider:${providerMessageId}`,
        occurredAt,
      });
      if (eventId) inserted += 1;
    }

    if (!action.external_ref) {
      await pool.query(`UPDATE autonomous_actions SET external_ref=$2::text WHERE id=$1::uuid AND external_ref IS NULL`, [action.id, providerMessageId]);
      actionRefsRepaired += 1;
    }
  }

  const repaired = await pool.query<{ id: string }>(
    `WITH matched AS (
       SELECT response.id,
              sent.campaign,
              sent.experiment_id,
              sent.variant
       FROM business_events response
       JOIN LATERAL (
         SELECT campaign,experiment_id,variant
         FROM business_events sent
         WHERE sent.event_type='outbound_sent'
           AND sent.properties->>'leadId'=response.properties->>'leadId'
           AND sent.occurred_at <= response.occurred_at
         ORDER BY sent.occurred_at DESC
         LIMIT 1
       ) sent ON true
       WHERE response.event_type = ANY($1::text[])
         AND response.occurred_at >= now() - ($2::text || ' days')::interval
         AND (response.campaign IS NULL OR response.experiment_id IS NULL OR response.variant IS NULL)
     )
     UPDATE business_events response
     SET campaign=COALESCE(response.campaign,matched.campaign),
         experiment_id=COALESCE(response.experiment_id,matched.experiment_id),
         variant=COALESCE(response.variant,matched.variant),
         properties=response.properties || '{"attributionReconciled":true}'::jsonb
     FROM matched
     WHERE response.id=matched.id
     RETURNING response.id::text`,
    [RESPONSE_EVENT_TYPES, days],
  );

  return {
    inspected: actions.rowCount ?? actions.rows.length,
    inserted,
    enriched,
    actionRefsRepaired,
    responseAttributionRepaired: repaired.rowCount ?? repaired.rows.length,
  };
}

export async function collectOutboundCampaignPerformance(windowDays = 30): Promise<{
  windowDays: number;
  totals: {
    sent: number;
    uniqueRecipients: number;
    replied: number;
    positiveReplies: number;
    demoRequests: number;
    trialInterest: number;
    attributedSubscriptions: number;
    optOuts: number;
    replyRate: number;
    positiveReplyRate: number;
    paidConversionRate: number;
  };
  campaigns: Array<{
    campaign: string;
    sent: number;
    replied: number;
    positiveReplies: number;
    demoRequests: number;
    trialInterest: number;
    attributedSubscriptions: number;
    optOuts: number;
  }>;
}> {
  if (!pool) {
    return { windowDays, totals: { sent: 0, uniqueRecipients: 0, replied: 0, positiveReplies: 0, demoRequests: 0, trialInterest: 0, attributedSubscriptions: 0, optOuts: 0, replyRate: 0, positiveReplyRate: 0, paidConversionRate: 0 }, campaigns: [] };
  }
  const days = Math.max(1, Math.min(365, Math.floor(windowDays)));
  const result = await pool.query<{
    campaign: string | null;
    sent: number;
    unique_recipients: number;
    replied: number;
    positive_replies: number;
    demo_requests: number;
    trial_interest: number;
    attributed_subscriptions: number;
    opt_outs: number;
  }>(
    `SELECT COALESCE(campaign,'unattributed') AS campaign,
            COUNT(*) FILTER (WHERE event_type='outbound_sent')::int AS sent,
            COUNT(DISTINCT properties->>'leadId') FILTER (WHERE event_type='outbound_sent')::int AS unique_recipients,
            COUNT(*) FILTER (WHERE event_type='outbound_replied')::int AS replied,
            COUNT(*) FILTER (WHERE event_type='outbound_positive_reply')::int AS positive_replies,
            COUNT(*) FILTER (WHERE event_type='demo_requested')::int AS demo_requests,
            COUNT(*) FILTER (WHERE event_type='trial_interest')::int AS trial_interest,
            COUNT(*) FILTER (WHERE event_type='outbound_subscription_attributed')::int AS attributed_subscriptions,
            COUNT(*) FILTER (WHERE event_type='outreach_opt_out')::int AS opt_outs
     FROM business_events
     WHERE occurred_at >= now() - ($1::text || ' days')::interval
       AND event_type IN ('outbound_sent','outbound_replied','outbound_positive_reply','demo_requested','trial_interest','outbound_subscription_attributed','outreach_opt_out')
     GROUP BY COALESCE(campaign,'unattributed')
     ORDER BY MAX(occurred_at) DESC`,
    [days],
  );

  const campaigns = result.rows.map((row) => ({
    campaign: String(row.campaign ?? "unattributed"),
    sent: Number(row.sent ?? 0),
    replied: Number(row.replied ?? 0),
    positiveReplies: Number(row.positive_replies ?? 0),
    demoRequests: Number(row.demo_requests ?? 0),
    trialInterest: Number(row.trial_interest ?? 0),
    attributedSubscriptions: Number(row.attributed_subscriptions ?? 0),
    optOuts: Number(row.opt_outs ?? 0),
  }));
  const sent = result.rows.reduce((sum, row) => sum + Number(row.sent ?? 0), 0);
  const uniqueRecipients = result.rows.reduce((sum, row) => sum + Number(row.unique_recipients ?? 0), 0);
  const replied = campaigns.reduce((sum, row) => sum + row.replied, 0);
  const positiveReplies = campaigns.reduce((sum, row) => sum + row.positiveReplies, 0);
  const demoRequests = campaigns.reduce((sum, row) => sum + row.demoRequests, 0);
  const trialInterest = campaigns.reduce((sum, row) => sum + row.trialInterest, 0);
  const attributedSubscriptions = campaigns.reduce((sum, row) => sum + row.attributedSubscriptions, 0);
  const optOuts = campaigns.reduce((sum, row) => sum + row.optOuts, 0);
  const ratio = (n: number, d: number) => d > 0 ? n / d : 0;

  return {
    windowDays: days,
    totals: {
      sent,
      uniqueRecipients,
      replied,
      positiveReplies,
      demoRequests,
      trialInterest,
      attributedSubscriptions,
      optOuts,
      replyRate: ratio(replied, sent),
      positiveReplyRate: ratio(positiveReplies, sent),
      paidConversionRate: ratio(attributedSubscriptions, sent),
    },
    campaigns,
  };
}
