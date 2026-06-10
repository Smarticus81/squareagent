import { Router } from "express";
import { ensureUserOrganization, v1RequireAuth, jsonError } from "./_helpers";
import { requirePlan } from "../auth";
import { ALL_WORKFLOWS } from "../../workflows";
import { executeWorkflow } from "../../workflows/engine";
import { getCachedCredentials } from "../../lib/credential-cache";
import { SquareClient } from "../../lib/square-client";
import type { ToolContext } from "../../tools/types";
import { getOrCreateSession } from "../../lib/session-store";
import { db, venuesTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";

const router = Router();

router.post("/:slug/run", v1RequireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const { slug } = req.params;
  const { venueId } = req.body ?? {};

  const workflow = ALL_WORKFLOWS.find((w) => w.id === slug);
  if (!workflow) {
    jsonError(res, 404, "workflow_not_found", `No workflow "${slug}"`);
    return;
  }

  if (!venueId) {
    jsonError(res, 400, "missing_venue", "venueId is required");
    return;
  }

  const numericVenueId = Number(venueId);
  if (!Number.isInteger(numericVenueId) || numericVenueId <= 0) {
    jsonError(res, 400, "invalid_venue", "venueId must be a positive integer");
    return;
  }

  const organizationId = req.organization?.id ?? (await ensureUserOrganization(req.user)).id;
  const [venue] = await db
    .select({ id: venuesTable.id })
    .from(venuesTable)
    .where(
      and(
        eq(venuesTable.id, numericVenueId),
        or(
          eq(venuesTable.organizationId, organizationId),
          and(eq(venuesTable.userId, req.user.id), isNull(venuesTable.organizationId)),
        ),
      ),
    )
    .limit(1);
  if (!venue) {
    jsonError(res, 404, "venue_not_found", "Venue not found in this organization.");
    return;
  }

  const creds = await getCachedCredentials(req.user.id, numericVenueId, organizationId);
  if (!creds || !creds.squareToken) {
    jsonError(res, 400, "no_credentials", "Venue not connected to Square");
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sessionId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session = getOrCreateSession(sessionId, creds.squareToken, creds.squareLocationId, req.user.id, numericVenueId);
  const squareClient = new SquareClient(creds.squareToken, creds.squareLocationId);

  const ctx: ToolContext = {
    catalog: [],
    order: [],
    squareToken: creds.squareToken,
    squareLocationId: creds.squareLocationId,
    session,
    squareClient,
    userId: req.user.id,
    organizationId,
    venueId: numericVenueId,
    assistantKind: "venue",
    noiseMode: "standard",
    confirmed: true,
    confirmationTrusted: true,
  };

  try {
    const { result, stepResults, totalDurationMs } = await executeWorkflow(workflow, {}, ctx);

    for (const step of stepResults) {
      res.write(`data: ${JSON.stringify({ type: "step", step: step.step, ok: step.ok, result: step.result, durationMs: step.durationMs })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: "done", summary: result, totalDurationMs })}\n\n`);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
  }

  res.end();
});

export default router;
