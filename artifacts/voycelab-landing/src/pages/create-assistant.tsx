import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { rememberIntendedPath } from "@/lib/post-login-redirect";
import { useVenues } from "@/hooks/use-venues";
import { withClerkBillingHeader } from "@/lib/clerk-session";
import { getPlanAllowedPipelines } from "@workspace/voicelab-core/pricing";
import { defaultWakePhraseFor } from "@workspace/voicelab-core/agent-profile";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Lock,
  Loader2,
  Pause,
  Play,
  Volume2,
  X,
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

const XAI_VOICES = [
  { id: "eve", label: "Eve", gender: "female" },
  { id: "ara", label: "Ara", gender: "female" },
  { id: "leo", label: "Leo", gender: "male" },
  { id: "rex", label: "Rex", gender: "male" },
  { id: "sal", label: "Sal", gender: "neutral" },
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
  {
    id: "xai_grok_realtime_ws",
    label: "xAI Grok Voice",
    description: "xAI's premium Grok realtime voice with expressive native audio.",
    defaultVoice: "eve",
  },
] as const;

const SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

function defaultVoiceForPipeline(provider: string, sampleVoices?: string[]): string {
  if (provider === "openai_realtime_webrtc" || provider === "openai_realtime_server_ws") {
    return sampleVoices?.[0] ?? "verse";
  }
  if (provider === "google_gemini_3_1_flash_live") return sampleVoices?.[0] ?? "Kore";
  if (provider.startsWith("google_gemini_")) return sampleVoices?.[0] ?? "Aoede";
  if (provider === "xai_grok_realtime_ws") return sampleVoices?.[0] ?? "eve";
  return sampleVoices?.[0] ?? "verse";
}

function isSelectableVoicePipeline(provider: string): boolean {
  return (
    provider === "openai_realtime_webrtc" ||
    provider === "openai_realtime_server_ws" ||
    provider === "xai_grok_realtime_ws" ||
    provider.startsWith("google_gemini_")
  );
}

function voiceOptionsForEngine(engine: VoiceEngine | undefined) {
  const fallback = engine?.id.startsWith("google_gemini_")
    ? GEMINI_VOICES
    : engine?.id === "xai_grok_realtime_ws"
      ? XAI_VOICES
      : VOICES;
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
  orderHandlingMode?: "auto_complete" | "hold_for_review";
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
  // Until the user edits the wake phrase themselves, keep it derived from the
  // assistant's name ("Lola" -> "Hey Lola") so every assistant wakes on its
  // own name instead of the shared "Hey Voyce" default.
  const [wakePhraseTouched, setWakePhraseTouched] = useState(false);
  const [wakeMode, setWakeMode] = useState<"ambient" | "tap">("ambient");
  const [orderHandlingMode, setOrderHandlingMode] = useState<"auto_complete" | "hold_for_review">("auto_complete");
  const [geminiThinkingLevel, setGeminiThinkingLevel] = useState<"minimal" | "low" | "medium" | "high">("minimal");
  const [geminiProactiveAudio, setGeminiProactiveAudio] = useState(true);
  const [geminiAffectiveDialog, setGeminiAffectiveDialog] = useState(false);
  const [personality, setPersonality] = useState("");
  const [voiceEngines, setVoiceEngines] = useState<VoiceEngine[]>(FALLBACK_VOICE_ENGINES);
  const [voiceEnginesLoaded, setVoiceEnginesLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(!!editId);
  // A failed edit-load leaves the form at defaults; saving then would silently
  // overwrite the real profile, so block submit until a reload succeeds.
  const [editLoadFailed, setEditLoadFailed] = useState(false);

  useEffect(() => {
    if (!authLoading && !auth) { rememberIntendedPath(); navigate("/login"); }
  }, [auth, authLoading, navigate]);

  useEffect(() => {
    if (editId || wakePhraseTouched) return;
    setWakePhrase(name.trim() ? defaultWakePhraseFor(name.trim()) : "Hey Voyce");
  }, [name, editId, wakePhraseTouched]);

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
        setWakePhraseTouched(true);
        setWakeMode(profile.wakeMode === "tap" ? "tap" : "ambient");
        setNoiseMode(profile.noiseMode || "standard");
        setOrderHandlingMode(profile.orderHandlingMode === "hold_for_review" ? "hold_for_review" : "auto_complete");
        setPersonality(profile.personality || "");
        if (
          profile.voicePipelineProvider === "openai_realtime_webrtc" ||
          profile.voicePipelineProvider === "openai_realtime_server_ws" ||
          profile.voicePipelineProvider === "google_gemini_3_1_flash_live" ||
          profile.voicePipelineProvider === "google_gemini_2_5_flash_native_audio" ||
          profile.voicePipelineProvider === "xai_grok_realtime_ws"
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
        setEditLoadFailed(true);
        setError("Could not load this assistant for editing. Reload the page to try again — saving is disabled so your live settings aren't overwritten.");
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
    // Use the same source the picker renders from (voiceOptionsForEngine),
    // which resolves openai / gemini / xai voices — and prefers the server's
    // sampleVoices. The old code only special-cased Gemini vs the default set,
    // so selecting the xAI engine left an invalid voice (e.g. "verse")
    // selected and submitted.
    const engine = voiceEngines.find((e) => e.id === voicePipelineProvider);
    const availableVoices = voiceOptionsForEngine(engine);
    if (availableVoices.length > 0 && !availableVoices.some((v) => v.id === voice)) {
      setVoice(engine?.defaultVoice ?? availableVoices[0].id);
    }
  }, [voiceEngines, voicePipelineProvider, voice]);

  useEffect(() => {
    if (noiseMode === "push_to_talk" && wakeMode !== "tap") {
      setWakeMode("tap");
    }
  }, [noiseMode, wakeMode]);

  const allowedVoiceEngines = useMemo(
    () => {
      if (auth?.isAdmin || auth?.user?.isAdmin) return new Set(voiceEngines.map((engine) => engine.id));
      const allowed = getPlanAllowedPipelines(auth?.subscription?.plan) as readonly string[];
      return new Set(voiceEngines.filter((engine) => allowed.includes(engine.id)).map((engine) => engine.id));
    },
    [auth?.subscription?.plan, auth?.isAdmin, auth?.user?.isAdmin, voiceEngines],
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
        wakePhrase: wakePhrase.trim() || defaultWakePhraseFor(name.trim()),
        wakeMode: noiseMode === "push_to_talk" ? "tap" : wakeMode,
        voicePipelineProvider,
        voicePipelineConfig,
        noiseMode,
        orderHandlingMode,
        personality,
        // allowedTools / confirmationPolicy are intentionally omitted: there is
        // no editor for them in this wizard. On create, the server applies its
        // defaults (all tools allowed, DEFAULT_CONFIRMATION_POLICY); on edit
        // (PATCH), omitting them preserves whatever was already set instead of
        // silently wiping it back to empty.
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
      <div className="vl-page-shell flex flex-1 items-center justify-center">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-vl-coral)" }}
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
  const selectedVenueName =
    venues?.find((venue) => venue.id === venueId)?.name ??
    venues?.find((venue) => venue.id === venueId)?.squareLocationName ??
    (venueId ? `Venue ${venueId}` : "General assistant");

  return (
    <div className="vl-page-shell relative flex-1 overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="flex items-center gap-x-5 mb-6 text-[12px]">
          <Link
            href="/assistants"
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Assistants
          </Link>
        </div>

        <div className="vl-panel overflow-hidden p-6 md:p-8">
          <p className="vl-eyebrow">{editId ? "Edit" : "Create"}</p>
          <h1
            className="vl-display mt-3 text-[38px] md:text-[54px]"
            style={{ color: "var(--color-vl-ink)" }}
          >
            {pageTitle}
          </h1>
          <p
            className="mt-4 max-w-2xl text-[15px] leading-relaxed"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            {pageSubtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="vl-panel space-y-6 p-5 md:p-6">
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
                    style={{ color: "var(--color-vl-coral)" }}
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
                  style={{ color: "var(--color-vl-coral)" }}
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
                color: "rgba(14, 27, 44,0.62)",
                background: "rgba(124,110,245,0.12)",
                borderColor: "rgba(124, 110, 245,0.12)",
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
            {!auth?.isAdmin && !auth?.user?.isAdmin && !allowedVoiceEngines.has("google_gemini_3_1_flash_live") && (
              <p className="mt-2 text-[12px]" style={{ color: "rgba(14, 27, 44,0.52)" }}>
                Gemini voices unlock on Pro and Business.{" "}
                <Link href="/pricing" className="underline" style={{ color: "var(--color-vl-coral)" }}>
                  View plans
                </Link>
              </p>
            )}
            {!voiceEnginesLoaded && (
              <p className="mt-2 text-[12px]" style={{ color: "rgba(14, 27, 44,0.52)" }}>
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
          <AdvancedSettingsCard>
            <div className="space-y-5">
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
                <p className="mt-1.5 text-[11.5px]" style={{ color: "rgba(14, 27, 44,0.42)" }}>
                  Controls how aggressively the assistant filters background noise and when it starts listening.
                </p>
              </label>

              <label className="block">
                <span className="vl-eyebrow block mb-1.5">Wake phrase</span>
                <input
                  value={wakePhrase}
                  onChange={(e) => { setWakePhrase(e.target.value); setWakePhraseTouched(true); }}
                  placeholder={name.trim() ? defaultWakePhraseFor(name.trim()) : "Hey Voyce"}
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
                            : "rgba(14, 27, 44,0.10)",
                          background: wakeMode === option.id ? "rgba(124,110,245,0.06)" : "#FFFFFF",
                          opacity: disabled ? 0.48 : 1,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <span className="block text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                          {option.label}
                        </span>
                        <span className="mt-1 block text-[11.5px]" style={{ color: "rgba(14, 27, 44,0.48)" }}>
                          {disabled ? "Disabled for push to talk" : option.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {venueId != null && (
                <fieldset>
                  <legend className="vl-eyebrow block mb-2">Order handling</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "auto_complete", label: "Auto-complete", hint: "Records payment now" },
                      { id: "hold_for_review", label: "Hold for review", hint: "Open ticket for close-out" },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setOrderHandlingMode(option.id as "auto_complete" | "hold_for_review")}
                        className="vl-card p-3 text-left transition-colors"
                        style={{
                          borderColor: orderHandlingMode === option.id
                            ? "rgba(124,110,245,0.6)"
                            : "rgba(14, 27, 44,0.10)",
                          background: orderHandlingMode === option.id ? "rgba(124,110,245,0.06)" : "#FFFFFF",
                          cursor: "pointer",
                        }}
                      >
                        <span className="block text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                          {option.label}
                        </span>
                        <span className="mt-1 block text-[11.5px]" style={{ color: "rgba(14, 27, 44,0.48)" }}>
                          {option.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px]" style={{ color: "rgba(14, 27, 44,0.42)" }}>
                    Hold for review parks submitted orders on the POS as open tickets so the team can settle them at close-out. No payment is taken at submit.
                  </p>
                </fieldset>
              )}

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
                <p className="mt-1.5 text-[11.5px]" style={{ color: "rgba(14, 27, 44,0.42)" }}>
                  Add custom instructions the assistant will follow during every conversation.
                </p>
              </label>
            </div>
          </AdvancedSettingsCard>

          </div>

          <aside className="vl-panel sticky top-24 p-5 md:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Configuration summary
            </p>
            <div className="mt-4 grid gap-3">
              <SummaryRow label="Assistant" value={name.trim() || "Unnamed assistant"} />
              <SummaryRow label="Connection" value={selectedVenueName} />
              <SummaryRow label="Voice engine" value={selectedVoiceEngine?.label ?? voicePipelineProvider.replace(/_/g, " ")} />
              <SummaryRow label="Voice" value={activeVoiceOptions.find((option) => option.id === voice)?.label ?? voice} />
              <SummaryRow label="Noise mode" value={noiseMode.replace(/_/g, " ")} />
              <SummaryRow label="Wake mode" value={wakeMode.replace(/_/g, " ")} />
              {venueId != null && (
                <SummaryRow
                  label="Order handling"
                  value={orderHandlingMode === "hold_for_review" ? "Hold for review" : "Auto-complete"}
                />
              )}
            </div>

            {error && (
              <p
                className="mt-4 rounded-2xl border px-4 py-3 text-[13px]"
                style={{
                  color: "var(--color-vl-danger)",
                  background: "rgba(215,64,46,0.08)",
                  borderColor: "rgba(215,64,46,0.18)",
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving || !name.trim() || !canUseSelectedEngine || editLoadFailed}
              className="vl-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 text-[14px] disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Changes write to the live assistant profile and apply the next time the assistant starts.
            </p>
          </aside>
        </form>
      </div>

      <style>{`
        .vl-input {
          width: 100%;
          height: 48px;
          padding: 0 16px;
          border-radius: 14px;
          background: rgba(255,255,255,0.78);
          border: 1px solid rgba(14, 27, 44,0.12);
          color: var(--color-vl-ink);
          font-size: 15px;
          outline: none;
          transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
        }
        .vl-input::placeholder { color: rgba(14, 27, 44,0.36); }
        .vl-input:focus {
          border-color: var(--color-vl-coral);
          background: #fff;
          box-shadow: 0 0 0 3px rgba(124, 110, 245,0.14);
        }
      `}</style>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white/70 px-4 py-3" style={{ borderColor: "rgba(14, 27, 44,0.06)" }}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--color-vl-ink-faint)" }}>
        {label}
      </p>
      <p className="mt-1 truncate text-[13px] font-bold capitalize" title={value} style={{ color: "var(--color-vl-ink)" }}>
        {value}
      </p>
    </div>
  );
}

function AdvancedSettingsCard({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="vl-card flex min-h-[220px] flex-col justify-between overflow-hidden p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <AssistantSetupArt />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
            Optional
          </p>
          <h2 className="mt-2 text-[20px] font-bold" style={{ color: "var(--color-vl-ink)" }}>
            Advanced settings
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            Noise behavior, wake phrase, start mode, and personality.
          </p>
        </div>
        <span className="mt-4 text-[12px] font-bold" style={{ color: "var(--color-vl-coral-deep)" }}>
          Configure
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-80 flex items-center justify-center px-4 py-8">
          <button
            type="button"
            aria-label="Close advanced settings"
            className="absolute inset-0 bg-[rgba(14,27,44,0.38)] backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            className="relative flex max-h-[88vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[28px] border bg-white shadow-2xl"
            style={{ borderColor: "rgba(14, 27, 44,0.10)" }}
          >
            <div className="grid gap-5 border-b p-6 lg:grid-cols-[220px_minmax(0,1fr)_auto]" style={{ borderColor: "rgba(14, 27, 44,0.08)" }}>
              <AssistantSetupArt compact />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>
                  Assistant setup
                </p>
                <h2 className="mt-1 text-[28px] font-bold leading-tight" style={{ color: "var(--color-vl-ink)" }}>
                  Advanced settings
                </h2>
                <p className="mt-1 max-w-130 text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Tune how the assistant listens, starts, and speaks.
                </p>
              </div>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-white/80 text-vl-ink-muted transition hover:bg-white hover:text-vl-ink"
                style={{ borderColor: "rgba(14, 27, 44,0.10)" }}
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="vl-scroll overflow-y-auto p-6">
              {children}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function AssistantSetupArt({ compact = false }: { compact?: boolean }) {
  const bars = [42, 76, 58, 90, 64, 82, 50];

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[22px] border shadow-inner ${compact ? "h-[120px]" : "h-[98px]"}`}
      style={{
        borderColor: "rgba(124,110,245,0.18)",
        background: "linear-gradient(135deg, rgba(124,110,245,0.22), rgba(255,107,71,0.16) 52%, rgba(255,255,255,0.88))",
      }}
    >
      <div className="absolute -right-8 -top-12 h-32 w-32 rounded-[36%] blur-2xl" style={{ background: "rgba(124,110,245,0.40)" }} />
      <div className="absolute -bottom-12 -left-10 h-32 w-32 rounded-[40%] blur-2xl" style={{ background: "rgba(255,107,71,0.30)" }} />
      <div className="absolute inset-x-4 bottom-4 flex h-14 items-end gap-1.5">
        {bars.map((height, index) => (
          <span
            key={`assistant-setup-${index}`}
            className="w-full rounded-md shadow-sm"
            style={{
              height: `${height}%`,
              background: index % 2 === 0 ? "rgba(124,110,245,0.76)" : "rgba(255,107,71,0.70)",
              opacity: 0.88,
            }}
          />
        ))}
      </div>
      <div
        className="absolute left-4 top-4 grid h-12 w-12 place-items-center rounded-[18px] border shadow-lg backdrop-blur"
        style={{ borderColor: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.44)", color: "#332B93" }}
      >
        <Volume2 className="h-5 w-5" />
      </div>
      <div className="absolute right-4 top-4 h-3 w-12 rounded-md bg-[rgba(124,110,245,0.72)]" />
      <div className="absolute right-4 top-9 h-3 w-8 rounded-md bg-[rgba(255,107,71,0.64)]" />
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
            ? "rgba(14, 27, 44,0.08)"
            : "rgba(14, 27, 44,0.10)",
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
            className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              color: statusLabel === "Ready" ? "var(--color-vl-success)" : "rgba(14, 27, 44,0.52)",
              background: statusLabel === "Ready" ? "rgba(16,185,129,0.10)" : "rgba(14, 27, 44,0.06)",
            }}
          >
            {locked && <Lock className="h-3 w-3" />}
            {locked ? "Upgrade" : statusLabel}
          </span>
        )}
      </span>
      <span className="mt-1 block text-[12px]" style={{ color: "rgba(14, 27, 44,0.52)" }}>
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
        borderColor: checked ? "rgba(124,110,245,0.6)" : "rgba(14, 27, 44,0.10)",
        background: checked ? "rgba(124,110,245,0.06)" : "#FFFFFF",
      }}
      aria-pressed={checked}
    >
      <span
          className="mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-xl p-0.5 transition-colors"
        style={{ background: checked ? "var(--color-vl-coral)" : "rgba(14, 27, 44,0.16)" }}
      >
        <span
          className="block h-4 w-4 rounded-lg bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
      <span>
        <span className="block text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
          {label}
        </span>
        <span className="mt-1 block text-[11.5px] leading-snug" style={{ color: "rgba(14, 27, 44,0.48)" }}>
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
          : "rgba(14, 27, 44,0.10)",
        background: selected ? "rgba(124,110,245,0.06)" : undefined,
      }}
    >
      {selected && (
        <span
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-lg"
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
        className="mt-1 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-[11px] transition-colors"
        style={{
          borderColor: isPlaying
            ? "rgba(124,110,245,0.6)"
            : "rgba(14, 27, 44,0.12)",
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
