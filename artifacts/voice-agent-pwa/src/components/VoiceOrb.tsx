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
 * VoiceOrb — pure waveform that mirrors the assistant's actual speech output.
 *
 * Rules of the design (unchanged):
 *   • When the assistant is speaking AND audio is flowing, bars rise from FFT
 *     bands of the remote MediaStream. The wave is the speech, in real time.
 *   • In every other state — idle, wake, listening, thinking, connecting,
 *     error, or "speaking with no audio yet" — bars sit at a flat baseline.
 *     No procedural sine waves, no fake breathing. Silence is silent.
 *   • A faint thinking pulse is the only non-audio motion, and only during
 *     `thinking` / `connecting`, to signal liveness without imitating speech.
 *
 * Visual layer aligned with the VoyceLab brand orb (see voycelab-landing's
 * voice-orb.tsx): 9 capsule bars on a left-to-right pastel rainbow ramp
 * (orange → pink → violet → blue), standing on a baseline over a soft
 * peach/lilac halo, with a faded mirror reflection below and warm/cool
 * accent dots closing each end.
 *
 * Bars grow UPWARD from the baseline (not symmetric about centre) so the
 * reflection reads as a real reflection.
 */

const BAR_COUNT = 9;

/** Hospitality spectrum: honey and coral resolve into plum, indigo, and sage. */
const BAR_COLORS: Array<[string, string]> = [
  ["#FBD393", "#E7A94D"], // honey
  ["#FFC7B1", "#FF9B82"], // peach
  ["#FF9B82", "#FF6B47"], // coral
  ["#FF8EAF", "#E85E86"], // rose
  ["#C59BEA", "#9C69D4"], // plum
  ["#B9B1FF", "#7C6EF5"], // violet
  ["#98A8E8", "#6679C8"], // dusk
  ["#BFD8C5", "#79AD88"], // sage
  ["#9CCDC2", "#5EAA9B"], // sea glass
];

const DOT_LEFT = "#FF6B47";
const DOT_RIGHT = "#7C6EF5";

const VB_W = 240;
const VB_H = 150;
const BAR_W = 8;
const GAP = 10;
const DOT_R = 4.5;
const DOT_GAP = 11;

const BASE_Y = 100; // bars stand on this line; reflection falls below it
const FLAT_H = 5; // resting bar height = flat line of capsules
const MAX_H = 84; // tallest peak
const REFLECT_RATIO = 0.5; // reflection height relative to the bar

const TOTAL_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
const X_START = (VB_W - TOTAL_W) / 2;

export function VoiceOrb({ state, remoteStream, onTap, size = 240 }: Props) {
  const uid = useId().replace(/[:]/g, "");

  const rootRef = useRef<HTMLButtonElement | null>(null);
  const barRefs = useRef<Array<SVGRectElement | null>>([]);
  const reflRefs = useRef<Array<SVGRectElement | null>>([]);

  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const freqBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const stateRef = useRef<OrbState>(state);
  const heightsRef = useRef<number[]>(new Array(BAR_COUNT).fill(FLAT_H));

  useEffect(() => {
    if ((state === "speaking" || state === "thinking" || state === "connecting") && ctxRef.current?.state === "suspended") {
      void ctxRef.current.resume().catch(() => {});
    }
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
      an.smoothingTimeConstant = 0.78;
      src.connect(an);
      void ctx.resume().catch(() => {});
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

  // Single rAF loop drives bar heights via direct DOM mutation.
  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const s = stateRef.current;
      const heights = heightsRef.current;
      const targets = new Array<number>(BAR_COUNT);

      const an = analyserRef.current;
      const buf = freqBufRef.current;

      // Only one condition produces real motion: assistant is speaking AND
      // its audio stream is actually putting energy on the wire.
      let drivingFromAudio = false;
      if (s === "speaking" && an && buf) {
        an.getByteFrequencyData(buf);
        const n = buf.length;
        const start = 2;
        const end = Math.min(n, Math.floor(n * 0.6));
        const span = Math.max(1, end - start);
        // Quick gate: ignore noise floor. If the loudest bin is below this,
        // treat it as silence and let bars relax to flat.
        let max = 0;
        for (let j = start; j < end; j++) if (buf[j] > max) max = buf[j];
        if (max > 18) {
          drivingFromAudio = true;
          for (let i = 0; i < BAR_COUNT; i++) {
            const a = start + Math.floor((i / BAR_COUNT) * span);
            const b = start + Math.floor(((i + 1) / BAR_COUNT) * span);
            let peak = 0;
            for (let j = a; j < b; j++) if (buf[j] > peak) peak = buf[j];
            const v = Math.min(1, Math.pow(peak / 255, 0.62) * 1.25);
            targets[i] = FLAT_H + v * (MAX_H - FLAT_H);
          }
        }
      }

      if (!drivingFromAudio) {
        // Default = flat. The "thinking"/"connecting" states get a tiny
        // travelling shimmer so the surface still reads as "alive" without
        // imitating speech.
        const showShimmer = s === "thinking" || s === "connecting";
        const peak = showShimmer ? 12 : 0;
        const headIdx = showShimmer ? (t * 2.4) % BAR_COUNT : -1;
        for (let i = 0; i < BAR_COUNT; i++) {
          if (showShimmer) {
            const dist = Math.min(
              Math.abs(i - headIdx),
              Math.abs(i - headIdx + BAR_COUNT),
              Math.abs(i - headIdx - BAR_COUNT),
            );
            const falloff = Math.max(0, 1 - dist / 2.2);
            targets[i] = FLAT_H + peak * falloff;
          } else {
            targets[i] = FLAT_H;
          }
        }
      }

      // Smooth toward target. Faster attack when audio drives, slower when
      // relaxing back to flat — feels natural.
      const k = drivingFromAudio ? 0.32 : 0.12;
      for (let i = 0; i < BAR_COUNT; i++) {
        heights[i] += (targets[i] - heights[i]) * k;
        const h = Math.max(FLAT_H, heights[i]);

        // Bar stands on the baseline and grows upward.
        const top = barRefs.current[i];
        if (top) {
          top.setAttribute("y", String(BASE_Y - h));
          top.setAttribute("height", String(h));
        }
        // Reflection hangs below the baseline, at a fraction of the height.
        const refl = reflRefs.current[i];
        if (refl) {
          refl.setAttribute("height", String(Math.max(FLAT_H, h * REFLECT_RATIO)));
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  const dimW = Math.round(size);
  const dimH = Math.round(size * (VB_H / VB_W));

  const barX = (i: number) => X_START + i * (BAR_W + GAP);

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onTap}
      className={`orb orb-${state}`}
      style={{ width: dimW, height: dimH, background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
      aria-label="Voice surface"
    >
      <svg className="orb-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} width={dimW} height={dimH} aria-hidden>
        <defs>
          {BAR_COLORS.map(([light, dark], i) => (
            <linearGradient key={i} id={`bar-${uid}-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={light} />
              <stop offset="100%" stopColor={dark} />
            </linearGradient>
          ))}

          {/* Soft brand halo sitting behind the wave. */}
          <radialGradient id={`halo-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FBD393" stopOpacity="0.48" />
            <stop offset="32%" stopColor="#FFC7B1" stopOpacity="0.42" />
            <stop offset="60%" stopColor="#CFC8FF" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#BFD8C5" stopOpacity="0" />
          </radialGradient>
          <filter id={`haloblur-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>

          {/* Reflection fades out as it falls away from the baseline. */}
          <linearGradient id={`reflfade-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.34" />
            <stop offset="70%" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`reflmask-${uid}`} maskUnits="userSpaceOnUse" x="0" y={BASE_Y} width={VB_W} height={VB_H - BASE_Y}>
            <rect x="0" y={BASE_Y} width={VB_W} height={VB_H - BASE_Y} fill={`url(#reflfade-${uid})`} />
          </mask>
        </defs>

        {/* Halo */}
        <ellipse
          cx={VB_W / 2}
          cy={BASE_Y - 26}
          rx={TOTAL_W * 0.78}
          ry={62}
          fill={`url(#halo-${uid})`}
          filter={`url(#haloblur-${uid})`}
        />

        {/* Mirrored reflection, scaled and faded below the baseline */}
        <g mask={`url(#reflmask-${uid})`}>
          {BAR_COLORS.map((_, i) => (
            <rect
              key={i}
              ref={(el) => { reflRefs.current[i] = el; }}
              x={barX(i)}
              y={BASE_Y + 4}
              width={BAR_W}
              height={FLAT_H}
              rx={BAR_W / 2}
              ry={BAR_W / 2}
              fill={`url(#bar-${uid}-${i})`}
            />
          ))}
        </g>

        {/* Accent dots closing each end of the wave */}
        <circle cx={X_START - DOT_GAP} cy={BASE_Y - DOT_R} r={DOT_R} fill={DOT_LEFT} />
        <circle cx={X_START + TOTAL_W + DOT_GAP} cy={BASE_Y - DOT_R} r={DOT_R} fill={DOT_RIGHT} />

        {/* The wave itself */}
        <g>
          {BAR_COLORS.map((_, i) => (
            <rect
              key={i}
              ref={(el) => { barRefs.current[i] = el; }}
              x={barX(i)}
              y={BASE_Y - FLAT_H}
              width={BAR_W}
              height={FLAT_H}
              rx={BAR_W / 2}
              ry={BAR_W / 2}
              fill={`url(#bar-${uid}-${i})`}
            />
          ))}
        </g>
      </svg>
    </button>
  );
}
