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
 * VoiceOrb — fluid, audio-reactive voice surface.
 *
 * - SVG metaball blobs joined via a "goo" filter for organic, mercury-like motion.
 * - Multi-band frequency analysis (bass / mid / treble) drives scale, blob warp,
 *   and inner shimmer so the orb feels physically tied to the assistant's voice.
 * - All per-frame updates are written to DOM refs (no React re-renders).
 */
export function VoiceOrb({ state, remoteStream, onTap, size = 240 }: Props) {
  const uid = useId().replace(/[:]/g, "");
  const gooId = `goo-${uid}`;
  const coreGradId = `core-${uid}`;
  const haloGradId = `halo-${uid}`;
  const dispId = `disp-${uid}`;

  const rootRef = useRef<HTMLButtonElement | null>(null);
  const blobGroupRef = useRef<SVGGElement | null>(null);
  const blobARef = useRef<SVGCircleElement | null>(null);
  const blobBRef = useRef<SVGCircleElement | null>(null);
  const blobCRef = useRef<SVGCircleElement | null>(null);
  const blobDRef = useRef<SVGCircleElement | null>(null);
  const coreRef = useRef<SVGCircleElement | null>(null);
  const sheenRef = useRef<SVGEllipseElement | null>(null);
  const haloRef = useRef<SVGCircleElement | null>(null);
  const turbRef = useRef<SVGFETurbulenceElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const freqBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const bandsRef = useRef({ rms: 0, bass: 0, mid: 0, treble: 0 });
  const stateRef = useRef<OrbState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Wire/unwire analyzer to remote stream
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
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.78;
      src.connect(an);
      ctxRef.current = ctx;
      sourceRef.current = src;
      analyzerRef.current = an;
      freqBufRef.current = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
      timeBufRef.current = new Uint8Array(new ArrayBuffer(an.fftSize));
      if (cancelled) teardownAudio();
    } catch (e) {
      console.warn("[VoiceOrb] analyzer setup failed", e);
    }
    return () => {
      cancelled = true;
      teardownAudio();
    };
  }, [remoteStream]);

  function teardownAudio() {
    try {
      sourceRef.current?.disconnect();
    } catch {}
    try {
      analyzerRef.current?.disconnect();
    } catch {}
    try {
      void ctxRef.current?.close();
    } catch {}
    sourceRef.current = null;
    analyzerRef.current = null;
    ctxRef.current = null;
    freqBufRef.current = null;
    timeBufRef.current = null;
  }

  // Single render loop — animates blobs via DOM mutations (no React re-renders).
  useEffect(() => {
    const t0 = performance.now();

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const s = stateRef.current;

      const bands = bandsRef.current;
      let targetBass = 0;
      let targetMid = 0;
      let targetTreble = 0;
      let targetRms = 0;

      const an = analyzerRef.current;
      const freq = freqBufRef.current;
      const time = timeBufRef.current;
      if (an && freq && time && s === "speaking") {
        an.getByteFrequencyData(freq);
        an.getByteTimeDomainData(time);
        const n = freq.length;
        const bassEnd = Math.floor(n * 0.08);
        const midEnd = Math.floor(n * 0.35);
        let bsum = 0;
        let msum = 0;
        let tsum = 0;
        for (let i = 0; i < bassEnd; i++) bsum += freq[i];
        for (let i = bassEnd; i < midEnd; i++) msum += freq[i];
        for (let i = midEnd; i < n; i++) tsum += freq[i];
        targetBass = bsum / (bassEnd * 255 || 1);
        targetMid = msum / ((midEnd - bassEnd) * 255 || 1);
        targetTreble = tsum / ((n - midEnd) * 255 || 1);
        let sq = 0;
        for (let i = 0; i < time.length; i++) {
          const v = (time[i] - 128) / 128;
          sq += v * v;
        }
        targetRms = Math.min(1, Math.sqrt(sq / time.length) * 2.6);
      } else if (s === "listening") {
        targetBass = 0.18 + Math.sin(t * 1.3) * 0.06;
        targetMid = 0.22 + Math.sin(t * 1.7 + 1.2) * 0.05;
        targetTreble = 0.12;
        targetRms = 0.18;
      } else if (s === "thinking") {
        targetBass = 0.32 + Math.sin(t * 2.4) * 0.08;
        targetMid = 0.4 + Math.sin(t * 3.1 + 0.5) * 0.1;
        targetTreble = 0.28 + Math.sin(t * 4.2) * 0.08;
        targetRms = 0.32;
      } else if (s === "wake") {
        targetBass = 0.45;
        targetMid = 0.4;
        targetTreble = 0.35;
        targetRms = 0.42;
      } else if (s === "connecting") {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
        targetBass = 0.22 + pulse * 0.18;
        targetMid = 0.18 + pulse * 0.18;
        targetTreble = 0.1;
        targetRms = 0.22;
      } else if (s === "error") {
        targetBass = 0.55;
        targetMid = 0.35;
        targetTreble = 0.25;
        targetRms = 0.45;
      } else {
        targetBass = 0.08 + Math.sin(t * 0.8) * 0.03;
        targetMid = 0.06;
        targetTreble = 0.04;
        targetRms = 0.06;
      }

      const k = 0.18;
      bands.rms += (targetRms - bands.rms) * k;
      bands.bass += (targetBass - bands.bass) * k;
      bands.mid += (targetMid - bands.mid) * k;
      bands.treble += (targetTreble - bands.treble) * (k * 1.4);

      const cx = 100;
      const cy = 100;
      const baseR = 38;
      const drift = 8 + bands.bass * 16;

      const positions: Array<[number, number, number]> = [
        [
          Math.cos(t * 0.9) * drift,
          Math.sin(t * 1.1) * drift,
          baseR * (1 + bands.bass * 0.35),
        ],
        [
          Math.cos(t * 1.3 + 1.7) * drift * 0.9,
          Math.sin(t * 0.8 + 0.4) * drift * 1.1,
          baseR * (0.92 + bands.mid * 0.4),
        ],
        [
          Math.cos(t * 0.7 + 3.1) * drift * 1.05,
          Math.sin(t * 1.5 + 2.2) * drift * 0.85,
          baseR * (0.88 + bands.treble * 0.45),
        ],
        [
          Math.cos(t * 1.1 + 4.6) * drift * 0.75,
          Math.sin(t * 0.95 + 5.0) * drift * 0.95,
          baseR * (0.95 + bands.rms * 0.5),
        ],
      ];

      const setBlob = (
        ref: React.MutableRefObject<SVGCircleElement | null>,
        p: [number, number, number],
      ) => {
        const el = ref.current;
        if (!el) return;
        el.setAttribute("cx", String(cx + p[0]));
        el.setAttribute("cy", String(cy + p[1]));
        el.setAttribute("r", String(p[2]));
      };
      setBlob(blobARef, positions[0]);
      setBlob(blobBRef, positions[1]);
      setBlob(blobCRef, positions[2]);
      setBlob(blobDRef, positions[3]);

      const grp = blobGroupRef.current;
      if (grp) {
        const swirl = (t * 8) % 360;
        const grpScale = 1 + bands.rms * 0.06;
        grp.setAttribute(
          "transform",
          `rotate(${swirl} ${cx} ${cy}) scale(${grpScale})`,
        );
      }

      if (coreRef.current) {
        const r = 26 + bands.treble * 8 + bands.rms * 4;
        coreRef.current.setAttribute("r", String(r));
        coreRef.current.style.opacity = String(0.45 + bands.treble * 0.4);
      }
      if (sheenRef.current) {
        const sx = -10 + Math.cos(t * 0.6) * 4;
        const sy = -22 + Math.sin(t * 0.7) * 3;
        sheenRef.current.setAttribute("cx", String(cx + sx));
        sheenRef.current.setAttribute("cy", String(cy + sy));
      }
      if (haloRef.current) {
        const hr = 92 + bands.bass * 18 + bands.rms * 14;
        haloRef.current.setAttribute("r", String(hr));
        haloRef.current.style.opacity = String(
          0.22 + bands.rms * 0.5 + bands.bass * 0.18,
        );
      }
      if (turbRef.current) {
        const f = 0.012 + bands.mid * 0.018 + Math.sin(t * 0.4) * 0.003;
        turbRef.current.setAttribute("baseFrequency", f.toFixed(4));
      }

      const root = rootRef.current;
      if (root) {
        root.style.setProperty(
          "--orb-pulse",
          String(1 + bands.bass * 0.05 + bands.rms * 0.04),
        );
        root.style.setProperty(
          "--orb-glow",
          String(0.35 + bands.rms * 0.45 + bands.bass * 0.2),
        );
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  const accentVar =
    state === "thinking"
      ? "var(--amber, #F2A33A)"
      : state === "error"
        ? "var(--danger, #E45757)"
        : state === "connecting"
          ? "var(--brand-strong, #4F46E5)"
          : "var(--brand, #6366F1)";

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onTap}
      className={`orb orb-${state}`}
      style={
        {
          width: size,
          height: size,
          ["--orb-accent" as string]: accentVar,
        } as React.CSSProperties
      }
      aria-label="Voice surface"
    >
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="orb-svg"
        aria-hidden
      >
        <defs>
          <radialGradient id={haloGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--orb-accent)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--orb-accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--orb-accent)" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={coreGradId} cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="22%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--orb-accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0A0A0B" stopOpacity="0.85" />
          </radialGradient>

          <filter id={gooId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 22 -10"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>

          <filter id={dispId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              ref={turbRef}
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="2"
              seed="3"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>

        {/* Outer halo */}
        <circle
          ref={haloRef}
          cx="100"
          cy="100"
          r="92"
          fill={`url(#${haloGradId})`}
          style={{ mixBlendMode: "screen" }}
        />

        {/* Mercury blobs joined by goo filter */}
        <g filter={`url(#${gooId})`}>
          <g ref={blobGroupRef} filter={`url(#${dispId})`}>
            <circle ref={blobARef} cx="100" cy="100" r="38" fill={`url(#${coreGradId})`} />
            <circle ref={blobBRef} cx="100" cy="100" r="34" fill={`url(#${coreGradId})`} />
            <circle ref={blobCRef} cx="100" cy="100" r="32" fill={`url(#${coreGradId})`} />
            <circle ref={blobDRef} cx="100" cy="100" r="36" fill={`url(#${coreGradId})`} />
          </g>
        </g>

        {/* Specular highlight */}
        <ellipse
          ref={sheenRef}
          cx="90"
          cy="78"
          rx="22"
          ry="14"
          fill="white"
          opacity="0.28"
          style={{ filter: "blur(6px)" }}
        />

        {/* Inner shimmer */}
        <circle
          ref={coreRef}
          cx="100"
          cy="100"
          r="26"
          fill={`url(#${coreGradId})`}
          opacity="0.55"
        />
      </svg>
    </button>
  );
}
