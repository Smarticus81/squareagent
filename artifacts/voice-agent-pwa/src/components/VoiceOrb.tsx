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
 * Rules of the design:
 *   • When the assistant is speaking AND audio is flowing, bars rise from FFT
 *     bands of the remote MediaStream. The wave is the speech, in real time.
 *   • In every other state — idle, wake, listening, thinking, connecting,
 *     error, or "speaking with no audio yet" — bars sit at a flat baseline.
 *     No procedural sine waves, no fake breathing. Silence is silent.
 *   • A faint thinking pulse (one bar travels across the row) is the only
 *     non-audio motion, and only during `thinking` / `connecting`, to signal
 *     liveness without imitating speech.
 *
 * Visually: 9 vertical capsule bars in a pastel rainbow gradient. No halo,
 * no reflection, no accent dots — the bars are the entire object.
 */

const BAR_COUNT = 9;
// Symmetric pastel rainbow: low energy on the edges, hottest in the middle.
const BAR_COLORS: Array<[string, string]> = [
  ["#7FCBF2", "#4FB1E8"], // sky
  ["#8C9CF0", "#5F73E0"], // indigo
  ["#B58CE6", "#8E64D8"], // purple
  ["#FF7AB6", "#FF4D8A"], // pink
  ["#FF6B47", "#E04323"], // coral (center)
  ["#FF7AB6", "#FF4D8A"],
  ["#B58CE6", "#8E64D8"],
  ["#8C9CF0", "#5F73E0"],
  ["#7FCBF2", "#4FB1E8"],
];

const VB_W = 240;
const VB_H = 120;
const CY = VB_H / 2;
const BAR_W = 8;
const GAP = 10;
const TOTAL_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
const X_START = (VB_W - TOTAL_W) / 2;
const FLAT_H = 5; // resting bar height = flat line of capsules
const MAX_H = 84; // tallest peak (top half)

export function VoiceOrb({ state, remoteStream, onTap, size = 240 }: Props) {
  const uid = useId().replace(/[:]/g, "");

  const rootRef = useRef<HTMLButtonElement | null>(null);
  const barRefs = useRef<Array<SVGRectElement | null>>([]);

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
        // travelling shimmer (~6px peak) so the surface still reads as
        // "alive" without imitating speech.
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
        const top = barRefs.current[i];
        if (top) {
          // Symmetric capsule: grows up AND down from baseline so flat
          // looks like a perfectly balanced equalizer line.
          top.setAttribute("y", String(CY - h / 2));
          top.setAttribute("height", String(h));
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

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onTap}
      className={`orb orb-${state}`}
      style={{ width: dimW, height: dimH, background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
      aria-label="Voice surface"
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width={dimW} height={dimH} aria-hidden>
        <defs>
          {BAR_COLORS.map(([light, dark], i) => (
            <linearGradient key={i} id={`bar-${uid}-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={light} />
              <stop offset="100%" stopColor={dark} />
            </linearGradient>
          ))}
        </defs>
        <g>
          {BAR_COLORS.map((_, i) => (
            <rect
              key={i}
              ref={(el) => { barRefs.current[i] = el; }}
              x={X_START + i * (BAR_W + GAP)}
              y={CY - FLAT_H / 2}
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
