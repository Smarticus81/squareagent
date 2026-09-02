import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Pause, Play, Volume2 } from "lucide-react";

export interface VoiceChoice {
  id: string;
  label: string;
  tone: string;
  gender: string;
}

const BAR_DELAYS = [0, 0.18, 0.09, 0.27, 0.14];

/**
 * A selectable voice with an inline audio preview. While the sample plays,
 * an equalizer of five bars breathes next to the name — the card itself
 * feels like it is speaking.
 */
export function VoiceCard({
  voice,
  sampleLine,
  selected,
  onSelect,
}: {
  voice: VoiceChoice;
  sampleLine: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const reduced = useReducedMotion();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playState, setPlayState] = useState<"idle" | "loading" | "playing" | "error">("idle");

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = "";
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function toggleSample(e: React.MouseEvent) {
    e.stopPropagation();
    if (playState === "playing") {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      setPlayState("idle");
      return;
    }
    setPlayState("loading");
    try {
      const url = `/api/v1/voice-pipelines/openai_realtime_webrtc/sample?voice=${encodeURIComponent(voice.id)}`;
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
    const utterance = new SpeechSynthesisUtterance(sampleLine);
    utterance.rate = 1.05;
    utterance.onend = () => setPlayState("idle");
    utterance.onerror = () => setPlayState("error");
    const voices = window.speechSynthesis.getVoices();
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    if (en.length > 0) utterance.voice = en[0];
    window.speechSynthesis.speak(utterance);
    setPlayState("playing");
  }

  const isPlaying = playState === "playing";

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileHover={reduced ? undefined : { y: -2 }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
      className="vl-card relative flex w-full items-center gap-4 p-4 text-left sm:p-5"
      style={{
        borderColor: selected ? "rgba(255, 107, 71, 0.55)" : "var(--vl-line)",
        background: selected
          ? "linear-gradient(160deg, #FFF0EA, #FFFFFF)"
          : undefined,
        boxShadow: selected
          ? "0 1px 0 rgba(255,255,255,0.7) inset, 0 14px 34px -22px rgba(229, 79, 45, 0.5)"
          : undefined,
      }}
      aria-pressed={selected}
    >
      {/* Selection tick */}
      <motion.span
        initial={false}
        animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 26 }}
        className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-lg"
        style={{ background: "var(--color-vl-coral)" }}
      >
        <Check className="h-3 w-3 text-white" />
      </motion.span>

      {/* Preview control */}
      <span
        role="button"
        tabIndex={0}
        aria-label={isPlaying ? `Stop ${voice.label} preview` : `Play ${voice.label} preview`}
        onClick={toggleSample}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleSample(e as unknown as React.MouseEvent);
          }
        }}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl transition-colors"
        style={{
          background: isPlaying ? "var(--color-vl-coral)" : "var(--color-vl-coral-tint)",
          color: isPlaying ? "#fff" : "var(--color-vl-coral-deep)",
          border: "1px solid rgba(229, 79, 45, 0.2)",
        }}
      >
        {playState === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : playState === "error" ? (
          <Volume2 className="h-4 w-4" style={{ color: "var(--color-vl-danger)" }} />
        ) : (
          <Play className="h-4 w-4 translate-x-[1px]" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
            {voice.label}
          </span>
          {/* Equalizer — only breathes while the voice is speaking */}
          <span className="flex h-4 items-end gap-[2.5px]" aria-hidden="true">
            {BAR_DELAYS.map((delay, i) => (
              <motion.span
                key={i}
                className="w-[3px] rounded-full"
                style={{
                  background: isPlaying
                    ? "linear-gradient(180deg, #FF6B47, #7C6EF5)"
                    : "var(--vl-line)",
                }}
                initial={false}
                animate={
                  isPlaying && !reduced
                    ? { height: ["30%", "100%", "45%", "85%", "30%"] }
                    : { height: "30%" }
                }
                transition={
                  isPlaying && !reduced
                    ? { duration: 0.9, repeat: Infinity, delay, ease: "easeInOut" }
                    : { duration: 0.2 }
                }
              />
            ))}
          </span>
        </span>
        <span className="mt-0.5 block text-[12.5px]" style={{ color: "var(--color-vl-ink-muted)" }}>
          {voice.tone} · {voice.gender}
        </span>
      </span>
    </motion.button>
  );
}
