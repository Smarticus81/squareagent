import { useEffect, useRef, useState } from "react";

type OrbState = "idle" | "wake" | "listening" | "thinking" | "speaking" | "connecting" | "error";

interface Props {
  state: OrbState;
  remoteStream: MediaStream | null;
  onTap?: () => void;
  size?: number;
}

/**
 * VoiceOrb — circular voice surface, scales with TTS amplitude.
 * - When state === "speaking" and remoteStream is present, attaches an
 *   AnalyserNode and animates ring scale + glow proportional to RMS.
 * - Other states use deterministic CSS animations.
 */
export function VoiceOrb({ state, remoteStream, onTap, size = 220 }: Props) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Wire up analyzer when stream arrives
  useEffect(() => {
    if (!remoteStream) {
      teardown();
      setLevel(0);
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      const src = ctx.createMediaStreamSource(remoteStream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.75;
      src.connect(an);
      ctxRef.current = ctx;
      sourceRef.current = src;
      analyzerRef.current = an;

      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        // RMS around 128 midpoint
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        // Boost & clamp into 0..1 with light easing
        const lvl = Math.min(1, Math.pow(rms * 3.4, 0.85));
        setLevel(lvl);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn("[VoiceOrb] analyzer setup failed", e);
    }
    return teardown;

    function teardown() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try { sourceRef.current?.disconnect(); } catch {}
      try { analyzerRef.current?.disconnect(); } catch {}
      try { void ctxRef.current?.close(); } catch {}
      sourceRef.current = null;
      analyzerRef.current = null;
      ctxRef.current = null;
    }
  }, [remoteStream]);

  // Decay level when not speaking so orb settles
  useEffect(() => {
    if (state === "speaking") return;
    setLevel(0);
  }, [state]);

  // Reactive scale + glow values
  const baseScale = 1;
  const ampScale = state === "speaking" ? 1 + level * 0.18 : 1;
  const glowAlpha =
    state === "speaking"   ? 0.35 + level * 0.45 :
    state === "listening"  ? 0.55 :
    state === "thinking"   ? 0.45 :
    state === "connecting" ? 0.35 :
    state === "wake"       ? 0.50 :
    state === "error"      ? 0.55 : 0.20;

  const accent =
    state === "speaking"   ? "var(--brand)" :
    state === "listening"  ? "var(--brand)" :
    state === "thinking"   ? "var(--amber)" :
    state === "error"      ? "var(--danger)" :
    state === "connecting" ? "var(--brand-strong)" :
    state === "wake"       ? "var(--brand)" :
    "var(--muted-2)";

  const stateClass = `orb orb-${state}`;

  return (
    <button
      type="button"
      className={stateClass}
      onClick={onTap}
      style={{
        width: size,
        height: size,
        // CSS custom props consumed below
        ["--orb-scale" as any]: baseScale,
        ["--orb-amp" as any]: ampScale,
        ["--orb-glow" as any]: glowAlpha,
        ["--orb-accent" as any]: accent,
      }}
      aria-label="Voice surface"
    >
      <span className="orb-glow" />
      <span className="orb-ring orb-ring-3" />
      <span className="orb-ring orb-ring-2" />
      <span className="orb-ring orb-ring-1" />
      <span className="orb-core" />
      <span className="orb-shimmer" />
    </button>
  );
}
