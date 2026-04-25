import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail } from "@/components/voice-rail";
import { Loader2, Mic, Plus, Settings2 } from "lucide-react";

/**
 * Agents — list of named voice agents, one per venue.
 *
 * Today there's a single agent per venue derived from the connected Square
 * location. As multi-agent profiles land server-side, the same UI will scale.
 */
export default function Agents() {
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
    pipeline: "Fastest realtime",
    noiseMode: "Bar",
    capabilities: ["read_menu", "create_order", "submit_order", "send_to_terminal", "check_inventory", "run_reports"],
    confirm: "Strict on terminal",
    state: v.squareLocationId ? ("ready" as const) : ("offline" as const),
  }));

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="vl-eyebrow">Agents</p>
            <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
              Your team's voice.
            </h1>
            <p className="mt-3 text-[15px]" style={{ color: "rgba(245,239,227,0.6)" }}>
              Name an agent per venue. Each agent has a connected service, a noise mode, and a confirmation policy.
            </p>
          </div>
          <button
            onClick={() => setLocation("/agents/new")}
            className="vl-btn-primary inline-flex items-center gap-2 text-[14px]"
          >
            <Plus className="w-4 h-4" /> New agent
          </button>
        </div>

        {venuesError && (
          <div className="vl-panel p-4 mb-6 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
            Venue service unavailable: {venuesError.message}
          </div>
        )}

        {list.length === 0 ? (
          <EmptyState onCreate={() => setLocation("/agents/new")} />
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
                  <Row k="Connected" v={a.service} />
                  <Row k="Pipeline" v={a.pipeline} />
                  <Row k="Noise mode" v={a.noiseMode} />
                  <Row k="Confirmation" v={a.confirm} />
                </dl>

                <div className="mt-5 pt-5 border-t border-white/[0.06]">
                  <p className="vl-eyebrow mb-2" style={{ color: "rgba(140,145,154,0.7)" }}>Allowed capabilities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {a.capabilities.map((c) => (
                      <span key={c} className="vl-chip" style={{ fontSize: 10 }}>
                        {c.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    onClick={() => launchAgent(a.id)}
                    disabled={a.state !== "ready"}
                    className="vl-btn-primary inline-flex items-center gap-2 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Mic className="w-4 h-4" /> Launch
                  </button>
                  <button
                    onClick={() => setLocation("/agents/new")}
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
        No agents yet.
      </h2>
      <p className="mt-3 text-[14px] max-w-md mx-auto" style={{ color: "rgba(245,239,227,0.6)" }}>
        Configure your first agent. Name it, bolt it onto Square, set the room and the boundaries.
      </p>
      <button onClick={onCreate} className="vl-btn-primary inline-flex items-center gap-2 mt-7">
        <Plus className="w-4 h-4" /> Create your first agent
      </button>
    </div>
  );
}

async function launchAgent(venueId: number) {
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
