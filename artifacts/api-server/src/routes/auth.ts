/**
 * Bevpro Auth Routes
 * POST /api/auth/signup — create account
 * POST /api/auth/login  — get JWT session token
 * GET  /api/auth/me     — get current user (requires auth)
 * POST /api/auth/logout — invalidate session
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db, usersTable, sessionsTable, subscriptionsTable, exchangeCodesTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

const router = Router();

const DEFAULT_SECRET = "bevpro-dev-secret-change-in-production";
export const JWT_SECRET = process.env.JWT_SECRET ?? DEFAULT_SECRET;
const SESSION_DAYS = 30;

/** Fail hard if running in production with the default secret */
export function assertJwtSecret(): void {
  if (JWT_SECRET === DEFAULT_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("FATAL: JWT_SECRET must be set in production. Server refusing to start.");
  }
}

function ensureAuthStore(res: Response): boolean {
  if (db) return true;

  res.status(503).json({
    error: "Auth service unavailable. Set DATABASE_URL and initialize the database tables.",
  });
  return false;
}

function signToken(userId: number, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

function verifyToken(token: string): { sub: number; sid: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as { sub: number; sid: string };
  } catch {
    return null;
  }
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function requireAuth(req: Request, res: Response, next: Function): Promise<void> {
  if (!ensureAuthStore(res)) return;

  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token" }); return; }

  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, payload.sid));
    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: "Session expired" }); return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
    if (!user) { res.status(401).json({ error: "User not found" }); return; }

    // Attach subscription for downstream plan checks
    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    (req as any).user = user;
    (req as any).subscription = subscription ?? null;
    next();
  } catch (e: any) {
    console.error("[Auth] Session lookup error:", e.message);
    res.status(503).json({ error: "Auth service unavailable" });
  }
}

/** Middleware: require an active subscription (trial or paid) that covers the given agent. */
export function requirePlan(...allowedAgents: ("pos" | "inventory")[]) {
  return (req: Request, res: Response, next: Function): void => {
    const sub = (req as any).subscription;
    if (!sub) { res.status(403).json({ error: "No active subscription" }); return; }

    // Check trial expiry
    if (sub.status === "trialing") {
      if (sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
        res.status(403).json({ error: "Trial expired. Please subscribe to continue." }); return;
      }
      // Trial grants access to both agents
      next(); return;
    }

    // Active paid subscriptions
    if (sub.status !== "active") {
      res.status(403).json({ error: "Subscription inactive. Please update your payment." }); return;
    }

    // Plan-based gating
    const plan = sub.plan as string;
    if (plan === "complete") { next(); return; }
    if (plan === "pos_only" && allowedAgents.includes("pos")) { next(); return; }
    if (plan === "inventory_only" && allowedAgents.includes("inventory")) { next(); return; }

    res.status(403).json({ error: "Your plan does not include this agent. Please upgrade." });
  };
}

// POST /api/auth/signup
router.post("/signup", async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    res.status(400).json({ error: "Email, password, and name are required" }); return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" }); return;
  }

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
    if (existing) { res.status(409).json({ error: "An account with this email already exists" }); return; }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
    }).returning();

    // Create 14-day free trial subscription
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(subscriptionsTable).values({
      userId: user.id,
      plan: "trial",
      status: "trialing",
      trialEndsAt,
    });

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(sessionsTable).values({ id: sessionId, userId: user.id, expiresAt });

    const token = signToken(user.id, sessionId);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      trialEndsAt,
    });
  } catch (e: any) {
    console.error("[Auth] Signup error:", e.message);
    res.status(500).json({ error: "Failed to create account" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
    if (!user) { res.status(401).json({ error: "Invalid email or password" }); return; }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Invalid email or password" }); return; }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(sessionsTable).values({ id: sessionId, userId: user.id, expiresAt });

    const token = signToken(user.id, sessionId);

    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      subscription: subscription ?? null,
    });
  } catch (e: any) {
    console.error("[Auth] Login error:", e.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const user = (req as any).user;

  try {
    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    res.json({ user: { id: user.id, email: user.email, name: user.name }, subscription: subscription ?? null });
  } catch (e: any) {
    console.error("[Auth] Current user lookup error:", e.message);
    res.status(503).json({ error: "Auth service unavailable" });
  }
});

// POST /api/auth/logout
router.post("/logout", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const token = extractToken(req)!;
  const payload = verifyToken(token)!;

  try {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, payload.sid));
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[Auth] Logout error:", e.message);
    res.status(503).json({ error: "Auth service unavailable" });
  }
});

// ── Exchange codes: Replace long-lived JWT in URL with one-time short-lived codes ──
// Codes are persisted in the database so they survive server restarts / deploys.

// Cleanup expired codes every 5 minutes
setInterval(async () => {
  if (!db) return;
  try {
    await db.delete(exchangeCodesTable).where(lt(exchangeCodesTable.expiresAt, new Date()));
  } catch (e: any) {
    console.error("[Exchange] Cleanup error:", e.message);
  }
}, 5 * 60_000);

/** POST /api/auth/exchange/create — Authenticated. Returns a one-time code (valid 5 min). */
router.post("/exchange/create", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const token = extractToken(req)!;
  const { venueId } = req.body ?? {};
  if (!venueId) { res.status(400).json({ error: "venueId is required" }); return; }

  const code = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000);

  try {
    await db.insert(exchangeCodesTable).values({
      code,
      token,
      venueId: String(venueId),
      expiresAt,
    });
    res.json({ code });
  } catch (e: any) {
    console.error("[Exchange] Failed to create code:", e.message);
    res.status(503).json({ error: "Exchange service temporarily unavailable. Please try again." });
  }
});

/** POST /api/auth/exchange/redeem — Public. Exchanges a code for token + venueId. */
router.post("/exchange/redeem", async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const { code } = req.body ?? {};
  if (!code) { res.status(400).json({ error: "code is required" }); return; }

  try {
    const [entry] = await db.select().from(exchangeCodesTable).where(eq(exchangeCodesTable.code, code));

    if (!entry || entry.expiresAt < new Date()) {
      if (entry) await db.delete(exchangeCodesTable).where(eq(exchangeCodesTable.code, code));
      res.status(400).json({ error: "Invalid or expired code" });
      return;
    }

    // Delete immediately — one-time use
    await db.delete(exchangeCodesTable).where(eq(exchangeCodesTable.code, code));
    res.json({ token: entry.token, venueId: entry.venueId });
  } catch (e: any) {
    console.error("[Exchange] Failed to redeem code:", e.message);
    res.status(503).json({ error: "Exchange service temporarily unavailable. Please try again." });
  }
});

// ── Account management ────────────────────────────────────────────────────────

/** PATCH /api/auth/profile — Update name/email */
router.patch("/profile", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;
  const user = (req as any).user;
  const { name, email } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (name && typeof name === "string") updates.name = name.trim();
  if (email && typeof email === "string") {
    const normalised = email.toLowerCase().trim();
    if (normalised !== user.email) {
      const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalised));
      if (existing) { res.status(409).json({ error: "Email already in use" }); return; }
      updates.email = normalised;
    }
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

  try {
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();
    res.json({ user: { id: updated.id, email: updated.email, name: updated.name } });
  } catch (e: any) {
    console.error("[Auth] Profile update error:", e.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/** POST /api/auth/change-password */
router.post("/change-password", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;
  const user = (req as any).user;
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" }); return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" }); return;
  }

  try {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) { res.status(403).json({ error: "Current password is incorrect" }); return; }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[Auth] Password change error:", e.message);
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;
