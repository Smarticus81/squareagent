import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail } from "@/components/voice-rail";
import { ExternalLink, Loader2, Plus, Settings2, Sparkles, Store, Trash2, X } from "lucide-react";

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
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null);
  const [launchIssue, setLaunchIssue] = useState<{ message: string; url?: string } | null>(null);

  useEffect(() => {
    if (!isLoading && !auth?.user) { rememberIntendedPath(); setLocation("/login"); }
  }, [auth, isLoading, setLocation]);

  if (isLoading || (venuesLoading && !venuesError) || (profilesLoading && !profilesError)) {
    return (
      <div className="vl-page-shell flex flex-1 items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const venueById = new Map((venues ?? []).map((v) => [v.id, v]));
  const list: AssistantSummary[] = (profiles ?? []).map((profile) => {
    const venue = profile.venueId ? venueById.get(profile.venueId) : undefined;
    const approvals = Object.values((profile.confirmationPolicy?.approvals ?? {}) as Record<string, string>);
    const askFirstCount = approvals.filter((level) => level === "ask_first").length;
    return {
    id: profile.id,
    venueId: profile.venueId,
    name: profile.displayName,
    venue: profile.venueId ? venue?.squareLocationName ?? venue?.name ?? "Unnamed venue" : "General assistant",
    service: profile.venueId ? "Square" : "Square not connected",
    voice: pipelineLabel(profile.voicePipelineProvider),
    room: roomLabel(profile.noiseMode),
    wakePhrase: profile.wakePhrase,
    allowedCount: profile.allowedTools.length,
    askFirstCount,
    state: !profile.venueId || venue?.squareLocationId ? ("ready" as const) : ("offline" as const),
  };
  });
  const selectedAssistant = list.find((assistant) => assistant.id === selectedAssistantId) ?? null;

  return (
    <div className="vl-page-shell relative flex-1 overflow-hidden px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-295">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="vl-eyebrow">Assistants</p>
            <h1 className="vl-display mt-4 max-w-180 text-[34px] sm:text-[42px] md:text-[62px]" style={{ color: "var(--color-vl-ink)" }}>
              Voice Assistants
            </h1>
            <p className="mt-4 max-w-155 text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Manage your active voice assistants. Click an assistant to launch its live session, or create a new profile below.
            </p>
          </div>
          {list.length > 0 && (
            <button
              onClick={() => setLocation("/assistants/new")}
              className="vl-btn-primary inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> Create assistant
            </button>
          )}
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
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedAssistantId(a.id)}
                className="vl-panel group flex aspect-square min-h-[268px] flex-col justify-between overflow-hidden p-4 text-left transition hover:-translate-y-1 hover:shadow-lg"
              >
                <AssistantArt assistant={a} />

                <div>
                  <div className="flex items-start justify-between gap-3">
                    <p className="vl-eyebrow line-clamp-1">{a.venue}</p>
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
                  <h2 className="vl-display mt-2 line-clamp-2 text-[32px] leading-none" style={{ color: "var(--color-vl-ink)" }}>
                    {a.name}
                  </h2>
                </div>

                <div className="grid gap-2">
                  <div className="rounded-2xl bg-white/70 px-4 py-3 text-[12.5px] font-semibold shadow-sm" style={{ color: "var(--color-vl-ink)", border: "1px solid rgba(10,10,11,0.06)" }}>
                    {a.service} · {a.voice}
                  </div>
                  <span className="text-[12px] font-bold" style={{ color: "var(--color-vl-coral-deep)" }}>
                    Open controls
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        {selectedAssistant && (
          <AssistantDetailModal
            assistant={selectedAssistant}
            removing={deleteAssistant.isPending && deleteAssistant.variables === selectedAssistant.id}
            launchIssue={launchIssue}
            onClose={() => { setLaunchIssue(null); setSelectedAssistantId(null); }}
            onLaunch={async () => {
              setLaunchIssue(null);
              setLaunchIssue(await launchAssistant(selectedAssistant.venueId, selectedAssistant.id));
            }}
            onReconfigure={() => setLocation(`/assistants/edit/${selectedAssistant.id}`)}
            onRemove={() => {
              const confirmed = window.confirm(
                `Remove ${selectedAssistant.name}? This assistant will no longer appear in your workspace or launch links.`,
              );
              if (confirmed) {
                deleteAssistant.mutate(selectedAssistant.id, {
                  onSuccess: () => setSelectedAssistantId(null),
                });
              }
            }}
          />
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
    <div className="rounded-2xl bg-white/72 px-4 py-3 shadow-sm" style={{ border: "1px solid rgba(10, 10, 11,0.06)" }}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>{k}</dt>
      <dd className="mt-1 text-[13px] font-medium" style={{ color: "var(--color-vl-ink)" }}>{v}</dd>
    </div>
  );
}

function AssistantArt({ assistant, compact = false }: { assistant: AssistantSummary; compact?: boolean }) {
  const ready = assistant.state === "ready";
  const bars = ready ? [46, 72, 58, 88, 64, 76, 52] : [28, 38, 32, 44, 34, 40, 30];
  const palette = ready
    ? {
        start: "rgba(47,158,100,0.20)",
        mid: "rgba(79,184,255,0.20)",
        end: "rgba(255,255,255,0.88)",
        glow: "rgba(47,158,100,0.40)",
        soft: "rgba(79,184,255,0.34)",
        line: "rgba(47,158,100,0.78)",
        lineAlt: "rgba(14,27,44,0.70)",
        ink: "#17633B",
      }
    : {
        start: "rgba(124,110,245,0.20)",
        mid: "rgba(255,107,71,0.14)",
        end: "rgba(255,255,255,0.88)",
        glow: "rgba(124,110,245,0.36)",
        soft: "rgba(255,107,71,0.28)",
        line: "rgba(124,110,245,0.72)",
        lineAlt: "rgba(255,107,71,0.62)",
        ink: "#332B93",
      };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[22px] border shadow-inner ${compact ? "h-[126px]" : "h-[102px]"}`}
      style={{
        borderColor: ready ? "rgba(47,158,100,0.18)" : "rgba(124,110,245,0.16)",
        background: `linear-gradient(135deg, ${palette.start}, ${palette.mid} 52%, ${palette.end})`,
      }}
    >
      <div className="absolute -right-8 -top-12 h-32 w-32 rounded-[36%] blur-2xl" style={{ background: palette.glow }} />
      <div className="absolute -bottom-12 -left-10 h-32 w-32 rounded-[40%] blur-2xl" style={{ background: palette.soft }} />
      <div className="absolute inset-x-4 bottom-4 flex h-14 items-end gap-1.5">
        {bars.map((height, index) => (
          <span
            key={`${assistant.id}-${index}`}
            className="w-full rounded-md shadow-sm"
            style={{
              height: `${height}%`,
              background: index % 2 === 0 ? palette.line : palette.lineAlt,
              opacity: 0.86,
            }}
          />
        ))}
      </div>
      <div
        className="absolute left-4 top-4 grid h-12 w-12 place-items-center rounded-[18px] border shadow-lg backdrop-blur"
        style={{ borderColor: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.44)", color: palette.ink }}
      >
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="absolute right-4 top-4 h-3 w-12 rounded-md" style={{ background: palette.line, opacity: 0.75 }} />
      <div className="absolute right-4 top-9 h-3 w-8 rounded-md" style={{ background: palette.lineAlt, opacity: 0.65 }} />
    </div>
  );
}

function AssistantDetailModal({
  assistant,
  removing,
  launchIssue,
  onClose,
  onLaunch,
  onReconfigure,
  onRemove,
}: {
  assistant: AssistantSummary;
  removing: boolean;
  launchIssue: { message: string; url?: string } | null;
  onClose: () => void;
  onLaunch: () => void;
  onReconfigure: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label={`Close ${assistant.name}`}
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[88vh] w-full max-w-[920px] flex-col overflow-hidden rounded-[28px] border bg-white shadow-2xl"
        style={{ borderColor: "rgba(10,10,11,0.10)" }}
      >
        <div className="grid gap-5 border-b p-6 lg:grid-cols-[240px_minmax(0,1fr)_auto]" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
          <AssistantArt assistant={assistant} compact />
          <div className="flex min-w-0 items-start gap-4">
            <div className="min-w-0">
              <p className="vl-eyebrow">{assistant.venue}</p>
              <h2 className="vl-display mt-1 text-[42px] leading-none" style={{ color: "var(--color-vl-ink)" }}>
                {assistant.name}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-900"
            style={{ borderColor: "rgba(10,10,11,0.10)" }}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="vl-scroll overflow-y-auto p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <VoiceRail state={assistant.state === "ready" ? "ready" : "offline"} intensity={0.6} />
              <dl className="mt-6 grid gap-3 sm:grid-cols-2">
                <Row k="Connected service" v={assistant.service} />
                <Row k="Voice engine" v={assistant.voice} />
                <Row k="Room setting" v={assistant.room} />
                <Row k="Wake phrase" v={assistant.wakePhrase} />
              </dl>
              <div className="mt-6 rounded-2xl px-4 py-3" style={{ background: "rgba(10,10,11,0.04)", border: "1px solid rgba(10,10,11,0.07)" }}>
                <p className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Can do <strong style={{ color: "var(--color-vl-ink)" }}>{assistant.allowedCount}</strong> actions. Will ask before <strong style={{ color: "var(--color-vl-ink)" }}>{assistant.askFirstCount}</strong>.
                </p>
              </div>
            </div>

            <div className="grid gap-3 self-start rounded-[24px] border bg-white/70 p-4" style={{ borderColor: "rgba(10,10,11,0.08)" }}>
              <button
                type="button"
                onClick={onLaunch}
                disabled={assistant.state !== "ready"}
                className="vl-btn-primary inline-flex items-center justify-center gap-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Open assistant <ExternalLink className="h-3.5 w-3.5" />
              </button>
              {launchIssue && (
                <p className="rounded-2xl border px-3 py-2 text-[12.5px]" style={{ color: "var(--color-vl-danger)", background: "rgba(215,64,46,0.08)", borderColor: "rgba(215,64,46,0.18)" }}>
                  {launchIssue.message}
                  {launchIssue.url && (
                    <>
                      {" "}
                      <a href={launchIssue.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                        Open it here
                      </a>
                      .
                    </>
                  )}
                </p>
              )}
              <button
                type="button"
                onClick={onReconfigure}
                className="vl-btn-ghost inline-flex items-center justify-center gap-2 text-[13px]"
              >
                <Settings2 className="w-4 h-4" /> Reconfigure
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={removing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  color: "var(--color-vl-danger)",
                  background: "rgba(215,64,46,0.08)",
                  border: "1px solid rgba(215,64,46,0.16)",
                }}
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remove
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="vl-panel p-10 text-center md:p-12">
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

interface AssistantSummary {
  id: string;
  venueId: number | null;
  name: string;
  venue: string;
  service: string;
  voice: string;
  room: string;
  wakePhrase: string;
  allowedCount: number;
  askFirstCount: number;
  state: "ready" | "offline";
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
  if (provider === "google_gemini_3_1_flash_live") return "Gemini 3.1 Flash Live";
  if (provider === "google_gemini_2_5_flash_native_audio") return "Gemini 2.5 Native Audio";
  if (provider === "xai_grok_realtime_ws") return "xAI Grok Voice";
  if (provider.includes("gemini")) return "Unsupported Gemini engine";
  if (provider.includes("browser_speech")) return "Browser Speech";
  if (provider.includes("push_to_talk")) return "Push-to-talk";
  if (provider.includes("text_only")) return "Text only";
  return "OpenAI Realtime";
}

function roomLabel(noiseMode: string): string {
  return noiseMode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Returns null on success, or a user-facing issue (with a manual link when the popup was blocked). */
async function launchAssistant(
  venueId: number | null,
  agentProfileId: string,
): Promise<{ message: string; url?: string } | null> {
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
    const url = `${baseUrl}?code=${encodeURIComponent(code)}&agentProfileId=${encodeURIComponent(agentProfileId)}`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      return { message: "Your browser blocked the new tab.", url };
    }
    return null;
  } catch (e) {
    console.error(e);
    return { message: e instanceof Error ? e.message : "Could not open the assistant. Try again." };
  }
}
