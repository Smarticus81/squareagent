import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { VoiceRail, type RailState } from "@/components/voice-rail";
import { noiseModes, pipelineOutcomes, permissionTools } from "@/lib/tokens";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Smartphone,
  Sparkles,
} from "lucide-react";

interface PipelineReport {
  provider: string;
  displayName: string;
  category: string;
  status: "available" | "needs_configuration" | "request_access" | "experimental" | "unavailable";
  reason?: string;
  missing?: string[];
  shortDescription?: string;
  isFallback?: boolean;
}

interface ConnectedServiceProvider {
  provider: string;
  displayName: string;
  description: string;
  status: "available" | "needs_configuration" | "request_access" | "unavailable";
  isImplemented: boolean;
}

const STEPS = [
  { n: "01", title: "Name", subtitle: "Name the voice your team will trust." },
  { n: "02", title: "Connect", subtitle: "Choose what this agent can control." },
  { n: "03", title: "Room", subtitle: "Tune it for the room." },
  { n: "04", title: "Boundaries", subtitle: "Set the boundaries." },
  { n: "05", title: "Pipeline", subtitle: "Choose the voice engine." },
  { n: "06", title: "Test", subtitle: "Test it before the room gets loud." },
  { n: "07", title: "Ready", subtitle: "Your agent is ready." },
] as const;

export default function AgentSetup() {
  const [, navigate] = useLocation();
  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues } = useVenues();
  const [step, setStep] = useState(1);

  const [agentName, setAgentName] = useState("");
  const [wakePhrase, setWakePhrase] = useState("");
  const [connectedServiceId, setConnectedServiceId] = useState<string>("square");
  const [venueId, setVenueId] = useState<number | null>(null);
  const [noiseMode, setNoiseMode] = useState<string>("bar");
  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    new Set(["read_menu", "create_order", "submit_order", "send_to_terminal", "check_inventory", "run_reports"])
  );
  const [pipelineOutcome, setPipelineOutcome] = useState<string>("fastest_realtime");
  const [pipelineProvider, setPipelineProvider] = useState<string>("openai_realtime_webrtc");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [providers, setProviders] = useState<ConnectedServiceProvider[]>([]);
  const [pipelines, setPipelines] = useState<PipelineReport[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !auth) navigate("/login");
  }, [auth, authLoading, navigate]);

  useEffect(() => {
    fetch("/api/v1/connected-service-providers")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
    fetch("/api/v1/voice-pipelines")
      .then((r) => r.json())
      .then((d) => setPipelines(d.pipelines ?? []))
      .catch(() => setPipelines([]));
  }, []);

  // Auto-pick the first venue once available
  useEffect(() => {
    if (!venueId && venues && venues.length > 0) setVenueId(venues[0].id);
  }, [venues, venueId]);

  // Auto-suggest wake phrase from name
  useEffect(() => {
    if (agentName) setWakePhrase(`Hey ${agentName}`);
  }, [agentName]);

  const groupedProviders = useMemo(() => {
    const live: ConnectedServiceProvider[] = [];
    const others: ConnectedServiceProvider[] = [];
    for (const p of providers) (p.isImplemented ? live : others).push(p);
    return { live, others };
  }, [providers]);

  async function save() {
    if (!venueId) {
      setError("Pick a venue first.");
      return;
    }
    if (!agentName.trim()) {
      setError("Give your agent a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/agent-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth?.organizationId ?? "",
          venueId,
          connectedServiceId: connectedServiceId || undefined,
          displayName: agentName,
          wakePhrase,
          voicePipelineProvider: pipelineProvider,
          voicePipelineConfig: {},
          noiseMode,
          allowedTools: Array.from(enabledTools),
          confirmationPolicy: { strict: enabledTools.has("submit_order") || enabledTools.has("send_to_terminal") },
          personality: "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      const body = await res.json().catch(() => ({}));
      setSavedId(body?.id ?? "agent");
      setStep(7);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agent profile");
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
    step === 3 ? "listening" :
    step === 4 ? "confirming" :
    step === 5 ? "thinking" :
    step === 6 ? "executing" :
    "synced";

  const railIntensity =
    step === 3 ? noiseModes.find((n) => n.value === noiseMode)?.intensity ?? 0.6 : 0.5;

  return (
    <div className="flex-1 pt-24 pb-20">
      <div className="w-full max-w-[1100px] mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-[260px_1fr] gap-10">
          {/* Step rail */}
          <aside>
            <p className="vl-eyebrow">Configuration</p>
            <h1 className="vl-display text-[28px] mt-2" style={{ color: "var(--color-vl-ivory)" }}>
              Build your agent.
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
                      borderLeft: active ? "2px solid var(--color-vl-voice)" : "2px solid transparent",
                    }}
                  >
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: active ? "var(--color-vl-voice)" : done ? "var(--color-vl-success)" : "rgba(245,239,227,0.4)" }}
                    >
                      {done ? "✓" : s.n}
                    </span>
                    <span
                      className="text-[13px]"
                      style={{
                        color: active ? "var(--color-vl-ivory)" : done ? "rgba(245,239,227,0.65)" : "rgba(245,239,227,0.45)",
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
            {/* Live preview rail */}
            <div className="vl-panel vl-edge-brass p-6 mb-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
                    <Sparkles className="w-3 h-3" />
                    {agentName || "Your agent"}
                  </span>
                  <span className="vl-chip">{providers.find((p) => p.provider === connectedServiceId)?.displayName ?? "Square"}</span>
                  <span className="vl-chip">{noiseModes.find((n) => n.value === noiseMode)?.label}</span>
                  <span className="vl-chip">{pipelineOutcomes.find((p) => p.id === pipelineOutcome)?.label}</span>
                </div>
              </div>
              <VoiceRail state={railState} intensity={railIntensity} />
              <div className="mt-3 vl-eyebrow text-center" style={{ color: "rgba(140,145,154,0.7)" }}>
                Live preview · {STEPS[step - 1].subtitle}
              </div>
            </div>

            {step === 1 && (
              <StepShell title="Name the voice your team will trust." subtitle="Defaults are fine — but the right name makes it stick.">
                <Field label="Agent name">
                  <input
                    autoFocus
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Bev, Kora, Friday, Barback, or anything you want"
                    className="vl-input"
                  />
                </Field>
                <Field label="Wake phrase">
                  <input value={wakePhrase} onChange={(e) => setWakePhrase(e.target.value)} className="vl-input" />
                  <p className="text-[12px] mt-1.5" style={{ color: "rgba(245,239,227,0.5)" }}>
                    Wake phrase auto-derives from the name. You can change it.
                  </p>
                </Field>
                <Nav onNext={() => setStep(2)} canNext={!!agentName.trim()} />
              </StepShell>
            )}

            {step === 2 && (
              <StepShell title="Choose what this agent can control." subtitle="VoyceLab bolts onto your existing service. We do not replace your POS.">
                <div className="space-y-2">
                  {groupedProviders.live.length > 0 && (
                    <div className="vl-eyebrow mb-2">Live</div>
                  )}
                  {groupedProviders.live.map((p) => (
                    <ProviderRow
                      key={p.provider}
                      label={p.displayName}
                      desc={p.description}
                      status="live"
                      checked={connectedServiceId === p.provider}
                      onSelect={() => setConnectedServiceId(p.provider)}
                    />
                  ))}
                  <div className="vl-eyebrow mb-2 mt-6">Request access</div>
                  {groupedProviders.others.map((p) => (
                    <ProviderRow
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
                            background:
                              venueId === v.id ? "rgba(124,110,245,0.06)" : undefined,
                          }}
                        >
                          <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
                            {v.name ?? v.squareLocationName ?? `Venue ${v.id}`}
                          </p>
                          <p className="text-[12px] mt-1" style={{ color: "rgba(245,239,227,0.5)" }}>
                            {v.squareLocationName ?? "No location"}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(!venues || venues.length === 0) && (
                  <div className="mt-6 vl-panel p-5 text-[13px]" style={{ color: "rgba(245,239,227,0.62)" }}>
                    No venues yet — connect Square in{" "}
                    <button onClick={() => navigate("/services")} className="underline" style={{ color: "var(--color-vl-brass2)" }}>
                      Connected services
                    </button>{" "}
                    first.
                  </div>
                )}

                <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} canNext={!!connectedServiceId && !!venueId} />
              </StepShell>
            )}

            {step === 3 && (
              <StepShell title="Tune it for the room." subtitle="Wake behavior, VAD posture, and confirmation strictness all change with the room.">
                <div className="grid sm:grid-cols-2 gap-2">
                  {noiseModes.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setNoiseMode(m.value)}
                      className="text-left vl-panel p-5 transition-colors"
                      style={{
                        borderColor: noiseMode === m.value ? "rgba(124,110,245,0.6)" : undefined,
                        background: noiseMode === m.value ? "rgba(124,110,245,0.06)" : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{m.label}</span>
                        <RoomIntensity level={m.intensity} active={noiseMode === m.value} />
                      </div>
                      <p className="text-[12px]" style={{ color: "rgba(245,239,227,0.55)" }}>
                        {m.description}
                      </p>
                    </button>
                  ))}
                </div>
                <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} canNext />
              </StepShell>
            )}

            {step === 4 && (
              <StepShell title="Set the boundaries." subtitle="Approved tools only. Risky actions go through a confirmation gate.">
                <div className="grid sm:grid-cols-2 gap-2">
                  {permissionTools.map((t) => {
                    const enabled = enabledTools.has(t.id);
                    const risky = t.risk === "high";
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          const next = new Set(enabledTools);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          setEnabledTools(next);
                        }}
                        className="text-left vl-panel p-4 flex items-center justify-between transition-colors"
                        style={{
                          borderColor: enabled
                            ? risky
                              ? "rgba(255,106,42,0.45)"
                              : "rgba(124,110,245,0.45)"
                            : undefined,
                          background: enabled
                            ? risky
                              ? "rgba(255,106,42,0.06)"
                              : "rgba(124,110,245,0.06)"
                            : undefined,
                        }}
                      >
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{t.label}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: risky ? "var(--color-vl-ember)" : "rgba(245,239,227,0.5)" }}>
                            {risky ? "Confirmation required" : t.risk === "medium" ? "Confirmation suggested" : "No confirmation"}
                          </p>
                        </div>
                        <span
                          className="w-9 h-5 rounded-full flex items-center px-0.5 transition-all"
                          style={{
                            background: enabled
                              ? risky
                                ? "rgba(255,106,42,0.4)"
                                : "rgba(124,110,245,0.4)"
                              : "rgba(245,239,227,0.10)",
                            justifyContent: enabled ? "flex-end" : "flex-start",
                          }}
                        >
                          <span className="w-4 h-4 rounded-full bg-[var(--color-vl-ivory)]" />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Nav onBack={() => setStep(3)} onNext={() => setStep(5)} canNext />
              </StepShell>
            )}

            {step === 5 && (
              <StepShell title="Choose the voice engine." subtitle="Outcomes, not vendors. Advanced detail lives in the panel below.">
                <div className="space-y-2">
                  {pipelineOutcomes.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPipelineOutcome(p.id)}
                      className="w-full text-left vl-panel p-5 transition-colors"
                      style={{
                        borderColor: pipelineOutcome === p.id ? "rgba(124,110,245,0.6)" : undefined,
                        background: pipelineOutcome === p.id ? "rgba(124,110,245,0.06)" : undefined,
                      }}
                    >
                      <p className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{p.label}</p>
                      <p className="text-[13px] mt-1" style={{ color: "rgba(245,239,227,0.6)" }}>{p.description}</p>
                    </button>
                  ))}
                </div>
                <button
                  className="vl-eyebrow mt-6 cursor-pointer"
                  onClick={() => setShowAdvanced((v) => !v)}
                  type="button"
                >
                  {showAdvanced ? "Hide" : "Show"} advanced providers
                </button>
                {showAdvanced && (
                  <div className="vl-panel p-4 mt-3 max-h-[280px] overflow-auto">
                    <div className="space-y-1">
                      {pipelines.map((p) => (
                        <label
                          key={p.provider}
                          className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-white/[0.04]"
                        >
                          <input
                            type="radio"
                            name="pipeline-provider"
                            checked={pipelineProvider === p.provider}
                            onChange={() => setPipelineProvider(p.provider)}
                            disabled={p.status === "unavailable" || p.status === "request_access"}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-medium" style={{ color: "var(--color-vl-ivory)" }}>
                                {p.displayName}
                              </span>
                              <span
                                className="vl-chip"
                                style={{
                                  fontSize: 9,
                                  color:
                                    p.status === "available"
                                      ? "var(--color-vl-success)"
                                      : p.status === "needs_configuration"
                                      ? "var(--color-vl-warning)"
                                      : p.status === "experimental"
                                      ? "var(--color-vl-voice)"
                                      : "rgba(245,239,227,0.5)",
                                }}
                              >
                                {p.status.replace("_", " ")}
                              </span>
                              {p.isFallback && <span className="vl-chip" style={{ fontSize: 9 }}>Fallback</span>}
                            </div>
                            <p className="text-[11px] mt-1" style={{ color: "rgba(245,239,227,0.5)" }}>
                              {p.shortDescription || p.reason}
                            </p>
                          </div>
                        </label>
                      ))}
                      {pipelines.length === 0 && (
                        <p className="text-[12px]" style={{ color: "rgba(245,239,227,0.5)" }}>
                          Pipeline registry unavailable. Outcome-based selection still works.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <Nav onBack={() => setStep(4)} onNext={() => setStep(6)} canNext />
              </StepShell>
            )}

            {step === 6 && (
              <StepShell title="Test it before the room gets loud." subtitle="Try a real command. The full voice surface launches separately.">
                <div className="vl-panel p-5">
                  <p className="vl-eyebrow mb-3">Test command</p>
                  <p className="vl-display text-[28px]" style={{ color: "var(--color-vl-ivory)" }}>
                    "Add two ranch waters."
                  </p>
                  <div className="mt-5 grid sm:grid-cols-2 gap-px bg-white/[0.06]">
                    <Tile label="Transcript" value="Two ranch waters." />
                    <Tile label="Action" value="add_item × 2" />
                    <Tile label="Confirmation" value="Required (send_to_terminal)" />
                    <Tile label="Estimated latency" value="~ 430 ms" />
                  </div>
                </div>

                {error && <p className="text-[13px] mt-4" style={{ color: "var(--color-vl-danger)" }}>{error}</p>}

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
                        Save and launch <ArrowRight className="w-4 h-4" />
                      </>
                    )
                  }
                  canNext={!saving}
                />
              </StepShell>
            )}

            {step === 7 && (
              <StepShell title="Your agent is ready." subtitle="Launch it on the floor. Or copy a link to a phone, tablet, or terminal.">
                <div className="vl-panel p-7 text-center">
                  <VoiceRail state="synced" />
                  <p className="vl-display text-[40px] mt-6" style={{ color: "var(--color-vl-ivory)" }}>
                    {agentName} is live.
                  </p>
                  <p className="mt-3 text-[14px]" style={{ color: "rgba(245,239,227,0.6)" }}>
                    Connected to {providers.find((p) => p.provider === connectedServiceId)?.displayName ?? "your service"}.{" "}
                    {noiseModes.find((n) => n.value === noiseMode)?.label} · {pipelineOutcomes.find((p) => p.id === pipelineOutcome)?.label}.
                  </p>
                  <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                    <button
                      onClick={() => venueId && launchAgent(venueId)}
                      className="vl-btn-primary inline-flex items-center gap-2"
                    >
                      Launch agent <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => venueId && copyInstallLink(venueId)}
                      className="vl-btn-ghost inline-flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" /> Copy install link
                    </button>
                    <button
                      onClick={() => navigate("/agents")}
                      className="vl-btn-ghost inline-flex items-center gap-2"
                    >
                      Back to agents
                    </button>
                  </div>
                  <div className="mt-8 text-left vl-line" />
                  <div className="mt-6 grid sm:grid-cols-2 gap-3 text-left">
                    <InstallSteps
                      title="iPhone & iPad — Safari"
                      steps={[
                        "Open the install link",
                        "Tap Share, then Add to Home Screen",
                        "Open from the home screen — fullscreen",
                      ]}
                    />
                    <InstallSteps
                      title="Android — Chrome"
                      steps={[
                        "Open the install link",
                        "Tap menu, then Install app",
                      ]}
                    />
                  </div>
                  <p className="mt-6 inline-flex items-center gap-2 text-[12px]" style={{ color: "rgba(245,239,227,0.5)" }}>
                    <Smartphone className="w-3.5 h-3.5" /> Saved as {savedId ?? "agent"} · You can reconfigure any time.
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
          height: 46px;
          padding: 0 16px;
          border-radius: 12px;
          background: rgba(245,239,227,0.04);
          border: 1px solid rgba(245,239,227,0.12);
          color: var(--color-vl-ivory);
          font-size: 15px;
          outline: none;
          transition: border-color .2s ease, background .2s ease;
        }
        .vl-input::placeholder { color: rgba(245,239,227,0.32); }
        .vl-input:focus { border-color: rgba(124,110,245,0.7); background: rgba(245,239,227,0.06); }
      `}</style>
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
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="vl-display text-[34px]" style={{ color: "var(--color-vl-ivory)" }}>{title}</h2>
      {subtitle && (
        <p className="mt-2 text-[14px]" style={{ color: "rgba(245,239,227,0.6)" }}>{subtitle}</p>
      )}
      <div className="mt-7 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  nextLabel?: React.ReactNode;
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
            Next <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}

function ProviderRow({
  label,
  desc,
  status,
  checked,
  onSelect,
}: {
  label: string;
  desc: string;
  status: "live" | "request";
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={status === "live" ? onSelect : undefined}
      className="w-full text-left vl-panel p-4 flex items-center gap-3 transition-colors"
      style={{
        opacity: status === "live" ? 1 : 0.65,
        cursor: status === "live" ? "pointer" : "default",
        borderColor: checked ? "rgba(124,110,245,0.6)" : undefined,
        background: checked ? "rgba(124,110,245,0.06)" : undefined,
      }}
    >
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center"
        style={{
          background: checked ? "var(--color-vl-voice)" : "transparent",
          border: "1px solid rgba(245,239,227,0.3)",
        }}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{label}</p>
          {status === "live" ? (
            <span className="vl-chip" style={{ color: "var(--color-vl-success)", borderColor: "rgba(53,194,117,0.4)", fontSize: 10 }}>
              Live
            </span>
          ) : (
            <span className="vl-chip" style={{ fontSize: 10 }}>Request access</span>
          )}
        </div>
        <p className="text-[12px] mt-0.5" style={{ color: "rgba(245,239,227,0.55)" }}>{desc}</p>
      </div>
    </button>
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
            background: level >= threshold ? (active ? "var(--color-vl-voice)" : "var(--color-vl-brass2)") : "rgba(245,239,227,0.18)",
          }}
        />
      ))}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0E1015] p-4">
      <p className="vl-eyebrow" style={{ color: "rgba(140,145,154,0.7)" }}>{label}</p>
      <p className="text-[14px] mt-2" style={{ color: "var(--color-vl-ivory)" }}>{value}</p>
    </div>
  );
}

function InstallSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="vl-panel p-5">
      <p className="vl-eyebrow mb-3">{title}</p>
      <ol className="space-y-2 text-[13px]" style={{ color: "rgba(245,239,227,0.78)" }}>
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
              style={{ background: "rgba(124,110,245,0.18)", color: "var(--color-vl-voice)" }}
            >
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
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
    if (!res.ok) throw new Error("Failed");
    const { code } = await res.json();
    const isLocalDev = !import.meta.env.PROD && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev ? `${window.location.protocol}//${window.location.hostname}:8081/` : `${window.location.origin}/agent/`;
    window.open(`${baseUrl}?code=${encodeURIComponent(code)}`, "_blank", "noopener,noreferrer");
  } catch (e) {
    console.error(e);
  }
}

async function copyInstallLink(venueId: number) {
  try {
    const token = localStorage.getItem("voycelab_token") || "";
    const res = await fetch("/api/auth/exchange/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ venueId }),
    });
    if (!res.ok) throw new Error("Failed");
    const { code } = await res.json();
    const isLocalDev = !import.meta.env.PROD && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const baseUrl = isLocalDev ? `${window.location.protocol}//${window.location.hostname}:8081/` : `${window.location.origin}/agent/`;
    const url = `${baseUrl}?code=${encodeURIComponent(code)}`;
    await navigator.clipboard.writeText(url);
  } catch (e) {
    console.error(e);
  }
}
