/** @deprecated Use POST /api/realtime/session instead. Kept for relay-based pipeline clients. */

import { Router, type Request, type Response } from "express";
import { v1 } from "@workspace/api-zod";
import { db, agentProfilesTable, serviceConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  jsonError,
  requireDb,
  userFromReq,
  userOwnsOrganization,
  v1RequireAuth,
} from "./_helpers";
import {
  getVoicePipelineAdapter,
} from "../../voice-pipelines";
import {
  buildToolsFromSkills,
  buildInstructionsFromSkills,
  getSkillsForSession,
} from "../../skills";
import type { VoicePipelineProvider } from "@workspace/voicelab-core/voice-pipeline";

const router = Router();
router.use(v1RequireAuth as never, requireDb);

router.post("/", async (req: Request, res: Response) => {
  const user = userFromReq(req);
  const parsed = v1.CreateRealtimeSessionRequest.safeParse(req.body);
  if (!parsed.success) {
    jsonError(res, 400, "invalid_request", parsed.error.message);
    return;
  }
  const [profile] = await db
    .select()
    .from(agentProfilesTable)
    .where(eq(agentProfilesTable.id, parsed.data.agentProfileId))
    .limit(1);
  if (!profile) {
    jsonError(res, 404, "not_found", "Agent profile not found.");
    return;
  }
  if (!(await userOwnsOrganization(user.id, profile.organizationId))) {
    jsonError(res, 403, "forbidden", "Access denied.");
    return;
  }

  const provider: VoicePipelineProvider =
    parsed.data.pipelineOverride ?? (profile.voicePipelineProvider as VoicePipelineProvider);
  const adapter = getVoicePipelineAdapter(provider);

  const plan = (req as Request & { subscription?: { plan?: string } }).subscription?.plan ?? "trial";
  const skills = getSkillsForSession(plan);
  const tools = buildToolsFromSkills(skills);

  // Infer assistant kind from the connected service. Anything that isn't
  // Square gets the general business persona.
  let assistantKind: "venue" | "general" = "venue";
  if (profile.connectedServiceId) {
    const [conn] = await db
      .select({ provider: serviceConnectionsTable.provider })
      .from(serviceConnectionsTable)
      .where(eq(serviceConnectionsTable.id, profile.connectedServiceId))
      .limit(1);
    if (conn && conn.provider !== "square") assistantKind = "general";
  } else {
    assistantKind = "general";
  }

  // Catalog is fetched lazily; build instructions with empty catalog/order — the
  // skill instructions still describe capabilities. The PWA can reload catalog
  // and request a new session.
  const instructions =
    `You are ${profile.displayName}, a voice agent for this venue. ` +
    (profile.personality ? `${profile.personality} ` : "") +
    "\n\n" +
    buildInstructionsFromSkills(skills, [], [], assistantKind);

  try {
    const session = await adapter.createSession({
      connectionId: profile.connectedServiceId ?? "",
      agentProfileId: profile.id,
      agentDisplayName: profile.displayName,
      userId: String(user.id),
      allowedToolNames:
        Array.isArray(profile.allowedTools) && profile.allowedTools.length > 0
          ? (profile.allowedTools as string[])
          : tools.map((t) => t.name),
      providerOptions: { ...(profile.voicePipelineConfig as Record<string, unknown>), tools },
      instructions,
    });
    res.json({
      sessionId: session.sessionId,
      provider: session.provider,
      agentDisplayName: profile.displayName,
      noiseMode: profile.noiseMode,
      clientHandshake: session.clientHandshake,
      capabilities: session.capabilities,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "session creation failed";
    jsonError(res, 502, "pipeline_session_failed", message);
  }
});

export default router;
