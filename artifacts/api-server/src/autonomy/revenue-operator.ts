import { pool } from "@workspace/db";
import { getPlan } from "@workspace/voicelab-core/pricing";
import { recordBusinessEvent } from "./ledger";

export interface RevenuePressureSnapshot {
  generatedAt: string;
  paidStarts7d: number;
  newMrrCents7d: number;
  cancellations7d: number;
  netPaidGrowth7d: number;
  lastPaidAt: string | null;
  daysSinceLastPaid: number | null;
  revenueEmergency: boolean;
}

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function collectRevenuePressure(): Promise<RevenuePressureSnapshot> {
  if (!pool) throw new Error("Database is required for revenue pressure metrics");

  const [starts, cancellations, lastPaid] = await Promise.all([
    pool.query<{ plan: string; count: number }>(
      `SELECT plan, COUNT(*)::int AS count
       FROM subscriptions
       WHERE plan <> 'trial'
         AND status IN ('active','paid')
         AND created_at >= now() - interval '7 days'
       GROUP BY plan`,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM subscriptions
       WHERE plan <> 'trial'
         AND status IN ('canceled','cancelled')
         AND updated_at >= now() - interval '7 days'`,
    ),
    pool.query<{ created_at: Date | null }>(
      `SELECT created_at
       FROM subscriptions
       WHERE plan <> 'trial' AND status IN ('active','paid')
       ORDER BY created_at DESC
       LIMIT 1`,
    ),
  ]);

  let paidStarts7d = 0;
  let newMrrCents7d = 0;
  for (const row of starts.rows) {
    const count = Number(row.count ?? 0);
    paidStarts7d += count;
    const plan = getPlan(String(row.plan));
    if (plan) newMrrCents7d += Math.round(plan.monthlyPriceUsd * 100) * count;
  }

  const cancellations7d = Number(cancellations.rows[0]?.count ?? 0);
  const lastPaidDate = lastPaid.rows[0]?.created_at ? new Date(lastPaid.rows[0].created_at) : null;
  const daysSinceLastPaid = lastPaidDate
    ? Math.max(0, (Date.now() - lastPaidDate.getTime()) / 86_400_000)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    paidStarts7d,
    newMrrCents7d,
    cancellations7d,
    netPaidGrowth7d: paidStarts7d - cancellations7d,
    lastPaidAt: lastPaidDate?.toISOString() ?? null,
    daysSinceLastPaid,
    revenueEmergency: paidStarts7d === 0,
  };
}

/**
 * A campaign that has had enough real, provider-confirmed deliveries but has
 * created zero paid customers is not "learning" forever. It is losing. Kill it
 * and force the next strategy cycle to create a materially different offer.
 */
export async function killZeroRevenueCampaigns(): Promise<{ inspected: number; killed: string[]; threshold: number }> {
  if (!pool) return { inspected: 0, killed: [], threshold: 0 };
  const threshold = Math.max(6, Math.floor(numberEnv("AUTONOMY_ZERO_CONVERSION_ROTATE_AFTER_SENDS", 12)));
  const campaigns = await pool.query<{ id: string; slug: string }>(
    `SELECT id::text,slug
     FROM experiments
     WHERE status='running' AND primary_metric='outbound_subscription_attributed'
     ORDER BY created_at ASC`,
  );

  const killed: string[] = [];
  for (const campaign of campaigns.rows) {
    const performance = await pool.query<{ sent: number; paid: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type='outbound_sent')::int AS sent,
         COUNT(*) FILTER (WHERE event_type='outbound_subscription_attributed')::int AS paid
       FROM business_events
       WHERE campaign=$1::text`,
      [campaign.slug],
    );
    const sent = Number(performance.rows[0]?.sent ?? 0);
    const paid = Number(performance.rows[0]?.paid ?? 0);
    if (sent < threshold || paid > 0) continue;

    await pool.query(
      `UPDATE experiments
       SET status='superseded', ended_at=COALESCE(ended_at,now()), updated_at=now(),
           result=COALESCE(result,'{}'::jsonb) || $2::jsonb
       WHERE id=$1::uuid AND status='running'`,
      [campaign.id, JSON.stringify({ stoppedReason: "zero_paid_conversions", confirmedSends: sent, paidConversions: paid })],
    );
    await recordBusinessEvent({
      eventType: "campaign_killed_zero_revenue",
      actorType: "system",
      actorId: "revenue-operator",
      campaign: campaign.slug,
      properties: { confirmedSends: sent, paidConversions: paid, threshold },
      dedupeKey: `campaign-killed-zero-revenue:${campaign.slug}`,
    });
    killed.push(campaign.slug);
  }

  return { inspected: campaigns.rows.length, killed, threshold };
}
