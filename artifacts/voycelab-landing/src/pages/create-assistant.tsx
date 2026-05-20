import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  Volume2,
} from "lucide-react";

const VOICES = [
  { id: "verse", label: "Verse", gender: "male" },
  { id: "ballad", label: "Ballad", gender: "female" },
  { id: "ash", label: "Ash", gender: "male" },
  { id: "coral", label: "Coral", gender: "female" },
] as const;

const SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

export default function CreateAssistant() {
  const [, navigate] = useLocation();
  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues } = useVenues();

  const [name, setName] = useState(() => {
    return sessionStorage.getItem("voycelab.pending_assistant_name") || "";
  });
  const [venueId, setVenueId] = useState<number | null>(null);
  const [voice, setVoice] = useState("verse");

  const [noiseMode, setNoiseMode] = useState("bar");
  const [voicePipelineProvider] = useState("openai_realtime_webrtc");
  const [wakePhrase, setWakePhrase] = useState("Hey Voyce");
  const [personality, setPersonality] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !auth) navigate("/login");
  }, [auth, authLoading, navigate]);

  useEffect(() => {
    if (!venueId && venues && venues.length > 0) setVenueId(venues[0].id);
  }, [venues, venueId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give your assistant a name.");
    if (!auth?.organizationId) {
      return setError(
        "Your account isn't fully set up yet. Reload and try again.",
      );
    }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("voycelab_token") || "";
      const body: Record<string, unknown> = {
        organizationId: auth.organizationId,
        displayName: name.trim(),
        wakePhrase: wakePhrase.trim() || "Hey Voyce",
        voicePipelineProvider,
        voicePipelineConfig: { voice },
        noiseMode,
        personality,
        allowedTools: [],
        confirmationPolicy: { approvals: {} },
      };
      if (venueId) body.venueId = venueId;

      const res = await fetch("/api/v1/agent-profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
      navigate("/command");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-vl-brass2)" }}
        />
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:px-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-[-12%] top-[-18%] h-95 w-140 rounded-full blur-3xl"
          style={{ background: "rgba(251, 207, 232, 0.42)" }}
        />
        <div
          className="absolute right-[-14%] top-[5%] h-120 w-150 rounded-full blur-3xl"
          style={{ background: "rgba(199, 210, 254, 0.30)" }}
        />
        <div
          className="absolute bottom-[-18%] right-[12%] h-105 w-170 rounded-full blur-3xl"
          style={{ background: "rgba(167, 243, 208, 0.23)" }}
        />
      </div>

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

        <p className="vl-eyebrow">Create</p>
        <h1
          className="vl-display mt-3 text-[34px]"
          style={{ color: "var(--color-vl-ink)" }}
        >
          New assistant
        </h1>
        <p
          className="mt-2 text-[14px] leading-relaxed"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          Name it, connect it, pick a voice. Everything else has sane defaults.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* ── Name ─────────────────────────────────────────── */}
          <label className="block">
            <span className="vl-eyebrow block mb-1.5">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bev at the Den"
              className="vl-input"
              maxLength={32}
              required
            />
          </label>

          {/* ── Connection ───────────────────────────────────── */}
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
                  <option value="">No venue connected</option>
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
                  Connect a new venue
                </Link>
              </div>
            )}
            {venues && venues.length > 0 && (
              <Link
                href="/services"
                className="inline-block mt-2 text-[12px] underline"
                style={{ color: "var(--color-vl-brass2)" }}
              >
                Connect a new venue
              </Link>
            )}
          </div>

          {/* ── Voice ────────────────────────────────────────── */}
          <fieldset>
            <legend className="vl-eyebrow block mb-3">Voice</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {VOICES.map((v) => (
                <VoiceOption
                  key={v.id}
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
                    <option value="quiet">Quiet</option>
                    <option value="bar">Bar</option>
                    <option value="loud">Loud</option>
                    <option value="outdoor">Outdoor</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "var(--color-vl-ink-faint)" }}
                  />
                </div>
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

              <label className="block">
                <span className="vl-eyebrow block mb-1.5">
                  Voice pipeline provider
                </span>
                <input
                  value={voicePipelineProvider}
                  readOnly
                  className="vl-input"
                  style={{ opacity: 0.6 }}
                />
              </label>

              <label className="block">
                <span className="vl-eyebrow block mb-1.5">Personality</span>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="Optional personality instructions..."
                  className="vl-input"
                  rows={3}
                  style={{ height: "auto", padding: "12px 16px" }}
                />
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
            disabled={saving || !name.trim()}
            className="vl-btn-primary w-full inline-flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> Create assistant
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

function VoiceOption({
  voiceId,
  label,
  gender,
  selected,
  onSelect,
}: {
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
      const url = `/api/v1/voice-pipelines/openai_realtime_webrtc/sample?voice=${encodeURIComponent(voiceId)}`;
      const res = await fetch(url);
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
      fallbackBrowserVoice(voiceId);
    }
  }

  function fallbackBrowserVoice(voiceName: string) {
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
