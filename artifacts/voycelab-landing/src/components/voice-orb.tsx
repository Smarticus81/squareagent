import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/utils";
import type { DemoAgentState } from "@/hooks/use-voycelab-demo-realtime";

export type VoiceOrbState = "idle" | "requesting" | "listening" | "denied" | "error";

export interface VoiceOrbProps {
  size?: number;
  particleCount?: number;
  outputStream?: MediaStream | null;
  agentState?: DemoAgentState;
  onListenStart?: (stream: MediaStream) => void;
  onListenStop?: () => void;
  className?: string;
  label?: string;
  externalError?: string | null;
}

const vertexShader = /* glsl */ `
  attribute float aSeed;
  attribute float aScale;
  attribute float aBand;
  attribute float aAudio;

  uniform float uTime;
  uniform float uEnergy;
  uniform float uThinking;

  varying float vAlpha;
  varying float vBand;
  varying float vAudio;
  varying float vDepth;

  mat3 rotateY(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  }

  mat3 rotateZ(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
  }

  // Cheap pseudo curl-noise displacement using stacked sines.
  vec3 curlDrift(vec3 p, float t) {
    float a = sin(p.y * 2.4 + t * 0.55) * cos(p.z * 1.7 + t * 0.4);
    float b = sin(p.z * 2.1 + t * 0.6) * cos(p.x * 1.9 + t * 0.35);
    float c = sin(p.x * 2.6 + t * 0.5) * cos(p.y * 1.5 + t * 0.45);
    return vec3(a, b, c);
  }

  void main() {
    vec3 p = position;

    // Idle drift: each particle wanders along a curl field, much more alive than pure breathing.
    vec3 drift = curlDrift(p * 1.4, uTime + aSeed * 12.0) * 0.06;
    p += drift * (0.6 + aScale * 0.7);

    float audioLift = aAudio * 0.55;
    float slowBreath = sin(uTime * 0.62 + aSeed * 6.2831) * 0.045;
    float shimmer = sin(uTime * (1.4 + aSeed * 1.9) + length(p) * 6.0) * 0.03;
    float scatter = 1.0 + slowBreath + shimmer + uThinking * 0.08 + uEnergy * 0.16 + audioLift;
    p *= scatter;

    p = rotateY(uTime * 0.05 + uEnergy * 0.18) * rotateZ(sin(uTime * 0.22) * 0.06) * p;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float perspective = 280.0 / max(90.0, -mvPosition.z);
    // Depth in 0..1 — closer particles are larger and slightly brighter.
    vDepth = clamp((mvPosition.z + 4.6) / 1.6, 0.0, 1.0);
    float depthBoost = mix(0.7, 1.35, vDepth);

    gl_PointSize = (2.6 + aScale * 6.2 + aAudio * 14.0 + uThinking * 1.6) * perspective * depthBoost;
    vAlpha = (0.05 + aScale * 0.09 + aAudio * 0.36 + uEnergy * 0.07) * (0.65 + vDepth * 0.55);
    vBand = aBand;
    vAudio = aAudio;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying float vAlpha;
  varying float vBand;
  varying float vAudio;
  varying float vDepth;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    // Soft gaussian-like core + a wider gentle halo for a true "dust glow".
    float core = exp(-d * d * 26.0);
    float halo = exp(-d * d * 7.0) * 0.55;

    // Color spectrum across bands: cyan → indigo → violet → pink → coral.
    vec3 cyan   = vec3(0.36, 0.78, 0.98);
    vec3 indigo = vec3(0.36, 0.40, 0.97);
    vec3 violet = vec3(0.66, 0.33, 0.97);
    vec3 pink   = vec3(0.95, 0.32, 0.65);
    vec3 coral  = vec3(1.00, 0.55, 0.40);

    vec3 color = mix(cyan, indigo, smoothstep(0.00, 0.30, vBand));
    color = mix(color, violet, smoothstep(0.25, 0.60, vBand));
    color = mix(color, pink,   smoothstep(0.55, 0.85, vBand));
    color = mix(color, coral,  smoothstep(0.80, 1.00, vBand));

    // Audio energy nudges color toward warm pink — feels like "speaking".
    color = mix(color, pink, vAudio * 0.35);

    // Depth tint: distant dust takes on cooler indigo so the cloud has air.
    color = mix(color * 0.85 + indigo * 0.15, color, vDepth);

    float alpha = (core * 0.65 + halo * 0.28) * vAlpha;
    gl_FragColor = vec4(color, alpha);
  }
`;

function makeDustGeometry(three: typeof THREE, count: number) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const scales = new Float32Array(count);
  const bands = new Float32Array(count);
  const audio = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    const coreGroup = index % 3 === 0;
    const mistGroup = index % 7 === 0;
    const baseRadius = coreGroup ? Math.pow(t, 1.25) * 0.62 : Math.pow(t, 0.55) * 1.18;
    const radius = baseRadius * (0.58 + (index % 17) / 52) + (mistGroup ? 0.08 : 0);
    const theta = index * golden;
    const phi = Math.acos(1 - 2 * t);

    positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius * 0.92;
    positions[index * 3 + 2] = Math.cos(phi) * radius * 0.72;
    seeds[index] = ((index * 16807) % 997) / 997;
    scales[index] = coreGroup
      ? 0.34 + (((index * 48271) % 811) / 811) * 0.72
      : 0.18 + (((index * 48271) % 811) / 811) * 0.86;
    bands[index] = ((index * 37) % 997) / 997;
    audio[index] = 0;
  }

  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new three.BufferAttribute(seeds, 1));
  geometry.setAttribute("aScale", new three.BufferAttribute(scales, 1));
  geometry.setAttribute("aBand", new three.BufferAttribute(bands, 1));
  geometry.setAttribute("aAudio", new three.BufferAttribute(audio, 1));
  return geometry;
}

export function VoiceOrb({
  size = 220,
  particleCount = 5600,
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

  const mountRef = useRef<HTMLDivElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frequencyRef = useRef<Uint8Array | null>(null);
  const smoothAudioRef = useRef<Float32Array | null>(null);
  const averageEnergyRef = useRef(0);
  const agentStateRef = useRef<DemoAgentState>(agentState);

  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  const stopMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
    });
    micStreamRef.current = null;
  }, []);

  const stopOutputAnalyser = useCallback(() => {
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sourceRef.current = null;
    try {
      analyserRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    frequencyRef.current = null;
    smoothAudioRef.current = null;
    averageEnergyRef.current = 0;
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
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;
      setState("listening");
      onListenStart?.(stream);
    } catch (err) {
      stopMic();
      const message = err instanceof Error ? err.message : "Could not access microphone";
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setState(denied ? "denied" : "error");
      setErrorMessage(
        denied ? "Microphone access blocked. Allow it in your browser to use the demo." : message,
      );
    }
  }, [onListenStart, stopMic]);

  useEffect(() => {
    return () => {
      stopMic();
      stopOutputAnalyser();
    };
  }, [stopMic, stopOutputAnalyser]);

  useEffect(() => {
    stopOutputAnalyser();
    if (!outputStream || outputStream.getAudioTracks().length === 0) return;
    if (typeof window === "undefined") return;

    try {
      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      const source = ctx.createMediaStreamSource(outputStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.84;
      source.connect(analyser);

      audioCtxRef.current = ctx;
      sourceRef.current = source;
      analyserRef.current = analyser;
      frequencyRef.current = new Uint8Array(analyser.frequencyBinCount);
      smoothAudioRef.current = new Float32Array(particleCount);
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    } catch {
      stopOutputAnalyser();
    }

    return () => stopOutputAnalyser();
  }, [outputStream, particleCount, stopOutputAnalyser]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let animationFrame = 0;
    let disposed = false;
    let cleanupThree: (() => void) | undefined;

    void import("three").then((three) => {
      if (disposed || !mountRef.current) return;

      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(34, 1, 0.1, 100);
      camera.position.z = 4.6;
      const targetCam = { x: 0, y: 0 };
      const onPointerMove = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
        targetCam.x = nx * 0.35;
        targetCam.y = -ny * 0.25;
      };
      window.addEventListener("pointermove", onPointerMove, { passive: true });

      const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size, size);
      mountRef.current.appendChild(renderer.domElement);

      const geometry = makeDustGeometry(three, particleCount);
      const audioAttribute = geometry.getAttribute("aAudio") as THREE.BufferAttribute;
      const material = new three.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: three.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uEnergy: { value: 0 },
          uThinking: { value: 0 },
        },
      });
      const points = new three.Points(geometry, material);
      scene.add(points);

      const startTime = performance.now();

      const render = (now: number) => {
        if (disposed) return;

        const time = (now - startTime) / 1000;
        const analyser = analyserRef.current;
        const frequency = frequencyRef.current;
        const smooth = smoothAudioRef.current;
        let average = 0;

        if (analyser && frequency && smooth) {
          analyser.getByteFrequencyData(frequency);
          const lower = 2;
          const upper = Math.min(frequency.length - 1, Math.floor(frequency.length * 0.64));
          const usable = Math.max(1, upper - lower);
          const audioArray = audioAttribute.array as Float32Array;

          for (let index = 0; index < particleCount; index += 1) {
            const startBin = lower + Math.floor((index / particleCount) * usable);
            const endBin = Math.max(startBin + 1, lower + Math.floor(((index + 1) / particleCount) * usable));
            let peak = 0;
            for (let bin = startBin; bin < endBin; bin += 1) {
              const value = frequency[bin] ?? 0;
              if (value > peak) peak = value;
            }
            const shaped = Math.min(1, Math.pow(peak / 255, 0.58) * 1.55);
            const attack = shaped > smooth[index] ? 0.6 : 0.11;
            smooth[index] += (shaped - smooth[index]) * attack;
            audioArray[index] = smooth[index];
            average += smooth[index];
          }
          audioAttribute.needsUpdate = true;
          average /= particleCount;
        } else {
          const audioArray = audioAttribute.array as Float32Array;
          for (let index = 0; index < particleCount; index += 1) {
            audioArray[index] *= 0.88;
          }
          audioAttribute.needsUpdate = true;
        }

        const thinking = agentStateRef.current === "connecting" || agentStateRef.current === "thinking" ? 1 : 0;
        const idle = 0.16 + Math.sin(time * 0.72) * 0.045;
        averageEnergyRef.current += (Math.max(average * 1.9, idle + thinking * 0.12) - averageEnergyRef.current) * 0.12;

        material.uniforms.uTime.value = time;
        material.uniforms.uEnergy.value = averageEnergyRef.current;
        material.uniforms.uThinking.value = thinking;
        points.rotation.y = time * 0.055;
        points.rotation.z = Math.sin(time * 0.18) * 0.035;

        // Smooth pointer-driven parallax.
        camera.position.x += (targetCam.x - camera.position.x) * 0.04;
        camera.position.y += (targetCam.y - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(render);
      };

      animationFrame = requestAnimationFrame(render);

      cleanupThree = () => {
        cancelAnimationFrame(animationFrame);
        window.removeEventListener("pointermove", onPointerMove);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      cleanupThree?.();
    };
  }, [particleCount, size]);

  const toggle = useCallback(() => {
    if (state === "listening" || state === "requesting") stop();
    else void start();
  }, [state, start, stop]);

  const ariaLabel =
    label ??
    (state === "listening" ? "Voice demo is listening. Click to stop." : "Voice demo. Click to start talking.");

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      {/* Cinematic outer aurora — sits well outside the orb so it gives the scene atmosphere */}
      <div
        aria-hidden
        className="absolute -inset-[60%] rounded-full pointer-events-none vl-orb-aurora"
        style={{
          background:
            "radial-gradient(circle at 35% 38%, rgba(99,102,241,0.16), transparent 55%)," +
            "radial-gradient(circle at 70% 30%, rgba(56,189,248,0.10), transparent 50%)," +
            "radial-gradient(circle at 65% 75%, rgba(236,72,153,0.14), transparent 55%)," +
            "radial-gradient(circle at 30% 75%, rgba(251,191,36,0.07), transparent 55%)",
          filter: "blur(60px)",
        }}
      />
      {/* Faint inner halo glow tied to the orb itself */}
      <div
        aria-hidden
        className="absolute -inset-[10%] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(168,85,247,0.10), rgba(236,72,153,0.06) 45%, transparent 72%)",
          filter: "blur(28px)",
          opacity: 0.85,
        }}
      />
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
        className="absolute inset-0 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-vl-accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-white"
      >
        <span
          ref={mountRef}
          aria-hidden
          className="absolute inset-0"
          style={{
            WebkitMaskImage:
              "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 32%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0) 78%)",
            maskImage:
              "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 32%, rgba(0,0,0,0.55) 58%, rgba(0,0,0,0) 78%)",
          }}
        />
        {state === "requesting" && (
          <span
            aria-hidden
            className="absolute inset-[18%] rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(99,102,241,0.36) 70deg, transparent 128deg, transparent 360deg)",
              animation: "vl-orbit-spin 1.15s linear infinite",
              filter: "blur(10px)",
            }}
          />
        )}
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
