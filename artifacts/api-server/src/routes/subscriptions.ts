/**
 * Clerk Billing subscription routes.
 *
 * Clerk owns checkout, payment methods, and subscription management. The API
 * keeps the existing local subscriptions table in sync from Clerk webhooks so
 * the rest of VoyceLab can continue to use req.subscription for plan gating.
 */

import { Router, Request, Response } from "express";
import { Webhook } from "svix";
import { db, subscriptionsTable, usersTable, organizationsTable, organizationMembershipsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { invalidateAuthCacheForUser, requireAuth } from "./auth";
import { checkClerkOrgPlan, mirrorClerkOrgMembership, removeClerkOrgMembershipMirror } from "../lib/clerk-billing";
import { PLANS, type PlanId } from "@workspace/voicelab-core/pricing";

const router = Router();

type Cadence = "monthly" | "yearly";
type BillingSource = "local_db" | "clerk_claims" | null;
type ClerkWebhookEvent = {
  id?: string;
  type?: string;
  data?: Record<string, any>;
};

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:5173");

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET ?? "";
const EXPLICIT_CLERK_BILLING_PORTAL_URL = process.env.CLERK_BILLING_PORTAL_URL ?? "";
const CLERK_BILLING_PORTAL_URL = EXPLICIT_CLERK_BILLING_PORTAL_URL || `${PUBLIC_BASE_URL}/billing`;

const CLERK_PLAN_ENV: Record<Exclude<PlanId, "trial">, string> = {
  pro: "CLERK_PLAN_PRO_ID",
  business: "CLERK_PLAN_BUSINESS_ID",
};

const CLERK_CHECKOUT_URL_ENV: Record<Exclude<PlanId, "trial">, Record<Cadence, string>> = {
  pro: {
    monthly: "CLERK_CHECKOUT_PRO_MONTHLY_URL",
    yearly: "CLERK_CHECKOUT_PRO_YEARLY_URL",
  },
  business: {
    monthly: "CLERK_CHECKOUT_BUSINESS_MONTHLY_URL",
    yearly: "CLERK_CHECKOUT_BUSINESS_YEARLY_URL",
  },
};

const CLERK_PLAN_SLUG_MAP: Record<string, PlanId> = {
  trial: "trial",
  free: "trial",
  pro: "pro",
  professional: "pro",
  business: "business",
  premium: "business",
};

/**
 * A config value is only "real" when it is present and not a left-in
 * placeholder (e.g. `whsec_...`, `cplan_...`). This keeps the Settings
 * readiness badges honest instead of reporting placeholders as configured.
 */
function isRealConfig(value: string | undefined | null): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  if (v.includes("...")) return false;
  return true;
}

const WEBHOOK_SECRET_READY = isRealConfig(CLERK_WEBHOOK_SECRET);

function billingReadiness() {
  const planReadiness = PLANS
    .filter((plan): plan is typeof plan & { id: Exclude<PlanId, "trial"> } => plan.id !== "trial")
    .map((plan) => {
      const env = CLERK_PLAN_ENV[plan.id];
      const monthlyEnv = CLERK_CHECKOUT_URL_ENV[plan.id].monthly;
      const yearlyEnv = CLERK_CHECKOUT_URL_ENV[plan.id].yearly;
      return {
        id: plan.id,
        name: plan.name,
        clerkPlanIdConfigured: isRealConfig(process.env[env]),
        checkoutMonthlyConfigured: isRealConfig(process.env[monthlyEnv]),
        checkoutYearlyConfigured: isRealConfig(process.env[yearlyEnv]),
      };
    });

  const embeddedCheckoutReady = Boolean(CLERK_PUBLISHABLE_KEY);
  const serverCheckoutReady = planReadiness.every(
    (plan) => plan.checkoutMonthlyConfigured || plan.checkoutYearlyConfigured,
  );
  const portalReady = Boolean(isRealConfig(EXPLICIT_CLERK_BILLING_PORTAL_URL) || CLERK_PUBLISHABLE_KEY);
  const portalMode = isRealConfig(EXPLICIT_CLERK_BILLING_PORTAL_URL)
    ? "external"
    : CLERK_PUBLISHABLE_KEY
      ? "embedded"
      : "none";
  const webhooksReady = WEBHOOK_SECRET_READY;
  const secretKeyConfigured = Boolean(CLERK_SECRET_KEY);
  const operational = Boolean((embeddedCheckoutReady || serverCheckoutReady) && portalReady && webhooksReady && secretKeyConfigured);

  return {
    provider: "clerk" as const,
    configured: embeddedCheckoutReady || serverCheckoutReady,
    operational,
    embeddedCheckoutReady,
    serverCheckoutReady,
    portalReady,
    portalMode,
    webhooksReady,
    secretKeyConfigured,
    publishableKeyConfigured: Boolean(CLERK_PUBLISHABLE_KEY),
    explicitPortalConfigured: isRealConfig(EXPLICIT_CLERK_BILLING_PORTAL_URL),
    plans: planReadiness,
  };
}

// ── GET /plans — public, used by /pricing page and signup flows ───────────────

router.get("/plans", (_req: Request, res: Response) => {
  res.json({
    plans: PLANS.map((p) => {
      const planKey = p.id === "trial" ? null : (p.id as Exclude<PlanId, "trial">);
      const rawClerkPlanId = planKey ? process.env[CLERK_PLAN_ENV[planKey]] ?? null : null;
      const rawCheckoutMonthly = planKey ? process.env[CLERK_CHECKOUT_URL_ENV[planKey].monthly] ?? null : null;
      const rawCheckoutYearly = planKey ? process.env[CLERK_CHECKOUT_URL_ENV[planKey].yearly] ?? null : null;
      const clerkPlanId = isRealConfig(rawClerkPlanId) ? rawClerkPlanId : null;
      const clerkCheckoutMonthlyUrl = isRealConfig(rawCheckoutMonthly) ? rawCheckoutMonthly : null;
      const clerkCheckoutYearlyUrl = isRealConfig(rawCheckoutYearly) ? rawCheckoutYearly : null;
      return {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        monthlyPriceUsd: p.monthlyPriceUsd,
        yearlyPriceUsdPerMonth: p.yearlyPriceUsdPerMonth,
        highlighted: p.highlighted ?? false,
        ribbon: p.ribbon ?? null,
        cta: p.cta,
        trialDays: p.trialDays ?? null,
        maxVenues: p.maxVenues,
        maxAssistants: p.maxAssistants,
        includedVoiceMinutes: p.includedVoiceMinutes,
        overagePerMinuteUsd: p.overagePerMinuteUsd,
        skillTiers: p.skillTiers,
        allowedPipelines: p.allowedPipelines,
        bullets: p.bullets,
        billingProvider: "clerk",
        clerkPlanId,
        clerkCheckoutMonthlyUrl,
        clerkCheckoutYearlyUrl,
        clerkReady: !!(clerkPlanId || clerkCheckoutMonthlyUrl || clerkCheckoutYearlyUrl),
      };
    }),
  });
});

// ── GET /status — authenticated billing health for the account page ───────────

router.get("/status", requireAuth as any, async (req: Request, res: Response) => {
  const { subscription: sub, billingSource } = await syncActiveClerkClaimSubscription(
    req,
    (req as Request & { subscription?: any }).subscription ?? null,
  );
  const readiness = billingReadiness();
  res.json({
    ...readiness,
    subscription: sub
      ? {
          plan: sub.plan ?? null,
          status: sub.status ?? null,
          trialEndsAt: sub.trialEndsAt ?? null,
          currentPeriodEnd: sub.currentPeriodEnd ?? null,
          clerkSubscriptionId: sub.clerkSubscriptionId ?? null,
          organizationId: sub.organizationId ?? null,
          billingSource,
        }
      : null,
  });
});

async function syncActiveClerkClaimSubscription(
  req: Request,
  currentSub: any,
): Promise<{ subscription: any; billingSource: BillingSource }> {
  const clerkPlan = checkClerkOrgPlan(req);
  if (!clerkPlan?.active) {
    return { subscription: currentSub, billingSource: currentSub ? "local_db" : null };
  }

  const organizationId = (req as Request & { organization?: { id?: string } }).organization?.id ?? null;
  const userId = (req as Request & { user?: { id?: number } }).user?.id ?? 0;
  const subscription = {
    ...(currentSub ?? {}),
    id: currentSub?.id ?? -1,
    userId,
    plan: clerkPlan.plan,
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: currentSub?.currentPeriodEnd ?? null,
    clerkSubscriptionId: currentSub?.clerkSubscriptionId ?? null,
    organizationId,
  };

  if (userId > 0) {
    await upsertSubscriptionForUser(userId, {
      plan: clerkPlan.plan,
      status: "active",
      trialEndsAt: null,
      organizationId,
    });
  }

  return { subscription, billingSource: "clerk_claims" };
}

async function upsertSubscriptionForUser(
  userId: number,
  values: Partial<typeof subscriptionsTable.$inferInsert>,
) {
  const [existing] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(subscriptionsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, existing.id));
    invalidateAuthCacheForUser(userId);
    return;
  }

  await db.insert(subscriptionsTable).values({
    userId,
    plan: "trial",
    status: "trialing",
    ...values,
  });
  invalidateAuthCacheForUser(userId);
}

/**
 * Sync a Clerk organization subscription to all members of the local org.
 * Clerk B2B billing attaches subscriptions to organizations, so when we
 * receive an org subscription event we need to update all org members.
 */
async function syncOrgSubscription(
  organizationId: string,
  values: Partial<typeof subscriptionsTable.$inferInsert>,
) {
  // Find all members of the organization
  const members = await db
    .select({ userId: organizationMembershipsTable.userId })
    .from(organizationMembershipsTable)
    .where(eq(organizationMembershipsTable.organizationId, organizationId));

  for (const member of members) {
    await upsertSubscriptionForUser(member.userId, {
      ...values,
      organizationId,
    });
  }

  // Also update any subscription rows that reference this org directly
  const [existingOrgSub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.organizationId, organizationId))
    .limit(1);

  if (existingOrgSub) {
    // Always refresh the org-level row when it exists, even when member rows
    // were also updated.
    // Org exists in subscriptions but has no members yet — update the row
    await db
      .update(subscriptionsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, existingOrgSub.id));
  }

  console.log(`[Clerk Billing] Synced org ${organizationId} subscription to ${members.length} members`);
}

/**
 * Resolve a Clerk organization ID to a local organization.
 * Clerk sends org_id in subscription events for B2B billing.
 */
async function resolveClerkOrgId(clerkOrgId: string): Promise<string | null> {
  if (!clerkOrgId) return null;

  // Primary path: the local org stores the Clerk org id it was linked to.
  const [linked] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.clerkOrgId, clerkOrgId))
    .limit(1);

  if (linked) return linked.id;

  // Back-compat: some early orgs may have stored the Clerk id as the PK.
  const [org] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, clerkOrgId))
    .limit(1);

  if (org) return org.id;

  // If not found by ID, look up by Clerk API to find the org email/name
  // and match to local org via the owner
  if (!CLERK_SECRET_KEY) return null;

  try {
    const res = await fetch(`https://api.clerk.com/v1/organizations/${encodeURIComponent(clerkOrgId)}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!res.ok) return null;
    const clerkOrg = await res.json() as { created_by?: string; name?: string };

    // Resolve the creator's email to find the local org
    if (clerkOrg.created_by) {
      const email = await emailForClerkUser(clerkOrg.created_by);
      if (email) {
        const [user] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, email))
          .limit(1);

        if (user) {
          const [localOrg] = await db
            .select({ id: organizationsTable.id })
            .from(organizationsTable)
            .where(eq(organizationsTable.ownerUserId, user.id))
            .limit(1);

          return localOrg?.id ?? null;
        }
      }
    }
  } catch (e) {
    console.warn(`[Clerk Billing] Failed to resolve org ${clerkOrgId}:`, e);
  }

  return null;
}

function planFromClerkPlan(rawPlan: unknown): PlanId {
  const plan = rawPlan && typeof rawPlan === "object" ? rawPlan as Record<string, unknown> : {};
  const candidates = [
    plan.slug,
    plan.id,
    plan.name,
    typeof rawPlan === "string" ? rawPlan : null,
  ]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);

  for (const value of candidates) {
    if (CLERK_PLAN_SLUG_MAP[value]) return CLERK_PLAN_SLUG_MAP[value];
    for (const localPlan of PLANS) {
      if (value === localPlan.id) return localPlan.id;
      if (value === localPlan.name.toLowerCase()) return localPlan.id;
    }
  }
  return "trial";
}

function statusFromClerkEvent(type: string, data: Record<string, any>): string {
  const rawStatus = String(data.status ?? "").trim();
  if (type.endsWith(".active") || rawStatus === "active") return "active";
  if (type.endsWith(".pastDue") || rawStatus === "past_due") return "past_due";
  if (type.endsWith(".canceled") || type.endsWith(".ended") || type.endsWith(".abandoned")) return "canceled";
  if (type.endsWith(".incomplete") || rawStatus === "incomplete") return "incomplete";
  if (type.endsWith(".upcoming") || type.endsWith(".freeTrialEnding")) return "trialing";
  return rawStatus || "active";
}

function dateFromClerkValue(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function extractPayerUserId(data: Record<string, any>): string {
  return String(
    data.payer?.user_id ??
    data.payer?.userId ??
    data.subscription?.payer?.user_id ??
    data.subscription?.payer?.userId ??
    data.user_id ??
    data.userId ??
    "",
  );
}

function extractPlan(data: Record<string, any>): PlanId {
  const itemPlan = Array.isArray(data.items) ? data.items[0]?.plan : undefined;
  return planFromClerkPlan(itemPlan ?? data.plan ?? data.subscription?.items?.[0]?.plan);
}

async function emailForClerkUser(clerkUserId: string): Promise<string | null> {
  if (!CLERK_SECRET_KEY || !clerkUserId) return null;
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  const user = await res.json() as {
    primary_email_address_id?: string;
    email_addresses?: Array<{ id?: string; email_address?: string }>;
  };
  const primary = user.email_addresses?.find((email) => email.id === user.primary_email_address_id);
  return primary?.email_address ?? user.email_addresses?.[0]?.email_address ?? null;
}

async function localUserIdForClerkPayer(data: Record<string, any>): Promise<number | null> {
  const metadataUserId = Number(data.metadata?.userId ?? data.subscription?.metadata?.userId ?? 0);
  if (Number.isInteger(metadataUserId) && metadataUserId > 0) return metadataUserId;

  const clerkUserId = extractPayerUserId(data);

  // Fast path: the clerk-link flow persists clerk_user_id on the local user.
  if (clerkUserId) {
    const [linked] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (linked) return linked.id;
  }

  const email = await emailForClerkUser(clerkUserId);
  if (!email) return null;

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  return user?.id ?? null;
}

async function syncClerkBillingEvent(type: string, data: Record<string, any>): Promise<void> {
  const subscriptionId = String(data.subscription?.id ?? data.subscription_id ?? data.id ?? "");
  const currentPeriodEnd = dateFromClerkValue(data.period_end ?? data.periodEnd ?? data.current_period_end);
  const cancelAt = dateFromClerkValue(data.canceled_at ?? data.cancel_at ?? data.cancelAt);
  const plan = extractPlan(data);
  const status = statusFromClerkEvent(type, data);

  const subscriptionValues = {
    clerkSubscriptionId: subscriptionId || null,
    plan,
    status,
    currentPeriodEnd,
    cancelAt,
  };

  // B2B: Check for organization-level subscription
  const clerkOrgId = String(
    data.subscriber?.org_id ??
    data.subscriber?.organization_id ??
    data.organization_id ??
    data.org_id ??
    data.subscription?.subscriber?.org_id ??
    data.subscription?.organization_id ??
    "",
  );

  if (clerkOrgId) {
    const localOrgId = await resolveClerkOrgId(clerkOrgId);
    if (localOrgId) {
      await syncOrgSubscription(localOrgId, subscriptionValues);
      console.log(`[Clerk Billing] Synced ${type} for org ${localOrgId} (clerk: ${clerkOrgId})`);
      return;
    }
    console.warn(`[Clerk Billing] Could not resolve Clerk org ${clerkOrgId} to local org for event ${type}`);
  }

  // B2C fallback: sync to individual user
  const userId = await localUserIdForClerkPayer(data);
  if (!userId) {
    console.warn(`[Clerk Billing] Could not map payer for event ${type}`);
    return;
  }

  await upsertSubscriptionForUser(userId, subscriptionValues);
  console.log(`[Clerk Billing] Synced ${type} for user ${userId}`);
}

/**
 * Mirror Clerk organizationMembership.* events into local org memberships so
 * invited teammates get venue access and inherit the org's plan, and removed
 * members lose it.
 */
async function syncClerkMembershipEvent(type: string, data: Record<string, any>): Promise<void> {
  const clerkOrgId = String(data.organization?.id ?? data.organization_id ?? "");
  const clerkUserId = String(
    data.public_user_data?.user_id ??
    data.public_user_data?.userId ??
    data.user_id ??
    data.userId ??
    "",
  );
  const clerkRole = String(data.role ?? "");

  if (!clerkOrgId || !clerkUserId) {
    console.warn(`[Clerk Billing] Membership event ${type} missing org/user id`);
    return;
  }

  const result = type.endsWith(".deleted")
    ? await removeClerkOrgMembershipMirror(clerkOrgId, clerkUserId)
    : await mirrorClerkOrgMembership(clerkOrgId, clerkUserId, clerkRole);

  if (!result) {
    // The Clerk user has no VoyceLab account yet — they'll be mirrored when
    // they sign up and clerk-link runs.
    console.log(`[Clerk Billing] Membership event ${type}: no local counterpart yet (clerk user ${clerkUserId})`);
    return;
  }

  invalidateAuthCacheForUser(result.localUserId);
  console.log(`[Clerk Billing] Membership event ${type}: ${result.action} user ${result.localUserId} in org ${result.localOrgId}`);
}

// ── POST /checkout — Handoff to Clerk Billing ─────────────────────────────────

router.post("/checkout", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const { planId, cadence = "monthly" } = req.body ?? {};
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan || plan.id === "trial") {
    res.status(400).json({ error: "A paid Clerk plan is required." });
    return;
  }

  const planKey = plan.id as Exclude<PlanId, "trial">;
  const period = cadence === "yearly" ? "yearly" : "monthly";
  const checkoutUrl = process.env[CLERK_CHECKOUT_URL_ENV[planKey][period]];

  if (checkoutUrl) {
    res.json({ url: checkoutUrl, provider: "clerk" });
    return;
  }

  res.status(409).json({
    error: "Clerk checkout is handled by the embedded Clerk PricingTable. Set VITE_CLERK_PUBLISHABLE_KEY for the web app, or configure CLERK_CHECKOUT_*_URL for server redirects.",
  });
});

// ── POST /portal — Open Clerk billing management ──────────────────────────────

router.post("/portal", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  const readiness = billingReadiness();
  if (!readiness.portalReady) {
    res.status(503).json({
      error: "Clerk Billing portal is not configured. Set VITE_CLERK_PUBLISHABLE_KEY for the embedded organization billing page or CLERK_BILLING_PORTAL_URL for an external portal.",
    });
    return;
  }

  await syncActiveClerkClaimSubscription(
    req,
    (req as Request & { subscription?: any }).subscription ?? null,
  );
  res.json({ url: CLERK_BILLING_PORTAL_URL, provider: "clerk", mode: readiness.portalMode });
});

// ── POST /webhook — Handle Clerk Billing events ───────────────────────────────

router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  if (!WEBHOOK_SECRET_READY) {
    res.status(503).json({ error: "CLERK_WEBHOOK_SECRET not configured" });
    return;
  }

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    event = wh.verify(req.body, {
      "svix-id": String(req.headers["svix-id"] ?? ""),
      "svix-timestamp": String(req.headers["svix-timestamp"] ?? ""),
      "svix-signature": String(req.headers["svix-signature"] ?? ""),
    }) as ClerkWebhookEvent;
  } catch (e: any) {
    console.error("[Clerk Billing] Webhook signature verification failed:", e.message);
    res.status(400).json({ error: "Invalid signature" }); return;
  }

  try {
    if (event.type?.startsWith("subscription." ) || event.type?.startsWith("subscriptionItem.")) {
      await syncClerkBillingEvent(event.type, event.data ?? {});
    } else if (event.type?.startsWith("organizationMembership.")) {
      await syncClerkMembershipEvent(event.type, event.data ?? {});
    } else if (event.type?.startsWith("paymentAttempt.")) {
      console.log(`[Clerk Billing] Payment attempt event: ${event.type}`);
    }
  } catch (e: any) {
    console.error("[Clerk Billing] Webhook processing error:", e.message);
  }

  // Always respond 200 to Clerk after verification to avoid webhook retries
  // for non-critical sync mapping issues.
  res.json({ received: true });
});

export default router;
