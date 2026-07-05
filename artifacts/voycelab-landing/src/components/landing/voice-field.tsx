import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * VoiceField — the landing hero's signature moment.
 *
 * A field of GPU-displaced points forming a "sound horizon": concentric
 * voice-waves radiate from center, a traveling carrier wave rolls across,
 * and the field lifts under the pointer. Height maps to an amber→ember ramp.
 *
 * Budget discipline: single draw call (Points + ShaderMaterial), DPR ≤ 2,
 * pauses when offscreen or tab-hidden, full dispose on unmount. The parent
 * must not mount this when prefers-reduced-motion is set.
 */

const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPointer;      // in plane coords
  uniform float uPointerLift; // 0..1
  uniform float uAmp;
  varying float vHeight;
  varying float vDist;

  void main() {
    vec3 p = position;
    float d = length(p.xy);

    // Concentric voice ripples radiating from origin
    float ripple = sin(d * 0.55 - uTime * 1.7) * exp(-d * 0.045);
    // Slow carrier swell rolling across the field
    float carrier = sin(p.x * 0.16 + uTime * 0.55) * cos(p.y * 0.22 - uTime * 0.4) * 0.45;
    // Fine shimmer
    float shimmer = sin(p.x * 1.3 + uTime * 2.2) * sin(p.y * 1.1 + uTime * 1.9) * 0.08;

    float h = (ripple * 1.6 + carrier + shimmer) * uAmp;

    // Pointer lift — a warm swell under the cursor
    float pd = distance(p.xy, uPointer);
    h += exp(-pd * pd * 0.02) * 2.4 * uPointerLift;

    p.z = h;
    vHeight = h;
    vDist = d;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.15 + smoothstep(0.0, 2.4, h) * 2.2) * (140.0 / -mv.z);
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying float vHeight;
  varying float vDist;

  void main() {
    // Round sprite
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.12, r);

    // Amber floor -> ember peaks
    vec3 amber = vec3(0.910, 0.639, 0.239); // #E8A33D
    vec3 ember = vec3(1.000, 0.353, 0.176); // #FF5A2D
    vec3 deep  = vec3(0.28, 0.19, 0.10);
    float t = smoothstep(-0.4, 2.2, vHeight);
    vec3 col = mix(mix(deep, amber, smoothstep(-1.2, 0.9, vHeight)), ember, t * t);

    // Fade the far edge of the field into the dark
    float edge = 1.0 - smoothstep(26.0, 46.0, vDist);
    float alpha = soft * edge * (0.16 + t * 0.7);
    gl_FragColor = vec4(col, alpha);
  }
`;

export default function VoiceField({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const isMobile = window.innerWidth < 768;
    const COLS = isMobile ? 130 : 210;
    const ROWS = isMobile ? 60 : 92;
    const W = 92; // plane width in world units
    const H = 40;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(0, -20, 9.5);
    camera.lookAt(0, 6, -1.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    // Point grid
    const count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    let i = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        positions[i++] = (x / (COLS - 1) - 0.5) * W;
        positions[i++] = (y / (ROWS - 1) - 0.5) * H;
        positions[i++] = 0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, -100) },
        uPointerLift: { value: 0 },
        uAmp: { value: 1 },
      },
    });

    const points = new THREE.Points(geo, mat);
    scene.add(points);

    // Sizing
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Pointer -> plane coords (approximate projection onto z=0 plane)
    const targetPointer = new THREE.Vector2(0, -100);
    let targetLift = 0;
    const ray = new THREE.Raycaster();
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
      if (ray.ray.intersectPlane(planeZ, hit)) {
        targetPointer.set(hit.x, hit.y);
        targetLift = 1;
      }
    };
    const onPointerLeave = () => {
      targetLift = 0;
    };
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave, { passive: true });

    // Visibility gating
    let inView = true;
    let pageVisible = document.visibilityState === "visible";
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(host);
    const onVis = () => {
      pageVisible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);

    let raf = 0;
    const clock = new THREE.Clock();
    let elapsed = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!inView || !pageVisible) return;
      elapsed += dt;
      const u = mat.uniforms;
      u.uTime.value = elapsed;
      (u.uPointer.value as THREE.Vector2).lerp(targetPointer, 0.08);
      u.uPointerLift.value += (targetLift - u.uPointerLift.value) * 0.06;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} aria-hidden className={`absolute inset-0 ${className}`} />;
}
