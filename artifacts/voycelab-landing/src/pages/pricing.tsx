import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { PricingTable, SignedIn, SignedOut } from "@clerk/clerk-react";
import { ArrowRight, Check, Loader2, Lock, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { withClerkBillingHeader } from "@/lib/clerk-session";

interface PlanBullet {
  text: string;
  emphasis?: boolean;
}

interface PlanResponse {
  id: string;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  yearlyPriceUsdPerMonth: number;
  highlighted: boolean;
  ribbon: string | null;
  cta: string;
  trialDays: number | null;
  maxVenues: number;
  maxAssistants: number;
  includedVoiceMinutes: number;
  overagePerMinuteUsd: number;
  skillTiers: string[];
  allowedPipelines: string[];
  bullets: PlanBullet[];
  billingProvider: "clerk";
  clerkPlanId: string | null;
  clerkCheckoutMonthlyUrl: string | null;
  clerkCheckoutYearlyUrl: string | null;
  clerkReady: boolean;
}

type Cadence = "monthly" | "yearly";

export default function Pricing() {
  const [, navigate] = useLocation();
  const { data: auth } = useAuth();
  const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  const clerkBillingEnabled = Boolean(clerkPublishableKey);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCheckout, setSelectedCheckout] = useState<{ planId: string; cadence: Cadence } | null>(null);

  useEffect(() => {
    fetch("/api/subscriptions/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => setError("Could not load pricing. Try again in a moment."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelect(plan: PlanResponse, cadenceOverride: Cadence = cadence) {
    if (plan.id === "trial") {
      if (auth?.user) navigate("/assistants/new");
      else navigate("/signup");
      return;
    }
    // Enterprise plan removed — no longer needed
    if (!auth?.user) {
      sessionStorage.setItem("voycelab.pending_plan", plan.id);
      sessionStorage.setItem("voycelab.pending_cadence", cadenceOverride);
      navigate("/signup");
      return;
    }
    if (clerkBillingEnabled) {
      setSelectedCheckout({ planId: plan.id, cadence: cadenceOverride });
      const checkout = document.getElementById("clerk-checkout");
      checkout?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const checkoutUrl = cadenceOverride === "yearly" ? plan.clerkCheckoutYearlyUrl : plan.clerkCheckoutMonthlyUrl;
    if (!checkoutUrl) {
      setError(
        `Clerk Billing is not configured yet for "${plan.name}". Set VITE_CLERK_PUBLISHABLE_KEY for the embedded checkout, or configure ${
          cadenceOverride === "yearly" ? "CLERK_CHECKOUT_*_YEARLY_URL" : "CLERK_CHECKOUT_*_MONTHLY_URL"
        } on the server.`,
      );
      return;
    }
    setError(null);
    setCheckoutLoading(plan.id);
    try {
      const token = localStorage.getItem("voycelab_token") ?? "";
      const headers = await withClerkBillingHeader({
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      });
      const res = await fetch("/api/subscriptions/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, cadence: cadenceOverride }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Checkout failed (${res.status})`);
      }
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  useEffect(() => {
    if (loading || !auth?.user || plans.length === 0) return;
    const pendingPlan = sessionStorage.getItem("voycelab.pending_plan");
    if (!pendingPlan) return;
    const pendingCadence = sessionStorage.getItem("voycelab.pending_cadence") === "yearly" ? "yearly" : "monthly";
    const plan = plans.find((p) => p.id === pendingPlan);
    sessionStorage.removeItem("voycelab.pending_plan");
    sessionStorage.removeItem("voycelab.pending_cadence");
    setCadence(pendingCadence);
    if (plan) {
      setSelectedCheckout({ planId: plan.id, cadence: pendingCadence });
      void handleSelect(plan, pendingCadence);
    }
  }, [loading, auth?.user, plans]);

  const selectedCheckoutPlan = selectedCheckout
    ? plans.find((plan) => plan.id === selectedCheckout.planId)
    : null;

  return (
    <div className="flex-1 pt-24 pb-24 bg-vl-cream">
      <div className="w-full max-w-295 mx-auto px-4 sm:px-6 lg:px-10">
        <p className="vl-eyebrow">Pricing</p>
        <h1 className="vl-display text-[40px] md:text-[56px] mt-3 max-w-3xl" style={{ color: "var(--color-vl-ink)" }}>
          The cost of giving your venue a voice.
        </h1>
        <p className="mt-4 text-[15px] max-w-2xl leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
          One platform. Every voice engine your team needs. Pricing scales with how many venues you run and how many assistants you put on the floor — not with how many features you can use.
        </p>

        {/* Cadence toggle */}
        <div className="mt-10 flex items-center gap-3">
          <CadenceToggle value={cadence} onChange={setCadence} />
          <span className="text-[12px]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Yearly = save ~17%
          </span>
        </div>

        {error && (
          <div className="mt-6 vl-panel p-4 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
            {error}
          </div>
        )}

        {clerkBillingEnabled && (
          <section id="clerk-checkout" className="mt-10 vl-panel p-5 md:p-7">
            <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="vl-eyebrow">Secure checkout</p>
                <h2 className="vl-display mt-2 text-[28px] md:text-[34px]" style={{ color: "var(--color-vl-ink)" }}>
                  Subscribe with Clerk Billing.
                </h2>
                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Clerk manages checkout, payment methods, invoices, and plan changes. Your VoyceLab account is linked automatically, so the plan you choose here activates instantly across your workspace.
                </p>
              </div>
              {!auth?.user && (
                <Link href="/signup" className="vl-btn-primary text-[13px] inline-flex items-center gap-2">
                  Start free trial <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
            {selectedCheckoutPlan && (
              <div
                className="mb-5 rounded-2xl border bg-white/70 p-4 text-[13px]"
                style={{ borderColor: "rgba(124,110,245,0.24)", color: "var(--color-vl-ink-muted)" }}
              >
                <span className="font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                  Selected: {selectedCheckoutPlan.name} · {selectedCheckout?.cadence === "yearly" ? "Yearly" : "Monthly"}
                </span>
                <span className="ml-1">
                  Choose the matching plan below to link billing to this organization.
                </span>
              </div>
            )}
            <SignedIn>
              <PricingTable for="organization" />
              <div className="mt-4 flex items-center gap-2 text-[12px]" style={{ color: "var(--color-vl-ink-faint)" }}>
                <Lock className="h-3.5 w-3.5" />
                Payments are processed securely by Stripe. Cancel or change your plan anytime.
              </div>
            </SignedIn>
            <SignedOut>
              {auth?.user ? (
                <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white/55 p-6 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
                  Preparing your secure checkout…
                </div>
              ) : (
                <div className="rounded-2xl border border-black/10 bg-white/55 p-6 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                  <p>Log in or start a free trial to subscribe — your plan links to your workspace automatically.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/signup" className="vl-btn-primary text-[13px] inline-flex items-center gap-2">
                      Start free trial <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <Link href="/login" className="vl-btn-ghost text-[13px]">Log in</Link>
                  </div>
                </div>
              )}
            </SignedOut>
          </section>
        )}

        {/* Plan grid */}
        {loading ? (
          <div className="mt-12 vl-panel p-12 flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
            <span className="text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>Loading plans…</span>
          </div>
        ) : (
          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                cadence={cadence}
                onSelect={() => handleSelect(p)}
                loading={checkoutLoading === p.id}
              />
            ))}
          </div>
        )}

        {/* Voice engine cost transparency */}
        <section className="mt-20">
          <p className="vl-eyebrow">What you actually pay for</p>
          <h2 className="vl-display text-[28px] md:text-[36px] mt-3 max-w-2xl" style={{ color: "var(--color-vl-ink)" }}>
            Your bill = platform + minutes spoken.
          </h2>
          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <Tile
              kicker="Platform fee"
              title="Predictable monthly base"
              body="Covers every venue, every assistant, every connected service, and every capability in your tier. No per-command charges, no per-action charges. You can rebuild your assistants every week and your bill doesn't move."
            />
            <Tile
              kicker="Voice minutes"
              title="Only what your team speaks"
              body="A minute is counted only when your assistant is actively in a session - listening, replying, or running a command. Idle screens and dashboard work cost nothing."
            />
            <Tile
              kicker="Overages"
              title="Soft cap, never a hard stop"
              body="If you blow through your included minutes, your assistants keep working. Overage rate drops as you climb tiers — Business pays $0.12/min, Pro pays $0.18/min."
            />
            <Tile
              kicker="No surprises"
              title="Switch engines without re-pricing"
              body="OpenAI Realtime, Gemini 3.1 Flash Live, Gemini 2.5 Native Audio — same minute, same price to you. We absorb provider differences so you can pick the best voice for the room without watching cost."
            />
          </div>
        </section>

        {/* ROI band */}
        <section className="mt-20 vl-panel vl-edge-brass p-8 md:p-10">
          <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
            <div>
              <p className="vl-eyebrow">The math</p>
              <h2 className="vl-display text-[28px] md:text-[34px] mt-3" style={{ color: "var(--color-vl-ink)" }}>

                If your manager saves 4 hours a week, you've already paid for Pro.
              </h2>
              <p className="mt-3 text-[14px] max-w-xl leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                Bar managers earn $20-$35 an hour. Four hours a week of saved POS lookups, inventory counts, and report-pulling is $320-$560 of value. Pro is $149.
              </p>
            </div>
            <Link
              href={auth?.user ? "/assistants/new" : "/signup"}
              className="vl-btn-primary inline-flex items-center gap-2 text-[14px] px-6 py-3"
            >
              <Sparkles className="w-4 h-4" />
              Start your trial
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-20">
          <p className="vl-eyebrow">FAQ</p>
          <h2 className="vl-display text-[28px] md:text-[36px] mt-3" style={{ color: "var(--color-vl-ink)" }}>
            The honest answers.
          </h2>
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <Faq
              q="Can I change voice engines after I start?"
              a="Yes. Each assistant carries its own engine choice. Switch any time from the assistant settings — no migration, no re-onboarding. Existing orders keep flowing."
            />
            <Faq
              q="What happens if my POS goes down?"
              a="Your assistant gracefully falls back to the push-to-talk surface and cached menu. Voice keeps working; only writes to Square wait until it's back."
            />
            <Faq
              q="Is the trial really 14 days, no card?"
              a="Yes. 60 voice minutes and core POS commands. Card is collected only if you upgrade."
            />
            <Faq
              q="What if I'm a chain or hospitality group?"
              a="Business covers unlimited venues and assistants. If you need SSO, custom audit, or a dedicated regional relay, contact sales@voycelab.com."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function CadenceToggle({ value, onChange }: { value: Cadence; onChange: (v: Cadence) => void }) {
  return (
    <div
      className="inline-flex rounded-full border p-1"
      style={{ borderColor: "rgba(10, 10, 11,0.12)", background: "rgba(255,255,255,0.5)" }}
      role="radiogroup"
    >
      {(["monthly", "yearly"] as Cadence[]).map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt)}
            className="text-[12px] px-4 py-1.5 rounded-full transition-colors"
            style={{
              background: selected ? "rgba(124,110,245,0.14)" : "transparent",
              color: selected ? "var(--color-vl-ink)" : "var(--color-vl-ink-muted)",
              border: selected ? "1px solid rgba(124,110,245,0.45)" : "1px solid transparent",
            }}
          >
            {opt === "monthly" ? "Monthly" : "Yearly"}
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({
  plan,
  cadence,
  onSelect,
  loading,
}: {
  plan: PlanResponse;
  cadence: Cadence;
  onSelect: () => void;
  loading: boolean;
}) {
  const monthly = plan.monthlyPriceUsd;
  const yearly = plan.yearlyPriceUsdPerMonth;
  const price = cadence === "yearly" ? yearly : monthly;
  const isContact = false;
  const isFree = plan.id === "trial";

  return (
    <article
      className="vl-panel p-6 flex flex-col"
      style={{
        borderColor: plan.highlighted ? "rgba(124,110,245,0.6)" : undefined,
        boxShadow: plan.highlighted ? "0 0 0 1px rgba(124,110,245,0.4)" : undefined,
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[20px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
          {plan.name}
        </h3>
        {plan.ribbon && (
          <span
            className="vl-chip"
            style={{ color: "var(--color-vl-ink-soft)", borderColor: "rgba(124,110,245,0.45)", fontSize: 10 }}
          >
            {plan.ribbon}
          </span>
        )}
      </div>
      <p className="text-[13px] mt-1.5 leading-snug min-h-9" style={{ color: "var(--color-vl-ink-muted)" }}>
        {plan.tagline}
      </p>

      <div className="mt-5 mb-1 flex items-baseline gap-2">
        {isContact ? (
          <span className="text-[28px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
            Custom
          </span>
        ) : isFree ? (
          <span className="text-[28px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
            Free
          </span>
        ) : (
          <>
            <span className="text-[36px] font-semibold tabular-nums" style={{ color: "var(--color-vl-ink)" }}>
              ${price}
            </span>
            <span className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
              / mo {cadence === "yearly" ? "(billed yearly)" : ""}
            </span>
          </>
        )}
      </div>
      {!isContact && !isFree && cadence === "yearly" && monthly > yearly && (
        <p className="text-[11.5px]" style={{ color: "var(--color-vl-success)" }}>
          Save ${(monthly - yearly) * 12}/yr vs. monthly
        </p>
      )}
      {isFree && plan.trialDays && (
        <p className="text-[11.5px] mt-0.5" style={{ color: "var(--color-vl-ink-faint)" }}>
          {plan.trialDays}-day trial · No card required
        </p>
      )}

      <div className="my-5 h-px" style={{ background: "rgba(10, 10, 11,0.08)" }} />

      <ul className="space-y-2.5 flex-1">
        {plan.bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[13px]"
            style={{
              color: b.emphasis ? "var(--color-vl-ink)" : "var(--color-vl-ink-soft)",
            }}
          >
            <Check
              className="w-3.5 h-3.5 mt-0.5 shrink-0"
              style={{ color: b.emphasis ? "var(--color-vl-coral-deep)" : "var(--color-vl-success)" }}
            />
            <span style={{ fontWeight: b.emphasis ? 600 : 400 }}>{b.text}</span>
          </li>
        ))}
        {!isContact && plan.includedVoiceMinutes > 0 && (
          <li className="flex items-start gap-2 text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>
            <span className="w-3.5" aria-hidden />
            <span>
              Overage at ${plan.overagePerMinuteUsd.toFixed(2)} / extra minute. {plan.allowedPipelines.length} voice engine{plan.allowedPipelines.length === 1 ? "" : "s"} unlocked.
            </span>
          </li>
        )}
      </ul>

      <button
        onClick={onSelect}
        disabled={loading}
        className={
          plan.highlighted
            ? "vl-btn-primary inline-flex items-center justify-center gap-2 text-[13px] mt-6"
            : "vl-btn-ghost inline-flex items-center justify-center gap-2 text-[13px] mt-6"
        }
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {plan.cta}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </article>
  );
}

function Tile({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="vl-panel p-6">
      <p className="vl-eyebrow">{kicker}</p>
      <p className="text-[16px] font-semibold mt-2" style={{ color: "var(--color-vl-ink)" }}>
        {title}
      </p>
      <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
        {body}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="vl-panel p-6">
      <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{q}</p>
      <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>{a}</p>
    </div>
  );
}
