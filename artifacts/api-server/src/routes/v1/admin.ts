import { Router, type NextFunction, type Request, type Response } from "express";
import {
  db,
  agentProfilesTable,
  organizationMembershipsTable,
  organizationsTable,
  subscriptionsTable,
  toolCallsTable,
  usageEventsTable,
  usersTable,
  venuesTable,
  type User,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getAllPipelineAvailability } from "../../voice-pipelines";
import { invalidateAuthCacheForUser, isAdminEmail } from "../auth";
import { ensureUserOrganization, jsonError, requireDb, v1RequireAuth, ROLES, type Role } from "./_helpers";
import { getPlan, buildUsageLimitSnapshot, type UsageRisk } from "@workspace/voicelab-core/pricing";
import { credentialCacheSize } from "../../lib/credential-cache";

const router = Router();

const PLANS = ["trial", "pro", "business", "admin"] as const;
const STATUSES = ["trialing", "active", "past_due", "canceled", "inactive"] as const;

type Plan = typeof PLANS[number];
type Status = typeof STATUSES[number];
type UserRow = typeof usersTable.$inferSelect;
type SubscriptionRow = typeof subscriptionsTable.$inferSelect;
type MembershipSummary = {
  userId: number;
  organizationId: string;
  role: string;
  organizationName: string | null;
};
type UserTotal = { userId: number | null; total: unknown };
type UserLastActivity = { userId: number | null; lastActivityAt: Date | string | null };
type TopTool = { toolName: string; count: unknown };
type RecentError = {
  userId: number | null;
  email: string | null;
  toolName: string;
  errorMessage: string | null;
  createdAt: Date | string;
};

const ROLE_DEFINITIONS: Array<{
  role: Role;
  label: string;
  permissions: string[];
}> = [
  {
    role: "owner",
    label: "Owner",
    permissions: ["Billing", "access control", "assistants", "connected services", "telemetry"],
  },
  {
    role: "admin",
    label: "Admin",
    permissions: ["Access control", "assistants", "connected services", "telemetry"],
  },
  {
    role: "manager",
    label: "Manager",
    permissions: ["Assistants", "connected services", "usage telemetry"],
  },
  {
    role: "operator",
    label: "Operator",
    permissions: ["Run assistants", "use approved commands"],
  },
];

function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!(req as Request & { isAdmin?: boolean }).isAdmin) {
    jsonError(res, 403, "admin_required", "Platform admin access required.");
    return;
  }
  next();
}

function numberFromAggregate(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function parseWindowDays(raw: unknown): number {
  const value = Number(raw ?? 30);
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(1, Math.floor(value)));
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

async function primaryMembershipForUser(user: User) {
  const [existing] = await db
    .select({
      id: organizationMembershipsTable.id,
      organizationId: organizationMembershipsTable.organizationId,
      role: organizationMembershipsTable.role,
      organizationName: organizationsTable.name,
    })
    .from(organizationMembershipsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, organizationMembershipsTable.organizationId))
    .where(eq(organizationMembershipsTable.userId, user.id))
    .limit(1);

  if (existing) return existing;

  const org = await ensureUserOrganization(user);
  const [created] = await db
    .select({
      id: organizationMembershipsTable.id,
      organizationId: organizationMembershipsTable.organizationId,
      role: organizationMembershipsTable.role,
      organizationName: organizationsTable.name,
    })
    .from(organizationMembershipsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, organizationMembershipsTable.organizationId))
    .where(and(
      eq(organizationMembershipsTable.userId, user.id),
      eq(organizationMembershipsTable.organizationId, org.id),
    ))
    .limit(1);

  return created ?? null;
}

router.use(v1RequireAuth as never, requireDb, requirePlatformAdmin);

router.get("/diagnostics", async (req: Request, res: Response) => {
  try {
    const diagnostics: any = {};

    // 1. Environment variables check
    diagnostics.env = {
      databaseUrlSet: !!process.env.DATABASE_URL,
      secretsEncryptionKeySet: !!process.env.SECRETS_ENCRYPTION_KEY,
      openaiApiKeySet: !!process.env.OPENAI_API_KEY,
      googleGeminiApiKeySet: !!process.env.GOOGLE_GEMINI_API_KEY,
      squareAppIdSet: !!process.env.SQUARE_APPLICATION_ID,
      squareAppSecretSet: !!process.env.SQUARE_APPLICATION_SECRET,
      clerkSecretKeySet: !!process.env.CLERK_SECRET_KEY,
      clerkPublishableKeySet: !!process.env.VITE_CLERK_PUBLISHABLE_KEY,
    };

    // 2. Database Connectivity & Latency check
    const dbStart = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      diagnostics.database = {
        status: "healthy",
        latencyMs: Date.now() - dbStart,
      };
    } catch (e: any) {
      diagnostics.database = {
        status: "unhealthy",
        error: e.message,
        latencyMs: Date.now() - dbStart,
      };
    }

    // 3. Square API Connectivity check
    const sqStart = Date.now();
    try {
      const response = await fetch("https://connect.squareup.com/v2/locations", {
        headers: {
          "Authorization": `Bearer ${process.env.SQUARE_APPLICATION_SECRET || ""}`,
          "Content-Type": "application/json",
        },
      });
      diagnostics.squareApi = {
        status: response.status === 200 || response.status === 401 ? "healthy" : "degraded",
        statusCode: response.status,
        latencyMs: Date.now() - sqStart,
      };
    } catch (e: any) {
      diagnostics.squareApi = {
        status: "unreachable",
        error: e.message,
        latencyMs: Date.now() - sqStart,
      };
    }

    // 4. OpenAI API Connectivity check
    const openaiStart = Date.now();
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
        },
      });
      diagnostics.openaiApi = {
        status: response.status === 200 || response.status === 401 ? "healthy" : "degraded",
        statusCode: response.status,
        latencyMs: Date.now() - openaiStart,
      };
    } catch (e: any) {
      diagnostics.openaiApi = {
        status: "unreachable",
        error: e.message,
        latencyMs: Date.now() - openaiStart,
      };
    }

    // 5. Gemini API Connectivity check
    const geminiStart = Date.now();
    try {
      const apiKey = process.env.GOOGLE_GEMINI_API_KEY || "";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      diagnostics.geminiApi = {
        status: response.status === 200 || response.status === 400 ? "healthy" : "degraded",
        statusCode: response.status,
        latencyMs: Date.now() - geminiStart,
      };
    } catch (e: any) {
      diagnostics.geminiApi = {
        status: "unreachable",
        error: e.message,
        latencyMs: Date.now() - geminiStart,
      };
    }

    // 5.5. Clerk API Connectivity check
    const clerkStart = Date.now();
    try {
      if (process.env.CLERK_SECRET_KEY && process.env.VITE_CLERK_PUBLISHABLE_KEY) {
        const { clerkClient } = await import("../../lib/clerk-billing");
        await clerkClient.users.getUserList({ limit: 1 });
        diagnostics.clerkApi = {
          status: "healthy",
          latencyMs: Date.now() - clerkStart,
        };
      } else {
        diagnostics.clerkApi = {
          status: "unconfigured",
          error: "CLERK_SECRET_KEY or VITE_CLERK_PUBLISHABLE_KEY is not set.",
          latencyMs: 0,
        };
      }
    } catch (e: any) {
      diagnostics.clerkApi = {
        status: "unhealthy",
        error: e.message || String(e),
        latencyMs: Date.now() - clerkStart,
      };
    }

    // 6. Internal Cache diagnostics
    diagnostics.caches = {
      credentialsSize: credentialCacheSize(),
    };

    res.json(diagnostics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/overview", async (req: Request, res: Response) => {
  const windowDays = parseWindowDays(req.query.days);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  try {
    const [
      users,
      memberships,
      subscriptions,
      voiceByUser,
      toolsByUser,
      failuresByUser,
      lastActivityByUser,
      totalUsers,
      totalOrganizations,
      totalVenues,
      totalAssistants,
      totalVoiceMinutes,
      totalToolCalls,
      totalFailures,
      topTools,
      recentErrors,
      pipelines,
    ] = await Promise.all([
      db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(250),
      db
        .select({
          userId: organizationMembershipsTable.userId,
          organizationId: organizationMembershipsTable.organizationId,
          role: organizationMembershipsTable.role,
          organizationName: organizationsTable.name,
        })
        .from(organizationMembershipsTable)
        .leftJoin(organizationsTable, eq(organizationsTable.id, organizationMembershipsTable.organizationId)),
      db.select().from(subscriptionsTable),
      db
        .select({
          userId: usageEventsTable.userId,
          total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)::int`,
        })
        .from(usageEventsTable)
        .where(and(eq(usageEventsTable.kind, "voice_minutes"), gte(usageEventsTable.occurredAt, since)))
        .groupBy(usageEventsTable.userId),
      db
        .select({
          userId: toolCallsTable.userId,
          total: sql<number>`count(*)::int`,
        })
        .from(toolCallsTable)
        .where(gte(toolCallsTable.createdAt, since))
        .groupBy(toolCallsTable.userId),
      db
        .select({
          userId: toolCallsTable.userId,
          total: sql<number>`count(*)::int`,
        })
        .from(toolCallsTable)
        .where(and(eq(toolCallsTable.status, "failed"), gte(toolCallsTable.createdAt, since)))
        .groupBy(toolCallsTable.userId),
      db
        .select({
          userId: toolCallsTable.userId,
          lastActivityAt: sql<Date>`max(${toolCallsTable.createdAt})`,
        })
        .from(toolCallsTable)
        .groupBy(toolCallsTable.userId),
      db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
      db.select({ count: sql<number>`count(*)::int` }).from(organizationsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(venuesTable),
      db.select({ count: sql<number>`count(*)::int` }).from(agentProfilesTable),
      db
        .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)::int` })
        .from(usageEventsTable)
        .where(and(eq(usageEventsTable.kind, "voice_minutes"), gte(usageEventsTable.occurredAt, since))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(toolCallsTable)
        .where(gte(toolCallsTable.createdAt, since)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(toolCallsTable)
        .where(and(eq(toolCallsTable.status, "failed"), gte(toolCallsTable.createdAt, since))),
      db
        .select({
          toolName: toolCallsTable.toolName,
          count: sql<number>`count(*)::int`,
        })
        .from(toolCallsTable)
        .where(gte(toolCallsTable.createdAt, since))
        .groupBy(toolCallsTable.toolName)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db
        .select({
          userId: toolCallsTable.userId,
          email: usersTable.email,
          toolName: toolCallsTable.toolName,
          errorMessage: toolCallsTable.errorMessage,
          createdAt: toolCallsTable.createdAt,
        })
        .from(toolCallsTable)
        .leftJoin(usersTable, eq(usersTable.id, toolCallsTable.userId))
        .where(and(eq(toolCallsTable.status, "failed"), gte(toolCallsTable.createdAt, since)))
        .orderBy(desc(toolCallsTable.createdAt))
        .limit(20),
      getAllPipelineAvailability(),
    ]);

    const membershipByUser = new Map<number, MembershipSummary>();
    for (const membership of memberships as MembershipSummary[]) {
      if (!membershipByUser.has(membership.userId)) membershipByUser.set(membership.userId, membership);
    }
    const subscriptionByUser = new Map<number, SubscriptionRow>(
      (subscriptions as SubscriptionRow[]).map((sub: SubscriptionRow) => [sub.userId, sub]),
    );
    const voiceMap = new Map(
      (voiceByUser as UserTotal[]).filter((row: UserTotal) => row.userId !== null).map((row: UserTotal) => [row.userId!, numberFromAggregate(row.total)]),
    );
    const toolsMap = new Map(
      (toolsByUser as UserTotal[]).filter((row: UserTotal) => row.userId !== null).map((row: UserTotal) => [row.userId!, numberFromAggregate(row.total)]),
    );
    const failuresMap = new Map(
      (failuresByUser as UserTotal[]).filter((row: UserTotal) => row.userId !== null).map((row: UserTotal) => [row.userId!, numberFromAggregate(row.total)]),
    );
    const lastActivityMap = new Map(
      (lastActivityByUser as UserLastActivity[]).filter((row: UserLastActivity) => row.userId !== null).map((row: UserLastActivity) => [row.userId!, row.lastActivityAt]),
    );

    res.json({
      windowDays,
      roles: ROLE_DEFINITIONS,
      totals: {
        users: numberFromAggregate(totalUsers[0]?.count),
        organizations: numberFromAggregate(totalOrganizations[0]?.count),
        venues: numberFromAggregate(totalVenues[0]?.count),
        assistants: numberFromAggregate(totalAssistants[0]?.count),
        voiceMinutes: numberFromAggregate(totalVoiceMinutes[0]?.total),
        toolCalls: numberFromAggregate(totalToolCalls[0]?.count),
        failedToolCalls: numberFromAggregate(totalFailures[0]?.count),
      },
      pipelines: pipelines.map((pipeline) => ({
        provider: pipeline.provider,
        displayName: pipeline.displayName,
        status: pipeline.status,
        reason: pipeline.reason ?? null,
        missing: pipeline.missing ?? [],
      })),
      topTools: (topTools as TopTool[]).map((tool: TopTool) => ({
        toolName: tool.toolName,
        count: numberFromAggregate(tool.count),
      })),
      recentErrors: (recentErrors as RecentError[]).map((error: RecentError) => ({
        userId: error.userId,
        email: error.email,
        toolName: error.toolName,
        errorMessage: error.errorMessage,
        createdAt: error.createdAt,
      })),
      users: (users as UserRow[]).map((user: UserRow) => {
        const membership = membershipByUser.get(user.id);
        const subscription = subscriptionByUser.get(user.id);
        const voiceMinutes = voiceMap.get(user.id) ?? 0;
        const usagePlan = isAdminEmail(user.email) ? "admin" : subscription?.plan ?? "trial";
        const usageLimits = buildUsageLimitSnapshot(usagePlan, voiceMinutes);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isPlatformAdmin: isAdminEmail(user.email),
          createdAt: user.createdAt,
          organization: membership
            ? {
                id: membership.organizationId,
                name: membership.organizationName,
                role: membership.role,
              }
            : null,
          subscription: subscription
            ? {
                plan: subscription.plan,
                status: subscription.status,
                trialEndsAt: subscription.trialEndsAt,
                currentPeriodEnd: subscription.currentPeriodEnd,
              }
            : null,
          usage: {
            voiceMinutes,
            toolCalls: toolsMap.get(user.id) ?? 0,
            failedToolCalls: failuresMap.get(user.id) ?? 0,
            lastActivityAt: lastActivityMap.get(user.id) ?? null,
            ...usageLimits,
          },
        };
      }),
    });
  } catch (e) {
    jsonError(res, 500, "admin_overview_error", e instanceof Error ? e.message : "Could not load admin overview.");
  }
});

router.patch("/users/:id/access", async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    jsonError(res, 400, "invalid_user_id", "User id must be a positive integer.");
    return;
  }

  const { plan, status, role, organizationId, resetMinutes } = req.body ?? {};
  if (plan !== undefined && !isPlan(plan)) {
    jsonError(res, 400, "invalid_plan", `Plan must be one of: ${PLANS.join(", ")}.`);
    return;
  }
  if (status !== undefined && !isStatus(status)) {
    jsonError(res, 400, "invalid_status", `Status must be one of: ${STATUSES.join(", ")}.`);
    return;
  }
  if (role !== undefined && !isRole(role)) {
    jsonError(res, 400, "invalid_role", `Role must be one of: ${ROLES.join(", ")}.`);
    return;
  }
  if (resetMinutes !== undefined && typeof resetMinutes !== "boolean") {
    jsonError(res, 400, "invalid_reset_minutes", "resetMinutes must be a boolean.");
    return;
  }
  if (plan === undefined && status === undefined && role === undefined && !resetMinutes) {
    jsonError(res, 400, "no_changes", "Send plan, status, role, or resetMinutes to update access.");
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      jsonError(res, 404, "not_found", "User not found.");
      return;
    }

    if (plan !== undefined || status !== undefined) {
      const [existing] = await db
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);
      const nextStatus = status ?? (plan === "trial" ? "trialing" : "active");
      const values = {
        ...(plan !== undefined ? { plan } : {}),
        status: nextStatus,
        trialEndsAt: nextStatus === "trialing" ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
        currentPeriodEnd:
          nextStatus === "active" && plan === "admin" ? new Date("9999-12-31T23:59:59Z") : null,
        updatedAt: new Date(),
      };
      if (existing) {
        await db.update(subscriptionsTable).set(values).where(eq(subscriptionsTable.id, existing.id));
      } else {
        const membership = await primaryMembershipForUser(user);
        await db.insert(subscriptionsTable).values({
          userId,
          organizationId: membership?.organizationId ?? null,
          plan: plan ?? "trial",
          status: nextStatus,
          trialEndsAt: values.trialEndsAt,
          currentPeriodEnd: values.currentPeriodEnd,
        });
      }
      invalidateAuthCacheForUser(userId);
    }

    if (role !== undefined) {
      let membership = await primaryMembershipForUser(user);
      if (organizationId && typeof organizationId === "string") {
        const [scoped] = await db
          .select({
            id: organizationMembershipsTable.id,
            organizationId: organizationMembershipsTable.organizationId,
          })
          .from(organizationMembershipsTable)
          .where(and(
            eq(organizationMembershipsTable.userId, userId),
            eq(organizationMembershipsTable.organizationId, organizationId),
          ))
          .limit(1);
        membership = scoped && membership ? { ...membership, ...scoped } : membership;
      }
      if (!membership) {
        jsonError(res, 404, "membership_not_found", "User does not have an organization membership.");
        return;
      }
      await db
        .update(organizationMembershipsTable)
        .set({ role })
        .where(eq(organizationMembershipsTable.id, membership.id));
      invalidateAuthCacheForUser(userId);
    }

    if (resetMinutes) {
      // Zero the voice-minute accumulator by deleting the usage events that
      // /api/v1/usage/current sums. Scope matches that query: org-wide when the
      // user belongs to an org, else the user's own org-less events.
      const membershipForReset = await primaryMembershipForUser(user);
      const scope = membershipForReset?.organizationId
        ? eq(usageEventsTable.organizationId, membershipForReset.organizationId)
        : and(eq(usageEventsTable.userId, userId), isNull(usageEventsTable.organizationId));
      await db
        .delete(usageEventsTable)
        .where(and(eq(usageEventsTable.kind, "voice_minutes"), scope));
    }

    const membership = await primaryMembershipForUser(user);
    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPlatformAdmin: isAdminEmail(user.email),
        organization: membership
          ? {
              id: membership.organizationId,
              name: membership.organizationName,
              role: membership.role,
            }
          : null,
        subscription: subscription
          ? {
              plan: subscription.plan,
              status: subscription.status,
              trialEndsAt: subscription.trialEndsAt,
              currentPeriodEnd: subscription.currentPeriodEnd,
            }
          : null,
      },
    });
  } catch (e) {
    jsonError(res, 500, "admin_access_update_error", e instanceof Error ? e.message : "Could not update access.");
  }
});

export default router;
