import { useEffect, useRef } from "react";
import { createPresenceMeter, type PresenceMeter } from "@workspace/voicelab-client/presence-meter";

export type PresenceState = "dormant" | "ready" | "listening" | "thinking" | "speaking" | "connecting" | "error";

/**
 * The assistant's presence, as it appears in the dashboard and on the
 * landing page. Same rules as the live surface: colour follows real state,
 * and the glow only moves with the assistant's actual audio.
 */
export function Presence({
  state,
  stream = null,
  size = 200,
  onClick,
  label,
  className = "",
}: {
  state: PresenceState;
  stream?: MediaStream | null;
  size?: number;
  onClick?: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const meter = useRef<PresenceMeter | null>(null);
  const stateRef = useRef(state);
  const level = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!stream) return;
    const m = createPresenceMeter(stream);
    meter.current = m;
    return () => { m?.dispose(); if (meter.current === m) meter.current = null; };
  }, [stream]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = stateRef.current === "speaking" ? (meter.current?.level() ?? 0) : 0;
      level.current += (target - level.current) * (target > level.current ? 0.4 : 0.12);
      ref.current?.style.setProperty("--lvl", level.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`vl-presence is-${state} ${className}`}
      style={{ ["--presence-size" as string]: `${size}px`, ["--lvl" as string]: 0 }}
    >
      <span className="p-bloom" aria-hidden="true" />
      <span className="p-ring" aria-hidden="true" />
      <span className="p-core" aria-hidden="true"><span className="p-sheen" /></span>
    </button>
  );
}
