import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import { collectBusinessSnapshot, objectiveScore } from "../../autonomy/metrics";
import { runAutonomyCycleLocked } from "../../autonomy/orchestrator";
import { recordBusinessEvent } from "../../autonomy/ledger";
import { assignExperiment, createExperiment } from "../../autonomy/experiments";
import { optOutLead } from "../../autonomy/growth";
import { VOYCELAB_OBJECTIVE, autonomyEnabled, codeWritesEnabled, outboundEnabled, DEFAULT_AUTONOMY_BUDGET } from "../../autonomy/constitution";
import { jsonError, v1RequireAuth } from "./_helpers";

const router = Router();

const publicTelemetryLimit = rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "telemetry_rate_limited" },
});

const PUBLIC_EVENT_TYPES = new Set([
  "visitor_seen",
  "cta_clicked",
  "demo_started",
  "demo_completed",
  "signup_started",
  "signup_completed",
  "checkout_started",
  "activation_reached",
  "subscription_started",
]);

function cleanString(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function routeParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;
}

// Public first-party telemetry endpoint used by the marketing site. The event
// allowlist prevents callers from forging internal support/finance/action events.
router.post("/events", publicTelemetryLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const eventType = cleanString(req.body?.eventType, 80);
    if (!eventType || !PUBLIC_EVENT_TYPES.has(eventType)) {
      res.status(400).json({ error: "unsupported_event_type" });
      return;
    }
    const properties = req.body?.properties && typeof req.body.properties === "object"
      ? Object.fromEntries(Object.entries(req.body.properties).slice(0, 30).map(([key, value]) => [key.slice(0, 80), typeof value === "string" ? value.slice(0, 500) : value]))
      : {};
    const id = await recordBusinessEvent({
      visitorId: cleanString(req.body?.visitorId, 120),
      sessionId: cleanString(req.body?.sessionId, 120),
      eventType,
      actorType: "visitor",
      source: cleanString(req.body?.source, 120),
      campaign: cleanString(req.body?.campaign, 120),
      experimentId: cleanString(req.body?.experimentId, 80),
      variant: cleanString(req.body?.variant, 80),
      properties,
      dedupeKey: cleanString(req.body?.dedupeKey, 220),
    });
    res.status(202).json({ accepted: true, id });
  } catch {
    res.status(202).json({ accepted: true });
  }
});

router.get("/experiments/:slug/assign", publicTelemetryLimit, async (req: Request, res: Response): Promise<void> => {
  const identity = cleanString(req.query.identity, 160);
  const slug = routeParam(req.params.slug);
  if (!identity) { res.status(400).json({ error: "identity_required" }); return; }
  if (!slug) { res.status(400).json({ error: "experiment_slug_required" }); return; }
  const assignment = await assignExperiment(slug, identity);
  if (!assignment) { res.status(404).json({ error: "experiment_not_running" }); return; }
  res.json(assignment);
});

router.use(v1RequireAuth as any);

function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!(req as Request & { isAdmin?: boolean }).isAdmin) {
    jsonError(res, 403, "admin_required", "Platform admin access required for the autonomous business control plane.");
    return;
  }
  next();
}
router.use(requirePlatformAdmin);

router.get("/status", async (_req: Request, res: Response): Promise<void> => {
  if (!pool) { res.status(503).json({ error: "database_unavailable" }); return; }
  const [snapshot, runs, actions, findings, experiments, leads, opportunities] = await Promise.all([
    collectBusinessSnapshot(30),
    pool.query(`SELECT id,run_type,trigger,status,objective_score_before,objective_score_after,started_at,finished_at,error_message,plan,result FROM autonomy_runs ORDER BY started_at DESC LIMIT 12`),
    pool.query(`SELECT id,agent,action_type,risk_level,authority,status,external_ref,cost_cents,expected_impact,actual_impact,created_at,executed_at,rolled_back_at FROM autonomous_actions ORDER BY created_at DESC LIMIT 30`),
    pool.query(`SELECT id,fingerprint,status,severity,subsystem,title,evidence,recommended_change,github_pr_url,updated_at FROM product_findings ORDER BY updated_at DESC LIMIT 25`),
    pool.query(`SELECT id,slug,status,hypothesis,primary_metric,winner,result,started_at,ended_at FROM experiments ORDER BY created_at DESC LIMIT 20`),
    pool.query(`SELECT id,company_name,website,contact_name,contact_email,segment,stage,fit_score,evidence,last_contacted_at,next_contact_at FROM prospect_leads ORDER BY fit_score DESC,created_at DESC LIMIT 50`),
    pool.query(`SELECT id,kind,status,title,description,priority_score,confidence_milli,estimated_impact,evidence,recommendation,effort,risk_level,created_at,updated_at FROM autonomy_opportunities ORDER BY priority_score DESC,updated_at DESC LIMIT 30`),
  ]);
  res.json({
    enabled: autonomyEnabled(),
    codeWritesEnabled: codeWritesEnabled(),
    outboundEnabled: outboundEnabled(),
    objective: VOYCELAB_OBJECTIVE,
    budget: DEFAULT_AUTONOMY_BUDGET,
    snapshot,
    objectiveScore: objectiveScore(snapshot),
    runs: runs.rows,
    actions: actions.rows,
    productFindings: findings.rows,
    experiments: experiments.rows,
    leads: leads.rows,
    opportunities: opportunities.rows,
  });
});

router.post("/run", async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await runAutonomyCycleLocked("founder_api");
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "autonomy_cycle_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/experiments", async (req: Request, res: Response): Promise<void> => {
  try {
    const slug = cleanString(req.body?.slug, 100);
    const hypothesis = cleanString(req.body?.hypothesis, 500);
    const primaryMetric = cleanString(req.body?.primaryMetric, 100);
    const variants = Array.isArray(req.body?.variants) ? req.body.variants.slice(0, 8) : [];
    if (!slug || !hypothesis || !primaryMetric || variants.length < 2) {
      res.status(400).json({ error: "invalid_experiment" });
      return;
    }
    const cleanedVariants = variants.map((variant: any, index: number) => ({
      id: cleanString(variant?.id, 80) ?? `variant-${index + 1}`,
      weight: Math.max(0, Number(variant?.weight ?? 1)),
      payload: variant?.payload && typeof variant.payload === "object" ? variant.payload : {},
    }));
    const id = await createExperiment({
      slug,
      hypothesis,
      primaryMetric,
      variants: cleanedVariants,
      guardrails: Array.isArray(req.body?.guardrails) ? req.body.guardrails.slice(0, 12) : [],
    });
    res.status(201).json({ id, slug });
  } catch (error) {
    res.status(400).json({ error: "experiment_create_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/leads/:id/opt-out", async (req: Request, res: Response): Promise<void> => {
  const leadId = routeParam(req.params.id);
  if (!leadId) { res.status(400).json({ error: "lead_id_required" }); return; }
  await optOutLead(leadId, cleanString(req.body?.reason, 180) ?? "founder_marked_opt_out");
  res.json({ ok: true });
});

export default router;
