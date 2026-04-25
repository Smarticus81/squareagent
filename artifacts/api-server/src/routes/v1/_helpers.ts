import type { Request, Response, NextFunction } from "express";
import {
  db,
  organizationsTable,
  organizationMembershipsTable,
  type User,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../auth";

/** Wraps requireAuth so v1 routes can compose cleanly. */
export const v1RequireAuth = requireAuth;

export function jsonError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  res.status(status).json({ error: { code, message, details } });
}

/** Get the authenticated user from the request (set by requireAuth). */
export function userFromReq(req: Request): User {
  return (req as Request & { user: User }).user;
}

/**
 * Auto-create a personal organization for a user on first call. Idempotent.
 * Used to bridge existing user-owned venues to the new org/venue model.
 */
export async function ensureUserOrganization(user: User): Promise<{ id: string }> {
  if (!db) throw new Error("Database not configured");
  const [existingMembership] = await db
    .select()
    .from(organizationMembershipsTable)
    .where(eq(organizationMembershipsTable.userId, user.id))
    .limit(1);
  if (existingMembership) return { id: existingMembership.organizationId };

  const [org] = await db
    .insert(organizationsTable)
    .values({ name: `${user.name}'s Workspace`, ownerUserId: user.id })
    .returning();
  await db.insert(organizationMembershipsTable).values({
    organizationId: org.id,
    userId: user.id,
    role: "owner",
  });
  return { id: org.id };
}

export async function userOwnsOrganization(
  userId: number,
  organizationId: string,
): Promise<boolean> {
  if (!db) return false;
  const [m] = await db
    .select()
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.userId, userId),
        eq(organizationMembershipsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(m);
}

/** Express middleware: ensure DB is configured. */
export function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (!db) {
    jsonError(res, 503, "db_unavailable", "Database not configured.");
    return;
  }
  next();
}
