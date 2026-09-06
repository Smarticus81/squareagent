import { pool } from "@workspace/db";
import { getPlan } from "@workspace/voicelab-core/pricing";

export interface FunnelMetrics {
  visitors: number;
  signups: number;
  squareConnected: number;
  activated: number;
  paid: number;
  visitorToSignup: number;
  signupToConnect: number;
  connectToActivation: number;
  activationToPaid: number;
}

export interface ProductHealthMetrics {
  toolCalls: number;
  toolFailures: number;
  toolFailureRate: number;
  averageToolLatencyMs: number;
  voiceSessions: number;
  sessionsWithNoSuccessfulTool: number;
  noSuccessfulToolRate: number;
  topFailingTools: Array<{ tool: string; failures: number; calls: number; rate: number }>;
}

export interface RevenueMetrics {
  mrrCents: number;
  paidOrganizations: number;
  activeByPlan: Record<string, number>;
}

export interface BusinessSnapshot {
  generatedAt: string;
  windowDays: number;
  funnel: FunnelMetrics;
  product: ProductHealthMetrics;
  revenue: RevenueMetrics;
  churnEvents: number;
  supportOpened: number;
  supportResolved: number;
}

function ratio(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function collectBusinessSnapshot(windowDays = 30): Promise<BusinessSnapshot> {
  if (!pool) throw new Error("Database is required for autonomy metrics");
  const days = Math.max(1, Math.min(365, Math.floor(windowDays)));

  const [eventsResult, toolsResult, toolBreakdownResult, voiceResult, subsResult] = await Promise.all([
    pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM business_events
       WHERE occurred_at >= now() - ($1::text || ' days')::interval
       GROUP BY event_type`,
      [days],
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE status IN ('error','failed') OR error_message IS NOT NULL)::int AS failures,
         COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::int AS avg_latency
       FROM tool_calls
       WHERE created_at >= now() - ($1::text || ' days')::interval`,
      [days],
    ),
    pool.query(
      `SELECT tool_name,
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE status IN ('error','failed') OR error_message IS NOT NULL)::int AS failures
       FROM tool_calls
       WHERE created_at >= now() - ($1::text || ' days')::interval
       GROUP BY tool_name
       HAVING COUNT(*) >= 3
       ORDER BY failures DESC, calls DESC
       LIMIT 12`,
      [days],
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS sessions,
         COUNT(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM tool_calls tc
             WHERE tc.session_id = vs.id
               AND tc.created_at >= now() - ($1::text || ' days')::interval
               AND tc.status NOT IN ('error','failed')
               AND tc.error_message IS NULL
           )
         )::int AS no_success
       FROM voice_sessions vs
       WHERE vs.created_at >= now() - ($1::text || ' days')::interval`,
      [days],
    ),
    pool.query(
      `SELECT plan, COUNT(DISTINCT COALESCE(organization_id::text, 'user:' || user_id::text))::int AS count
       FROM subscriptions
       WHERE status IN ('active','paid','trialing') AND plan <> 'trial'
       GROUP BY plan`,
    ),
  ]);

  const events = new Map<string, number>();
  for (const row of eventsResult.rows) events.set(String(row.event_type), n(row.count));

  const visitors = events.get("visitor_seen") ?? 0;
  const signups = events.get("signup_completed") ?? 0;
  const squareConnected = events.get("square_connected") ?? 0;
  const activated = events.get("activation_reached") ?? 0;
  const paid = events.get("subscription_started") ?? 0;

  const toolRow = toolsResult.rows[0] ?? {};
  const calls = n(toolRow.calls);
  const failures = n(toolRow.failures);
  const voiceRow = voiceResult.rows[0] ?? {};
  const sessions = n(voiceRow.sessions);
  const noSuccess = n(voiceRow.no_success);

  const activeByPlan: Record<string, number> = {};
  let mrrCents = 0;
  let paidOrganizations = 0;
  for (const row of subsResult.rows) {
    const planId = String(row.plan);
    const count = n(row.count);
    activeByPlan[planId] = count;
    paidOrganizations += count;
    const plan = getPlan(planId);
    if (plan) mrrCents += Math.round(plan.monthlyPriceUsd * 100) * count;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    funnel: {
      visitors,
      signups,
      squareConnected,
      activated,
      paid,
      visitorToSignup: ratio(signups, visitors),
      signupToConnect: ratio(squareConnected, signups),
      connectToActivation: ratio(activated, squareConnected),
      activationToPaid: ratio(paid, activated),
    },
    product: {
      toolCalls: calls,
      toolFailures: failures,
      toolFailureRate: ratio(failures, calls),
      averageToolLatencyMs: n(toolRow.avg_latency),
      voiceSessions: sessions,
      sessionsWithNoSuccessfulTool: noSuccess,
      noSuccessfulToolRate: ratio(noSuccess, sessions),
      topFailingTools: toolBreakdownResult.rows.map((row) => ({
        tool: String(row.tool_name),
        failures: n(row.failures),
        calls: n(row.calls),
        rate: ratio(n(row.failures), n(row.calls)),
      })),
    },
    revenue: { mrrCents, paidOrganizations, activeByPlan },
    churnEvents: events.get("subscription_cancelled") ?? 0,
    supportOpened: events.get("support_opened") ?? 0,
    supportResolved: events.get("support_resolved") ?? 0,
  };
}

export function objectiveScore(snapshot: BusinessSnapshot): number {
  const mrr = snapshot.revenue.mrrCents / 100;
  const activation = snapshot.funnel.connectToActivation * 1_000;
  const conversion = snapshot.funnel.activationToPaid * 1_500;
  const reliabilityPenalty = snapshot.product.toolFailureRate * 2_000;
  const deadSessionPenalty = snapshot.product.noSuccessfulToolRate * 1_000;
  const churnPenalty = snapshot.churnEvents * 75;
  return Math.round(mrr + activation + conversion - reliabilityPenalty - deadSessionPenalty - churnPenalty);
}
