/** @deprecated Use POST /api/realtime/session instead. Kept for relay-based pipeline clients. */

import { Router, type Request, type Response } from "express";
import { v1 } from "@workspace/api-zod";
import {
  db,
  agentProfilesTable,
  serviceConnectionsTable,
  emailCredentialsTable,
  externalDbConnectionsTable,
  knowledgeDocumentsTable,
  usageEventsTable,
} from "@workspace/db";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  jsonError,
  requireDb,
  userFromReq,
  userOwnsOrganization,
  v1RequireAuth,
} from "./_helpers";
import {
  getVoicePipelineAdapter,
  readVoicePipelineEnvCredentials,
} from "../../voice-pipelines";
import { getCachedCredentials } from "../../lib/credential-cache";
import {
  buildToolsFromSkills,
  buildInstructionsFromSkills,
  getSkillsForSession,
} from "../../skills";
import type { ToolDefinition } from "../../tools";
import { planAllowsPipeline, buildUsageLimitSnapshot } from "@workspace/voicelab-core/pricing";
import type { VoicePipelineProvider } from "@workspace/voicelab-core/voice-pipeline";
import { getNoiseModeBehavior, type NoiseMode } from "@workspace/voicelab-core/noise";

const router = Router();
router.use(v1RequireAuth as never, requireDb);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string");
}

function filterToolsByProfile(tools: ToolDefinition[], allowedToolNames: string[] | null): ToolDefinition[] {
  if (!allowedToolNames || allowedToolNames.length === 0) return tools;
  const allowed = new Set(allowedToolNames);
  return tools.filter((tool) => tool.name === "wait_for_user" || allowed.has(tool.name));
}

function tenantWhere<T extends { userId: any; organizationId: any }>(
  table: T,
  userId: number,
  organizationId: string,
) {
  return or(
    eq(table.organizationId, organizationId),
    and(eq(table.userId, userId), isNull(table.organizationId)),
  );
}

async function hasGeneralConnectedSystems(userId: number, organizationId: string): Promise<boolean> {
  const [[email], [document], [database]] = await Promise.all([
    db
      .select({ id: emailCredentialsTable.id })
      .from(emailCredentialsTable)
      .where(tenantWhere(emailCredentialsTable, userId, organizationId))
      .limit(1),
    db
      .select({ id: knowledgeDocumentsTable.id })
      .from(knowledgeDocumentsTable)
      .where(tenantWhere(knowledgeDocumentsTable, userId, organizationId))
      .limit(1),
    db
      .select({ id: externalDbConnectionsTable.id })
      .from(externalDbConnectionsTable)
      .where(tenantWhere(externalDbConnectionsTable, userId, organizationId))
      .limit(1),
  ]);
  return Boolean(email || document || database);
}

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

  const isAdmin = Boolean((req as Request & { isAdmin?: boolean }).isAdmin);
  const savedProvider = profile.voicePipelineProvider as VoicePipelineProvider;
  const provider: VoicePipelineProvider = parsed.data.pipelineOverride ?? savedProvider;
  if (provider !== savedProvider && !isAdmin) {
    jsonError(
      res,
      400,
      "pipeline_override_forbidden",
      "This assistant is configured for a different voice engine. Edit the assistant to change engines.",
    );
    return;
  }
  const plan = (req as Request & { subscription?: { plan?: string } }).subscription?.plan ?? "trial";
  if (!isAdmin && !planAllowsPipeline(plan, provider)) {
    jsonError(
      res,
      402,
      "pipeline_not_in_plan",
      `The "${provider}" voice engine is not included in your "${plan}" plan. Upgrade to unlock it.`,
    );
    return;
  }
  const adapter = getVoicePipelineAdapter(provider);
  const availability = await adapter.availability({
    credentials: readVoicePipelineEnvCredentials(),
  });
  if (
    availability.status === "needs_configuration" ||
    availability.status === "request_access" ||
    availability.status === "unavailable"
  ) {
    jsonError(
      res,
      503,
      "pipeline_not_available",
      availability.reason ?? `The "${provider}" voice engine is not available on this deployment.`,
      {
        status: availability.status,
        missing: availability.missing ?? [],
      },
    );
    return;
  }

  // Check usage limits & hard overage cap
  if (!isAdmin) {
    try {
      const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [usage] = await db
        .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
        .from(usageEventsTable)
        .where(and(
          profile.organizationId
            ? or(
                eq(usageEventsTable.organizationId, profile.organizationId),
                and(eq(usageEventsTable.userId, user.id), isNull(usageEventsTable.organizationId)),
              )
            : eq(usageEventsTable.userId, user.id),
          eq(usageEventsTable.kind, "voice_minutes"),
          gte(usageEventsTable.occurredAt, periodStart),
        ));
      
      const used = Number(usage?.total ?? 0);
      const limits = buildUsageLimitSnapshot(plan, used);
      if (limits.risk === "blocked") {
        jsonError(
          res,
          402,
          "usage_limit_exceeded",
          `Your voice assistants are currently suspended because you've reached your absolute plan overage cap (${limits.hardCapMinutes} min). Please upgrade on the Billing page to resume.`
        );
        return;
      }
    } catch (e: any) {
      // non-critical — proceed if db usage check fails to avoid voice session downtime
    }
  }

  // Infer assistant kind from the connected service. Anything that isn't
  // Square gets the general business persona.
  let assistantKind: "venue" | "general" = "venue";
  let sessionConnectionId = profile.connectedServiceId ?? "";
  if (profile.connectedServiceId) {
    const [conn] = await db
      .select({ provider: serviceConnectionsTable.provider })
      .from(serviceConnectionsTable)
      .where(
        and(
          eq(serviceConnectionsTable.id, profile.connectedServiceId),
          eq(serviceConnectionsTable.organizationId, profile.organizationId),
        ),
      )
      .limit(1);
    if (!conn) {
      jsonError(res, 403, "service_forbidden", "Connected service is not available for this workspace.");
      return;
    }
    if (conn && conn.provider !== "square") assistantKind = "general";
  } else {
    assistantKind = "general";
  }

  if (assistantKind === "venue") {
    if (!profile.venueId) {
      assistantKind = "general";
    } else {
      const creds = await getCachedCredentials(
        user.id,
        profile.venueId,
        profile.organizationId,
        profile.connectedServiceId,
      );
      if (creds) {
        sessionConnectionId = creds.serviceConnectionId ?? sessionConnectionId;
      } else {
        assistantKind = "general";
      }
    }
  } else if (!profile.connectedServiceId && profile.venueId) {
    const creds = await getCachedCredentials(user.id, profile.venueId, profile.organizationId);
    if (creds) {
      assistantKind = "venue";
      sessionConnectionId = creds.serviceConnectionId ?? "";
    }
  }

  const includeGeneralTools =
    assistantKind === "venue" && (await hasGeneralConnectedSystems(user.id, profile.organizationId));
  const profileAllowedTools = isStringArray(profile.allowedTools) ? profile.allowedTools : null;
  const skills = getSkillsForSession(plan, { kind: assistantKind, includeGeneralTools });
  const tools = filterToolsByProfile(buildToolsFromSkills(skills), profileAllowedTools);

  // Catalog is fetched lazily; build instructions with empty catalog/order — the
  // skill instructions still describe capabilities. The PWA can reload catalog
  // and request a new session.
  const instructions =
    `You are ${profile.displayName}, a voice agent for this venue. ` +
    (profile.personality ? `${profile.personality} ` : "") +
    "\n\n" +
    buildInstructionsFromSkills(skills, [], [], assistantKind);

  try {
    const noiseMode: NoiseMode =
      profile.noiseMode === "loud" || profile.noiseMode === "push_to_talk" ? profile.noiseMode : "standard";
    const session = await adapter.createSession({
      connectionId: sessionConnectionId,
      agentProfileId: profile.id,
      agentDisplayName: profile.displayName,
      userId: String(user.id),
      allowedToolNames: tools.map((t) => t.name),
      providerOptions: { ...(profile.voicePipelineConfig as Record<string, unknown>), noiseMode, tools },
      instructions,
    });
    const behavior = getNoiseModeBehavior(noiseMode);
    res.json({
      sessionId: session.sessionId,
      provider: session.provider,
      agentDisplayName: profile.displayName,
      noiseMode,
      clientHandshake: session.clientHandshake,
      capabilities: {
        ...session.capabilities,
        bargeIn: session.capabilities.bargeIn && behavior.bargeInEnabled,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "session creation failed";
    jsonError(res, 502, "pipeline_session_failed", message);
  }
});

export default router;
