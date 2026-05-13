import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail } from "@/components/voice-rail";
import { ArrowLeft, ExternalLink, Loader2, Plus, Settings2, Sparkles, Store, Trash2 } from "lucide-react";

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
  const { data: profiles, isLoading: profilesLoading, error: profilesError } = useAgentProfiles();
  const deleteAssistant = useDeleteAssistant();

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  if (isLoading || (venuesLoading && !venuesError) || (profilesLoading && !profilesError)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const venueById = new Map((venues ?? []).map((v) => [v.id, v]));
  const list = (profiles ?? []).map((profile) => {
    const venue = profile.venueId ? venueById.get(profile.venueId) : undefined;
    const approvals = Object.values((profile.confirmationPolicy?.approvals ?? {}) as Record<string, string>);
    const askFirstCount = approvals.filter((level) => level === "ask_first").length;
    return {
    id: profile.id,
    venueId: profile.venueId,
    name: profile.displayName,
    venue: profile.venueId ? venue?.squareLocationName ?? venue?.name ?? "Unnamed venue" : "General assistant",
    service: profile.venueId ? "Square" : "Not connected yet",
    voice: pipelineLabel(profile.voicePipelineProvider),
    room: roomLabel(profile.noiseMode),
    wakePhrase: profile.wakePhrase,
    allowedCount: profile.allowedTools.length,
    askFirstCount,
    state: !profile.venueId || venue?.squareLocationId ? ("ready" as const) : ("offline" as const),
  };
  });

  return (
    <div className="relative flex-1 overflow-hidden px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-12%] top-[-18%] h-95 w-140 rounded-full blur-3xl" style={{ background: "rgba(251, 207, 232, 0.42)" }} />
        <div className="absolute right-[-12%] top-[8%] h-115 w-140 rounded-full blur-3xl" style={{ background: "rgba(199, 210, 254, 0.30)" }} />
        <div className="absolute bottom-[-18%] right-[8%] h-105 w-170 rounded-full blur-3xl" style={{ background: "rgba(167, 243, 208, 0.25)" }} />
      </div>
      <div className="mx-auto w-full max-w-295">
        <Link
          href="/command"
          className="inline-flex items-center gap-1.5 text-[12px] mb-5 transition-colors"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Console
        </Link>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="vl-eyebrow">Assistants</p>
            <h1 className="vl-display mt-4 max-w-180 text-[34px] sm:text-[42px] md:text-[62px]" style={{ color: "var(--color-vl-ink)" }}>
              Your team’s voice assistants.
            </h1>
            <p className="mt-5 max-w-155 text-[16px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Create one assistant per venue. Each voice carries its connected service, room behavior, wake phrase, and approval rules.
            </p>
          </div>
        </div>

        {venuesError && (
          <div className="mb-6 rounded-2xl border px-4 py-3 text-[13px]" style={{ color: "var(--color-vl-danger)", background: "rgba(215,64,46,0.08)", borderColor: "rgba(215,64,46,0.18)" }}>
            Connected service is unavailable right now: {venuesError.message}
          </div>
        )}

        {profilesError && (
          <div className="mb-6 rounded-2xl border px-4 py-3 text-[13px]" style={{ color: "var(--color-vl-danger)", background: "rgba(215,64,46,0.08)", borderColor: "rgba(215,64,46,0.18)" }}>
            Assistants are unavailable right now: {profilesError.message}
          </div>
        )}

        {list.length === 0 ? (
          <EmptyState onCreate={() => setLocation("/assistants/new")} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {list.map((a) => (
              <article key={a.id} className="vl-card-glass overflow-hidden p-6 md:p-7">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)", border: "1px solid rgba(99, 102, 241,0.16)" }}>
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="vl-eyebrow">{a.venue}</p>
                      <h2 className="vl-display mt-1 text-[42px]" style={{ color: "var(--color-vl-ink)" }}>
                        {a.name}
                      </h2>
                    </div>
                  </div>
                  <span
                    className="vl-chip"
                    style={{
                      color: a.state === "ready" ? "var(--color-vl-success)" : "var(--color-vl-ink-muted)",
                      borderColor: a.state === "ready" ? "rgba(47,158,100,0.20)" : undefined,
                      background: a.state === "ready" ? "rgba(47,158,100,0.08)" : undefined,
                    }}
                  >
                    {a.state === "ready" ? "Ready" : "Offline"}
                  </span>
                </div>

                <div className="mt-4">
                  <VoiceRail state={a.state === "ready" ? "ready" : "offline"} intensity={0.6} />
                </div>

                <dl className="mt-7 grid gap-3 sm:grid-cols-2">
                  <Row k="Connected service" v={a.service} />
                  <Row k="Voice engine" v={a.voice} />
                  <Row k="Room setting" v={a.room} />
                  <Row k="Wake phrase" v={a.wakePhrase} />
                </dl>

                <div className="mt-6 rounded-2xl px-4 py-3" style={{ background: "rgba(10, 10, 11,0.04)", border: "1px solid rgba(10, 10, 11,0.07)" }}>
                  <p className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Can do <strong style={{ color: "var(--color-vl-ink)" }}>{a.allowedCount}</strong> actions. Will ask before <strong style={{ color: "var(--color-vl-ink)" }}>{a.askFirstCount}</strong>.
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    onClick={() => launchAssistant(a.venueId, a.id)}
                    disabled={a.state !== "ready"}
                    className="vl-btn-primary inline-flex items-center gap-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Open assistant <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setLocation(`/assistants/edit/${a.id}`)}
                    className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]"
                  >
                    <Settings2 className="w-4 h-4" /> Reconfigure
                  </button>
                  <button
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Remove ${a.name}? This assistant will no longer appear in your workspace or launch links.`,
                      );
                      if (confirmed) deleteAssistant.mutate(a.id);
                    }}
                    disabled={deleteAssistant.isPending && deleteAssistant.variables === a.id}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      color: "var(--color-vl-danger)",
                      background: "rgba(215,64,46,0.08)",
                      border: "1px solid rgba(215,64,46,0.16)",
                    }}
                  >
                    {deleteAssistant.isPending && deleteAssistant.variables === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {deleteAssistant.error && (
          <p className="mt-5 rounded-2xl border px-4 py-3 text-[13px]" style={{ color: "var(--color-vl-danger)", background: "rgba(215,64,46,0.08)", borderColor: "rgba(215,64,46,0.18)" }}>
            {deleteAssistant.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl bg-white/60 px-4 py-3" style={{ border: "1px solid rgba(10, 10, 11,0.06)" }}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>{k}</dt>
      <dd className="mt-1 text-[13px] font-medium" style={{ color: "var(--color-vl-ink)" }}>{v}</dd>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="vl-card-glass p-10 text-center md:p-12">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
        <Store className="h-6 w-6" />
      </div>
      <h2 className="vl-display text-[36px]" style={{ color: "var(--color-vl-ink)" }}>
        Create your first assistant.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
        Name it, connect a service, choose what it can do, and test a command before you launch.
      </p>
      <button onClick={onCreate} className="vl-btn-primary inline-flex items-center gap-2 mt-7">
        <Plus className="w-4 h-4" /> Create your assistant
      </button>
    </div>
  );
}

interface AgentProfile {
  id: string;
  venueId: number | null;
  displayName: string;
  wakePhrase: string;
  voicePipelineProvider: string;
  noiseMode: string;
  allowedTools: string[];
  confirmationPolicy: Record<string, unknown>;
}

function useAgentProfiles() {
  return useQuery({
    queryKey: ["/api/v1/agent-profiles"],
    queryFn: async () => {
      const token = localStorage.getItem("voycelab_token") || "";
      const res = await fetch("/api/v1/agent-profiles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? body.error ?? `Failed to load assistants (${res.status})`);
      }
      const data = await res.json();
      return (data.profiles ?? []) as AgentProfile[];
    },
    enabled: !!localStorage.getItem("voycelab_token"),
  });
}

function useDeleteAssistant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assistantId: string) => {
      const token = localStorage.getItem("voycelab_token") || "";
      const res = await fetch(`/api/v1/agent-profiles/${encodeURIComponent(assistantId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? body.error ?? `Failed to remove assistant (${res.status})`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/agent-profiles"] });
    },
  });
}

function pipelineLabel(provider: string): string {
  if (provider.includes("gemini")) return "Gemini Live";
  if (provider.includes("hume")) return "Hume EVI";
  if (provider.includes("deepgram")) return "Deepgram";
  if (provider.includes("elevenlabs")) return "ElevenLabs";
  return "OpenAI Realtime";
}

function roomLabel(noiseMode: string): string {
  return noiseMode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function launchAssistant(venueId: number | null, agentProfileId: string) {
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(venueId ? { venueId } : {}), agentProfileId }),
    });
    if (!res.ok) throw new Error("Could not open the assistant. Try again.");
    const { code } = await res.json();
    const isLocalDev =
      !import.meta.env.PROD &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev
      ? `${window.location.protocol}//${window.location.hostname}:8081/`
      : `${window.location.origin}/agent/`;
    window.open(`${baseUrl}?code=${encodeURIComponent(code)}&agentProfileId=${encodeURIComponent(agentProfileId)}`, "_blank", "noopener,noreferrer");
  } catch (e) {
    console.error(e);
  }
}
