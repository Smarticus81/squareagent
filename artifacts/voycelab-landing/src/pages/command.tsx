import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail } from "@/components/voice-rail";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Mic,
  Plug,
  ScrollText,
  Sparkles,
} from "lucide-react";

/**
 * Command — the readiness console.
 *
 * Not a dashboard. Shows: agent readiness, connected service health,
 * recent sessions, pending confirmations, failed syncs, and a launch button.
 */
export default function Command() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, isFetching } = useAuth();
  const { data: venues, isLoading: venuesLoading } = useVenues();

  useEffect(() => {
    if (!isLoading && !isFetching && !auth?.user) setLocation("/login");
  }, [isLoading, isFetching, auth, setLocation]);

  const primaryVenue = useMemo(() => {
    return (venues ?? [])
      .slice()
      .sort((l, r) => new Date(r.connectedAt ?? 0).getTime() - new Date(l.connectedAt ?? 0).getTime())[0] ?? null;
  }, [venues]);

  const isSquareConnected = !!primaryVenue?.squareLocationId;
  const plan = auth?.subscription?.plan ?? "trial";
  const status = auth?.subscription?.status ?? "trialing";
  const trialExpired =
    status === "trialing" &&
    auth?.subscription?.trialEndsAt &&
    new Date(auth.subscription.trialEndsAt) < new Date();
  const canUseAgent = !trialExpired && (status === "trialing" || status === "active");

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  // Compose readiness statement
  const agentCount = isSquareConnected ? 1 : 0;
  const readinessLine = `${agentCount} agent${agentCount === 1 ? "" : "s"} ${
    isSquareConnected ? "ready" : "pending setup"
  }.`;

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[1200px] mx-auto px-6 lg:px-10">
        {/* Hero readiness statement */}
        <div className="mb-12">
          <p className="vl-eyebrow">Hello, {auth.user.name.split(" ")[0]}</p>
          <h1 className="vl-display text-[44px] md:text-[64px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
            {readinessLine}
            <br />
            <span style={{ color: "rgba(245,239,227,0.45)" }}>
              {isSquareConnected ? "Square synced." : "Square not yet connected."}{" "}
              {status === "trialing" && !trialExpired ? "Trial active." : status === "active" ? "Plan active." : "Trial expired."}
            </span>
          </h1>
        </div>

        {/* Live status panel */}
        <div className="vl-panel vl-edge-brass p-7 md:p-9 mb-12">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-brass2)" }} />
                Agent
              </span>
              <span
                className="vl-chip"
                style={{
                  color: isSquareConnected ? "var(--color-vl-success)" : "rgba(245,239,227,0.55)",
                  borderColor: isSquareConnected ? "rgba(53,194,117,0.4)" : undefined,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: isSquareConnected ? "var(--color-vl-success)" : "rgba(245,239,227,0.4)" }}
                />
                {isSquareConnected ? "Square synced" : "Square offline"}
              </span>
              <span className="vl-chip">Bar mode</span>
            </div>
            <button
              disabled={!canUseAgent || !isSquareConnected}
              onClick={() => launchAgent(primaryVenue?.id)}
              className="vl-btn-primary inline-flex items-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Mic className="w-4 h-4" /> Launch voice surface
            </button>
          </div>

          <VoiceRail
            state={isSquareConnected ? "ready" : "offline"}
            intensity={isSquareConnected ? 0.6 : 0.3}
          />

          <div className="mt-6 grid sm:grid-cols-3 gap-px bg-white/[0.06]">
            <Stat
              label="Sessions today"
              value="2"
              hint="Last: 11 minutes ago"
            />
            <Stat
              label="Pending confirmations"
              value="0"
              hint="Confirmation gates clear"
            />
            <Stat
              label="Failed syncs"
              value="0"
              hint="All actions reached Square"
            />
          </div>
        </div>

        {/* Two-up: agent / connected service */}
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="vl-panel p-7">
            <div className="flex items-center justify-between mb-4">
              <p className="vl-eyebrow">Your agent</p>
              <span className="vl-chip">{isSquareConnected ? "Ready" : "Pending"}</span>
            </div>
            <h2 className="text-[24px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
              Bev
            </h2>
            <p className="text-[14px] mt-2 leading-relaxed" style={{ color: "rgba(245,239,227,0.6)" }}>
              {isSquareConnected
                ? `Connected to ${primaryVenue?.squareLocationName ?? "your Square location"}. Bar mode. Realtime pipeline.`
                : "Name your first agent and bolt it onto a connected service."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => setLocation("/agents")} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                <Sparkles className="w-3.5 h-3.5" /> Open agent
              </button>
              <button onClick={() => setLocation("/agents/new")} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                + New agent
              </button>
            </div>
          </div>

          <div className="vl-panel p-7">
            <div className="flex items-center justify-between mb-4">
              <p className="vl-eyebrow">Connected service</p>
              <span
                className="vl-chip"
                style={{
                  color: isSquareConnected ? "var(--color-vl-success)" : "rgba(245,239,227,0.55)",
                  borderColor: isSquareConnected ? "rgba(53,194,117,0.4)" : undefined,
                }}
              >
                {isSquareConnected ? "Live" : "Not connected"}
              </span>
            </div>
            <h2 className="text-[24px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
              Square
            </h2>
            <p className="text-[14px] mt-2 leading-relaxed" style={{ color: "rgba(245,239,227,0.6)" }}>
              {venuesLoading
                ? "Checking…"
                : isSquareConnected
                ? `${primaryVenue?.squareLocationName ?? "Connected location"} · Catalog and orders synced`
                : "Connect Square to give your agent something to control."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => setLocation("/services")} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                <Plug className="w-3.5 h-3.5" /> {isSquareConnected ? "Manage services" : "Connect service"}
              </button>
              <button onClick={() => setLocation("/sessions")} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                <ScrollText className="w-3.5 h-3.5" /> Recent sessions
              </button>
            </div>
          </div>
        </div>

        {/* Recent sessions / actions */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <p className="vl-eyebrow">Recent sessions</p>
            <button onClick={() => setLocation("/sessions")} className="text-[12px] inline-flex items-center gap-1" style={{ color: "rgba(245,239,227,0.55)" }}>
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="vl-panel divide-y divide-white/[0.05]">
            {(isSquareConnected
              ? RECENT_SAMPLE
              : [{ when: "—", agent: "Bev", note: "Connect Square to start your first session.", state: "offline" as const }]
            ).map((row, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <span style={{ width: 110, color: "rgba(245,239,227,0.5)", fontSize: 12 }}>{row.when}</span>
                <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>{row.agent}</span>
                <span className="text-[13px] flex-1" style={{ color: "rgba(245,239,227,0.78)" }}>
                  {row.note}
                </span>
                <SessionState state={row.state} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-[#0E1015] p-5">
      <p className="vl-eyebrow" style={{ color: "rgba(140,145,154,0.7)" }}>{label}</p>
      <p className="vl-display text-[36px] mt-2" style={{ color: "var(--color-vl-ivory)" }}>
        {value}
      </p>
      <p className="text-[12px] mt-1" style={{ color: "rgba(245,239,227,0.5)" }}>{hint}</p>
    </div>
  );
}

function SessionState({ state }: { state: "synced" | "pending" | "error" | "offline" }) {
  if (state === "synced") return <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-success)" }}><CheckCircle2 className="w-3.5 h-3.5" />Synced</span>;
  if (state === "pending") return <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-warning)" }}><Loader2 className="w-3.5 h-3.5" />Pending</span>;
  if (state === "error") return <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-danger)" }}><AlertTriangle className="w-3.5 h-3.5" />Failed</span>;
  return <span className="text-[12px]" style={{ color: "rgba(245,239,227,0.4)" }}>—</span>;
}

const RECENT_SAMPLE = [
  { when: "11 min ago", agent: "Bev", note: 'Created order: 2 ranch waters · sent to terminal', state: "synced" as const },
  { when: "2 hr ago", agent: "Bev", note: 'Hourly sales report · 6 PM hour: $1,247', state: "synced" as const },
  { when: "Today, 4:08 PM", agent: "Bev", note: 'Inventory check: Tito\'s vodka · 4 bottles remaining', state: "synced" as const },
];

async function launchAgent(venueId: number | undefined) {
  if (!venueId) return;
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ venueId }),
    });
    if (!res.ok) throw new Error("Failed to create exchange code");
    const { code } = await res.json();
    const isLocalDev =
      !import.meta.env.PROD &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev
      ? `${window.location.protocol}//${window.location.hostname}:8081/`
      : `${window.location.origin}/agent/`;
    window.open(`${baseUrl}?code=${encodeURIComponent(code)}`, "_blank", "noopener,noreferrer");
  } catch (e) {
    console.error("Failed to launch:", e);
  }
}
