import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type VoiceOrbState =
  | "idle"
  | "requesting"
  | "listening"
  | "denied"
  | "error";

export interface VoiceOrbProps {
  /** Pixel diameter of the orb's outer ring container. Defaults to 220. */
  size?: number;
  /** Number of frequency bars rendered inside the orb. Defaults to 24. */
  barCount?: number;
  /**
   * Optional callback fired when the orb successfully attaches to the user's
   * microphone. Receives the live MediaStream so callers can pipe it into a
   * realtime session (e.g. on /command).
   */
  onListenStart?: (stream: MediaStream) => void;
  /** Optional callback fired when the orb stops listening. */
  onListenStop?: () => void;
  /** Optional className passed to the outer wrapper. */
  className?: string;
  /** Optional ARIA label override. */
  label?: string;
  /** Optional error surfaced by a parent realtime session using the orb stream. */
  externalError?: string | null;
}

/**
 * VoiceOrb — the brand's central voice surface.
 *
 * Renders a hospitality-themed sphere (peach + lilac + coral wash) with a
 * live audio-reactive waveform inside. Click to grant microphone access;
 * the orb's bars and outer glow react to the user's actual voice in real
 * time using the Web Audio API. Click again to release the mic.
 *
 * No simulation: the visualisation is driven by an AnalyserNode wired
 * directly to a getUserMedia() audio track. When permission is denied the
 * orb falls back to a calm idle pulse and surfaces a helpful message.
 */
export function VoiceOrb({
  size = 220,
  barCount = 24,
  onListenStart,
  onListenStop,
  className,
  label,
  externalError,
}: VoiceOrbProps) {
  const [state, setState] = useState<VoiceOrbState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => new Array(barCount).fill(0));
  const [averageLevel, setAverageLevel] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const teardown = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        /* node may already be closed */
      }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        /* node may already be closed */
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      try {
        if (ctx.state !== "closed") void ctx.close();
      } catch {
        /* nothing to do */
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      });
      streamRef.current = null;
    }
    dataArrayRef.current = null;
    setLevels(new Array(barCount).fill(0));
    setAverageLevel(0);
  }, [barCount]);

  const stop = useCallback(() => {
    teardown();
    setState("idle");
    setErrorMessage(null);
    onListenStop?.();
  }, [teardown, onListenStop]);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setState("denied");
      setErrorMessage("This browser does not expose microphone access.");
      return;
    }

    setState("requesting");
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioContextCtor();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      analyserRef.current = analyser;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(new ArrayBuffer(bufferLength));
      dataArrayRef.current = dataArray;

      const lowerBound = 2; // skip the very lowest frequency bin (DC noise)
      const upperBound = Math.min(bufferLength - 1, Math.floor(bufferLength * 0.5));
      const usableBins = Math.max(1, upperBound - lowerBound);

      const tick = () => {
        const a = analyserRef.current;
        const buf = dataArrayRef.current;
        if (!a || !buf) return;
        a.getByteFrequencyData(buf);

        const next = new Array<number>(barCount);
        let total = 0;
        for (let i = 0; i < barCount; i += 1) {
          const startBin = lowerBound + Math.floor((i / barCount) * usableBins);
          const endBin = Math.max(
            startBin + 1,
            lowerBound + Math.floor(((i + 1) / barCount) * usableBins),
          );
          let max = 0;
          for (let b = startBin; b < endBin; b += 1) {
            const v = buf[b] ?? 0;
            if (v > max) max = v;
          }
          const normalized = max / 255;
          // Slight perceptual boost to make whispers visible
          const shaped = Math.pow(normalized, 0.7);
          next[i] = shaped;
          total += shaped;
        }
        setLevels(next);
        setAverageLevel(total / barCount);

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
      setState("listening");
      onListenStart?.(stream);
    } catch (err) {
      teardown();
      const message = err instanceof Error ? err.message : "Could not access microphone";
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setState(denied ? "denied" : "error");
      setErrorMessage(
        denied
          ? "Microphone access blocked. Allow it in your browser to hear the orb listen."
          : message,
      );
    }
  }, [barCount, onListenStart, teardown]);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  const toggle = useCallback(() => {
    if (state === "listening" || state === "requesting") {
      stop();
    } else {
      void start();
    }
  }, [state, start, stop]);

  const isListening = state === "listening";
  const isRequesting = state === "requesting";

  // Outer halo intensity reacts to overall volume when listening, otherwise
  // breathes gently as ambient idle motion via CSS keyframes.
  const haloOpacity = isListening
    ? Math.min(1, 0.45 + averageLevel * 0.9)
    : 0.6;
  const sphereScale = isListening ? 1 + Math.min(0.07, averageLevel * 0.18) : 1;

  // Idle "breathing" — a slow sine driven by the page clock so reduced-motion
  // viewers still see a stable calm sphere.
  const [idleBreath, setIdleBreath] = useState(0);
  useEffect(() => {
    if (isListening) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      setIdleBreath((Math.sin(t * 1.1) + 1) / 2);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isListening]);

  const idleScale = 1 + idleBreath * 0.025;
  const idleHalo = 0.45 + idleBreath * 0.25;

  const sphereDiameter = Math.round(size * 0.82);
  const haloDiameter = Math.round(size * 1.18);

  const ariaLabel =
    label ??
    (isListening
      ? "Voice orb is listening. Click to stop."
      : "Voice orb. Click to start listening.");

  const idleBars = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => {
        const center = (barCount - 1) / 2;
        const distance = Math.abs(i - center) / center;
        return 0.35 + (1 - distance) * 0.45;
      }),
    [barCount],
  );

  return (
    <div
      className={cn("relative inline-flex flex-col items-center", className)}
      style={{ width: size, height: size }}
    >
      {/* Outer halo */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 rounded-full pointer-events-none transition-opacity duration-200"
        style={{
          width: haloDiameter,
          height: haloDiameter,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle at 50% 50%, rgba(255, 138, 102, 0.45), rgba(199, 183, 229, 0.30) 45%, transparent 72%)",
          filter: "blur(28px)",
          opacity: isListening ? haloOpacity : idleHalo,
        }}
      />

      {/* Outer ring */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
        style={{
          width: haloDiameter,
          height: haloDiameter,
          transform: "translate(-50%, -50%)",
          border: "1px solid rgba(14, 27, 44, 0.08)",
        }}
      />

      {/* Sphere */}
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        aria-label={ariaLabel}
        aria-pressed={isListening}
        className="absolute left-1/2 top-1/2 rounded-full focus:outline-none cursor-pointer group"
        style={{
          width: sphereDiameter,
          height: sphereDiameter,
          transform: `translate(-50%, -50%) scale(${isListening ? sphereScale : idleScale})`,
          transition: isListening ? "transform 80ms ease-out" : "transform 600ms ease-in-out",
          background:
            "radial-gradient(circle at 30% 28%, rgba(255, 222, 200, 0.92), rgba(255, 169, 138, 0.85) 30%, rgba(199, 183, 229, 0.78) 65%, rgba(255, 107, 71, 0.55) 100%)",
          boxShadow:
            "0 30px 80px rgba(255, 107, 71, 0.22), 0 8px 28px rgba(199, 183, 229, 0.30), inset 0 0 60px rgba(255, 255, 255, 0.32), inset 0 -16px 40px rgba(255, 107, 71, 0.20)",
          border: "1px solid rgba(255, 255, 255, 0.55)",
        }}
      >
        {/* Specular highlight */}
        <span
          aria-hidden
          className="absolute inset-2 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.85), rgba(255,255,255,0.05) 55%, transparent 70%)",
            filter: "blur(0.5px)",
          }}
        />

        {/* Waveform bars */}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center gap-[3px]"
        >
          {(isListening ? levels : idleBars).map((value, i) => {
            const minHeight = 6;
            const maxHeight = sphereDiameter * 0.34;
            const heightPx = isListening
              ? minHeight + value * maxHeight
              : minHeight + (idleBars[i] ?? 0.5) * maxHeight * (0.55 + idleBreath * 0.4);
            return (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: 3,
                  height: `${heightPx}px`,
                  background: "rgba(255, 255, 255, 0.95)",
                  boxShadow: "0 0 8px rgba(255, 255, 255, 0.55)",
                  transition: isListening ? "height 60ms ease-out" : "height 160ms ease-in-out",
                }}
              />
            );
          })}
        </span>

        {/* Loading shimmer when requesting permission */}
        {isRequesting && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.45) 60deg, rgba(255,255,255,0) 120deg, rgba(255,255,255,0) 360deg)",
              animation: "vl-orbit-spin 1.4s linear infinite",
              maskImage: "radial-gradient(circle, transparent 60%, black 62%, black 100%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 60%, black 62%, black 100%)",
            }}
          />
        )}
      </button>

      {/* CTA pill below the orb */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top: `calc(50% + ${sphereDiameter / 2 + 18}px)` }}
      >
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-all",
            "shadow-[0_8px_22px_-10px_rgba(255,107,71,0.55)]",
          )}
          style={{
            background: isListening
              ? "linear-gradient(180deg, #FFFFFF, #FFF1EB)"
              : "linear-gradient(180deg, #FF7E5C, #ED5331)",
            color: isListening ? "var(--color-vl-coral-deep)" : "#FFFFFF",
            border: isListening
              ? "1px solid rgba(255, 107, 71, 0.30)"
              : "1px solid rgba(237, 83, 49, 0.40)",
          }}
        >
          {isListening ? (
            <>
              <MicOff className="w-3.5 h-3.5" />
              Stop listening
            </>
          ) : isRequesting ? (
            <>
              <Mic className="w-3.5 h-3.5" />
              Requesting microphone…
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5" />
              Tap to talk
            </>
          )}
        </button>

        {((state === "denied" || state === "error") && errorMessage || externalError) && (
          <p
            className="mt-2 max-w-[260px] mx-auto text-center text-[11.5px] leading-relaxed"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            {externalError ?? errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
