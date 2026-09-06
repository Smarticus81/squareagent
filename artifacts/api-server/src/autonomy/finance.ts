import { pool } from "@workspace/db";
import { getPlan } from "@workspace/voicelab-core/pricing";

export interface FinanceSnapshot {
  generatedAt: string;
  windowDays: number;
  mrrCents: number;
  paidOrganizations: number;
  arpaCents: number;
  voiceMinutes: number;
  estimatedVoiceCostCents: number | null;
  campaignSpendCents: number;
  cohortPaidCustomers: number;
  estimatedCacCents: number | null;
  estimatedGrossContributionCents: number | null;
  estimatedGrossMargin: number | null;
  cacPaybackMonths: number | null;
  costCoverageComplete: boolean;
  acquisitionEconomicsCoverage: boolean;
  verdict: "healthy" | "caution" | "veto" | "insufficient_cost_data";
  reasons: string[];
}

function envNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export async function collectFinanceSnapshot(windowDays = 30): Promise<FinanceSnapshot> {
  if (!pool) throw new Error("Database is required for finance metrics");
  const days = Math.max(1, Math.min(365, Math.floor(windowDays)));

  const [subs, usage, spend, cohort] = await Promise.all([
    pool.query<{ plan: string; count: number }>(
      `SELECT plan, COUNT(DISTINCT COALESCE(organization_id::text, 'user:' || user_id::text))::int AS count
       FROM subscriptions
       WHERE status IN ('active','paid') AND plan <> 'trial'
       GROUP BY plan`,
    ),
    pool.query<{ minutes: number }>(
      `SELECT COALESCE(SUM(quantity),0)::float AS minutes
       FROM usage_events
       WHERE kind='voice_minutes'
         AND occurred_at >= now() - ($1::text || ' days')::interval`,
      [days],
    ),
    pool.query<{ cents: number }>(
      `SELECT COALESCE(SUM(value_cents),0)::int AS cents
       FROM business_events
       WHERE event_type='campaign_spend'
         AND occurred_at >= now() - ($1::text || ' days')::interval`,
      [days],
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(DISTINCT u.id)::int AS count
       FROM users u
       WHERE u.created_at >= now() - ($1::text || ' days')::interval
         AND EXISTS (
           SELECT 1 FROM subscriptions s
           WHERE s.user_id=u.id AND s.plan <> 'trial' AND s.status IN ('active','paid')
         )`,
      [days],
    ),
  ]);

  let mrrCents = 0;
  let paidOrganizations = 0;
  for (const row of subs.rows) {
    const count = Number(row.count ?? 0);
    paidOrganizations += count;
    const plan = getPlan(String(row.plan));
    if (plan) mrrCents += Math.round(plan.monthlyPriceUsd * 100) * count;
  }

  const arpaCents = paidOrganizations > 0 ? Math.round(mrrCents / paidOrganizations) : 0;
  const voiceMinutes = Number(usage.rows[0]?.minutes ?? 0);
  const blendedVoiceCostPerMinuteCents = envNumber("AUTONOMY_BLENDED_VOICE_COST_CENTS_PER_MINUTE");
  const fixedInfraCentsPerMonth = envNumber("AUTONOMY_FIXED_INFRA_COST_CENTS_MONTH");
  const estimatedVoiceCostCents = blendedVoiceCostPerMinuteCents === null
    ? null
    : Math.round(voiceMinutes * blendedVoiceCostPerMinuteCents);
  const proratedFixedInfra = fixedInfraCentsPerMonth === null
    ? null
    : Math.round(fixedInfraCentsPerMonth * (days / 30));
  const campaignSpendCents = Number(spend.rows[0]?.cents ?? 0);
  const cohortPaidCustomers = Number(cohort.rows[0]?.count ?? 0);
  const estimatedCacCents = campaignSpendCents > 0 && cohortPaidCustomers > 0
    ? Math.round(campaignSpendCents / cohortPaidCustomers)
    : null;

  const periodRevenueCents = Math.round(mrrCents * (days / 30));
  const costCoverageComplete = estimatedVoiceCostCents !== null && proratedFixedInfra !== null;
  const directCosts = costCoverageComplete ? estimatedVoiceCostCents! + proratedFixedInfra! : null;
  const estimatedGrossContributionCents = directCosts === null ? null : periodRevenueCents - directCosts;
  const estimatedGrossMargin = estimatedGrossContributionCents === null || periodRevenueCents <= 0
    ? null
    : estimatedGrossContributionCents / periodRevenueCents;
  const monthlyGrossContributionPerCustomer = estimatedGrossMargin === null || arpaCents <= 0
    ? null
    : arpaCents * estimatedGrossMargin;
  const cacPaybackMonths = estimatedCacCents !== null && monthlyGrossContributionPerCustomer && monthlyGrossContributionPerCustomer > 0
    ? estimatedCacCents / monthlyGrossContributionPerCustomer
    : null;
  const acquisitionEconomicsCoverage = campaignSpendCents > 0 && cohortPaidCustomers > 0;

  const reasons: string[] = [];
  let verdict: FinanceSnapshot["verdict"] = "healthy";
  if (!costCoverageComplete) {
    verdict = "insufficient_cost_data";
    reasons.push("Set AUTONOMY_BLENDED_VOICE_COST_CENTS_PER_MINUTE and AUTONOMY_FIXED_INFRA_COST_CENTS_MONTH before finance can enforce gross-margin decisions.");
  } else {
    const minGrossMargin = (envNumber("AUTONOMY_MIN_GROSS_MARGIN_PERCENT") ?? 60) / 100;
    if (estimatedGrossMargin !== null && estimatedGrossMargin < minGrossMargin) {
      verdict = "veto";
      reasons.push(`Estimated gross margin ${(estimatedGrossMargin * 100).toFixed(1)}% is below the configured ${(minGrossMargin * 100).toFixed(0)}% floor.`);
    }
  }

  if (acquisitionEconomicsCoverage) {
    const maxPaybackMonths = envNumber("AUTONOMY_MAX_CAC_PAYBACK_MONTHS") ?? 12;
    if (cacPaybackMonths !== null && cacPaybackMonths > maxPaybackMonths) {
      verdict = "veto";
      reasons.push(`Estimated CAC payback ${cacPaybackMonths.toFixed(1)} months exceeds the configured ${maxPaybackMonths}-month ceiling.`);
    } else if (cacPaybackMonths !== null && cacPaybackMonths > Math.max(6, maxPaybackMonths * 0.7) && verdict === "healthy") {
      verdict = "caution";
      reasons.push(`Estimated CAC payback is ${cacPaybackMonths.toFixed(1)} months; acquisition should be scaled selectively.`);
    }
  } else if (campaignSpendCents > 0) {
    reasons.push("Acquisition spend exists but the current signup cohort has no paid conversion yet, so CAC is not measurable.");
    if (verdict === "healthy") verdict = "caution";
  }

  if (!reasons.length) reasons.push("Known unit economics are within configured thresholds.");

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    mrrCents,
    paidOrganizations,
    arpaCents,
    voiceMinutes,
    estimatedVoiceCostCents,
    campaignSpendCents,
    cohortPaidCustomers,
    estimatedCacCents,
    estimatedGrossContributionCents,
    estimatedGrossMargin,
    cacPaybackMonths,
    costCoverageComplete,
    acquisitionEconomicsCoverage,
    verdict,
    reasons,
  };
}

export function financeAllowsAcquisition(snapshot: FinanceSnapshot): boolean {
  return snapshot.verdict !== "veto";
}
