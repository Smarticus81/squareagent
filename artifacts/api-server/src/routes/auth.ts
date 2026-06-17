/**
 * VoyceLab Auth Routes
 * POST /api/auth/signup — create account
 * POST /api/auth/login  — get JWT session token
 * GET  /api/auth/me     — get current user (requires auth)
 * POST /api/auth/logout — invalidate session
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db, usersTable, sessionsTable, subscriptionsTable, exchangeCodesTable, organizationMembershipsTable, venuesTable, agentProfilesTable } from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { checkClerkOrgPlan } from "../lib/clerk-billing";
import { decrypt, encrypt } from "../lib/secrets";

const router = Router();

const DEFAULT_SECRET = "voycelab-dev-secret-change-in-production";
export const JWT_SECRET = process.env.JWT_SECRET ?? DEFAULT_SECRET;
const SESSION_DAYS = 30;

/**
 * Platform admin emails — never-expiring trial, every pipeline unlocked,
 * every skill tier on, no plan gating. Configurable via ADMIN_EMAILS env
 * (comma-separated). Compared case-insensitively.
 */
const FAR_FUTURE = new Date("9999-12-31T23:59:59Z");
const DEFAULT_ADMIN_EMAIL = "tmusoni@thinkertons.com";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAIL)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && process.env.ADMIN_EMAILS) {
  const invalidAdminEmail = ADMIN_EMAILS.find((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
  if (invalidAdminEmail) {
    throw new Error(`FATAL: ADMIN_EMAILS contains an invalid email address: ${invalidAdminEmail}`);
  }
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Synthetic admin subscription used by middleware when the DB row hasn't
 * caught up yet. Stored shape matches `subscriptionsTable.$inferSelect`
 * for downstream consumers (ws-relay, requirePlan, agent-profiles).
 */
export function buildAdminSubscription(userId: number): {
  id: number;
  userId: number;
  organizationId: string | null;
  clerkSubscriptionId: string | null;
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: -1,
    userId,
    organizationId: null,
    clerkSubscriptionId: null,
    plan: "admin",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: FAR_FUTURE,
    cancelAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type SubscriptionRow = typeof subscriptionsTable.$inferSelect;

/**
 * Make sure an admin user has a subscription row that reflects platform
 * admin status. Idempotent. Returns the effective subscription row so callers
 * don't need a second query to read it back.
 */
async function ensureAdminSubscription(userId: number): Promise<SubscriptionRow | null> {
  if (!db) return null;
  try {
    const [existing] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId));
    if (!existing) {
      const [inserted] = await db
        .insert(subscriptionsTable)
        .values({
          userId,
          plan: "admin",
          status: "active",
          trialEndsAt: null,
          currentPeriodEnd: FAR_FUTURE,
        })
        .returning();
      return (inserted as SubscriptionRow) ?? (buildAdminSubscription(userId) as SubscriptionRow);
    }
    const needsUpdate =
      existing.plan !== "admin" ||
      existing.status !== "active" ||
      existing.trialEndsAt !== null ||
      !existing.currentPeriodEnd ||
      existing.currentPeriodEnd.getTime() < FAR_FUTURE.getTime();
    if (needsUpdate) {
      const [updated] = await db
        .update(subscriptionsTable)
        .set({
          plan: "admin",
          status: "active",
          trialEndsAt: null,
          currentPeriodEnd: FAR_FUTURE,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.userId, userId))
        .returning();
      return (updated as SubscriptionRow) ?? (existing as SubscriptionRow);
    }
    return existing as SubscriptionRow;
  } catch (e) {
    console.error("[Auth] ensureAdminSubscription failed:", e instanceof Error ? e.message : e);
    return buildAdminSubscription(userId) as SubscriptionRow;
  }
}

function buildClerkClaimSubscription(
  userId: number,
  organizationId: string | null,
  plan: string,
): SubscriptionRow {
  return {
    id: -2,
    userId,
    organizationId,
    clerkSubscriptionId: null,
    plan,
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SubscriptionRow;
}

async function ensureClerkClaimSubscription(
  userId: number,
  organizationId: string | null,
  plan: string,
  existing?: SubscriptionRow | null,
): Promise<SubscriptionRow> {
  const fallback = buildClerkClaimSubscription(userId, organizationId, plan);
  if (!db) return fallback;
  try {
    const current =
      existing ??
      (await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .then((rows: SubscriptionRow[]) => rows[0] ?? null));

    if (current) {
      const [updated] = await db
        .update(subscriptionsTable)
        .set({
          organizationId,
          plan,
          status: "active",
          trialEndsAt: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.id, current.id))
        .returning();
      return (updated as SubscriptionRow | undefined) ?? { ...current, ...fallback, id: current.id };
    }

    const [inserted] = await db
      .insert(subscriptionsTable)
      .values({
        userId,
        organizationId,
        plan,
        status: "active",
        trialEndsAt: null,
        currentPeriodEnd: null,
      })
      .returning();
    return (inserted as SubscriptionRow | undefined) ?? fallback;
  } catch (e) {
    console.error("[Auth] ensureClerkClaimSubscription failed:", e instanceof Error ? e.message : e);
    return fallback;
  }
}

// ── Auth context cache ────────────────────────────────────────────────────────
// The voice flow fires a tool call (POST /api/realtime/tools) on every spoken
// command, plus a heartbeat every 60s. Without caching, requireAuth ran 4–6
// sequential DB round trips on EVERY one of those requests, adding 100ms+ of
// latency before any actual work. We cache the resolved auth context per session
// for a short TTL so repeated requests in a live conversation skip the DB
// entirely. JWT verification still happens every request, so revoked/expired
// tokens are never served from cache.

interface CachedAuth {
  user: typeof usersTable.$inferSelect;
  subscription: SubscriptionRow | null;
  organization: { id: string; role: string } | null;
  isAdmin: boolean;
  sessionExpiresAt: Date;
  expiresAt: number; // cache-entry expiry (epoch ms)
}

const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS ?? 30_000);
const authCache = new Map<string, CachedAuth>();

/** Drop a cached auth context (call on logout or when entitlements change). */
export function invalidateAuthCache(sessionId: string): void {
  authCache.delete(sessionId);
}

export function invalidateAuthCacheForUser(userId: number): void {
  for (const [sid, entry] of authCache) {
    if (entry.user.id === userId) authCache.delete(sid);
  }
}

// Bound memory: sweep expired entries periodically.
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of authCache) {
    if (entry.expiresAt <= now) authCache.delete(sid);
  }
}, 60_000);

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

  // Fast path: serve a still-valid cached auth context without touching the DB.
  const cached = authCache.get(payload.sid);
  if (cached && cached.expiresAt > Date.now() && cached.sessionExpiresAt > new Date()) {
    (req as any).user = cached.user;
    (req as any).subscription = cached.subscription;
    (req as any).organization = cached.organization;
    (req as any).isAdmin = cached.isAdmin;
    next();
    return;
  }

  try {
    // session and user are independent (both derive from the verified token),
    // so fetch them concurrently rather than serially.
    const [[session], [user]] = await Promise.all([
      db
        .select()
        .from(sessionsTable)
        .where(and(eq(sessionsTable.id, payload.sid), eq(sessionsTable.userId, payload.sub))),
      db.select().from(usersTable).where(eq(usersTable.id, payload.sub)),
    ]);

    if (!session || session.expiresAt < new Date()) {
      authCache.delete(payload.sid);
      res.status(401).json({ error: "Session expired" }); return;
    }
    if (!user) { res.status(401).json({ error: "User not found" }); return; }

    const isAdmin = isAdminEmail(user.email);

    // Subscription and organization membership both depend only on user.id —
    // resolve them concurrently. For admins, ensureAdminSubscription both
    // mirrors entitlements into the DB and returns the row, removing the
    // previously redundant follow-up subscription query.
    const subscriptionPromise: Promise<SubscriptionRow | null> = isAdmin
      ? ensureAdminSubscription(user.id)
      : db
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.userId, user.id))
          .then((rows: SubscriptionRow[]) => rows[0] ?? null);

    const organizationPromise = db
      .select()
      .from(organizationMembershipsTable)
      .where(eq(organizationMembershipsTable.userId, user.id))
      .limit(1)
      .then((rows: (typeof organizationMembershipsTable.$inferSelect)[]) =>
        rows[0] ? { id: rows[0].organizationId, role: rows[0].role } : null,
      )
      // organization_memberships table may not exist yet; continue without it
      .catch(() => null);

    let [subscription, organization] = await Promise.all([
      subscriptionPromise,
      organizationPromise,
    ]);
    if (!subscription && isAdmin) subscription = buildAdminSubscription(user.id) as SubscriptionRow;

    authCache.set(payload.sid, {
      user,
      subscription: subscription ?? null,
      organization,
      isAdmin,
      sessionExpiresAt: session.expiresAt,
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    });

    (req as any).user = user;
    (req as any).subscription = subscription ?? null;
    (req as any).organization = organization;
    (req as any).isAdmin = isAdmin;
    next();
  } catch (e: any) {
    console.error("[Auth] Session lookup error:", e.message);
    res.status(503).json({ error: "Auth service unavailable" });
  }
}

/** Middleware: require an active subscription (trial or paid). */
export function requirePlan() {
  return async (req: Request, res: Response, next: Function): Promise<void> => {
    if ((req as any).isAdmin) { next(); return; }

    const sub = (req as any).subscription;
    const userId = Number((req as any).user?.id ?? 0);
    const organizationId = ((req as any).organization?.id as string | undefined) ?? null;

    // Clerk B2B fallback: if no local subscription, check Clerk org claims
    if (!sub) {
      const clerkPlan = checkClerkOrgPlan(req);
      if (clerkPlan?.active) {
        // Persist the Clerk-verified plan immediately so relay-only paths
        // that cannot carry Clerk headers see the same entitlement.
        (req as any).subscription = await ensureClerkClaimSubscription(userId, organizationId, clerkPlan.plan);
        next();
        return;
      }
      res.status(403).json({ error: "No active subscription" }); return;
    }

    // Check trial expiry
    if (sub.status === "trialing") {
      if (sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
        // Before rejecting, check if Clerk org has an active plan
        const clerkPlan = checkClerkOrgPlan(req);
        if (clerkPlan?.active) {
          (req as any).subscription = await ensureClerkClaimSubscription(userId, organizationId, clerkPlan.plan, sub);
          next();
          return;
        }
        res.status(403).json({ error: "Trial expired. Please subscribe to continue." }); return;
      }
      next(); return;
    }

    // Active paid subscriptions — any plan gets the unified agent
    if (sub.status !== "active") {
      // Check Clerk as fallback for payment issues resolved there
      const clerkPlan = checkClerkOrgPlan(req);
      if (clerkPlan?.active) {
        (req as any).subscription = await ensureClerkClaimSubscription(userId, organizationId, clerkPlan.plan, sub);
        next();
        return;
      }
      res.status(403).json({ error: "Subscription inactive. Please update your payment." }); return;
    }

    next();
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

    const isAdmin = isAdminEmail(user.email);
    const trialEndsAt = isAdmin ? null : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [subscription] = await db.insert(subscriptionsTable).values({
      userId: user.id,
      plan: isAdmin ? "admin" : "trial",
      status: isAdmin ? "active" : "trialing",
      trialEndsAt,
      currentPeriodEnd: isAdmin ? FAR_FUTURE : null,
    }).returning();

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(sessionsTable).values({ id: sessionId, userId: user.id, expiresAt });

    const token = signToken(user.id, sessionId);

    let organizationId: string | null = null;
    try {
      const { ensureUserOrganization } = await import("./v1/_helpers");
      const org = await ensureUserOrganization(user);
      organizationId = org.id;
    } catch { /* org tables may not exist yet */ }

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, isAdmin },
      subscription: subscription ?? (isAdmin ? buildAdminSubscription(user.id) : null),
      organizationId,
      trialEndsAt,
      isAdmin,
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

    const isAdmin = isAdminEmail(user.email);
    let subscription: SubscriptionRow | null = isAdmin ? await ensureAdminSubscription(user.id) : null;
    if (!subscription && !isAdmin) {
      [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    }
    if (!subscription && isAdmin) subscription = buildAdminSubscription(user.id) as SubscriptionRow;

    let organizationId =
      ((req as Request & { organization?: { id?: string | null } }).organization?.id ?? null) as string | null;
    try {
      const { ensureUserOrganization } = await import("./v1/_helpers");
      const org = await ensureUserOrganization(user);
      organizationId = org.id;
    } catch { /* org tables may not exist yet */ }

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, isAdmin },
      subscription: subscription ?? null,
      organizationId,
      isAdmin,
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
  const isAdmin: boolean = Boolean((req as any).isAdmin);

  try {
    let [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    if (!subscription && isAdmin) subscription = buildAdminSubscription(user.id) as never;
    // Best-effort organization lookup — the wizard needs this to create agent profiles.
    let organizationId: string | null = null;
    try {
      const { ensureUserOrganization } = await import("./v1/_helpers");
      const org = await ensureUserOrganization(user);
      organizationId = org.id;
    } catch {
      // Tables may not yet be migrated; the wizard will surface an actionable error.
    }
    if (!subscription) {
      [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    }
    if (!subscription && isAdmin) subscription = buildAdminSubscription(user.id) as never;

    const clerkPlan = checkClerkOrgPlan(req);
    if (clerkPlan?.active) {
      subscription = await ensureClerkClaimSubscription(user.id, organizationId, clerkPlan.plan, subscription);
      (req as Request & { subscription?: SubscriptionRow }).subscription = subscription;
    }
    res.json({
      user: { id: user.id, email: user.email, name: user.name, isAdmin },
      subscription: subscription ?? null,
      organizationId,
      isAdmin,
    });
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
    invalidateAuthCache(payload.sid);
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
async function validateExchangeLaunchScope(
  userId: number,
  organizationId: string | null,
  venueId: unknown,
  agentProfileId: unknown,
): Promise<{ ok: true; venueId: string; agentProfileId: string | null } | { ok: false; status: number; error: string }> {
  let normalizedVenueId = "";
  let profileVenueId: number | null = null;

  if (agentProfileId) {
    if (typeof agentProfileId !== "string") {
      return { ok: false, status: 400, error: "agentProfileId must be a string" };
    }
    if (!organizationId) {
      return { ok: false, status: 403, error: "Organization membership required" };
    }
    const [profile] = await db
      .select({
        id: agentProfilesTable.id,
        organizationId: agentProfilesTable.organizationId,
        venueId: agentProfilesTable.venueId,
      })
      .from(agentProfilesTable)
      .where(and(eq(agentProfilesTable.id, agentProfileId), eq(agentProfilesTable.organizationId, organizationId)))
      .limit(1);
    if (!profile) {
      return { ok: false, status: 404, error: "Assistant not found" };
    }
    profileVenueId = profile.venueId ?? null;
  }

  if (venueId) {
    const numericVenueId = Number(venueId);
    if (!Number.isInteger(numericVenueId) || numericVenueId <= 0) {
      return { ok: false, status: 400, error: "venueId must be a positive integer" };
    }
    const [venue] = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(
        and(
          eq(venuesTable.id, numericVenueId),
          organizationId
            ? or(
                eq(venuesTable.organizationId, organizationId),
                and(eq(venuesTable.userId, userId), isNull(venuesTable.organizationId)),
              )
            : eq(venuesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!venue) {
      return { ok: false, status: 404, error: "Venue not found" };
    }
    if (profileVenueId !== null && profileVenueId !== numericVenueId) {
      return { ok: false, status: 400, error: "Assistant is not linked to this venue" };
    }
    normalizedVenueId = String(numericVenueId);
  } else if (profileVenueId !== null) {
    normalizedVenueId = String(profileVenueId);
  }

  return {
    ok: true,
    venueId: normalizedVenueId,
    agentProfileId: typeof agentProfileId === "string" ? agentProfileId : null,
  };
}

router.post("/exchange/create", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!ensureAuthStore(res)) return;

  const token = extractToken(req)!;
  const { venueId, agentProfileId } = req.body ?? {};
  if (!venueId && !agentProfileId) { res.status(400).json({ error: "venueId or agentProfileId is required" }); return; }

  const organizationId = (req as any).organization?.id ?? null;
  const scope = await validateExchangeLaunchScope((req as any).user.id, organizationId, venueId, agentProfileId);
  if (!scope.ok) {
    res.status(scope.status).json({ error: scope.error });
    return;
  }

  const code = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000);

  try {
    await db.insert(exchangeCodesTable).values({
      code,
      token: encrypt(token),
      venueId: scope.venueId,
      agentProfileId: scope.agentProfileId,
      expiresAt,
    });
    res.json({ code, agentProfileId: scope.agentProfileId });
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
    const token = decrypt(entry.token);
    if (!token) {
      res.status(400).json({ error: "Invalid or expired code" });
      return;
    }
    res.json({ token, venueId: entry.venueId, agentProfileId: (entry as any).agentProfileId ?? null });
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
