import { Router, type Request, type Response } from "express";
import { v1 } from "@workspace/api-zod";
import { db, agentProfilesTable, venuesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ensureUserOrganization,
  jsonError,
  requireDb,
  userFromReq,
  userOwnsOrganization,
  v1RequireAuth,
} from "./_helpers";
import {
  DEFAULT_AGENT_PERSONALITY,
  defaultWakePhraseFor,
} from "@workspace/voicelab-core/agent-profile";
import { DEFAULT_CONFIRMATION_POLICY } from "@workspace/voicelab-core/confirmation";
import { planAllowsPipeline } from "@workspace/voicelab-core/pricing";
import type { VoicePipelineProvider } from "@workspace/voicelab-core/voice-pipeline";
import { invalidateAgentProfile } from "../../lib/agent-profile-cache";

const router = Router();
router.use(v1RequireAuth as never, requireDb);

interface AgentProfileRow {
  id: string;
  organizationId: string;
  venueId: number | null;
  connectedServiceId: string | null;
  displayName: string;
  wakePhrase: string;
  voicePipelineProvider: string;
  voicePipelineConfig: Record<string, unknown>;
  noiseMode: string;
  allowedTools: string[];
  confirmationPolicy: Record<string, unknown>;
  personality: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function rowToResponse(row: AgentProfileRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    venueId: row.venueId,
    connectedServiceId: row.connectedServiceId,
    displayName: row.displayName,
    wakePhrase: row.wakePhrase,
    voicePipelineProvider: row.voicePipelineProvider,
    voicePipelineConfig: row.voicePipelineConfig,
    noiseMode: row.noiseMode,
    allowedTools: row.allowedTools,
    confirmationPolicy: row.confirmationPolicy,
    personality: row.personality,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/", async (req: Request, res: Response) => {
  const user = userFromReq(req);
  const org = await ensureUserOrganization(user);
  const rows = await db
    .select()
    .from(agentProfilesTable)
    .where(eq(agentProfilesTable.organizationId, org.id));
  res.json({
    profiles: rows.map((r: typeof rows[number]) => rowToResponse(r as unknown as AgentProfileRow)),
  });
});

router.post("/", async (req: Request, res: Response) => {
  const user = userFromReq(req);
  const parsed = v1.CreateAgentProfileRequest.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.warn("[agent-profiles] POST validation failed", {
      issues: parsed.error.issues,
      body: req.body,
    });
    const firstIssue = parsed.error.issues[0];
    const friendly = firstIssue
      ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}`
      : "Invalid request body.";
    jsonError(res, 400, "invalid_request", friendly, {
      fieldErrors: flat.fieldErrors,
      formErrors: flat.formErrors,
    });
    return;
  }
  const body = parsed.data;
  if (!(await userOwnsOrganization(user.id, body.organizationId))) {
    jsonError(res, 403, "forbidden", "User does not own this organization.");
    return;
  }
  if (body.venueId) {
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(and(eq(venuesTable.id, body.venueId), eq(venuesTable.userId, user.id)))
      .limit(1);
    if (!venue) {
      jsonError(res, 404, "venue_not_found", "Venue not found or not owned by user.");
      return;
    }
  }

  // Pipeline-tier gating: prevent picking a pipeline that's not unlocked
  // by the user's current subscription plan. This is enforced server-side
  // so the wizard can't bypass it by sending a different provider.
  // Platform admins (tmusoni@thinkertons.com etc.) bypass tier gating.
  const isAdmin = Boolean((req as Request & { isAdmin?: boolean }).isAdmin);
  const plan = (req as Request & { subscription?: { plan?: string } }).subscription?.plan ?? "trial";
  if (
    !isAdmin &&
    !planAllowsPipeline(plan, body.voicePipelineProvider as VoicePipelineProvider)
  ) {
    jsonError(
      res,
      402,
      "pipeline_not_in_plan",
      `The "${body.voicePipelineProvider}" voice engine is not included in your "${plan}" plan. Upgrade to unlock it.`,
    );
    return;
  }

  const wakePhrase = body.wakePhrase ?? defaultWakePhraseFor(body.displayName);

  const [row] = await db
    .insert(agentProfilesTable)
    .values({
      organizationId: body.organizationId,
      venueId: body.venueId ?? null,
      connectedServiceId: body.connectedServiceId ?? null,
      displayName: body.displayName,
      wakePhrase,
      voicePipelineProvider: body.voicePipelineProvider,
      voicePipelineConfig: body.voicePipelineConfig,
      noiseMode: body.noiseMode,
      allowedTools: body.allowedTools,
      confirmationPolicy:
        Object.keys(body.confirmationPolicy).length > 0
          ? body.confirmationPolicy
          : (DEFAULT_CONFIRMATION_POLICY as unknown as Record<string, unknown>),
      personality: body.personality || DEFAULT_AGENT_PERSONALITY,
    })
    .returning();
  res.status(201).json(rowToResponse(row as AgentProfileRow));
});

router.get("/:id", async (req: Request, res: Response) => {
  const user = userFromReq(req);
  const [row] = await db
    .select()
    .from(agentProfilesTable)
    .where(eq(agentProfilesTable.id, String(req.params.id)))
    .limit(1);
  if (!row) {
    jsonError(res, 404, "not_found", "Agent profile not found.");
    return;
  }
  if (!(await userOwnsOrganization(user.id, row.organizationId))) {
    jsonError(res, 403, "forbidden", "Access denied.");
    return;
  }
  res.json(rowToResponse(row as AgentProfileRow));
});

router.patch("/:id", async (req: Request, res: Response) => {
  const user = userFromReq(req);
  const parsed = v1.UpdateAgentProfileRequest.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.warn("[agent-profiles] PATCH validation failed", {
      issues: parsed.error.issues,
      body: req.body,
    });
    const firstIssue = parsed.error.issues[0];
    const friendly = firstIssue
      ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}`
      : "Invalid request body.";
    jsonError(res, 400, "invalid_request", friendly, {
      fieldErrors: flat.fieldErrors,
      formErrors: flat.formErrors,
    });
    return;
  }
  const [existing] = await db
    .select()
    .from(agentProfilesTable)
    .where(eq(agentProfilesTable.id, String(req.params.id)))
    .limit(1);
  if (!existing) {
    jsonError(res, 404, "not_found", "Agent profile not found.");
    return;
  }
  if (!(await userOwnsOrganization(user.id, existing.organizationId))) {
    jsonError(res, 403, "forbidden", "Access denied.");
    return;
  }
  if (parsed.data.voicePipelineProvider) {
    const isAdmin = Boolean((req as Request & { isAdmin?: boolean }).isAdmin);
    const plan = (req as Request & { subscription?: { plan?: string } }).subscription?.plan ?? "trial";
    if (
      !isAdmin &&
      !planAllowsPipeline(plan, parsed.data.voicePipelineProvider as VoicePipelineProvider)
    ) {
      jsonError(
        res,
        402,
        "pipeline_not_in_plan",
        `The "${parsed.data.voicePipelineProvider}" voice engine is not included in your "${plan}" plan. Upgrade to unlock it.`,
      );
      return;
    }
  }
  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  // Drop undefined keys so we don't overwrite columns with null.
  for (const k of Object.keys(updates)) {
    if (updates[k] === undefined) delete updates[k];
  }
  const [row] = await db
    .update(agentProfilesTable)
    .set(updates)
    .where(eq(agentProfilesTable.id, String(req.params.id)))
    .returning();
  invalidateAgentProfile(String(req.params.id));
  res.json(rowToResponse(row as AgentProfileRow));
});

router.delete("/:id", async (req: Request, res: Response) => {
  const user = userFromReq(req);
  const [existing] = await db
    .select()
    .from(agentProfilesTable)
    .where(eq(agentProfilesTable.id, String(req.params.id)))
    .limit(1);
  if (!existing) {
    res.status(204).end();
    return;
  }
  if (!(await userOwnsOrganization(user.id, existing.organizationId))) {
    jsonError(res, 403, "forbidden", "Access denied.");
    return;
  }
  await db.delete(agentProfilesTable).where(eq(agentProfilesTable.id, String(req.params.id)));
  invalidateAgentProfile(String(req.params.id));
  res.status(204).end();
});

export default router;
