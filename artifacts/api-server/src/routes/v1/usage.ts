import { Router } from "express";
import { ensureUserOrganization, v1RequireAuth, jsonError } from "./_helpers";
import { db, toolCallsTable, usageEventsTable } from "@workspace/db";
import { eq, sql, and, gte, isNull, or } from "drizzle-orm";
import { buildUsageLimitSnapshot } from "@workspace/voicelab-core/pricing";

const router = Router();

async function currentOrganizationId(req: any): Promise<string | null> {
  const existing = req.organization?.id;
  if (existing) return existing;
  if (!req.user) return null;
  return (await ensureUserOrganization(req.user)).id;
}

function usageTenantWhere(userId: number, organizationId: string | null) {
  return organizationId
    ? or(
        eq(usageEventsTable.organizationId, organizationId),
        and(eq(usageEventsTable.userId, userId), isNull(usageEventsTable.organizationId)),
      )
    : eq(usageEventsTable.userId, userId);
}

function toolTenantWhere(userId: number, organizationId: string | null) {
  return organizationId
    ? or(
        eq(toolCallsTable.organizationId, organizationId),
        and(eq(toolCallsTable.userId, userId), isNull(toolCallsTable.organizationId)),
      )
    : eq(toolCallsTable.userId, userId);
}

router.get("/current", v1RequireAuth as any, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const organizationId = await currentOrganizationId(req);
    const periodStart = req.subscription?.currentPeriodEnd
      ? new Date(new Date(req.subscription.currentPeriodEnd).getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // These three reads are independent; run them concurrently so the dashboard
    // endpoint costs one round-trip's worth of wall-clock instead of three
    // serial ones.
    const [[minutesResult], topTools, recentErrors] = await Promise.all([
      db
        .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
        .from(usageEventsTable)
        .where(and(
          usageTenantWhere(userId, organizationId),
          eq(usageEventsTable.kind, "voice_minutes"),
          gte(usageEventsTable.occurredAt, periodStart),
        )),
      db
        .select({
          toolName: toolCallsTable.toolName,
          count: sql<number>`count(*)::int`,
        })
        .from(toolCallsTable)
        .where(and(
          toolTenantWhere(userId, organizationId),
          gte(toolCallsTable.createdAt, periodStart),
        ))
        .groupBy(toolCallsTable.toolName)
        .orderBy(sql`count(*) desc`)
        .limit(5),
      db
        .select({
          toolName: toolCallsTable.toolName,
          errorMessage: toolCallsTable.errorMessage,
          createdAt: toolCallsTable.createdAt,
        })
        .from(toolCallsTable)
        .where(and(
          toolTenantWhere(userId, organizationId),
          eq(toolCallsTable.status, "failed"),
          gte(toolCallsTable.createdAt, periodStart),
        ))
        .orderBy(sql`${toolCallsTable.createdAt} desc`)
        .limit(10),
    ]);

    const usedMinutes = Number(minutesResult?.total ?? 0);
    const planId = req.isAdmin ? "admin" : (req.subscription?.plan ?? "trial");
    const usageLimits = buildUsageLimitSnapshot(planId, usedMinutes);

    res.json({
      scope: organizationId ? "organization" : "user",
      organizationId,
      voiceMinutes: { used: usedMinutes },
      usageLimits,
      topTools,
      recentErrors,
    });
  } catch (e: any) {
    jsonError(res, 500, "usage_error", e.message);
  }
});

export default router;
