import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail, type RailState } from "@/components/voice-rail";
import {
  roomSettings,
  connectedServices,
  actionGroups,
  approvalLabels,
  defaultApprovals,
  voicePipelineCategories,
  DEFAULT_PIPELINE_PROVIDER,
  type ApprovalLevel,
  type RoomSettingValue,
} from "@/lib/tokens";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Sparkles,
  Volume2,
} from "lucide-react";

interface ConnectedServiceProvider {
  provider: string;
  displayName: string;
  description: string;
  status: "available" | "needs_configuration" | "request_access" | "unavailable";
  isImplemented: boolean;
}

interface PipelineReport {
  provider: string;
  displayName: string;
  category: string;
  status: "available" | "needs_configuration" | "request_access" | "experimental" | "unavailable";
  reason?: string;
  missing?: string[];
  shortDescription?: string;
  recommendedFor: string[];
  requiredCredentials: string[];
  isFallback: boolean;
  isExperimental: boolean;
  notes?: string;
  sampleVoices: string[];
  sampleAvailable: boolean;
}

const STEPS = [
  { n: "01", title: "Name", subtitle: "Name your assistant." },
  { n: "02", title: "Connect", subtitle: "Connect the service your assistant will control." },
  { n: "03", title: "Allowed actions", subtitle: "Choose what your assistant can do." },
  { n: "04", title: "Room", subtitle: "Tune how your assistant listens." },
  { n: "05", title: "Voice", subtitle: "Choose the voice experience." },
  { n: "06", title: "Test", subtitle: "Test your assistant." },
  { n: "07", title: "Launch", subtitle: "Your assistant is ready." },
] as const;

/* ─────────────────────────────────────────────────────────────────
   Create assistant — guided journey.
   ───────────────────────────────────────────────────────────────── */
export default function CreateAssistant() {
  const [, navigate] = useLocation();
  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues } = useVenues();
  const [step, setStep] = useState(1);

  const [assistantName, setAssistantName] = useState(() => {
    return sessionStorage.getItem("voycelab.pending_assistant_name") || "";
  });
  const [wakePhrase, setWakePhrase] = useState(() => {
    const pending = sessionStorage.getItem("voycelab.pending_assistant_name") || "";
    return pending ? `Hey ${pending}` : "Hey Bev";
  });
  const [wakePhraseTouched, setWakePhraseTouched] = useState(false);
  const [serviceId, setServiceId] = useState<string>("square");
  const [venueId, setVenueId] = useState<number | null>(null);
  const [room, setRoom] = useState<RoomSettingValue>("bar");
  const [pipelineProvider, setPipelineProvider] = useState<string>(DEFAULT_PIPELINE_PROVIDER);
  const [pipelineVoice, setPipelineVoice] = useState<string>("");
  const [thinkingLevel, setThinkingLevel] = useState<"minimal" | "low" | "medium" | "high">("minimal");
  const [proactiveAudio, setProactiveAudio] = useState<boolean>(true);
  const [approvals, setApprovals] = useState<Record<string, ApprovalLevel>>(defaultApprovals());

  const [providers, setProviders] = useState<ConnectedServiceProvider[]>([]);
  const [pipelines, setPipelines] = useState<PipelineReport[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [openAiStatus, setOpenAiStatus] = useState<{
    ok: boolean;
    reason: string;
    message?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/voice-pipelines/openai-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setOpenAiStatus({ ok: Boolean(d.ok), reason: String(d.reason ?? "unknown"), message: d.message });
      })
      .catch(() => {
        if (!cancelled) setOpenAiStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authLoading && !auth) navigate("/login");
  }, [auth, authLoading, navigate]);

  useEffect(() => {
    fetch("/api/v1/connected-service-providers")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/voice-pipelines")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const raw: PipelineReport[] = Array.isArray(d?.pipelines) ? d.pipelines : [];
        // Defensive normalization: older api-server builds may not return the new
        // sample fields; fall back to safe defaults so the wizard never crashes.
        const list: PipelineReport[] = raw.map((p) => ({
          ...p,
          sampleVoices: Array.isArray(p.sampleVoices) ? p.sampleVoices : [],
          sampleAvailable: Boolean(p.sampleAvailable),
          recommendedFor: Array.isArray(p.recommendedFor) ? p.recommendedFor : [],
          requiredCredentials: Array.isArray(p.requiredCredentials) ? p.requiredCredentials : [],
        }));
        setPipelines(list);
        setPipelineProvider((prev) => {
          const current = list.find((p) => p.provider === prev);
          if (!current || current.status === "needs_configuration" || current.status === "unavailable") {
            const firstAvailable = list.find(
              (p) => p.status === "available" && !p.isFallback,
            );
            if (firstAvailable) return firstAvailable.provider;
          }
          return prev;
        });
      })
      .catch(() => {
        if (!cancelled) setPipelines([]);
      })
      .finally(() => {
        if (!cancelled) setPipelinesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const current = pipelines.find((p) => p.provider === pipelineProvider);
    if (!current) return;
    const voices = current.sampleVoices ?? [];
    if (voices.length === 0) {
      setPipelineVoice((v) => (v === "" ? v : ""));
      return;
    }
    setPipelineVoice((v) => (voices.includes(v) ? v : voices[0]));
  }, [pipelineProvider, pipelines]);

  useEffect(() => {
    if (!venueId && venues && venues.length > 0) setVenueId(venues[0].id);
  }, [venues, venueId]);

  useEffect(() => {
    if (wakePhraseTouched) return;
    const trimmed = assistantName.trim();
    setWakePhrase(trimmed ? `Hey ${trimmed}` : "Hey Bev");
  }, [assistantName, wakePhraseTouched]);

  // Sensitive actions never enable themselves; keep them gated.
  const allowedActionIds = useMemo(
    () => Object.entries(approvals).filter(([, level]) => level !== "not_allowed").map(([id]) => id),
    [approvals],
  );
  const askFirstCount = useMemo(
    () => Object.values(approvals).filter((l) => l === "ask_first").length,
    [approvals],
  );
  const allowedCount = allowedActionIds.length;

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.provider === pipelineProvider) ?? null,
    [pipelines, pipelineProvider],
  );

  const isGeminiPipeline = pipelineProvider.startsWith("google_gemini_");
  const isGemini31 = pipelineProvider === "google_gemini_3_1_flash_live";
  const isGemini25 =
    pipelineProvider === "google_gemini_2_5_flash_native_audio" ||
    pipelineProvider === "google_gemini_live_native_audio";

  // Engineering tool ids for the chosen actions — kept internal.
  const allowedTools = useMemo(() => {
    const set = new Set<string>();
    for (const group of actionGroups) {
      for (const a of group.actions) {
        if (approvals[a.id] && approvals[a.id] !== "not_allowed") set.add(a.internalTool);
      }
    }
    return Array.from(set);
  }, [approvals]);

  function buildPipelineConfig(): Record<string, unknown> {
    const cfg: Record<string, unknown> = {};
    if (pipelineVoice) cfg.voice = pipelineVoice;
    if (isGemini31) cfg.thinkingLevel = thinkingLevel;
    if (isGemini25) cfg.proactiveAudio = proactiveAudio;
    return cfg;
  }

  async function save() {
    if (!venueId) return setError("Choose a venue first.");
    if (!assistantName.trim()) return setError("Give your assistant a name.");
    if (!auth?.organizationId) {
      return setError(
        "Your account isn't fully set up yet. Reload the page and try again — the server is provisioning your organization.",
      );
    }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("voycelab_token") || "";
      // connectedServiceId is a foreign key to service_connections.id (UUID).
      // The wizard's serviceId is the provider slug ("square") — treat it as
      // a hint, not a foreign key. Only forward real UUIDs.
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId);
      const connectedServiceId = isUuid ? serviceId : undefined;
      const res = await fetch("/api/v1/agent-profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          organizationId: auth.organizationId,
          venueId,
          ...(connectedServiceId ? { connectedServiceId } : {}),
          displayName: assistantName,
          wakePhrase: wakePhrase.trim(),
          voicePipelineProvider: pipelineProvider,
          voicePipelineConfig: buildPipelineConfig(),
          noiseMode: room,
          allowedTools,
          confirmationPolicy: { approvals },
          personality: "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
        const code = body.error?.code ?? "";
        const baseMsg = body.error?.message ?? `Could not save your assistant. (HTTP ${res.status})`;
        const friendly =
          code === "pipeline_not_in_plan"
            ? `${baseMsg} Visit /pricing to upgrade.`
            : code === "venue_not_found"
            ? "We couldn't find that venue. Reload the page and try again."
            : baseMsg;
        throw new Error(friendly);
      }
      const body = await res.json().catch(() => ({}));
      setSavedId(body?.id ?? "assistant");
      sessionStorage.removeItem("voycelab.pending_assistant_name");
      setStep(7);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your assistant.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  const railState: RailState =
    step === 1 ? "ready" :
    step === 2 ? "ready" :
    step === 3 ? "confirming" :
    step === 4 ? "listening" :
    step === 5 ? "speaking" :
    step === 6 ? "executing" :
    "synced";

  const railIntensity =
    step === 4 ? roomSettings.find((r) => r.value === room)?.intensity ?? 0.6 : 0.55;

  return (
    <div className="relative flex-1 overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:px-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-12%] top-[-18%] h-[380px] w-[560px] rounded-full blur-3xl" style={{ background: "rgba(255, 201, 168, 0.42)" }} />
        <div className="absolute right-[-14%] top-[5%] h-[480px] w-[600px] rounded-full blur-3xl" style={{ background: "rgba(199, 183, 229, 0.30)" }} />
        <div className="absolute bottom-[-18%] right-[12%] h-[420px] w-[680px] rounded-full blur-3xl" style={{ background: "rgba(156, 201, 161, 0.23)" }} />
      </div>
      <div className="mx-auto w-full max-w-[1160px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6 text-[12px]">
          <Link href="/assistants" className="inline-flex items-center gap-1.5 transition-colors" style={{ color: "var(--color-vl-ink-muted)" }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Assistants
          </Link>
          <Link href="/command" className="inline-flex items-center gap-1.5 transition-colors" style={{ color: "var(--color-vl-ink-muted)" }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Console
          </Link>
        </div>
        <div className="grid gap-8 lg:grid-cols-[280px_1fr] lg:gap-10">
          {/* Step rail */}
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <p className="vl-eyebrow">Create</p>
            <h1 className="vl-display mt-3 text-[34px]" style={{ color: "var(--color-vl-ink)" }}>
              Build your assistant.
            </h1>
            <ol className="mt-8 space-y-1.5">
              {STEPS.map((s, i) => {
                const idx = i + 1;
                const active = idx === step;
                const done = idx < step;
                return (
                  <li
                    key={s.n}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors"
                    style={{
                      background: active ? "rgba(124,110,245,0.10)" : "transparent",
                      borderLeft: active ? "2px solid var(--color-vl-coral)" : "2px solid transparent",
                    }}
                  >
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: active ? "var(--color-vl-coral)" : done ? "var(--color-vl-success)" : "var(--color-vl-ink-faint)" }}
                    >
                      {done ? "✓" : s.n}
                    </span>
                    <span
                      className="text-[13px]"
                      style={{
                        color: active ? "var(--color-vl-ink)" : done ? "var(--color-vl-ink-muted)" : "var(--color-vl-ink-faint)",
                      }}
                    >
                      {s.title}
                    </span>
                  </li>
                );
              })}
            </ol>
          </aside>

          {/* Step body */}
          <section>
            {openAiStatus && !openAiStatus.ok && (
              <OpenAiStatusBanner status={openAiStatus} />
            )}
            <PreviewBar
              name={assistantName}
              service={connectedServices.find((s) => s.id === serviceId)?.name ?? "Square"}
              room={roomSettings.find((r) => r.value === room)?.label ?? "Bar"}
              voice={selectedPipeline?.displayName ?? "Choose a voice engine"}
              railState={railState}
              railIntensity={railIntensity}
              hint={STEPS[step - 1].subtitle}
            />

            {step === 1 && (
              <StepShell
                title="Name your assistant."
                subtitle="This is the name people will use when they speak to it."
              >
                <Field label="Assistant name">
                  <input
                    autoFocus
                    value={assistantName}
                    onChange={(e) => setAssistantName(e.target.value)}
                    placeholder="Bev, Kora, Friday, Barback, Ruby…"
                    className="vl-input"
                    maxLength={32}
                  />
                </Field>
                <Field label="Wake phrase">
                  <input
                    value={wakePhrase}
                    onChange={(e) => {
                      setWakePhraseTouched(true);
                      setWakePhrase(e.target.value);
                    }}
                    placeholder="Hey Bev"
                    className="vl-input"
                    maxLength={60}
                  />
                </Field>
                <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Say this phrase to wake the assistant in the PWA or Expo app. Custom phrases are saved with the assistant profile.
                </p>
                <Nav onNext={() => setStep(2)} canNext={!!assistantName.trim() && !!wakePhrase.trim()} />
              </StepShell>
            )}

            {step === 2 && (
              <StepShell
                title="Connect the service your assistant will control."
                subtitle="Your assistant does not replace your system. It works inside it."
              >
                <div className="space-y-2">
                  <p className="vl-eyebrow mb-1">Available</p>
                  {providersWithDefault(providers)
                    .filter((p) => p.isImplemented)
                    .map((p) => (
                      <ServiceRow
                        key={p.provider}
                        label={p.displayName}
                        desc={p.description}
                        status="available"
                        checked={serviceId === p.provider}
                        onSelect={() => setServiceId(p.provider)}
                      />
                    ))}

                  <p className="vl-eyebrow mb-1 mt-6">Request access</p>
                  {providersWithDefault(providers)
                    .filter((p) => !p.isImplemented)
                    .map((p) => (
                      <ServiceRow
                        key={p.provider}
                        label={p.displayName}
                        desc={p.description}
                        status="request"
                        checked={false}
                        onSelect={() => {}}
                      />
                    ))}
                </div>

                {(venues ?? []).length > 0 && (
                  <div className="mt-8">
                    <p className="vl-eyebrow mb-3">Location</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {(venues ?? []).map((v) => (
                        <button
                          key={v.id}
                          onClick={() => setVenueId(v.id)}
                          className="text-left vl-panel p-4 transition-colors"
                          style={{
                            borderColor: venueId === v.id ? "rgba(124,110,245,0.6)" : undefined,
                            background: venueId === v.id ? "rgba(124,110,245,0.06)" : undefined,
                          }}
                        >
                          <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                            {v.name ?? v.squareLocationName ?? `Venue ${v.id}`}
                          </p>
                          <p className="text-[12px] mt-1" style={{ color: "var(--color-vl-ink-faint)" }}>
                            {v.squareLocationName ?? "No location"}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(!venues || venues.length === 0) && (
                  <div className="mt-6 vl-panel p-5 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                    No venues connected yet. Open{" "}
                    <button onClick={() => navigate("/services")} className="underline" style={{ color: "var(--color-vl-brass2)" }}>
                      Connected services
                    </button>{" "}
                    to connect Square first.
                  </div>
                )}

                <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} canNext={!!serviceId && !!venueId} />
              </StepShell>
            )}

            {step === 3 && (
              <StepShell
                title="Choose what your assistant can do."
                subtitle="Decide what runs without asking, what asks first, and what is not allowed."
              >
                <div className="space-y-4">
                  {actionGroups.map((group) => (
                    <div key={group.id} className="vl-panel p-5">
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                          {group.label}
                        </p>
                        <p className="text-[12px]" style={{ color: "var(--color-vl-ink-faint)" }}>
                          {group.description}
                        </p>
                      </div>
                      <ul className="mt-3 divide-y" style={{ borderColor: "rgba(14,27,44,0.08)" }}>
                        {group.actions.map((a) => {
                          const level = approvals[a.id];
                          return (
                            <li key={a.id} className="py-2.5 flex items-center gap-3">
                              <p className="flex-1 text-[13px]" style={{ color: "var(--color-vl-ink)" }}>
                                {a.label}
                              </p>
                              <ApprovalSelector
                                value={level}
                                onChange={(next) => setApprovals((s) => ({ ...s, [a.id]: next }))}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

                <p className="text-[12px] mt-4" style={{ color: "var(--color-vl-ink-muted)" }}>
                  {assistantName || "Your assistant"} can do <strong style={{ color: "var(--color-vl-ink)" }}>{allowedCount}</strong>{" "}
                  actions and will ask first on <strong style={{ color: "var(--color-vl-ink)" }}>{askFirstCount}</strong>.
                </p>

                <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} canNext />
              </StepShell>
            )}

            {step === 4 && (
              <StepShell
                title="Tune how your assistant listens."
                subtitle="Choose the setting that best matches the room."
              >
                <div className="grid sm:grid-cols-2 gap-2">
                  {roomSettings.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setRoom(m.value)}
                      className="text-left vl-panel p-5 transition-colors"
                      style={{
                        borderColor: room === m.value ? "rgba(124,110,245,0.6)" : undefined,
                        background: room === m.value ? "rgba(124,110,245,0.06)" : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{m.label}</span>
                        <RoomIntensity level={m.intensity} active={room === m.value} />
                      </div>
                      <p className="text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>{m.description}</p>
                      <div className="mt-3 grid grid-cols-2 gap-1 text-[11px]" style={{ color: "var(--color-vl-ink-faint)" }}>
                        <span>Listens: {m.listens}</span>
                        <span>Approval: {m.asks}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <Nav onBack={() => setStep(3)} onNext={() => setStep(5)} canNext />
              </StepShell>
            )}

            {step === 5 && (
              <StepShell
                title="Pick your voice engine."
                subtitle="Each assistant runs on a specific provider. Tap any engine to hear it speak the same line, then pick the one your room deserves."
              >
                {pipelinesLoading ? (
                  <div className="vl-panel p-8 flex items-center justify-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
                    <span className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>Loading available engines…</span>
                  </div>
                ) : (
                  <PipelinePicker
                    pipelines={pipelines}
                    selected={pipelineProvider}
                    onSelect={(provider) => setPipelineProvider(provider)}
                    selectedVoice={pipelineVoice}
                    onSelectVoice={(v) => setPipelineVoice(v)}
                  />
                )}

                {selectedPipeline && (selectedPipeline.provider.startsWith("google_gemini_") || selectedPipeline.provider.startsWith("openai_")) && (
                  <PipelineConfigPanel
                    selected={selectedPipeline}
                    voice={pipelineVoice}
                    onVoice={setPipelineVoice}
                    isGemini31={isGemini31}
                    isGemini25={isGemini25}
                    thinkingLevel={thinkingLevel}
                    onThinkingLevel={setThinkingLevel}
                    proactiveAudio={proactiveAudio}
                    onProactiveAudio={setProactiveAudio}
                  />
                )}

                <Nav onBack={() => setStep(4)} onNext={() => setStep(6)} canNext={!!selectedPipeline && selectedPipeline.status !== "needs_configuration" && selectedPipeline.status !== "unavailable"} />
              </StepShell>
            )}

            {step === 6 && (
              <StepShell
                title="Test your assistant."
                subtitle="Try a real command. The full voice surface launches separately."
              >
                <TestProgress allowedActions={allowedCount} askFirst={askFirstCount} assistantName={assistantName || "Your assistant"} />
                {error && (
                  <p className="text-[13px] mt-4" style={{ color: "var(--color-vl-danger)" }}>{error}</p>
                )}

                <Nav
                  onBack={() => setStep(5)}
                  onNext={save}
                  nextLabel={
                    saving ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                      </span>
                    ) : (
                      <>
                        Launch <ArrowRight className="w-4 h-4" />
                      </>
                    )
                  }
                  canNext={!saving}
                />
              </StepShell>
            )}

            {step === 7 && (
              <StepShell
                title="Your assistant is ready."
                subtitle="Open it on the floor. Or copy a launch link to a phone, tablet, or terminal."
              >
                <div className="vl-panel p-7 text-center">
                  <VoiceRail state="synced" />
                  <p className="vl-display text-[40px] mt-6" style={{ color: "var(--color-vl-ink)" }}>
                    {assistantName} is live.
                  </p>

                  <dl className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-[13px] text-left max-w-md mx-auto">
                    <Summary k="Assistant" v={assistantName} />
                    <Summary k="Wake phrase" v={wakePhrase} />
                    <Summary k="Connected service" v={connectedServices.find((s) => s.id === serviceId)?.name ?? "Square"} />
                    <Summary k="Room setting" v={roomSettings.find((r) => r.value === room)?.label ?? "Bar"} />
                    <Summary k="Voice engine" v={selectedPipeline?.displayName ?? ""} />
                    {pipelineVoice && <Summary k="Voice character" v={pipelineVoice} />}
                    <Summary k="Can do" v={`${allowedCount} actions`} />
                    <Summary k="Will ask first" v={`${askFirstCount} actions`} />
                  </dl>

                  <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                    <button
                      onClick={() => venueId && savedId && launchAssistant(venueId, savedId)}
                      className="vl-btn-primary inline-flex items-center gap-2"
                    >
                      Open assistant <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => venueId && savedId && copyLaunchLink(venueId, savedId)}
                      className="vl-btn-ghost inline-flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" /> Copy launch link
                    </button>
                    <button onClick={() => navigate("/command")} className="vl-btn-ghost inline-flex items-center gap-2">
                      Go to Command
                    </button>
                  </div>

                  <p className="mt-6 text-[12px]" style={{ color: "var(--color-vl-ink-faint)" }}>
                    <Sparkles className="w-3.5 h-3.5 inline -mt-0.5" /> Saved as {savedId ?? "assistant"}. You can change everything from the Assistants screen.
                  </p>
                </div>
              </StepShell>
            )}
          </section>
        </div>
      </div>

      <style>{`
        .vl-input {
          width: 100%;
          height: 48px;
          padding: 0 16px;
          border-radius: 14px;
          background: #FFFFFF;
          border: 1px solid rgba(14,27,44,0.12);
          color: var(--color-vl-ink);
          font-size: 15px;
          outline: none;
          transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
        }
        .vl-input::placeholder { color: rgba(14,27,44,0.36); }
        .vl-input:focus {
          border-color: var(--color-vl-coral);
          box-shadow: 0 0 0 3px rgba(255,107,71,0.14);
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Helpers / sub-components
   ───────────────────────────────────────────────────────────────── */

function OpenAiStatusBanner({
  status,
}: {
  status: { ok: boolean; reason: string; message?: string };
}) {
  const copy = (() => {
    switch (status.reason) {
      case "missing_key":
        return {
          title: "Server is missing OPENAI_API_KEY.",
          body: "Voice agents and previews can't run until OPENAI_API_KEY is set in the API server environment. The wizard will use a generic browser voice for previews in the meantime.",
        };
      case "insufficient_quota":
        return {
          title: "OpenAI account is out of quota.",
          body: "Live agents and native voice previews will fail until billing is restored. Previews here will play a generic browser voice. Restore billing at platform.openai.com/settings/organization/billing.",
        };
      case "billing_disabled":
        return {
          title: "OpenAI rejected your API key.",
          body: status.message
            ? `OpenAI says: "${status.message}". Verify the key at platform.openai.com/api-keys and that the project has an active payment method.`
            : "Verify the key at platform.openai.com/api-keys and that the project has an active payment method.",
        };
      default:
        return {
          title: "OpenAI is currently unreachable.",
          body: status.message ?? "Voice previews will fall back to a generic browser voice until OpenAI responds again.",
        };
    }
  })();
  const url =
    status.reason === "insufficient_quota"
      ? "https://platform.openai.com/settings/organization/billing"
      : "https://platform.openai.com/api-keys";
  const ctaLabel =
    status.reason === "insufficient_quota"
      ? "Open OpenAI billing"
      : status.reason === "missing_key"
      ? null
      : "Open OpenAI keys";
  return (
    <div
      className="vl-panel p-4 mb-5 flex items-start gap-3"
      style={{
        borderColor: "rgba(232,93,72,0.45)",
        background: "rgba(232,93,72,0.06)",
      }}
    >
      <span
        className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full"
        style={{ background: "rgba(232,93,72,0.18)", color: "var(--color-vl-danger)", fontWeight: 700, fontSize: 12 }}
        aria-hidden="true"
      >
        !
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
          {copy.title}
        </p>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
          {copy.body}
        </p>
        {ctaLabel && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] mt-2"
            style={{ color: "var(--color-vl-brass2)" }}
          >
            {ctaLabel} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function PreviewBar({
  name,
  service,
  room,
  voice,
  railState,
  railIntensity,
  hint,
}: {
  name: string;
  service: string;
  room: string;
  voice: string;
  railState: RailState;
  railIntensity: number;
  hint: string;
}) {
  return (
    <div className="vl-card-glass mb-6 p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
            <Sparkles className="w-3 h-3" />
            {name || "Your assistant"}
          </span>
          <span className="vl-chip">{service}</span>
          <span className="vl-chip">{room}</span>
          <span className="vl-chip">{voice}</span>
        </div>
      </div>
      <VoiceRail state={railState} intensity={railIntensity} />
      <div className="mt-3 vl-eyebrow text-center" style={{ color: "var(--color-vl-ink-faint)" }}>
        Live preview · {hint}
      </div>
    </div>
  );
}

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="vl-display text-[38px]" style={{ color: "var(--color-vl-ink)" }}>{title}</h2>
      {subtitle && (
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>{subtitle}</p>
      )}
      <div className="mt-7 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="vl-eyebrow block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Nav({
  onBack,
  onNext,
  canNext,
  nextLabel,
}: {
  onBack?: () => void;
  onNext: () => void;
  canNext?: boolean;
  nextLabel?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 pt-4">
      {onBack && (
        <button onClick={onBack} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}
      <button
        onClick={onNext}
        disabled={canNext === false}
        className="vl-btn-primary inline-flex items-center gap-2 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {nextLabel ?? (
          <>
            Continue <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}

function ServiceRow({
  label,
  desc,
  status,
  checked,
  onSelect,
}: {
  label: string;
  desc: string;
  status: "available" | "request";
  checked: boolean;
  onSelect: () => void;
}) {
  const available = status === "available";
  return (
    <button
      onClick={available ? onSelect : undefined}
      className="w-full text-left vl-panel p-4 flex items-center gap-3 transition-colors"
      style={{
        opacity: available ? 1 : 0.65,
        cursor: available ? "pointer" : "default",
        borderColor: checked ? "rgba(255,107,71,0.36)" : undefined,
        background: checked ? "var(--color-vl-coral-tint)" : undefined,
      }}
    >
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center"
        style={{
          background: checked ? "var(--color-vl-coral)" : "transparent",
          border: "1px solid rgba(14,27,44,0.18)",
        }}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{label}</p>
          {available ? (
            <span
              className="vl-chip"
              style={{ color: "var(--color-vl-success)", borderColor: "rgba(53,194,117,0.4)", fontSize: 10 }}
            >
              Available
            </span>
          ) : (
            <span className="vl-chip" style={{ fontSize: 10 }}>Request access</span>
          )}
        </div>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--color-vl-ink-muted)" }}>{desc}</p>
      </div>
    </button>
  );
}

function ApprovalSelector({
  value,
  onChange,
}: {
  value: ApprovalLevel;
  onChange: (next: ApprovalLevel) => void;
}) {
  const options: ApprovalLevel[] = ["no_approval", "ask_first", "not_allowed"];
  return (
    <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "rgba(14,27,44,0.10)", background: "rgba(255,255,255,0.58)" }} role="radiogroup">
      {options.map((opt) => {
        const selected = value === opt;
        const tone =
          opt === "no_approval"
            ? "var(--color-vl-success)"
            : opt === "ask_first"
            ? "var(--color-vl-brass2)"
            : "var(--color-vl-danger)";
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt)}
            className="text-[11px] px-3 py-1 rounded-full transition-all"
            style={{
              background: selected ? `${tone}1F` : "transparent",
              color: selected ? tone : "var(--color-vl-ink-muted)",
              border: selected ? `1px solid ${tone}55` : "1px solid transparent",
            }}
          >
            {approvalLabels[opt]}
          </button>
        );
      })}
    </div>
  );
}

function RoomIntensity({ level, active }: { level: number; active: boolean }) {
  return (
    <div className="flex items-end gap-[2px]">
      {[0.2, 0.4, 0.6, 0.8].map((threshold) => (
        <div
          key={threshold}
          className="w-1 rounded-full"
          style={{
            height: 6 + threshold * 12,
            background: level >= threshold ? (active ? "var(--color-vl-coral)" : "var(--color-vl-brass2)") : "rgba(14,27,44,0.12)",
          }}
        />
      ))}
    </div>
  );
}

function TestProgress({
  allowedActions,
  askFirst,
  assistantName,
}: {
  allowedActions: number;
  askFirst: number;
  assistantName: string;
}) {
  // Static demo of the test command result. The actual voice surface is a
  // separate launch from step 7. Here we show user-friendly progress only.
  const stages = ["Heard", "Understood", "Allowed", "Added", "Synced"] as const;
  return (
    <div className="vl-panel p-5">
      <p className="vl-eyebrow mb-3">Test command</p>
      <p className="vl-display text-[28px]" style={{ color: "var(--color-vl-ink)" }}>
        "Add two ranch waters."
      </p>

      <div className="mt-6 grid sm:grid-cols-5 gap-px rounded-xl overflow-hidden" style={{ background: "rgba(14,27,44,0.08)" }}>
        {stages.map((s, i) => (
          <div key={s} className="bg-vl-paper py-3 px-2 text-center">
            <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: "rgba(140,145,154,0.7)" }}>
              {String(i + 1).padStart(2, "0")}
            </p>
            <p className="mt-1 text-[13px] font-medium" style={{ color: i === 4 ? "var(--color-vl-success)" : "var(--color-vl-ink)" }}>
              {s}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-5 text-[13px]" style={{ color: "var(--color-vl-ink-soft)" }}>
        {assistantName} can do <strong>{allowedActions}</strong> actions. <strong>{askFirst}</strong> of them will ask before running.
      </p>
      <p className="mt-1 text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>
        For sensitive actions you'll see <strong>Confirm</strong> and <strong>Cancel</strong> on the voice surface.
      </p>
    </div>
  );
}

function Summary({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: "var(--color-vl-ink-faint)" }}>{k}</dt>
      <dd style={{ color: "var(--color-vl-ink)" }}>{v}</dd>
    </>
  );
}

function providersWithDefault(list: ConnectedServiceProvider[]) {
  // Always show Square at the top, even if the registry is empty.
  if (list.length > 0) return list;
  return [
    {
      provider: "square",
      displayName: "Square",
      description: "Catalog, orders, terminal, stock checks.",
      status: "available" as const,
      isImplemented: true,
    },
  ];
}

async function launchAssistant(venueId: number, agentProfileId: string) {
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ venueId, agentProfileId }),
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

async function copyLaunchLink(venueId: number, agentProfileId: string) {
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ venueId, agentProfileId }),
    });
    if (!res.ok) throw new Error("Could not generate a link.");
    const { code } = await res.json();
    const isLocalDev =
      !import.meta.env.PROD &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev
      ? `${window.location.protocol}//${window.location.hostname}:8081/`
      : `${window.location.origin}/agent/`;
    const url = `${baseUrl}?code=${encodeURIComponent(code)}&agentProfileId=${encodeURIComponent(agentProfileId)}`;
    await navigator.clipboard.writeText(url);
  } catch (e) {
    console.error(e);
  }
}

/* ─────────────────────────────────────────────────────────────────
   Pipeline picker — full registry, grouped by category, in plain sight.
   ───────────────────────────────────────────────────────────────── */

function PipelinePicker({
  pipelines,
  selected,
  onSelect,
  selectedVoice,
  onSelectVoice,
}: {
  pipelines: PipelineReport[];
  selected: string;
  onSelect: (provider: string) => void;
  selectedVoice: string;
  onSelectVoice: (voice: string) => void;
}) {
  const grouped = useMemo(() => {
    const buckets = new Map<string, PipelineReport[]>();
    for (const p of pipelines) {
      const list = buckets.get(p.category) ?? [];
      list.push(p);
      buckets.set(p.category, list);
    }
    return voicePipelineCategories
      .map((cat) => ({ cat, items: (buckets.get(cat.id) ?? []).sort(comparePipelines) }))
      .filter((g) => g.items.length > 0);
  }, [pipelines]);

  return (
    <div className="space-y-7">
      {grouped.map(({ cat, items }) => (
        <div key={cat.id}>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="vl-eyebrow">{cat.label}</p>
            <p className="text-[11px]" style={{ color: "var(--color-vl-ink-faint)" }}>{items.length} option{items.length === 1 ? "" : "s"}</p>
          </div>
          <p className="text-[12.5px] mb-3" style={{ color: "var(--color-vl-ink-muted)" }}>{cat.blurb}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {items.map((p) => (
              <PipelineCard
                key={p.provider}
                pipeline={p}
                active={selected === p.provider}
                onSelect={() => onSelect(p.provider)}
                voice={selected === p.provider ? selectedVoice : ""}
                onVoice={onSelectVoice}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function comparePipelines(a: PipelineReport, b: PipelineReport): number {
  const rank = (p: PipelineReport) => {
    if (p.status === "available") return 0;
    if (p.status === "experimental") return 1;
    if (p.status === "request_access") return 2;
    if (p.status === "needs_configuration") return 3;
    return 4;
  };
  const dr = rank(a) - rank(b);
  if (dr !== 0) return dr;
  return a.displayName.localeCompare(b.displayName);
}

function PipelineCard({
  pipeline,
  active,
  onSelect,
  voice,
  onVoice,
}: {
  pipeline: PipelineReport;
  active: boolean;
  onSelect: () => void;
  voice: string;
  onVoice: (voice: string) => void;
}) {
  const disabled = pipeline.status === "needs_configuration" || pipeline.status === "unavailable";
  const tone =
    pipeline.status === "available"
      ? "var(--color-vl-success)"
      : pipeline.status === "experimental"
      ? "var(--color-vl-brass2)"
      : pipeline.status === "request_access"
      ? "var(--color-vl-coral)"
      : "var(--color-vl-danger)";
  const statusLabel: Record<typeof pipeline.status, string> = {
    available: "Available",
    experimental: "Preview",
    request_access: "Request access",
    needs_configuration: "Needs setup",
    unavailable: "Unavailable",
  } as Record<typeof pipeline.status, string>;

  return (
    <div
      className="vl-panel p-5 transition-colors"
      style={{
        opacity: disabled ? 0.55 : 1,
        borderColor: active ? "rgba(255,107,71,0.36)" : undefined,
        background: active ? "var(--color-vl-coral-tint)" : undefined,
      }}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        className="w-full text-left"
        disabled={disabled}
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{pipeline.displayName}</p>
              <span
                className="vl-chip"
                style={{ color: tone, borderColor: `${tone}55`, fontSize: 10 }}
              >
                {statusLabel[pipeline.status] ?? pipeline.status}
              </span>
              {pipeline.isFallback && (
                <span className="vl-chip" style={{ fontSize: 10 }}>Fallback</span>
              )}
            </div>
            {pipeline.shortDescription && (
              <p className="text-[12.5px] mt-1.5 leading-snug" style={{ color: "var(--color-vl-ink-muted)" }}>
                {pipeline.shortDescription}
              </p>
            )}
            {disabled && pipeline.reason && (
              <p className="text-[11.5px] mt-2" style={{ color: "var(--color-vl-ink-faint)" }}>
                {pipeline.reason}
              </p>
            )}
          </div>
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
            style={{
              background: active ? "var(--color-vl-coral)" : "transparent",
              border: "1px solid rgba(14,27,44,0.18)",
            }}
          >
            {active && <Check className="w-3 h-3 text-white" />}
          </span>
        </div>
      </button>
      {pipeline.sampleAvailable && (pipeline.sampleVoices?.length ?? 0) > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <SamplePlayer
            provider={pipeline.provider}
            voice={active && voice ? voice : pipeline.sampleVoices[0]}
            disabled={disabled}
          />
          {active && (
            <select
              value={voice || pipeline.sampleVoices[0]}
              onChange={(e) => onVoice(e.target.value)}
              aria-label="Voice character"
              style={{
                height: 28,
                padding: "0 8px",
                borderRadius: 999,
                background: "rgba(14,27,44,0.04)",
                border: "1px solid rgba(14,27,44,0.12)",
                color: "var(--color-vl-ink)",
                fontSize: 11.5,
                outline: 0,
              }}
            >
              {pipeline.sampleVoices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Sample player — synthesizes a real audio clip on demand and plays it.
   ───────────────────────────────────────────────────────────────── */

const SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

/**
 * Map a vendor-specific voice label to the closest browser voice attribute
 * (gender + lang) so the SpeechSynthesis fallback feels at least flavoured
 * when native TTS isn't available. Best-effort — browser voices vary by OS.
 */
const BROWSER_VOICE_HINTS: Record<string, { gender: "female" | "male" | "neutral"; lang: string }> = {
  ash: { gender: "male", lang: "en-US" },
  alloy: { gender: "neutral", lang: "en-US" },
  ballad: { gender: "female", lang: "en-US" },
  coral: { gender: "female", lang: "en-US" },
  sage: { gender: "neutral", lang: "en-US" },
  verse: { gender: "male", lang: "en-US" },
  Kore: { gender: "female", lang: "en-US" },
  Aoede: { gender: "female", lang: "en-US" },
  Puck: { gender: "male", lang: "en-US" },
  Charon: { gender: "male", lang: "en-US" },
  Leda: { gender: "female", lang: "en-US" },
  Fenrir: { gender: "male", lang: "en-US" },
  Zephyr: { gender: "neutral", lang: "en-US" },
  Rachel: { gender: "female", lang: "en-US" },
  Bella: { gender: "female", lang: "en-US" },
  Antoni: { gender: "male", lang: "en-US" },
  Domi: { gender: "female", lang: "en-US" },
  asteria: { gender: "female", lang: "en-US" },
  luna: { gender: "female", lang: "en-US" },
  stella: { gender: "female", lang: "en-US" },
  athena: { gender: "female", lang: "en-US" },
  ITO: { gender: "male", lang: "en-US" },
  KORA: { gender: "female", lang: "en-US" },
  AURA: { gender: "female", lang: "en-US" },
};

function pickBrowserVoice(label: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const all = window.speechSynthesis.getVoices();
  if (all.length === 0) return null;
  const hint = BROWSER_VOICE_HINTS[label] ?? { gender: "neutral", lang: "en-US" };
  const en = all.filter((v) => v.lang.toLowerCase().startsWith(hint.lang.slice(0, 2).toLowerCase()));
  const pool = en.length > 0 ? en : all;
  const wantFemale = hint.gender === "female";
  const wantMale = hint.gender === "male";
  const match = pool.find((v) => {
    const n = v.name.toLowerCase();
    if (wantFemale) return /samantha|fiona|moira|tessa|karen|veena|allison|susan|zoe|sarah|female|sienna/.test(n);
    if (wantMale) return /alex|daniel|fred|tom|aaron|gordon|jamie|reed|male|oliver/.test(n);
    return true;
  });
  return match ?? pool[0] ?? null;
}

function speakWithBrowser(label: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      reject(new Error("Browser does not support SpeechSynthesis."));
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickBrowserVoice(label);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.05;
      utterance.pitch = 1;
      utterance.onend = () => resolve();
      utterance.onerror = (ev) => reject(new Error(ev.error || "speechSynthesis error"));
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("speechSynthesis failed"));
    }
  });
}

interface SampleErrorBody {
  error?: { code?: string; message?: string };
}

function SamplePlayer({
  provider,
  voice,
  disabled,
}: {
  provider: string;
  voice: string;
  disabled: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error" | "playing_fallback">("idle");
  const [errorText, setErrorText] = useState<string>("");
  const [usedFallback, setUsedFallback] = useState<boolean>(false);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.src = "";
        audioRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    setState("idle");
    setErrorText("");
    setUsedFallback(false);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [provider, voice]);

  async function fallbackToBrowser(): Promise<void> {
    setUsedFallback(true);
    setState("playing_fallback");
    try {
      await speakWithBrowser(voice, SAMPLE_LINE);
      setState("idle");
    } catch (e) {
      setState("error");
      setErrorText(e instanceof Error ? e.message : "Browser preview failed");
    }
  }

  async function play() {
    if (disabled) return;
    if (state === "playing" || state === "playing_fallback") {
      audioRef.current?.pause();
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setState("idle");
      return;
    }
    setState("loading");
    setErrorText("");
    setUsedFallback(false);
    try {
      const url = `/api/v1/voice-pipelines/${encodeURIComponent(provider)}/sample?voice=${encodeURIComponent(voice)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as SampleErrorBody;
        const code = body.error?.code ?? "";
        // Anything billing-related routes through the silent browser fallback
        // so the operator still gets a preview voice while we surface the
        // underlying issue in the dashboard banner instead.
        if (
          code === "openai_quota_exhausted" ||
          code === "openai_billing_disabled" ||
          code === "openai_rate_limited"
        ) {
          await fallbackToBrowser();
          return;
        }
        throw new Error(body.error?.message ?? `Sample HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        setState("idle");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setState("error");
        setErrorText("Playback failed");
      };
      audioRef.current = audio;
      await audio.play();
      setState("playing");
    } catch (e) {
      // Any unexpected failure falls back to the browser voice so the user
      // is never blocked from previewing a pipeline they're considering.
      try {
        await fallbackToBrowser();
      } catch {
        setState("error");
        setErrorText(e instanceof Error ? e.message : "Sample failed");
      }
    }
  }

  const isPlaying = state === "playing" || state === "playing_fallback";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={play}
        disabled={disabled || state === "loading"}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors text-[12px]"
        style={{
          borderColor: isPlaying ? "rgba(124,110,245,0.6)" : "rgba(14,27,44,0.12)",
          background: isPlaying ? "var(--color-vl-coral-tint)" : "rgba(255,255,255,0.55)",
          color: "var(--color-vl-ink)",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {state === "loading" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-3.5 h-3.5" />
        ) : state === "error" ? (
          <Volume2 className="w-3.5 h-3.5" style={{ color: "var(--color-vl-danger)" }} />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        <span>{state === "error" ? errorText || "Try again" : isPlaying ? "Playing" : "Hear sample"}</span>
      </button>
      {usedFallback && (
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{
            color: "var(--color-vl-brass2)",
            background: "rgba(224,183,106,0.10)",
            border: "1px solid rgba(224,183,106,0.35)",
          }}
          title="Native TTS unavailable. This is a generic browser voice — the live agent still uses the real provider."
        >
          Browser preview
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Pipeline config panel — voice character + provider-specific knobs.
   ───────────────────────────────────────────────────────────────── */

function PipelineConfigPanel({
  selected,
  voice,
  onVoice,
  isGemini31,
  isGemini25,
  thinkingLevel,
  onThinkingLevel,
  proactiveAudio,
  onProactiveAudio,
}: {
  selected: PipelineReport;
  voice: string;
  onVoice: (v: string) => void;
  isGemini31: boolean;
  isGemini25: boolean;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  onThinkingLevel: (v: "minimal" | "low" | "medium" | "high") => void;
  proactiveAudio: boolean;
  onProactiveAudio: (v: boolean) => void;
}) {
  if (selected.status === "needs_configuration" || selected.status === "unavailable") return null;
  return (
    <div className="vl-panel p-5 mt-2">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="vl-eyebrow">Tune {selected.displayName}</p>
        <p className="text-[11px]" style={{ color: "var(--color-vl-ink-faint)" }}>Optional</p>
      </div>

      {(selected.sampleVoices?.length ?? 0) > 0 && (
        <div className="mb-4">
          <label className="block text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--color-vl-ink-muted)" }}>
            Voice character
          </label>
          <div className="flex flex-wrap gap-2">
            {selected.sampleVoices.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onVoice(v)}
                className="px-3 py-1.5 rounded-full text-[12px] transition-colors"
                style={{
                  borderColor: voice === v ? "rgba(124,110,245,0.6)" : "rgba(14,27,44,0.12)",
                  background: voice === v ? "var(--color-vl-coral-tint)" : "rgba(255,255,255,0.55)",
                  color: "var(--color-vl-ink)",
                  border: `1px solid ${voice === v ? "rgba(124,110,245,0.6)" : "rgba(14,27,44,0.12)"}`,
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {isGemini31 && (
        <div className="mb-3">
          <label className="block text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--color-vl-ink-muted)" }}>
            Thinking depth
          </label>
          <p className="text-[11.5px] mb-2" style={{ color: "var(--color-vl-ink-faint)" }}>
            Lower = faster first reply. Higher = better reasoning on multi-step requests like splitting a tab or upselling.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["minimal", "low", "medium", "high"] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => onThinkingLevel(lvl)}
                className="px-3 py-1.5 rounded-full text-[12px] capitalize transition-colors"
                style={{
                  borderColor: thinkingLevel === lvl ? "rgba(224,183,106,0.6)" : "rgba(14,27,44,0.12)",
                  background: thinkingLevel === lvl ? "rgba(224,183,106,0.10)" : "rgba(255,255,255,0.55)",
                  color: "var(--color-vl-ink)",
                  border: `1px solid ${thinkingLevel === lvl ? "rgba(224,183,106,0.6)" : "rgba(14,27,44,0.12)"}`,
                }}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      )}

      {isGemini25 && (
        <div className="flex items-start justify-between gap-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium" style={{ color: "var(--color-vl-ink)" }}>Proactive audio</p>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--color-vl-ink-muted)" }}>
              When on, the assistant ignores ambient chatter and only responds to speech that's clearly directed at it. Recommended for busy bars.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onProactiveAudio(!proactiveAudio)}
            className="shrink-0 inline-flex items-center"
            aria-pressed={proactiveAudio}
            aria-label="Toggle proactive audio"
          >
            <span
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{
                background: proactiveAudio ? "rgba(124,110,245,0.6)" : "rgba(14,27,44,0.12)",
              }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                style={{ left: proactiveAudio ? "18px" : "2px" }}
              />
            </span>
          </button>
        </div>
      )}

      {selected.notes && (
        <p className="text-[11.5px] mt-3 leading-relaxed" style={{ color: "var(--color-vl-ink-faint)" }}>
          {selected.notes}
        </p>
      )}

    </div>
  );
}
