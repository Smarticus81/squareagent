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

const router = Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000");

/** Map price IDs from env to plan names */
const PLAN_PRICE_MAP: Record<string, string> = {
  [process.env.STRIPE_PRICE_POS_ONLY ?? "price_pos_only"]: "pos_only",
  [process.env.STRIPE_PRICE_INVENTORY_ONLY ?? "price_inventory_only"]: "inventory_only",
  [process.env.STRIPE_PRICE_COMPLETE ?? "price_complete"]: "complete",
};

function planFromPriceId(priceId: string): string {
  return PLAN_PRICE_MAP[priceId] ?? "complete";
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
      // Persist customer ID
      if (sub) {
        await db.update(subscriptionsTable)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(subscriptionsTable.id, sub.id));
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${PUBLIC_BASE_URL}/dashboard?checkout=success`,
      cancel_url: `${PUBLIC_BASE_URL}/dashboard?checkout=cancel`,
      subscription_data: {
        metadata: { userId: String(user.id) },
      },
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
      return_url: `${PUBLIC_BASE_URL}/dashboard`,
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
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = parseInt(sub.metadata.userId ?? "0", 10);
        if (!userId) break;

        const priceId = sub.items.data[0]?.price?.id ?? "";
        const plan = planFromPriceId(priceId);

        await db.update(subscriptionsTable)
          .set({
            stripeSubscriptionId: sub.id,
            stripeCustomerId: sub.customer as string,
            plan,
            status: sub.status === "trialing" ? "trialing" : sub.status === "active" ? "active" : sub.status,
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
            cancelAt: (sub as any).cancel_at ? new Date((sub as any).cancel_at * 1000) : null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionsTable.userId, userId));

        console.log(`[Stripe] Subscription ${sub.id} updated for user ${userId} — plan: ${plan}, status: ${sub.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = parseInt(sub.metadata.userId ?? "0", 10);
        if (!userId) break;

        await db.update(subscriptionsTable)
          .set({
            status: "canceled",
            cancelAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(subscriptionsTable.userId, userId));

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
