import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail } from "@/components/voice-rail";
import { Loader2, Plus, Settings2 } from "lucide-react";

/**
 * Assistants — your team's voices.
 *
 * One named assistant per connected venue today. Each card surfaces the
 * connected service, room setting, and "ask first" count. No internal
 * concepts (tools, sessions, providers) leak into the UI.
 */
export default function Assistants() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const { data: venues, isLoading: venuesLoading, error: venuesError } = useVenues();

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  if (isLoading || (venuesLoading && !venuesError)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const list = (venues ?? []).map((v) => ({
    id: v.id,
    name: "Bev",
    venue: v.squareLocationName ?? v.name ?? "Unnamed venue",
    service: "Square",
    voice: "Fastest live voice",
    room: "Bar",
    allowedCount: 8,
    askFirstCount: 3,
    state: v.squareLocationId ? ("ready" as const) : ("offline" as const),
  }));

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <p className="vl-eyebrow">Assistants</p>
            <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
              Your team's voices.
            </h1>
            <p className="mt-3 text-[15px]" style={{ color: "rgba(245,239,227,0.62)" }}>
              Each assistant has a connected service, a room setting, and approval rules for what it can do.
            </p>
          </div>
          <button
            onClick={() => setLocation("/assistants/new")}
            className="vl-btn-primary inline-flex items-center gap-2 text-[14px]"
          >
            <Plus className="w-4 h-4" /> Create your assistant
          </button>
        </div>

        {venuesError && (
          <div className="vl-panel p-4 mb-6 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
            Connected service is unavailable right now: {venuesError.message}
          </div>
        )}

        {list.length === 0 ? (
          <EmptyState onCreate={() => setLocation("/assistants/new")} />
        ) : (
          <div className="grid lg:grid-cols-2 gap-3">
            {list.map((a) => (
              <article key={a.id} className="vl-panel p-7 vl-edge-brass">
                <div className="flex items-center justify-between mb-3">
                  <p className="vl-eyebrow">{a.venue}</p>
                  <span
                    className="vl-chip"
                    style={{
                      color: a.state === "ready" ? "var(--color-vl-success)" : "rgba(245,239,227,0.55)",
                      borderColor: a.state === "ready" ? "rgba(53,194,117,0.4)" : undefined,
                    }}
                  >
                    {a.state === "ready" ? "Ready" : "Offline"}
                  </span>
                </div>
                <h2 className="vl-display text-[40px]" style={{ color: "var(--color-vl-ivory)" }}>
                  {a.name}
                </h2>

                <div className="mt-4">
                  <VoiceRail state={a.state === "ready" ? "ready" : "offline"} intensity={0.6} />
                </div>

                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 mt-6 text-[13px]">
                  <Row k="Connected service" v={a.service} />
                  <Row k="Voice option" v={a.voice} />
                  <Row k="Room setting" v={a.room} />
                  <Row k="Approval" v={`Ask first on ${a.askFirstCount}`} />
                </dl>

                <div className="mt-5 pt-5 border-t border-white/[0.06]">
                  <p className="text-[13px]" style={{ color: "rgba(245,239,227,0.7)" }}>
                    Can do <strong style={{ color: "var(--color-vl-ivory)" }}>{a.allowedCount}</strong> actions. Will ask before <strong style={{ color: "var(--color-vl-ivory)" }}>{a.askFirstCount}</strong>.
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    onClick={() => launchAssistant(a.id)}
                    disabled={a.state !== "ready"}
                    className="vl-btn-primary text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Open assistant
                  </button>
                  <button
                    onClick={() => setLocation("/assistants/new")}
                    className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
                  >
                    <Settings2 className="w-4 h-4" /> Reconfigure
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: "rgba(245,239,227,0.5)" }}>{k}</dt>
      <dd style={{ color: "var(--color-vl-ivory)" }}>{v}</dd>
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="vl-panel p-12 text-center">
      <h2 className="vl-display text-[32px]" style={{ color: "var(--color-vl-ivory)" }}>
        Create your first assistant.
      </h2>
      <p className="mt-3 text-[14px] max-w-md mx-auto" style={{ color: "rgba(245,239,227,0.6)" }}>
        Name it, connect a service, choose what it can do, and test a command before you launch.
      </p>
      <button onClick={onCreate} className="vl-btn-primary inline-flex items-center gap-2 mt-7">
        <Plus className="w-4 h-4" /> Create your assistant
      </button>
    </div>
  );
}

async function launchAssistant(venueId: number) {
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
    console.error(e);
  }
}
