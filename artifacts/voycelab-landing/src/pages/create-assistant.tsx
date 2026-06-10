import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { withClerkBillingHeader } from "@/lib/clerk-session";
import { getPlanAllowedPipelines } from "@workspace/voicelab-core/pricing";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Lock,
  Loader2,
  Pause,
  Play,
  Volume2,
} from "lucide-react";

const VOICES = [
  { id: "verse", label: "Verse", gender: "male" },
  { id: "ballad", label: "Ballad", gender: "male" },
  { id: "ash", label: "Ash", gender: "male" },
  { id: "coral", label: "Coral", gender: "female" },
] as const;

const GEMINI_VOICES = [
  { id: "Kore", label: "Kore", gender: "neutral" },
  { id: "Aoede", label: "Aoede", gender: "female" },
  { id: "Puck", label: "Puck", gender: "male" },
  { id: "Charon", label: "Charon", gender: "male" },
  { id: "Leda", label: "Leda", gender: "female" },
  { id: "Fenrir", label: "Fenrir", gender: "male" },
] as const;

type VoiceEngineId = string;

interface VoiceEngine {
  id: VoiceEngineId;
  label: string;
  description: string;
  defaultVoice: string;
  status?: "available" | "needs_configuration" | "request_access" | "experimental" | "unavailable";
  reason?: string;
  missing?: string[];
  sampleVoices?: string[];
  sampleAvailable?: boolean;
  capabilities?: VoicePipelineCapabilities;
}

interface VoicePipelineCapabilities {
  nativeAudio: boolean;
  realtimeToolCalling: boolean;
  bargeIn: boolean;
  serverVAD: boolean;
  clientVAD: boolean;
  turnDetection: boolean;
  noiseSuppression: boolean;
  wakeWord: boolean;
  multilingual: boolean;
  mobile: boolean;
  browser: boolean;
}

interface VoicePipelineApiItem {
  provider: string;
  displayName?: string;
  shortDescription?: string;
  category?: string;
  status?: VoiceEngine["status"];
  reason?: string;
  missing?: string[];
  isFallback?: boolean;
  sampleVoices?: string[];
  sampleAvailable?: boolean;
  capabilities?: VoicePipelineCapabilities;
}

const FALLBACK_VOICE_ENGINES: VoiceEngine[] = [
  {
    id: "openai_realtime_webrtc",
    label: "OpenAI Realtime",
    description: "Lowest-friction browser voice.",
    defaultVoice: "verse",
  },
  {
    id: "openai_realtime_server_ws",
    label: "OpenAI Realtime Relay",
    description: "Server-routed OpenAI voice for managed observability.",
    defaultVoice: "ash",
  },
  {
    id: "google_gemini_3_1_flash_live",
    label: "Gemini 3.1 Flash Live",
    description: "Newest low-latency native audio for busy rooms.",
    defaultVoice: "Kore",
  },
  {
    id: "google_gemini_2_5_flash_native_audio",
    label: "Gemini 2.5 Native Audio",
    description: "Stable native audio over the low-latency relay.",
    defaultVoice: "Aoede",
  },
] as const;

const SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

function defaultVoiceForPipeline(provider: string, sampleVoices?: string[]): string {
  if (provider === "openai_realtime_webrtc" || provider === "openai_realtime_server_ws") {
    return sampleVoices?.[0] ?? "verse";
  }
  if (provider === "google_gemini_3_1_flash_live") return sampleVoices?.[0] ?? "Kore";
  if (provider.startsWith("google_gemini_")) return sampleVoices?.[0] ?? "Aoede";
  return sampleVoices?.[0] ?? "verse";
}

function isSelectableVoicePipeline(provider: string): boolean {
  return (
    provider === "openai_realtime_webrtc" ||
    provider === "openai_realtime_server_ws" ||
    provider.startsWith("google_gemini_")
  );
}

function voiceOptionsForEngine(engine: VoiceEngine | undefined) {
  const fallback = engine?.id.startsWith("google_gemini_") ? GEMINI_VOICES : VOICES;
  const sampleVoices = engine?.sampleVoices?.length ? engine.sampleVoices : null;
  if (!sampleVoices) return fallback;
  return sampleVoices.map((voiceId) => {
    const known = fallback.find((voice) => voice.id === voiceId);
    return known ?? { id: voiceId, label: voiceId, gender: "voice" };
  });
}

interface AgentProfile {
  id: string;
  displayName: string;
  venueId: number | null;
  connectedServiceId: string | null;
  wakePhrase: string;
  wakeMode?: "ambient" | "tap";
  voicePipelineProvider: string;
  voicePipelineConfig: Record<string, unknown>;
  noiseMode: string;
  personality: string;
}

export default function CreateAssistant() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const kind = searchParams.get("kind");
  const editId = params?.id ?? null;

  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues } = useVenues();

  const [name, setName] = useState(() => {
    return sessionStorage.getItem("voycelab.pending_assistant_name") || "";
  });
  const [venueId, setVenueId] = useState<number | null>(null);
  const [voice, setVoice] = useState("verse");
  const [noiseMode, setNoiseMode] = useState("standard");
  const [voicePipelineProvider, setVoicePipelineProvider] = useState<VoiceEngineId>("openai_realtime_webrtc");
  const [wakePhrase, setWakePhrase] = useState("Hey Voyce");
  const [wakeMode, setWakeMode] = useState<"ambient" | "tap">("ambient");
  const [geminiThinkingLevel, setGeminiThinkingLevel] = useState<"minimal" | "low" | "medium" | "high">("minimal");
  const [geminiProactiveAudio, setGeminiProactiveAudio] = useState(true);
  const [geminiAffectiveDialog, setGeminiAffectiveDialog] = useState(false);
  const [personality, setPersonality] = useState("");
  const [voiceEngines, setVoiceEngines] = useState<VoiceEngine[]>(FALLBACK_VOICE_ENGINES);
  const [voiceEnginesLoaded, setVoiceEnginesLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(!!editId);

  useEffect(() => {
    if (!authLoading && !auth) navigate("/login");
  }, [auth, authLoading, navigate]);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const token = localStorage.getItem("voycelab_token") || "";
        const res = await fetch(`/api/v1/agent-profiles/${encodeURIComponent(editId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Could not load assistant");
        const data = await res.json();
        const profile = (data.profile ?? data) as AgentProfile;
        setName(profile.displayName);
        setVenueId(profile.venueId);
        setWakePhrase(profile.wakePhrase || "Hey Voyce");
        setWakeMode(profile.wakeMode === "tap" ? "tap" : "ambient");
        setNoiseMode(profile.noiseMode || "standard");
        setPersonality(profile.personality || "");
        if (
          profile.voicePipelineProvider === "openai_realtime_webrtc" ||
          profile.voicePipelineProvider === "openai_realtime_server_ws" ||
          profile.voicePipelineProvider === "google_gemini_3_1_flash_live" ||
          profile.voicePipelineProvider === "google_gemini_2_5_flash_native_audio"
        ) {
          setVoicePipelineProvider(profile.voicePipelineProvider);
        }
        const cfg = profile.voicePipelineConfig as {
          voice?: string;
          voiceName?: string;
          thinkingLevel?: string;
          proactiveAudio?: boolean;
          affectiveDialog?: boolean;
        } | undefined;
        if (cfg?.voiceName || cfg?.voice) setVoice(cfg.voiceName ?? cfg.voice ?? voice);
        if (
          cfg?.thinkingLevel === "minimal" ||
          cfg?.thinkingLevel === "low" ||
          cfg?.thinkingLevel === "medium" ||
          cfg?.thinkingLevel === "high"
        ) {
          setGeminiThinkingLevel(cfg.thinkingLevel);
        }
        if (typeof cfg?.proactiveAudio === "boolean") setGeminiProactiveAudio(cfg.proactiveAudio);
        if (typeof cfg?.affectiveDialog === "boolean") setGeminiAffectiveDialog(cfg.affectiveDialog);
      } catch {
        setError("Could not load this assistant for editing.");
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [editId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("voycelab_token") || "";
        const res = await fetch("/api/v1/voice-pipelines", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { pipelines?: VoicePipelineApiItem[] };
        const live = (data.pipelines ?? [])
          .filter((pipeline) => isSelectableVoicePipeline(pipeline.provider) && !pipeline.isFallback)
          .map((pipeline): VoiceEngine => ({
            id: pipeline.provider,
            label: pipeline.displayName ?? pipeline.provider.replace(/_/g, " "),
            description: pipeline.shortDescription ?? pipeline.reason ?? "Native realtime voice.",
            defaultVoice: defaultVoiceForPipeline(pipeline.provider, pipeline.sampleVoices),
            status: pipeline.status,
            reason: pipeline.reason,
            missing: pipeline.missing,
            sampleVoices: pipeline.sampleVoices,
            sampleAvailable: pipeline.sampleAvailable,
            capabilities: pipeline.capabilities,
          }));
        if (!cancelled && live.length > 0) {
          setVoiceEngines(live);
          setVoiceEnginesLoaded(true);
        }
      } catch {
        if (!cancelled) setVoiceEnginesLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editId) return;
    if (!venueId && venues && venues.length > 0 && kind !== "general") {
      setVenueId(venues[0].id);
    }
  }, [venues, venueId, kind, editId]);

  useEffect(() => {
    const availableVoices = voicePipelineProvider.startsWith("google_gemini_") ? GEMINI_VOICES : VOICES;
    if (!availableVoices.some((v) => v.id === voice)) {
      setVoice(voiceEngines.find((engine) => engine.id === voicePipelineProvider)?.defaultVoice ?? availableVoices[0].id);
    }
  }, [voiceEngines, voicePipelineProvider, voice]);

  useEffect(() => {
    if (noiseMode === "push_to_talk" && wakeMode !== "tap") {
      setWakeMode("tap");
    }
  }, [noiseMode, wakeMode]);

  const allowedVoiceEngines = useMemo(
    () => {
      if (auth?.isAdmin) return new Set(voiceEngines.map((engine) => engine.id));
      const allowed = getPlanAllowedPipelines(auth?.subscription?.plan) as readonly string[];
      return new Set(voiceEngines.filter((engine) => allowed.includes(engine.id)).map((engine) => engine.id));
    },
    [auth?.subscription?.plan, auth?.isAdmin, voiceEngines],
  );
  const selectedVoiceEngine = voiceEngines.find((engine) => engine.id === voicePipelineProvider);
  const selectedEngineReady =
    !voiceEnginesLoaded ||
    selectedVoiceEngine?.status === undefined ||
    selectedVoiceEngine.status === "available" ||
    selectedVoiceEngine.status === "experimental";
  const canUseSelectedEngine = allowedVoiceEngines.has(voicePipelineProvider) && selectedEngineReady;

  useEffect(() => {
    if (allowedVoiceEngines.has(voicePipelineProvider)) return;
    const fallback = voiceEngines.find((engine) => allowedVoiceEngines.has(engine.id))?.id ?? "openai_realtime_webrtc";
    setVoicePipelineProvider(fallback);
  }, [allowedVoiceEngines, voiceEngines, voicePipelineProvider]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give your assistant a name.");
    if (!canUseSelectedEngine) {
      return setError("Choose a voice engine included with your plan and ready on this deployment.");
    }
    if (!auth?.organizationId) {
      return setError(
        "Your account isn't fully set up yet. Reload and try again.",
      );
    }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("voycelab_token") || "";
      const isGeminiPipeline = voicePipelineProvider.startsWith("google_gemini_");
      const voicePipelineConfig = isGeminiPipeline
        ? {
            voiceName: voice,
            voice,
            ...(voicePipelineProvider === "google_gemini_3_1_flash_live"
              ? { thinkingLevel: geminiThinkingLevel }
              : {
                  proactiveAudio: geminiProactiveAudio,
                  affectiveDialog: geminiAffectiveDialog,
                }),
          }
        : { voice };
      const body: Record<string, unknown> = {
        organizationId: auth.organizationId,
        displayName: name.trim(),
        wakePhrase: wakePhrase.trim() || "Hey Voyce",
        wakeMode: noiseMode === "push_to_talk" ? "tap" : wakeMode,
        voicePipelineProvider,
        voicePipelineConfig,
        noiseMode,
        personality,
        allowedTools: [],
        confirmationPolicy: { approvals: {} },
      };
      if (venueId) {
        body.venueId = venueId;
        const selectedVenue = venues?.find((v) => v.id === venueId);
        body.connectedServiceId = selectedVenue?.serviceConnectionId ?? null;
      }

      const url = editId
        ? `/api/v1/agent-profiles/${encodeURIComponent(editId)}`
        : "/api/v1/agent-profiles";
      const method = editId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: await withClerkBillingHeader({
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(
          errBody.error?.message ??
            `Could not save your assistant. (HTTP ${res.status})`,
        );
      }
      sessionStorage.removeItem("voycelab.pending_assistant_name");
      navigate("/assistants");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loadingProfile) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-vl-brass2)" }}
        />
      </div>
    );
  }

  const isGeneral = kind === "general" && !editId;
  const pageTitle = editId ? "Edit assistant" : "New assistant";
  const pageSubtitle = editId
    ? "Update your assistant's name, voice, and behavior."
    : isGeneral
    ? "A general assistant for questions, notes, and connected data. You can connect Square later."
    : "Name it, connect it, pick a voice. Everything else has sane defaults.";
  const submitLabel = editId ? "Save changes" : "Create assistant";
  const activeVoiceOptions = voiceOptionsForEngine(selectedVoiceEngine);

  return (
    <div className="relative flex-1 overflow-hidden bg-vl-cream px-4 pb-20 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="flex items-center gap-x-5 mb-6 text-[12px]">
          <Link
            href="/assistants"
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Assistants
          </Link>
        </div>

        <p className="vl-eyebrow">{editId ? "Edit" : "Create"}</p>
        <h1
          className="vl-display mt-3 text-[34px]"
          style={{ color: "var(--color-vl-ink)" }}
        >
          {pageTitle}
        </h1>
        <p
          className="mt-2 text-[14px] leading-relaxed"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          {pageSubtitle}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* ── Name ─────────────────────────────────────────── */}
          <label className="block">
            <span className="vl-eyebrow block mb-1.5">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isGeneral ? "My Business Assistant" : "Bev at the Den"}
              className="vl-input"
              maxLength={32}
              required
            />
          </label>

          {/* ── Connection ───────────────────────────────────── */}
          {!isGeneral && (
            <div>
              <span className="vl-eyebrow block mb-1.5">Connection</span>
              {venues && venues.length > 0 ? (
                <div className="relative">
                  <select
                    value={venueId ?? ""}
                    onChange={(e) =>
                      setVenueId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="vl-input appearance-none pr-10"
                  >
                    <option value="">No venue -- general assistant</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name ?? v.squareLocationName ?? `Venue ${v.id}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "var(--color-vl-ink-faint)" }}
                  />
                </div>
              ) : (
                <div
                  className="vl-card p-4 text-[13px]"
                  style={{ color: "var(--color-vl-ink-muted)" }}
                >
                  No venues connected yet.{" "}
                  <Link
                    href="/services"
                    className="underline"
                    style={{ color: "var(--color-vl-brass2)" }}
                  >
                    Connect Square
                  </Link>{" "}
                  to enable POS actions, or create a general assistant now.
                </div>
              )}
              {venues && venues.length > 0 && (
                <Link
                  href="/services"
                  className="inline-block mt-2 text-[12px] underline"
                  style={{ color: "var(--color-vl-brass2)" }}
                >
                  Manage connections
                </Link>
              )}
            </div>
          )}

          {isGeneral && (
            <div
              className="rounded-xl border p-4 text-[13px]"
              style={{
                color: "rgba(10,10,11,0.62)",
                background: "rgba(199,210,254,0.12)",
                borderColor: "rgba(99,102,241,0.12)",
              }}
            >
              Your assistant starts without POS access. Connect Square anytime from{" "}
              <Link
                href="/services"
                className="underline"
                style={{ color: "var(--color-vl-accent)" }}
              >
                Integrations
              </Link>{" "}
              to unlock ordering, inventory, and reporting.
            </div>
          )}

          {/* ── Voice ────────────────────────────────────────── */}
          <fieldset>
            <legend className="vl-eyebrow block mb-3">Voice engine</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {voiceEngines.map((engine) => (
                <VoiceEngineCard
                  key={engine.id}
                  engine={engine}
                  selected={voicePipelineProvider === engine.id}
                  locked={!allowedVoiceEngines.has(engine.id)}
                  onSelect={() => setVoicePipelineProvider(engine.id)}
                />
              ))}
            </div>
            {!auth?.isAdmin && !allowedVoiceEngines.has("google_gemini_3_1_flash_live") && (
              <p className="mt-2 text-[12px]" style={{ color: "rgba(10,10,11,0.52)" }}>
                Gemini voices unlock on Pro and Business.{" "}
                <Link href="/pricing" className="underline" style={{ color: "var(--color-vl-brass2)" }}>
                  View plans
                </Link>
              </p>
            )}
            {!voiceEnginesLoaded && (
              <p className="mt-2 text-[12px]" style={{ color: "rgba(10,10,11,0.52)" }}>
                Using built-in engine defaults until server readiness loads.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {activeVoiceOptions.map((v) => (
                <VoiceOption
                  key={v.id}
                  provider={voicePipelineProvider}
                  voiceId={v.id}
                  label={v.label}
                  gender={v.gender}
                  selected={voice === v.id}
                  onSelect={() => setVoice(v.id)}
                />
              ))}
            </div>
          </fieldset>

          {/* ── Advanced settings ─────────────────────────────── */}
          <details className="vl-card">
            <summary
              className="cursor-pointer select-none px-5 py-4 text-[13px] font-semibold"
              style={{ color: "var(--color-vl-ink)" }}
            >
              Advanced settings
            </summary>
            <div className="space-y-5 px-5 pb-5 pt-2">
              <label className="block">
                <span className="vl-eyebrow block mb-1.5">Noise mode</span>
                <div className="relative">
                  <select
                    value={noiseMode}
                    onChange={(e) => setNoiseMode(e.target.value)}
                    className="vl-input appearance-none pr-10"
                  >
                    <option value="standard">Standard</option>
                    <option value="loud">Loud venue</option>
                    <option value="push_to_talk">Push to talk</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "var(--color-vl-ink-faint)" }}
                  />
                </div>
                <p className="mt-1.5 text-[11.5px]" style={{ color: "rgba(10,10,11,0.42)" }}>
                  Controls how aggressively the assistant filters background noise and when it starts listening.
                </p>
              </label>

              <label className="block">
                <span className="vl-eyebrow block mb-1.5">Wake phrase</span>
                <input
                  value={wakePhrase}
                  onChange={(e) => setWakePhrase(e.target.value)}
                  placeholder="Hey Voyce"
                  className="vl-input"
                  maxLength={60}
                />
              </label>

              <fieldset>
                <legend className="vl-eyebrow block mb-2">Start mode</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "ambient", label: "Wake phrase", hint: "Always ready" },
                    { id: "tap", label: "Tap only", hint: "Quietest setup" },
                  ].map((option) => {
                    const disabled = noiseMode === "push_to_talk" && option.id === "ambient";
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (!disabled) setWakeMode(option.id as "ambient" | "tap");
                        }}
                        className="vl-card p-3 text-left transition-colors"
                        style={{
                          borderColor: wakeMode === option.id
                            ? "rgba(124,110,245,0.6)"
                            : "rgba(10, 10, 11,0.10)",
                          background: wakeMode === option.id ? "rgba(124,110,245,0.06)" : "#FFFFFF",
                          opacity: disabled ? 0.48 : 1,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <span className="block text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                          {option.label}
                        </span>
                        <span className="mt-1 block text-[11.5px]" style={{ color: "rgba(10,10,11,0.48)" }}>
                          {disabled ? "Disabled for push to talk" : option.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {voicePipelineProvider.startsWith("google_gemini_") && (
                <fieldset className="space-y-3">
                  <legend className="vl-eyebrow block">Gemini live behavior</legend>
                  {voicePipelineProvider === "google_gemini_3_1_flash_live" ? (
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                        Thinking level
                      </span>
                      <div className="relative">
                        <select
                          value={geminiThinkingLevel}
                          onChange={(e) => setGeminiThinkingLevel(e.target.value as typeof geminiThinkingLevel)}
                          className="vl-input appearance-none pr-10"
                        >
                          <option value="minimal">Minimal latency</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2"
                          style={{ color: "var(--color-vl-ink-faint)" }}
                        />
                      </div>
                    </label>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ToggleCard
                        label="Proactive audio"
                        hint="Stays quiet when speech is not meant for the assistant."
                        checked={geminiProactiveAudio}
                        onChange={setGeminiProactiveAudio}
                      />
                      <ToggleCard
                        label="Affective dialog"
                        hint="Adapts tone to the user's expression and delivery."
                        checked={geminiAffectiveDialog}
                        onChange={setGeminiAffectiveDialog}
                      />
                    </div>
                  )}
                </fieldset>
              )}

              <label className="block">
                <span className="vl-eyebrow block mb-1.5">Personality</span>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="Optional: describe how the assistant should behave, its tone, special knowledge..."
                  className="vl-input"
                  rows={3}
                  style={{ height: "auto", padding: "12px 16px" }}
                />
                <p className="mt-1.5 text-[11.5px]" style={{ color: "rgba(10,10,11,0.42)" }}>
                  Add custom instructions the assistant will follow during every conversation.
                </p>
              </label>
            </div>
          </details>

          {error && (
            <p
              className="text-[13px]"
              style={{ color: "var(--color-vl-danger)" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !name.trim() || !canUseSelectedEngine}
            className="vl-btn-primary w-full inline-flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> {submitLabel}
              </>
            )}
          </button>
        </form>
      </div>

      <style>{`
        .vl-input {
          width: 100%;
          height: 48px;
          padding: 0 16px;
          border-radius: 14px;
          background: #FFFFFF;
          border: 1px solid rgba(10, 10, 11,0.12);
          color: var(--color-vl-ink);
          font-size: 15px;
          outline: none;
          transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
        }
        .vl-input::placeholder { color: rgba(10, 10, 11,0.36); }
        .vl-input:focus {
          border-color: var(--color-vl-coral);
          box-shadow: 0 0 0 3px rgba(99, 102, 241,0.14);
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Voice option card with sample playback
   ───────────────────────────────────────────────────────────────── */

function VoiceEngineCard({
  engine,
  selected,
  locked,
  onSelect,
}: {
  engine: VoiceEngine;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  const needsConfig = engine.status === "needs_configuration";
  const unavailable = engine.status === "unavailable" || engine.status === "request_access";
  const disabled = locked || unavailable || needsConfig;
  const statusLabel = needsConfig
    ? "Key needed"
    : unavailable
    ? "Unavailable"
    : engine.status === "available"
    ? "Ready"
    : engine.status === "experimental"
    ? "Preview"
    : null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className="vl-card p-4 text-left transition-colors"
      style={{
        borderColor: selected
          ? "rgba(124,110,245,0.6)"
            : disabled
            ? "rgba(10,10,11,0.08)"
            : "rgba(10, 10, 11,0.10)",
        background: selected ? "rgba(124,110,245,0.06)" : "#FFFFFF",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
          {engine.label}
        </span>
        {(locked || statusLabel) && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              color: statusLabel === "Ready" ? "var(--color-vl-success)" : "rgba(10,10,11,0.52)",
              background: statusLabel === "Ready" ? "rgba(16,185,129,0.10)" : "rgba(10,10,11,0.06)",
            }}
          >
            {locked && <Lock className="h-3 w-3" />}
            {locked ? "Upgrade" : statusLabel}
          </span>
        )}
      </span>
      <span className="mt-1 block text-[12px]" style={{ color: "rgba(10,10,11,0.52)" }}>
        {locked
          ? "Upgrade to use this voice engine."
          : needsConfig
          ? `${engine.missing?.[0] ?? "Provider key"} is not configured on this deployment.`
          : engine.description}
      </span>
    </button>
  );
}

function ToggleCard({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="vl-card flex min-h-[88px] items-start gap-3 p-3 text-left transition-colors"
      style={{
        borderColor: checked ? "rgba(124,110,245,0.6)" : "rgba(10,10,11,0.10)",
        background: checked ? "rgba(124,110,245,0.06)" : "#FFFFFF",
      }}
      aria-pressed={checked}
    >
      <span
        className="mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors"
        style={{ background: checked ? "var(--color-vl-coral)" : "rgba(10,10,11,0.16)" }}
      >
        <span
          className="block h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
      <span>
        <span className="block text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
          {label}
        </span>
        <span className="mt-1 block text-[11.5px] leading-snug" style={{ color: "rgba(10,10,11,0.48)" }}>
          {hint}
        </span>
      </span>
    </button>
  );
}

function VoiceOption({
  provider,
  voiceId,
  label,
  gender,
  selected,
  onSelect,
}: {
  provider: string;
  voiceId: string;
  label: string;
  gender: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playState, setPlayState] = useState<
    "idle" | "loading" | "playing" | "error"
  >("idle");

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = "";
    };
  }, []);

  async function toggleSample(e: React.MouseEvent) {
    e.stopPropagation();
    if (playState === "playing") {
      audioRef.current?.pause();
      setPlayState("idle");
      return;
    }
    setPlayState("loading");
    try {
      const url = `/api/v1/voice-pipelines/${encodeURIComponent(provider)}/sample?voice=${encodeURIComponent(voiceId)}`;
      const token = localStorage.getItem("voycelab_token") || "";
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        setPlayState("idle");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setPlayState("error");
      };
      audioRef.current = audio;
      await audio.play();
      setPlayState("playing");
    } catch {
      fallbackBrowserVoice();
    }
  }

  function fallbackBrowserVoice() {
    if (!window.speechSynthesis) {
      setPlayState("error");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(SAMPLE_LINE);
    utterance.rate = 1.05;
    utterance.onend = () => setPlayState("idle");
    utterance.onerror = () => setPlayState("error");
    const voices = window.speechSynthesis.getVoices();
    const en = voices.filter((v) =>
      v.lang.toLowerCase().startsWith("en"),
    );
    if (en.length > 0) utterance.voice = en[0];
    window.speechSynthesis.speak(utterance);
    setPlayState("playing");
  }

  const isPlaying = playState === "playing";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="vl-card relative flex flex-col items-center gap-2 p-4 transition-colors"
      style={{
        borderColor: selected
          ? "rgba(124,110,245,0.6)"
          : "rgba(10, 10, 11,0.10)",
        background: selected ? "rgba(124,110,245,0.06)" : undefined,
      }}
    >
      {selected && (
        <span
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: "var(--color-vl-coral)" }}
        >
          <Check className="w-3 h-3 text-white" />
        </span>
      )}
      <span
        className="text-[14px] font-semibold"
        style={{ color: "var(--color-vl-ink)" }}
      >
        {label}
      </span>
      <span
        className="text-[11px]"
        style={{ color: "var(--color-vl-ink-faint)" }}
      >
        {gender}
      </span>
      <button
        type="button"
        onClick={toggleSample}
        disabled={playState === "loading"}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors"
        style={{
          borderColor: isPlaying
            ? "rgba(124,110,245,0.6)"
            : "rgba(10, 10, 11,0.12)",
          background: isPlaying
            ? "var(--color-vl-coral-tint)"
            : "rgba(255,255,255,0.55)",
          color: "var(--color-vl-ink)",
        }}
      >
        {playState === "loading" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-3 h-3" />
        ) : playState === "error" ? (
          <Volume2
            className="w-3 h-3"
            style={{ color: "var(--color-vl-danger)" }}
          />
        ) : (
          <Play className="w-3 h-3" />
        )}
        {isPlaying ? "Stop" : "Play"}
      </button>
    </button>
  );
}
