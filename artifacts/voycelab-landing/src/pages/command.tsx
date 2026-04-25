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
 * Command — readiness, not metrics.
 *
 * Shows: assistant readiness, connected service health, recent conversations,
 * items needing approval, connection issues, launch button. No latency chips,
 * no technical engine names — those live behind Settings → Advanced.
 */
export default function Command() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, isFetching } = useAuth();
  const { data: venues, isLoading: venuesLoading, error: venuesError } = useVenues();

  useEffect(() => {
    if (!isLoading && !isFetching && !auth?.user) setLocation("/login");
  }, [isLoading, isFetching, auth, setLocation]);

  const primaryVenue = useMemo(() => {
    return (
      (venues ?? [])
        .slice()
        .sort(
          (l, r) =>
            new Date(r.connectedAt ?? 0).getTime() - new Date(l.connectedAt ?? 0).getTime(),
        )[0] ?? null
    );
  }, [venues]);

  const isConnected = !!primaryVenue?.squareLocationId;
  const status = auth?.subscription?.status ?? "trialing";
  const trialExpired =
    status === "trialing" &&
    auth?.subscription?.trialEndsAt &&
    new Date(auth.subscription.trialEndsAt) < new Date();
  const canUse = !trialExpired && (status === "trialing" || status === "active");

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const assistantCount = isConnected ? 1 : 0;
  const headline = `${assistantCount} assistant${assistantCount === 1 ? "" : "s"} ${
    isConnected ? "ready" : "to set up"
  }.`;

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[1200px] mx-auto px-6 lg:px-10">
        {/* Hero readiness statement */}
        <div className="mb-12">
          <p className="vl-eyebrow">Hello, {auth.user.name.split(" ")[0]}</p>
          <h1
            className="vl-display text-[44px] md:text-[64px] mt-3"
            style={{ color: "var(--color-vl-ivory)" }}
          >
            {headline}
            <br />
            <span style={{ color: "rgba(245,239,227,0.45)" }}>
              {isConnected ? "Square synced." : "Square not connected yet."}{" "}
              {status === "trialing" && !trialExpired
                ? "Trial active."
                : status === "active"
                ? "Plan active."
                : "Trial ended."}
            </span>
          </h1>
        </div>

        {venuesError && (
          <div
            className="vl-panel p-4 mb-6 text-[13px]"
            style={{ color: "var(--color-vl-danger)" }}
          >
            Connected service is unavailable right now: {venuesError.message}
          </div>
        )}

        {/* Live status panel */}
        <div className="vl-panel vl-edge-brass p-7 md:p-9 mb-12">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "var(--color-vl-brass2)" }}
                />
                Assistant
              </span>
              <span
                className="vl-chip"
                style={{
                  color: isConnected ? "var(--color-vl-success)" : "rgba(245,239,227,0.55)",
                  borderColor: isConnected ? "rgba(53,194,117,0.4)" : undefined,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor: isConnected ? "var(--color-vl-success)" : "rgba(245,239,227,0.4)",
                  }}
                />
                {isConnected ? "Square synced" : "Square not connected"}
              </span>
              <span className="vl-chip">Bar</span>
            </div>
            <button
              disabled={!canUse || !isConnected}
              onClick={() => launchAssistant(primaryVenue?.id)}
              className="vl-btn-primary inline-flex items-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Mic className="w-4 h-4" /> Open assistant
            </button>
          </div>

          <VoiceRail state={isConnected ? "ready" : "offline"} intensity={isConnected ? 0.6 : 0.3} />

          <div className="mt-6 grid sm:grid-cols-3 gap-px bg-white/[0.06]">
            <Stat label="Conversations today" value="2" hint="Last: 11 minutes ago" />
            <Stat label="Waiting for approval" value="0" hint="Nothing pending" />
            <Stat label="Needs attention" value="0" hint="All actions reached Square" />
          </div>
        </div>

        {/* Two-up: assistant / connected service */}
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="vl-panel p-7">
            <div className="flex items-center justify-between mb-4">
              <p className="vl-eyebrow">Your assistant</p>
              <span className="vl-chip">{isConnected ? "Ready" : "Pending"}</span>
            </div>
            <h2
              className="text-[24px] font-semibold tracking-tight"
              style={{ color: "var(--color-vl-ivory)" }}
            >
              Bev
            </h2>
            <p
              className="text-[14px] mt-2 leading-relaxed"
              style={{ color: "rgba(245,239,227,0.6)" }}
            >
              {isConnected
                ? `Connected to ${primaryVenue?.squareLocationName ?? "your Square location"}. Bar room setting. Fastest live voice.`
                : "Name your first assistant and connect a service."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={() => setLocation("/assistants")}
                className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
              >
                <Sparkles className="w-3.5 h-3.5" /> Open assistants
              </button>
              <button
                onClick={() => setLocation("/assistants/new")}
                className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
              >
                + Create your assistant
              </button>
            </div>
          </div>

          <div className="vl-panel p-7">
            <div className="flex items-center justify-between mb-4">
              <p className="vl-eyebrow">Connected service</p>
              <span
                className="vl-chip"
                style={{
                  color: isConnected ? "var(--color-vl-success)" : "rgba(245,239,227,0.55)",
                  borderColor: isConnected ? "rgba(53,194,117,0.4)" : undefined,
                }}
              >
                {isConnected ? "Available" : "Not connected"}
              </span>
            </div>
            <h2
              className="text-[24px] font-semibold tracking-tight"
              style={{ color: "var(--color-vl-ivory)" }}
            >
              Square
            </h2>
            <p
              className="text-[14px] mt-2 leading-relaxed"
              style={{ color: "rgba(245,239,227,0.6)" }}
            >
              {venuesLoading
                ? "Checking…"
                : isConnected
                ? `${primaryVenue?.squareLocationName ?? "Connected location"} · Synced`
                : "Connect Square to give your assistant something to control."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={() => setLocation("/services")}
                className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
              >
                <Plug className="w-3.5 h-3.5" />{" "}
                {isConnected ? "Manage services" : "Connect Square"}
              </button>
              <button
                onClick={() => setLocation("/conversations")}
                className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
              >
                <ScrollText className="w-3.5 h-3.5" /> Conversations
              </button>
            </div>
          </div>
        </div>

        {/* Recent conversations */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <p className="vl-eyebrow">Recent conversations</p>
            <button
              onClick={() => setLocation("/conversations")}
              className="text-[12px] inline-flex items-center gap-1"
              style={{ color: "rgba(245,239,227,0.55)" }}
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="vl-panel divide-y divide-white/[0.05]">
            {(isConnected
              ? RECENT_SAMPLE
              : [
                  {
                    when: "—",
                    assistant: "Bev",
                    note: "Connect Square to start your first conversation.",
                    state: "offline" as const,
                  },
                ]
            ).map((row, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <span style={{ width: 110, color: "rgba(245,239,227,0.5)", fontSize: 12 }}>
                  {row.when}
                </span>
                <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
                  {row.assistant}
                </span>
                <span
                  className="text-[13px] flex-1"
                  style={{ color: "rgba(245,239,227,0.78)" }}
                >
                  {row.note}
                </span>
                <ConversationState state={row.state} />
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
      <p className="vl-eyebrow" style={{ color: "rgba(140,145,154,0.7)" }}>
        {label}
      </p>
      <p
        className="vl-display text-[36px] mt-2"
        style={{ color: "var(--color-vl-ivory)" }}
      >
        {value}
      </p>
      <p className="text-[12px] mt-1" style={{ color: "rgba(245,239,227,0.5)" }}>
        {hint}
      </p>
    </div>
  );
}

function ConversationState({
  state,
}: {
  state: "synced" | "waiting_approval" | "needs_attention" | "offline";
}) {
  if (state === "synced")
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px]"
        style={{ color: "var(--color-vl-success)" }}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Synced
      </span>
    );
  if (state === "waiting_approval")
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px]"
        style={{ color: "var(--color-vl-warning)" }}
      >
        <Loader2 className="w-3.5 h-3.5" />
        Waiting for approval
      </span>
    );
  if (state === "needs_attention")
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px]"
        style={{ color: "var(--color-vl-danger)" }}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        Needs attention
      </span>
    );
  return (
    <span className="text-[12px]" style={{ color: "rgba(245,239,227,0.4)" }}>
      —
    </span>
  );
}

const RECENT_SAMPLE = [
  {
    when: "11 min ago",
    assistant: "Bev",
    note: "Added 2 ranch waters · sent to terminal",
    state: "synced" as const,
  },
  {
    when: "2 hr ago",
    assistant: "Bev",
    note: "Hourly sales summary · 6 PM hour: $1,247",
    state: "synced" as const,
  },
  {
    when: "Today, 4:08 PM",
    assistant: "Bev",
    note: "Stock check: Tito's vodka · 4 bottles remaining",
    state: "synced" as const,
  },
];

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
