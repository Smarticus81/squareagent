import { useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail } from "@/components/voice-rail";
import {
  ArrowRight,
  ArrowUpRight,
  Loader2,
  Mic,
  Plug,
  Settings as Cog,
  Sparkles,
} from "lucide-react";

/**
 * Command — the launchpad.
 *
 * One job: tell the user the single next action they need to take, and give
 * them one button to do it. No fake metrics, no duplicated status. State
 * drives the headline, the copy, and the primary CTA.
 */
export default function Command() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, isFetching } = useAuth();
  const { data: venues, isLoading: venuesLoading, error: venuesError } = useVenues();

  useEffect(() => {
    if (!isLoading && !isFetching && !auth?.user) setLocation("/login");
  }, [isLoading, isFetching, auth, setLocation]);

  const primaryVenue = useMemo(
    () =>
      (venues ?? [])
        .slice()
        .sort(
          (l, r) =>
            new Date(r.connectedAt ?? 0).getTime() - new Date(l.connectedAt ?? 0).getTime(),
        )[0] ?? null,
    [venues],
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }
  if (!auth?.user) return null;

  const isConnected = !!primaryVenue?.squareLocationId;
  const status = auth?.subscription?.status ?? "trialing";
  const trialEndsAt = auth?.subscription?.trialEndsAt ? new Date(auth.subscription.trialEndsAt) : null;
  const trialActive = status === "trialing" && (!trialEndsAt || trialEndsAt > new Date());
  const trialExpired = status === "trialing" && trialEndsAt && trialEndsAt < new Date();
  const planActive = status === "active";

  const firstName = auth.user.name.split(" ")[0] || "there";

  /* ── Drive the primary action from real state ─────────────────────────── */
  const primary = (() => {
    if (venuesError) {
      return {
        kind: "error" as const,
        eyebrow: "Connection issue",
        title: "We couldn't load your venues.",
        body: venuesError.message,
        ctaLabel: "Try again",
        ctaAction: () => window.location.reload(),
      };
    }
    if (trialExpired) {
      return {
        kind: "upgrade" as const,
        eyebrow: "Trial ended",
        title: "Pick a plan to keep using your assistant.",
        body: "Your 14-day trial has ended. Upgrade to keep Bev on the floor.",
        ctaLabel: "Choose a plan",
        ctaAction: async () => {
          const token = localStorage.getItem("voycelab_token") || "";
          const res = await fetch("/api/subscriptions/portal", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          }).catch(() => null);
          if (res?.ok) {
            const { url } = await res.json();
            window.location.href = url;
          }
        },
      };
    }
    if (!isConnected) {
      return {
        kind: "connect" as const,
        eyebrow: venuesLoading ? "Loading..." : "Step 1 of 2",
        title: "Connect Square to get started.",
        body: "VoyceLab works inside your POS. Link Square to give your assistant something to control.",
        ctaLabel: "Connect Square",
        ctaAction: () => setLocation("/services"),
      };
    }
    return {
      kind: "open" as const,
      eyebrow: planActive ? "Plan active" : trialActive ? "Trial active" : "Ready",
      title: "Bev is ready on the floor.",
      body: `${primaryVenue?.squareLocationName ?? "Your venue"} · Bar · Fastest live voice`,
      ctaLabel: "Open Bev",
      ctaAction: () => launchAssistant(primaryVenue?.id),
    };
  })();

  return (
    <div className="flex-1 pt-24 pb-16">
      <div className="w-full max-w-[960px] mx-auto px-6 lg:px-10">
        {/* Greeting */}
        <div className="mb-8 md:mb-10">
          <p className="vl-eyebrow">Console</p>
          <h1 className="text-[28px] md:text-[34px] font-semibold tracking-tight mt-2" style={{ color: "var(--color-vl-ivory)" }}>
            Hello, {firstName}.
          </h1>
        </div>

        {/* Single intent card — the one thing that matters right now */}
        <article
          className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#14161C] to-[#0B0D12] p-7 md:p-10"
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                primary.kind === "open"
                  ? "radial-gradient(ellipse 70% 80% at 80% 0%, rgba(90,160,255,0.10), transparent 60%)"
                  : primary.kind === "upgrade"
                  ? "radial-gradient(ellipse 70% 80% at 80% 0%, rgba(224,82,82,0.10), transparent 60%)"
                  : "radial-gradient(ellipse 70% 80% at 80% 0%, rgba(245,166,35,0.08), transparent 60%)",
            }}
          />
          <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-8">
            <div className="max-w-xl">
              <p className="vl-eyebrow" style={{
                color: primary.kind === "upgrade"
                  ? "var(--color-vl-danger)"
                  : primary.kind === "open"
                  ? "var(--color-vl-success)"
                  : "var(--color-vl-brass2)",
              }}>
                {primary.eyebrow}
              </p>
              <h2 className="text-[28px] md:text-[36px] font-semibold tracking-tight mt-3 leading-[1.1]" style={{ color: "var(--color-vl-ivory)" }}>
                {primary.title}
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(245,239,227,0.62)" }}>
                {primary.body}
              </p>
            </div>
            <button
              type="button"
              onClick={() => primary.ctaAction?.()}
              className="vl-btn-primary inline-flex items-center gap-2 text-[14px] px-6 py-3 shrink-0"
            >
              {primary.kind === "open" ? <Mic className="w-4 h-4" /> : null}
              {primary.ctaLabel}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {primary.kind === "open" && (
            <div className="relative mt-10 pt-7 border-t border-white/[0.06]">
              <VoiceRail state="ready" intensity={0.55} />
            </div>
          )}

          {primary.kind === "connect" && (
            <div className="relative mt-10 pt-7 border-t border-white/[0.06] grid sm:grid-cols-2 gap-6">
              <Step n="1" active label="Connect Square" body="OAuth to your merchant and pick a location." />
              <Step n="2" label="Create your assistant" body="Name it, pick a voice, choose what it can do." />
            </div>
          )}
        </article>

        {/* Trial countdown strip — only when useful */}
        {trialActive && trialEndsAt && (
          <div className="mt-4 flex items-center justify-between gap-4 px-5 py-3 rounded-xl border border-white/[0.06]">
            <p className="text-[12.5px]" style={{ color: "rgba(245,239,227,0.62)" }}>
              Trial ends {trialEndsAt.toLocaleDateString()} ·{" "}
              <span style={{ color: "var(--color-vl-ivory)" }}>
                {Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} days left
              </span>
            </p>
            <Link href="/settings" className="text-[12px] inline-flex items-center gap-1" style={{ color: "var(--color-vl-brass2)" }}>
              Manage billing <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        )}

        {/* Three tight rows — not a dashboard, a router */}
        <nav className="mt-12 border-t border-white/[0.06]">
          <RouterRow
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label="Assistant"
            detail={isConnected ? "Bev · Bar · Fastest live voice" : "Not configured yet"}
            hint="Rename, retune, or change what it can do."
            href="/assistants"
            cta={isConnected ? "Configure" : "Set up"}
          />
          <RouterRow
            icon={<Plug className="w-3.5 h-3.5" />}
            label="Integrations"
            detail={
              isConnected
                ? `${primaryVenue?.squareLocationName ?? "Square"} · Synced`
                : "No services connected"
            }
            hint="Connect Square, disconnect, or add a location."
            href="/services"
            cta={isConnected ? "Manage" : "Connect"}
          />
          <RouterRow
            icon={<Cog className="w-3.5 h-3.5" />}
            label="Account"
            detail={`${auth.user.email} · ${planActive ? "Plan active" : trialActive ? "Trial" : "Trial ended"}`}
            hint="Profile, password, and billing."
            href="/settings"
            cta="Open"
            last
          />
        </nav>
      </div>
    </div>
  );
}

function Step({ n, active, label, body }: { n: string; active?: boolean; label: string; body: string }) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-mono shrink-0"
        style={{
          borderColor: active ? "rgba(224,183,106,0.6)" : "rgba(245,239,227,0.14)",
          color: active ? "var(--color-vl-brass2)" : "rgba(245,239,227,0.5)",
          background: active ? "rgba(224,183,106,0.06)" : "transparent",
        }}
      >
        {n}
      </div>
      <div>
        <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
          {label}
        </p>
        <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: "rgba(245,239,227,0.55)" }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function RouterRow({
  icon,
  label,
  detail,
  hint,
  href,
  cta,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  hint: string;
  href: string;
  cta: string;
  last?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-6 py-5 px-1 ${last ? "" : "border-b border-white/[0.06]"} transition-colors hover:bg-white/[0.015]`}
    >
      <div className="flex items-center gap-3 shrink-0 w-44" style={{ color: "rgba(245,239,227,0.55)" }}>
        <span style={{ color: "var(--color-vl-brass2)" }}>{icon}</span>
        <span className="vl-eyebrow">{label}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium truncate" style={{ color: "var(--color-vl-ivory)" }}>
          {detail}
        </p>
        <p className="text-[12px] mt-0.5" style={{ color: "rgba(245,239,227,0.45)" }}>
          {hint}
        </p>
      </div>
      <span
        className="text-[12px] inline-flex items-center gap-1 shrink-0 transition-colors group-hover:text-[color:var(--color-vl-ivory)]"
        style={{ color: "rgba(245,239,227,0.55)" }}
      >
        {cta}
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}

async function launchAssistant(venueId: number | undefined) {
  if (!venueId) return;
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ venueId }),
    });
    if (!res.ok) throw new Error("Could not open the assistant. Try again.");
    const { code } = await res.json();
    const isLocalDev =
      !import.meta.env.PROD &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev
      ? `${window.location.protocol}//${window.location.hostname}:8081/`
      : `${window.location.origin}/agent/`;
    window.open(`${baseUrl}?code=${encodeURIComponent(code)}`, "_blank", "noopener,noreferrer");
  } catch (e) {
    console.error("Could not open assistant:", e);
  }
}
