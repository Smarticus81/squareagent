import { useEffect, useId, useRef } from "react";

type OrbState =
  | "idle"
  | "wake"
  | "listening"
  | "thinking"
  | "speaking"
  | "connecting"
  | "error";

interface Props {
  state: OrbState;
  remoteStream: MediaStream | null;
  onTap?: () => void;
  size?: number;
}

/**
 * VoiceOrb — soft pastel rainbow waveform on a glowing halo.
 *
 * Design:
 *   • Round halo behind (peach → coral → pink → lilac → sky)
 *   • 7 vertical capsule bars in pastel rainbow gradient (orange → coral →
 *     magenta → pink → purple → indigo → sky), each mirrored vertically below
 *     the baseline at reduced opacity for a "reflection" feel.
 *   • Two flanking accent dots (warm orange left, cool sky right).
 *   • Bar heights animate from FFT bands of the assistant's audio when
 *     speaking, otherwise from a per-state pseudo-wave (idle breathing,
 *     listening rolling, thinking pulse, etc.).
 *
 * Works on light or dark backgrounds — the halo provides its own glow.
 */

const BAR_COUNT = 7;
// Pastel rainbow palette, left → right
const BAR_COLORS: Array<[string, string]> = [
  ["#FFB37A", "#FF9A5C"], // orange
  ["#FF9AA2", "#FF6B7A"], // coral
  ["#FF7AB6", "#FF4D8A"], // pink-magenta
  ["#E97FD8", "#D158C0"], // magenta
  ["#B58CE6", "#8E64D8"], // purple
  ["#8C9CF0", "#5F73E0"], // indigo
  ["#7FCBF2", "#4FB1E8"], // sky
];

export function VoiceOrb({ state, remoteStream, onTap, size = 240 }: Props) {
  const uid = useId().replace(/[:]/g, "");

  const rootRef = useRef<HTMLButtonElement | null>(null);
  const haloRef = useRef<SVGEllipseElement | null>(null);
  const barRefs = useRef<Array<SVGRectElement | null>>([]);
  const reflRefs = useRef<Array<SVGRectElement | null>>([]);
  const dotLeftRef = useRef<SVGCircleElement | null>(null);
  const dotRightRef = useRef<SVGCircleElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const freqBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const stateRef = useRef<OrbState>(state);
  // Smoothed bar heights 0..1
  const heightsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0.15));
  const energyRef = useRef(0.1);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Connect FFT analyser to the assistant's remote audio stream.
  useEffect(() => {
    if (!remoteStream) return;
    let cancelled = false;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(remoteStream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.7;
      src.connect(an);
      ctxRef.current = ctx;
      sourceRef.current = src;
      analyserRef.current = an;
      freqBufRef.current = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
      if (cancelled) teardownAudio();
    } catch (e) {
      console.warn("[VoiceOrb] analyser setup failed", e);
    }
    return () => {
      cancelled = true;
      teardownAudio();
    };
  }, [remoteStream]);

  function teardownAudio() {
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    try { void ctxRef.current?.close(); } catch { /* ignore */ }
    sourceRef.current = null;
    analyserRef.current = null;
    ctxRef.current = null;
    freqBufRef.current = null;
  }

  // Single rAF loop drives all bar animations via DOM mutation.
  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const s = stateRef.current;
      const heights = heightsRef.current;

      // Compute target heights per bar based on state + audio.
      const targets = new Array<number>(BAR_COUNT);
      const an = analyserRef.current;
      const buf = freqBufRef.current;
      let totalEnergy = 0;

      if (an && buf && (s === "speaking" || s === "listening")) {
        an.getByteFrequencyData(buf);
        const n = buf.length;
        // Map bar index → frequency window (skip very lowest bins)
        const start = 2;
        const end = Math.min(n, Math.floor(n * 0.55));
        const span = Math.max(1, end - start);
        for (let i = 0; i < BAR_COUNT; i++) {
          const a = start + Math.floor((i / BAR_COUNT) * span);
          const b = start + Math.floor(((i + 1) / BAR_COUNT) * span);
          let peak = 0;
          for (let j = a; j < b; j++) if (buf[j] > peak) peak = buf[j];
          const v = Math.min(1, Math.pow(peak / 255, 0.65) * 1.2);
          targets[i] = s === "listening" ? 0.18 + v * 0.35 : 0.2 + v * 0.8;
          totalEnergy += v;
        }
        totalEnergy /= BAR_COUNT;
      } else {
        // Procedural per-state wave — looks alive without audio input.
        const baseByState: Record<OrbState, number> = {
          idle: 0.16,
          wake: 0.45,
          listening: 0.32,
          thinking: 0.5,
          speaking: 0.55,
          connecting: 0.32,
          error: 0.5,
        };
        const ampByState: Record<OrbState, number> = {
          idle: 0.1,
          wake: 0.25,
          listening: 0.18,
          thinking: 0.25,
          speaking: 0.35,
          connecting: 0.25,
          error: 0.22,
        };
        const speedByState: Record<OrbState, number> = {
          idle: 1.1,
          wake: 3.5,
          listening: 2.4,
          thinking: 3.2,
          speaking: 4.6,
          connecting: 2.8,
          error: 5.5,
        };
        const base = baseByState[s];
        const amp = ampByState[s];
        const speed = speedByState[s];
        for (let i = 0; i < BAR_COUNT; i++) {
          // Sine wave with phase offset per bar gives the "rolling wave" feel.
          const phase = (i / BAR_COUNT) * Math.PI * 2;
          const wave = Math.sin(t * speed + phase) * 0.5 + 0.5;
          const detail = Math.sin(t * speed * 0.6 + phase * 1.7) * 0.18;
          targets[i] = Math.max(0.06, base + (wave + detail) * amp);
        }
        totalEnergy = base;
      }

      // Smooth toward target (low-pass)
      const k = 0.28;
      let avg = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        heights[i] += (targets[i] - heights[i]) * k;
        avg += heights[i];
      }
      avg /= BAR_COUNT;
      energyRef.current += (avg - energyRef.current) * 0.18;

      // Apply to DOM
      const cy = 100; // viewBox 200x200, baseline at vertical center
      const maxBarHeight = 86; // tallest bar half (top half + reflection)
      const barWidth = 7;
      const gap = 8;
      const totalWidth = BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap;
      const xStart = 100 - totalWidth / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        const h = Math.max(4, heights[i] * maxBarHeight);
        const top = barRefs.current[i];
        if (top) {
          top.setAttribute("y", String(cy - h));
          top.setAttribute("height", String(h));
          top.setAttribute("x", String(xStart + i * (barWidth + gap)));
        }
        const ref = reflRefs.current[i];
        if (ref) {
          // Reflection: slightly shorter, fades downward via gradient mask.
          const rh = h * 0.55;
          ref.setAttribute("y", String(cy + 2));
          ref.setAttribute("height", String(rh));
          ref.setAttribute("x", String(xStart + i * (barWidth + gap)));
        }
      }

      // Halo breathes with overall energy.
      const halo = haloRef.current;
      if (halo) {
        const e = energyRef.current;
        halo.setAttribute("rx", String(78 + e * 16));
        halo.setAttribute("ry", String(60 + e * 14));
        halo.setAttribute("opacity", String(0.55 + e * 0.35));
      }

      // Accent dots subtle pulse.
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      if (dotLeftRef.current) {
        dotLeftRef.current.setAttribute("r", String(3.4 + pulse * 0.8));
      }
      if (dotRightRef.current) {
        dotRightRef.current.setAttribute("r", String(3.4 + (1 - pulse) * 0.8));
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onTap}
      className={`orb orb-${state}`}
      style={{ width: size, height: size, background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
      aria-label="Voice surface"
    >
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        aria-hidden
      >
        <defs>
          {/* Soft halo gradient */}
          <radialGradient id={`halo-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD8C2" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#FFB7D0" stopOpacity="0.7" />
            <stop offset="70%" stopColor="#C9B8EE" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#A6D5F2" stopOpacity="0" />
          </radialGradient>

          {/* Per-bar vertical gradients */}
          {BAR_COLORS.map(([light, dark], i) => (
            <linearGradient key={i} id={`bar-${uid}-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={light} />
              <stop offset="100%" stopColor={dark} />
            </linearGradient>
          ))}

          {/* Reflection mask: fade to transparent downward */}
          <linearGradient id={`refl-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.38" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={`reflmask-${uid}`}>
            <rect x="0" y="100" width="200" height="100" fill={`url(#refl-${uid})`} />
          </mask>

          {/* Soft glow filter for bars */}
          <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Halo */}
        <ellipse
          ref={haloRef}
          cx="100"
          cy="100"
          rx="82"
          ry="62"
          fill={`url(#halo-${uid})`}
          style={{ mixBlendMode: "screen" }}
        />

        {/* Bars (top) */}
        <g filter={`url(#glow-${uid})`}>
          {BAR_COLORS.map((_, i) => (
            <rect
              key={`top-${i}`}
              ref={(el) => { barRefs.current[i] = el; }}
              x="0"
              y="60"
              width="7"
              height="40"
              rx="3.5"
              ry="3.5"
              fill={`url(#bar-${uid}-${i})`}
            />
          ))}
        </g>

        {/* Bars (reflection) — masked downward fade */}
        <g mask={`url(#reflmask-${uid})`}>
          {BAR_COLORS.map((_, i) => (
            <rect
              key={`refl-${i}`}
              ref={(el) => { reflRefs.current[i] = el; }}
              x="0"
              y="102"
              width="7"
              height="22"
              rx="3.5"
              ry="3.5"
              fill={`url(#bar-${uid}-${i})`}
            />
          ))}
        </g>

        {/* Accent dots */}
        <circle
          ref={dotLeftRef}
          cx="20"
          cy="100"
          r="3.6"
          fill="#FF8A4A"
        />
        <circle
          ref={dotRightRef}
          cx="180"
          cy="100"
          r="3.6"
          fill="#5FB7E8"
        />
      </svg>
    </button>
  );
}
