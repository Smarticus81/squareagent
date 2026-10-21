import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import { useVenues } from "@/hooks/use-venues";
import { Presence } from "@/components/presence";

/**
 * Home — your assistant.
 *
 * One presence, its name, where it runs, and the single thing you came here
 * to do: open it on a device behind the bar. Everything else is a quiet
 * link. Multiple assistants become a short list under the primary one.
 */
export default function Assistants() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const { data: venues, isLoading: venuesLoading, error: venuesError } = useVenues();
  const { data: profiles, isLoading: profilesLoading, error: profilesError } = useAgentProfiles();
  const deleteAssistant = useDeleteAssistant();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchIssue, setLaunchIssue] = useState<{ message: string; url?: string } | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!isLoading && !auth?.user) { rememberIntendedPath(); setLocation("/login"); }
  }, [auth, isLoading, setLocation]);

  if (isLoading || (venuesLoading && !venuesError) || (profilesLoading && !profilesError)) {
    return (
      <div className="vl-page-shell flex flex-1 items-center justify-center">
        <Presence state="connecting" size={72} label="Loading" />
      </div>
    );
  }
  if (!auth?.user) return null;

  const venueById = new Map((venues ?? []).map((v) => [v.id, v]));
  const defaultVenue = (venues ?? []).find((v) => v.squareLocationId) ?? null;
  const list: AssistantSummary[] = (profiles ?? []).map((profile) => {
    const venue = profile.venueId ? venueById.get(profile.venueId) : undefined;
    const venueLabel = profile.venueId
      ? venue?.squareLocationName ?? venue?.name ?? "Unnamed venue"
      : defaultVenue
        ? `${defaultVenue.squareLocationName ?? defaultVenue.name}`
        : "No venue yet";
    const hasSquare = profile.venueId ? Boolean(venue?.squareLocationId) : Boolean(defaultVenue);
    return {
      id: profile.id,
      venueId: profile.venueId,
      name: profile.displayName,
      venue: venueLabel,
      wakePhrase: profile.wakePhrase,
      hasSquare,
      ready: !profile.venueId || Boolean(venue?.squareLocationId),
    };
  });

  const primary = list.find((a) => a.id === selectedId) ?? list[0] ?? null;
  const others = list.filter((a) => a.id !== primary?.id);

  async function launch(a: AssistantSummary) {
    setLaunchIssue(null);
    setLaunching(true);
    try {
      setLaunchIssue(await launchAssistant(a.venueId, a.id));
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="vl-page-shell flex flex-1 flex-col px-5 pb-24 pt-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        {(venuesError || profilesError) && (
          <p className="mb-6 rounded-2xl border px-4 py-3 text-[13px]" style={{ color: "var(--color-vl-danger)", borderColor: "rgba(255,107,107,0.22)", background: "rgba(255,107,107,0.08)" }}>
            {venuesError?.message ?? profilesError?.message}
          </p>
        )}

        {!primary ? (
          <EmptyState onGuided={() => setLocation("/onboarding")} onCreate={() => setLocation("/assistants/new")} />
        ) : (
          <section className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <Presence state={primary.ready ? "ready" : "dormant"} size={180} label={primary.name} onClick={() => { void launch(primary); }} />
            <p className="vl-eyebrow mt-10">{primary.venue}</p>
            <h1 className="vl-display mt-3 text-[clamp(2rem,5vw,3.2rem)]">{primary.name}</h1>
            <p className="mt-3 text-[15px]" style={{ color: "var(--color-vl-ink-muted)" }}>
              {primary.ready
                ? <>Wakes to <span style={{ color: "var(--color-vl-ink)" }}>“{primary.wakePhrase}”</span>{primary.hasSquare ? " · connected to Square" : ""}</>
                : "Square isn't connected for this venue yet."}
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
              {primary.ready ? (
                <button type="button" onClick={() => { void launch(primary); }} disabled={launching} className="vl-btn-primary min-w-48 justify-center px-6 py-3 text-[15px]">
                  {launching ? "Opening…" : "Open on this device"}
                </button>
              ) : (
                <button type="button" onClick={() => setLocation("/services")} className="vl-btn-primary min-w-48 justify-center px-6 py-3 text-[15px]">
                  Connect Square
                </button>
              )}
              <button type="button" onClick={() => setLocation(`/assistants/edit/${primary.id}`)} className="vl-btn-ghost min-w-32 justify-center px-6 py-3 text-[15px]">
                Edit
              </button>
            </div>
            {launchIssue && (
              <p className="mt-4 max-w-sm text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                {launchIssue.message}
                {launchIssue.url && (
                  <> <a href={launchIssue.url} target="_blank" rel="noopener noreferrer" className="underline">Open it here</a>.</>
                )}
              </p>
            )}
            <p className="mt-6 text-[12.5px]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Opens in a new tab. Add it to the home screen of the phone or tablet that stays behind the bar.
            </p>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13.5px]">
              <button type="button" className="transition-colors hover:text-white" style={{ color: "var(--color-vl-ink-muted)" }} onClick={() => setLocation("/assistants/new")}>
                New assistant
              </button>
              <button type="button" className="transition-colors hover:text-white" style={{ color: "var(--color-vl-ink-muted)" }} onClick={() => setLocation("/services")}>
                Connections
              </button>
              <button
                type="button"
                className="transition-colors hover:text-white"
                style={{ color: "var(--color-vl-ink-faint)" }}
                disabled={deleteAssistant.isPending}
                onClick={() => {
                  if (window.confirm(`Remove ${primary.name}? It will stop appearing in your workspace and its launch links will stop working.`)) {
                    deleteAssistant.mutate(primary.id, { onSuccess: () => setSelectedId(null) });
                  }
                }}
              >
                {deleteAssistant.isPending ? "Removing…" : "Remove"}
              </button>
            </div>
            {deleteAssistant.error && (
              <p className="mt-3 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>{deleteAssistant.error.message}</p>
            )}
          </section>
        )}

        {others.length > 0 && (
          <section className="mt-6 border-t pt-6" style={{ borderColor: "var(--vl-line)" }}>
            <p className="vl-eyebrow mb-3">Other assistants</p>
            <ul className="flex flex-col">
              {others.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { setLaunchIssue(null); setSelectedId(a.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className="flex w-full items-center justify-between gap-4 border-b py-4 text-left transition-colors hover:text-white"
                    style={{ borderColor: "var(--vl-line)" }}
                  >
                    <span className="flex items-center gap-3">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: a.ready ? "var(--color-vl-success)" : "var(--color-vl-ink-faint)" }} />
                      <span className="text-[15px]" style={{ color: "var(--color-vl-ink)" }}>{a.name}</span>
                    </span>
                    <span className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>{a.venue}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onGuided, onCreate }: { onGuided: () => void; onCreate: () => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <Presence state="dormant" size={160} label="No assistant yet" onClick={onGuided} />
      <h1 className="vl-display mt-10 text-[clamp(2rem,5vw,3rem)]">Give your venue a voice.</h1>
      <p className="mt-3 max-w-md text-[15px] leading-7" style={{ color: "var(--color-vl-ink-muted)" }}>
        Name your assistant, connect Square, pick a voice. About three minutes.
      </p>
      <button type="button" onClick={onGuided} className="vl-btn-primary mt-8 min-w-48 justify-center px-6 py-3 text-[15px]">Set it up</button>
      <button type="button" onClick={onCreate} className="mt-4 text-[13px] transition-colors hover:text-white" style={{ color: "var(--color-vl-ink-faint)" }}>
        or use advanced setup
      </button>
    </section>
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
  wakePhrase: string;
  hasSquare: boolean;
  ready: boolean;
}

function useAgentProfiles() {
  return useQuery({
    queryKey: ["/api/v1/agent-profiles"],
    queryFn: async () => {
      const token = localStorage.getItem("voycelab_token") || "";
      const res = await fetch("/api/v1/agent-profiles", { headers: { Authorization: `Bearer ${token}` } });
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/agent-profiles"] }); },
  });
}

/** Returns null on success, or a user-facing issue (with a manual link when the popup was blocked). */
async function launchAssistant(venueId: number | null, agentProfileId: string): Promise<{ message: string; url?: string } | null> {
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(venueId ? { venueId } : {}), agentProfileId }),
    });
    if (!res.ok) throw new Error("Couldn't open the assistant. Try again.");
    const { code } = await res.json();
    const isLocalDev = !import.meta.env.PROD && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev ? `${window.location.protocol}//${window.location.hostname}:8081/` : `${window.location.origin}/agent/`;
    const url = `${baseUrl}?code=${encodeURIComponent(code)}&agentProfileId=${encodeURIComponent(agentProfileId)}`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) return { message: "Your browser blocked the new tab.", url };
    return null;
  } catch (e) {
    console.error(e);
    return { message: e instanceof Error ? e.message : "Couldn't open the assistant. Try again." };
  }
}
