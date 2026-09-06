import crypto from "crypto";
import { pool } from "@workspace/db";
import { recordBusinessEvent } from "./ledger";

export interface ExperimentVariant {
  id: string;
  weight: number;
  payload?: Record<string, unknown>;
}

export async function createExperiment(params: {
  slug: string;
  hypothesis: string;
  primaryMetric: string;
  variants: ExperimentVariant[];
  guardrails?: Array<{ metric: string; max?: number; min?: number }>;
}): Promise<string> {
  if (!pool) throw new Error("Database is required for experiments");
  const totalWeight = params.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (params.variants.length < 2 || totalWeight <= 0) throw new Error("Experiment requires at least two positively weighted variants");
  const normalized = params.variants.map((variant) => ({ ...variant, weight: variant.weight / totalWeight }));
  const result = await pool.query<{ id: string }>(
    `INSERT INTO experiments (slug,status,hypothesis,primary_metric,variants,guardrails,allocation,started_at)
     VALUES ($1,'running',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,now())
     ON CONFLICT (slug) DO UPDATE SET
       hypothesis=EXCLUDED.hypothesis,
       primary_metric=EXCLUDED.primary_metric,
       variants=EXCLUDED.variants,
       guardrails=EXCLUDED.guardrails,
       allocation=EXCLUDED.allocation,
       updated_at=now()
     RETURNING id`,
    [params.slug, params.hypothesis, params.primaryMetric, JSON.stringify(normalized), JSON.stringify(params.guardrails ?? []), JSON.stringify(Object.fromEntries(normalized.map((v) => [v.id, v.weight])))],
  );
  return result.rows[0].id;
}

function bucket(identity: string, slug: string): number {
  const digest = crypto.createHash("sha256").update(`${slug}:${identity}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export async function assignExperiment(slug: string, identity: string): Promise<{ experimentId: string; variant: ExperimentVariant } | null> {
  if (!pool || !identity) return null;
  const result = await pool.query(`SELECT id,variants FROM experiments WHERE slug=$1 AND status='running' LIMIT 1`, [slug]);
  const experiment = result.rows[0];
  if (!experiment) return null;
  const variants = (Array.isArray(experiment.variants) ? experiment.variants : []) as ExperimentVariant[];
  const point = bucket(identity, slug);
  let cumulative = 0;
  let selected = variants[variants.length - 1];
  for (const variant of variants) {
    cumulative += Number(variant.weight ?? 0);
    if (point <= cumulative) { selected = variant; break; }
  }
  if (!selected) return null;
  await recordBusinessEvent({
    visitorId: identity,
    eventType: "experiment_exposed",
    actorType: "system",
    experimentId: experiment.id,
    variant: selected.id,
    properties: { slug },
    dedupeKey: `experiment:${experiment.id}:${identity}`,
  });
  return { experimentId: experiment.id, variant: selected };
}

function zScore(successA: number, totalA: number, successB: number, totalB: number): number {
  if (!totalA || !totalB) return 0;
  const pA = successA / totalA;
  const pB = successB / totalB;
  const pooled = (successA + successB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  return se > 0 ? (pB - pA) / se : 0;
}

export async function evaluateExperiments(): Promise<Array<{ slug: string; status: string; winner?: string; result: unknown }>> {
  if (!pool) return [];
  const active = await pool.query(`SELECT id,slug,primary_metric,variants FROM experiments WHERE status='running' ORDER BY started_at ASC`);
  const outcomes: Array<{ slug: string; status: string; winner?: string; result: unknown }> = [];

  for (const experiment of active.rows) {
    const variants = (Array.isArray(experiment.variants) ? experiment.variants : []) as ExperimentVariant[];
    if (variants.length < 2) continue;
    const exposureResult = await pool.query(
      `SELECT variant, COUNT(DISTINCT COALESCE(visitor_id, user_id::text, session_id))::int AS exposed
       FROM business_events WHERE experiment_id=$1 AND event_type='experiment_exposed' GROUP BY variant`,
      [experiment.id],
    );
    const conversionResult = await pool.query(
      `SELECT variant, COUNT(DISTINCT COALESCE(visitor_id, user_id::text, session_id))::int AS converted
       FROM business_events WHERE experiment_id=$1 AND event_type=$2 GROUP BY variant`,
      [experiment.id, experiment.primary_metric],
    );
    const exposures = new Map(exposureResult.rows.map((row) => [String(row.variant), Number(row.exposed)]));
    const conversions = new Map(conversionResult.rows.map((row) => [String(row.variant), Number(row.converted)]));
    const control = variants[0];
    const controlN = exposures.get(control.id) ?? 0;
    const controlSuccess = conversions.get(control.id) ?? 0;
    let best: { id: string; z: number; rate: number; n: number; conversions: number } | null = null;

    for (const candidate of variants.slice(1)) {
      const n = exposures.get(candidate.id) ?? 0;
      const success = conversions.get(candidate.id) ?? 0;
      const z = zScore(controlSuccess, controlN, success, n);
      const rate = n ? success / n : 0;
      if (!best || z > best.z) best = { id: candidate.id, z, rate, n, conversions: success };
    }

    const controlRate = controlN ? controlSuccess / controlN : 0;
    const summary = {
      control: { id: control.id, exposed: controlN, conversions: controlSuccess, rate: controlRate },
      best,
      confidenceThreshold: 1.96,
      minSamplePerVariant: 50,
    };

    if (best && controlN >= 50 && best.n >= 50 && best.z >= 1.96 && best.rate > controlRate) {
      await pool.query(
        `UPDATE experiments SET status='completed',winner=$2,result=$3::jsonb,ended_at=now(),updated_at=now() WHERE id=$1`,
        [experiment.id, best.id, JSON.stringify(summary)],
      );
      outcomes.push({ slug: experiment.slug, status: "completed", winner: best.id, result: summary });
    } else {
      await pool.query(`UPDATE experiments SET result=$2::jsonb,updated_at=now() WHERE id=$1`, [experiment.id, JSON.stringify(summary)]);
      outcomes.push({ slug: experiment.slug, status: "running", result: summary });
    }
  }
  return outcomes;
}
