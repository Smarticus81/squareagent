import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DemoAgentState } from "@/hooks/use-voycelab-demo-realtime";

export type VoiceOrbState = "idle" | "requesting" | "listening" | "denied" | "error";

export interface VoiceOrbProps {
  size?: number;
  /** Retained for backward-compat with previous Three.js implementation. */
  particleCount?: number;
  outputStream?: MediaStream | null;
  agentState?: DemoAgentState;
  onListenStart?: (stream: MediaStream) => void;
  onListenStop?: () => void;
  className?: string;
  label?: string;
  externalError?: string | null;
}

/**
 * Landing-page demo orb: pastel rainbow waveform on a soft glowing halo.
 *
 * Visual language matches the PWA + iOS orbs (single shared identity across
 * web/PWA/native). When idle, bars roll in a gentle wave; while connecting or
 * thinking they pulse; when the agent is speaking the bars react to FFT of
 * `outputStream`.
 */

const BAR_COUNT = 9;
const BAR_COLORS: Array<[string, string]> = [
  ["#FFB37A", "#FF9A5C"],
  ["#FFA08A", "#FF7A6B"],
  ["#FF8FA8", "#FF5C82"],
  ["#FF7DC0", "#E94CA0"],
  ["#E382E0", "#C45CC8"],
  ["#B58CE6", "#8E64D8"],
  ["#8C9CF0", "#5F73E0"],
  ["#7AB7F0", "#4F95D8"],
  ["#7FD2F0", "#4FB7E8"],
];

export function VoiceOrb({
  size = 320,
  outputStream,
  agentState = "idle",
  onListenStart,
  onListenStop,
  className,
  label,
  externalError,
}: VoiceOrbProps) {
  const [state, setState] = useState<VoiceOrbState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uid = useId().replace(/[:]/g, "");

  const haloRef = useRef<SVGEllipseElement | null>(null);
  const barRefs = useRef<Array<SVGRectElement | null>>([]);
  const reflRefs = useRef<Array<SVGRectElement | null>>([]);
  const dotLeftRef = useRef<SVGCircleElement | null>(null);
  const dotRightRef = useRef<SVGCircleElement | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const heightsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0.15));
  const energyRef = useRef(0.1);
  const agentStateRef = useRef<DemoAgentState>(agentState);
  const stateRef = useRef<VoiceOrbState>(state);

  useEffect(() => { agentStateRef.current = agentState; }, [agentState]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const stopMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    micStreamRef.current = null;
  }, []);

  const stopOutputAnalyser = useCallback(() => {
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    sourceRef.current = null;
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    freqRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopMic();
    setState("idle");
    setErrorMessage(null);
    onListenStop?.();
  }, [onListenStop, stopMic]);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("denied");
      setErrorMessage("This browser does not expose microphone access.");
      return;
    }
    setState("requesting");
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;
      setState("listening");
      onListenStart?.(stream);
    } catch (err) {
      stopMic();
      const message = err instanceof Error ? err.message : "Could not access microphone";
      const denied = err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setState(denied ? "denied" : "error");
      setErrorMessage(denied ? "Microphone access blocked. Allow it in your browser to use the demo." : message);
    }
  }, [onListenStart, stopMic]);

  // Wire FFT analyser to the assistant's output stream
  useEffect(() => {
    stopOutputAnalyser();
    if (!outputStream || outputStream.getAudioTracks().length === 0) return;
    if (typeof window === "undefined") return;
    try {
      const Ctx: typeof AudioContext = window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(outputStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      sourceRef.current = source;
      analyserRef.current = analyser;
      freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    } catch {
      stopOutputAnalyser();
    }
    return () => stopOutputAnalyser();
  }, [outputStream, stopOutputAnalyser]);

  // Cleanup on unmount
  useEffect(() => () => { stopMic(); stopOutputAnalyser(); }, [stopMic, stopOutputAnalyser]);

  // Master rAF loop
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const ag = agentStateRef.current;
      const s = stateRef.current;
      const heights = heightsRef.current;
      const targets = new Array<number>(BAR_COUNT);

      const an = analyserRef.current;
      const buf = freqRef.current;
      const speaking = ag === "speaking" || ag === "thinking";

      if (an && buf && speaking) {
        an.getByteFrequencyData(buf);
        const n = buf.length;
        const start = 2;
        const end = Math.min(n, Math.floor(n * 0.6));
        const span = Math.max(1, end - start);
        for (let i = 0; i < BAR_COUNT; i++) {
          const a = start + Math.floor((i / BAR_COUNT) * span);
          const b = start + Math.floor(((i + 1) / BAR_COUNT) * span);
          let peak = 0;
          for (let j = a; j < b; j++) if (buf[j] > peak) peak = buf[j];
          const v = Math.min(1, Math.pow(peak / 255, 0.62) * 1.25);
          targets[i] = 0.18 + v * 0.78;
        }
      } else {
        // Procedural per-state wave
        const isListening = s === "listening" || ag === "listening";
        const isConnecting = ag === "connecting" || s === "requesting";
        const base = isListening ? 0.34 : isConnecting ? 0.3 : 0.18;
        const amp = isListening ? 0.22 : isConnecting ? 0.18 : 0.12;
        const speed = isListening ? 2.6 : isConnecting ? 2.2 : 1.2;
        for (let i = 0; i < BAR_COUNT; i++) {
          const phase = (i / BAR_COUNT) * Math.PI * 2;
          const wave = Math.sin(t * speed + phase) * 0.5 + 0.5;
          const detail = Math.sin(t * speed * 0.55 + phase * 1.6) * 0.16;
          targets[i] = Math.max(0.06, base + (wave + detail) * amp);
        }
      }

      const k = 0.26;
      let avg = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        heights[i] += (targets[i] - heights[i]) * k;
        avg += heights[i];
      }
      avg /= BAR_COUNT;
      energyRef.current += (avg - energyRef.current) * 0.18;

      // viewBox 320x320; baseline at y=160
      const cy = 160;
      const maxH = 130;
      const barWidth = 11;
      const gap = 11;
      const totalWidth = BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap;
      const xStart = 160 - totalWidth / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        const h = Math.max(6, heights[i] * maxH);
        const top = barRefs.current[i];
        if (top) {
          top.setAttribute("y", String(cy - h));
          top.setAttribute("height", String(h));
          top.setAttribute("x", String(xStart + i * (barWidth + gap)));
        }
        const ref = reflRefs.current[i];
        if (ref) {
          const rh = h * 0.55;
          ref.setAttribute("y", String(cy + 4));
          ref.setAttribute("height", String(rh));
          ref.setAttribute("x", String(xStart + i * (barWidth + gap)));
        }
      }

      const halo = haloRef.current;
      if (halo) {
        const e = energyRef.current;
        halo.setAttribute("rx", String(130 + e * 22));
        halo.setAttribute("ry", String(96 + e * 18));
        halo.setAttribute("opacity", String(0.7 + e * 0.3));
      }

      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      if (dotLeftRef.current) dotLeftRef.current.setAttribute("r", String(5 + pulse * 1.4));
      if (dotRightRef.current) dotRightRef.current.setAttribute("r", String(5 + (1 - pulse) * 1.4));

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = useCallback(() => {
    if (state === "listening" || state === "requesting") stop();
    else void start();
  }, [state, start, stop]);

  const ariaLabel =
    label ??
    (state === "listening" ? "Voice demo is listening. Click to stop." : "Voice demo. Click to start talking.");

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            toggle();
          }
        }}
        aria-label={ariaLabel}
        aria-pressed={state === "listening"}
        className="absolute inset-0 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-vl-accent) focus-visible:ring-offset-4 focus-visible:ring-offset-white"
        style={{ background: "transparent", border: 0, padding: 0 }}
      >
        <svg
          viewBox="0 0 320 320"
          width={size}
          height={size}
          aria-hidden
          style={{ display: "block" }}
        >
          <defs>
            <radialGradient id={`halo-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFD8C2" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#FFB7D0" stopOpacity="0.75" />
              <stop offset="60%" stopColor="#C9B8EE" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#A6D5F2" stopOpacity="0" />
            </radialGradient>

            {BAR_COLORS.map(([light, dark], i) => (
              <linearGradient key={i} id={`bar-${uid}-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={light} />
                <stop offset="100%" stopColor={dark} />
              </linearGradient>
            ))}

            <linearGradient id={`refl-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.4" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <mask id={`reflmask-${uid}`}>
              <rect x="0" y="160" width="320" height="160" fill={`url(#refl-${uid})`} />
            </mask>

            <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <ellipse
            ref={haloRef}
            cx="160"
            cy="160"
            rx="130"
            ry="96"
            fill={`url(#halo-${uid})`}
            style={{ mixBlendMode: "screen" }}
          />

          <g filter={`url(#glow-${uid})`}>
            {BAR_COLORS.map((_, i) => (
              <rect
                key={`top-${i}`}
                ref={(el) => { barRefs.current[i] = el; }}
                x="0"
                y="120"
                width="11"
                height="40"
                rx="5.5"
                ry="5.5"
                fill={`url(#bar-${uid}-${i})`}
              />
            ))}
          </g>

          <g mask={`url(#reflmask-${uid})`}>
            {BAR_COLORS.map((_, i) => (
              <rect
                key={`refl-${i}`}
                ref={(el) => { reflRefs.current[i] = el; }}
                x="0"
                y="164"
                width="11"
                height="22"
                rx="5.5"
                ry="5.5"
                fill={`url(#bar-${uid}-${i})`}
              />
            ))}
          </g>

          <circle ref={dotLeftRef} cx="32" cy="160" r="5" fill="#FF8A4A" />
          <circle ref={dotRightRef} cx="288" cy="160" r="5" fill="#5FB7E8" />
        </svg>
      </button>

      {(((state === "denied" || state === "error") && errorMessage) || externalError) && (
        <p
          className="absolute left-1/2 top-[calc(100%+12px)] w-65 -translate-x-1/2 text-center text-[11.5px] leading-relaxed"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          {externalError ?? errorMessage}
        </p>
      )}
    </div>
  );
}
