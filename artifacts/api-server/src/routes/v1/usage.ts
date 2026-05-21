import { Router } from "express";
import { v1RequireAuth, jsonError } from "./_helpers";
import { db, toolCallsTable, usageEventsTable } from "@workspace/db";
import { eq, sql, and, gte } from "drizzle-orm";

const router = Router();

router.get("/current", v1RequireAuth as any, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const periodStart = req.subscription?.currentPeriodEnd
      ? new Date(new Date(req.subscription.currentPeriodEnd).getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [minutesResult] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
      .from(usageEventsTable)
      .where(and(
        eq(usageEventsTable.userId, userId),
        eq(usageEventsTable.kind, "voice_minutes"),
        gte(usageEventsTable.occurredAt, periodStart),
      ));

    const topTools = await db
      .select({
        toolName: toolCallsTable.toolName,
        count: sql<number>`count(*)::int`,
      })
      .from(toolCallsTable)
      .where(and(
        eq(toolCallsTable.userId, userId),
        gte(toolCallsTable.createdAt, periodStart),
      ))
      .groupBy(toolCallsTable.toolName)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    const recentErrors = await db
      .select({
        toolName: toolCallsTable.toolName,
        errorMessage: toolCallsTable.errorMessage,
        createdAt: toolCallsTable.createdAt,
      })
      .from(toolCallsTable)
      .where(and(
        eq(toolCallsTable.userId, userId),
        eq(toolCallsTable.status, "failed"),
        gte(toolCallsTable.createdAt, periodStart),
      ))
      .orderBy(sql`${toolCallsTable.createdAt} desc`)
      .limit(10);

    res.json({
      voiceMinutes: { used: Number(minutesResult?.total ?? 0) },
      topTools,
      recentErrors,
    });
  } catch (e: any) {
    jsonError(res, 500, "usage_error", e.message);
  }
});

export default router;
