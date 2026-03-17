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
import { db, usersTable, sessionsTable, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "bevpro-dev-secret-change-in-production";
const SESSION_DAYS = 30;

function signToken(userId: number, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

function verifyToken(token: string): { sub: number; sid: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: number; sid: string };
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
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, payload.sid));
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: "Session expired" }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  (req as any).user = user;
  next();
}

// POST /api/auth/signup
router.post("/signup", async (req: Request, res: Response): Promise<void> => {
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
  const user = (req as any).user;
  const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
  res.json({ user: { id: user.id, email: user.email, name: user.name }, subscription: subscription ?? null });
});

// POST /api/auth/logout
router.post("/logout", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const token = extractToken(req)!;
  const payload = verifyToken(token)!;
  await db.delete(sessionsTable).where(eq(sessionsTable.id, payload.sid));
  res.json({ ok: true });
});

export default router;
