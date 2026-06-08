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
import { requireAuth } from "./auth";
import { PLANS, type PlanId } from "@workspace/voicelab-core/pricing";

const router = Router();

type Cadence = "monthly" | "yearly";
type ClerkWebhookEvent = {
  id?: string;
  type?: string;
  data?: Record<string, any>;
};

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:5173");

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET ?? "";
const CLERK_BILLING_PORTAL_URL = process.env.CLERK_BILLING_PORTAL_URL ?? `${PUBLIC_BASE_URL}/billing`;

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

// ── GET /plans — public, used by /pricing page and signup flows ───────────────

router.get("/plans", (_req: Request, res: Response) => {
  res.json({
    plans: PLANS.map((p) => {
      const planKey = p.id === "trial" ? null : (p.id as Exclude<PlanId, "trial">);
      const clerkPlanId = planKey ? process.env[CLERK_PLAN_ENV[planKey]] ?? null : null;
      const clerkCheckoutMonthlyUrl = planKey ? process.env[CLERK_CHECKOUT_URL_ENV[planKey].monthly] ?? null : null;
      const clerkCheckoutYearlyUrl = planKey ? process.env[CLERK_CHECKOUT_URL_ENV[planKey].yearly] ?? null : null;
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
    return;
  }

  await db.insert(subscriptionsTable).values({
    userId,
    plan: "trial",
    status: "trialing",
    ...values,
  });
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

  if (existingOrgSub && members.length === 0) {
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

  // First check if we have an org with this exact ID (Clerk org IDs may match)
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

  const email = await emailForClerkUser(extractPayerUserId(data));
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
    error: "Clerk checkout is handled by the embedded Clerk PricingTable. Set VITE_CLERK_PUBLISHABLE_KEY on the dashboard app, or configure CLERK_CHECKOUT_*_URL for server redirects.",
  });
});

// ── POST /portal — Open Clerk billing management ──────────────────────────────

router.post("/portal", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  res.json({ url: CLERK_BILLING_PORTAL_URL, provider: "clerk" });
});

// ── POST /webhook — Handle Clerk Billing events ───────────────────────────────

router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  if (!CLERK_WEBHOOK_SECRET) {
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
