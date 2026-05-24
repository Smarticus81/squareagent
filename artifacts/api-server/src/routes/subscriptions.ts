/**
 * Stripe Subscription Routes
 *
 * POST /api/subscriptions/checkout  — Create a Stripe Checkout Session
 * POST /api/subscriptions/portal    — Create a Stripe Customer Portal session
 * POST /api/subscriptions/webhook   — Handle Stripe webhook events
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { db, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { PLANS } from "@workspace/voicelab-core/pricing";

const router = Router();

// ── GET /plans — public, used by /pricing page and signup flows ───────────────

router.get("/plans", (_req: Request, res: Response) => {
  res.json({
    plans: PLANS.map((p) => {
      const stripeMonthly = p.stripeMonthlyPriceEnvVar
        ? process.env[p.stripeMonthlyPriceEnvVar] ?? null
        : null;
      const stripeYearly = p.stripeYearlyPriceEnvVar
        ? process.env[p.stripeYearlyPriceEnvVar] ?? null
        : null;
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
        stripeMonthlyPriceId: stripeMonthly,
        stripeYearlyPriceId: stripeYearly,
        stripeReady: !!(stripeMonthly || stripeYearly),
      };
    }),
  });
});

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000");

/**
 * Map price IDs from env to plan names. Both legacy plan ids
 * (pos_only / inventory_only / complete) and the new pricing tier ids
 * (starter / professional / premium) are supported simultaneously so
 * existing subscriptions keep resolving while the new pricing rolls out.
 */
const PLAN_PRICE_MAP: Record<string, string> = {
  // Current pricing tiers (monthly + yearly).
  [process.env.STRIPE_PRICE_PRO_MONTHLY ?? "price_pro_monthly"]: "pro",
  [process.env.STRIPE_PRICE_PRO_YEARLY ?? "price_pro_yearly"]: "pro",
  [process.env.STRIPE_PRICE_BUSINESS_MONTHLY ?? "price_business_monthly"]: "business",
  [process.env.STRIPE_PRICE_BUSINESS_YEARLY ?? "price_business_yearly"]: "business",
  // Legacy price IDs — map old tiers to new equivalents.
  [process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "price_starter_monthly"]: "pro",
  [process.env.STRIPE_PRICE_STARTER_YEARLY ?? "price_starter_yearly"]: "pro",
  [process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY ?? "price_professional_monthly"]: "pro",
  [process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY ?? "price_professional_yearly"]: "pro",
  [process.env.STRIPE_PRICE_PREMIUM_MONTHLY ?? "price_premium_monthly"]: "business",
  [process.env.STRIPE_PRICE_PREMIUM_YEARLY ?? "price_premium_yearly"]: "business",
  // Legacy aliases.
  [process.env.STRIPE_PRICE_POS_ONLY ?? "price_pos_only"]: "pro",
  [process.env.STRIPE_PRICE_INVENTORY_ONLY ?? "price_inventory_only"]: "pro",
  [process.env.STRIPE_PRICE_COMPLETE ?? "price_complete"]: "business",
};

function planFromPriceId(priceId: string): string {
  return PLAN_PRICE_MAP[priceId] ?? "pro";
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
    return;
  }

  await db.insert(subscriptionsTable).values({
    userId,
    plan: "trial",
    status: "trialing",
    ...values,
  });
}

// ── POST /checkout — Create Stripe Checkout Session ───────────────────────────

router.post("/checkout", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const user = (req as any).user;
  const sub = (req as any).subscription;
  const { priceId } = req.body ?? {};

  if (!priceId) { res.status(400).json({ error: "priceId is required" }); return; }

  try {
    // Reuse Stripe customer if exists
    let customerId = sub?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: String(user.id) },
      });
      customerId = customer.id;
      await upsertSubscriptionForUser(user.id, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${PUBLIC_BASE_URL}/command?checkout=success`,
      cancel_url: `${PUBLIC_BASE_URL}/command?checkout=cancel`,
      subscription_data: {
        metadata: { userId: String(user.id) },
      },
      metadata: {
        userId: String(user.id),
        priceId,
        plan: planFromPriceId(priceId),
      },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error("[Stripe] Checkout error:", e.message);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── POST /portal — Create Stripe Customer Portal session ──────────────────────

router.post("/portal", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const sub = (req as any).subscription;
  if (!sub?.stripeCustomerId) {
    res.status(400).json({ error: "No Stripe customer found. Subscribe first." }); return;
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${PUBLIC_BASE_URL}/settings`,
    });
    res.json({ url: session.url });
  } catch (e: any) {
    console.error("[Stripe] Portal error:", e.message);
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

// ── POST /webhook — Handle Stripe events ──────────────────────────────────────

router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const sig = req.headers["stripe-signature"];
  if (!sig) { res.status(400).json({ error: "Missing stripe-signature header" }); return; }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e: any) {
    console.error("[Stripe] Webhook signature verification failed:", e.message);
    res.status(400).json({ error: "Invalid signature" }); return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = parseInt(String(session.metadata?.userId ?? "0"), 10);
        if (!userId) break;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
        const priceId = String(session.metadata?.priceId ?? "");

        await upsertSubscriptionForUser(userId, {
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: subscriptionId ?? null,
          plan: priceId ? planFromPriceId(priceId) : String(session.metadata?.plan ?? "pro"),
          status: "active",
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        let userId = parseInt(sub.metadata.userId ?? "0", 10);
        if (!userId && typeof sub.customer === "string") {
          const customer = await stripe.customers.retrieve(sub.customer);
          if (!customer.deleted) userId = parseInt(String(customer.metadata?.userId ?? "0"), 10);
        }
        if (!userId) break;

        const priceId = sub.items.data[0]?.price?.id ?? "";
        const plan = planFromPriceId(priceId);

        await upsertSubscriptionForUser(userId, {
            stripeSubscriptionId: sub.id,
            stripeCustomerId: sub.customer as string,
            plan,
            status: sub.status === "trialing" ? "trialing" : sub.status === "active" ? "active" : sub.status,
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
            cancelAt: (sub as any).cancel_at ? new Date((sub as any).cancel_at * 1000) : null,
          });

        console.log(`[Stripe] Subscription ${sub.id} updated for user ${userId} — plan: ${plan}, status: ${sub.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        let userId = parseInt(sub.metadata.userId ?? "0", 10);
        if (!userId && typeof sub.customer === "string") {
          const customer = await stripe.customers.retrieve(sub.customer);
          if (!customer.deleted) userId = parseInt(String(customer.metadata?.userId ?? "0"), 10);
        }
        if (!userId) break;

        await upsertSubscriptionForUser(userId, {
            status: "canceled",
            cancelAt: new Date(),
          });

        console.log(`[Stripe] Subscription ${sub.id} canceled for user ${userId}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.warn(`[Stripe] Payment failed for customer ${customerId}`);
        break;
      }
    }
  } catch (e: any) {
    console.error("[Stripe] Webhook processing error:", e.message);
  }

  // Always respond 200 to Stripe
  res.json({ received: true });
});

export default router;
