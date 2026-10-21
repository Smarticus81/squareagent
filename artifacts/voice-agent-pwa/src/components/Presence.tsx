import { useEffect, useRef } from "react";
import { createPresenceMeter, type PresenceMeter } from "@/lib/presence-meter";

export type PresenceState =
  | "dormant"     // signed out, offline, or shut down
  | "ready"       // armed, listening for the wake phrase
  | "listening"   // live session, mic open
  | "thinking"    // live session, working on it
  | "speaking"    // live session, assistant audio flowing
  | "connecting"
  | "error";

interface Props {
  state: PresenceState;
  /** The assistant's remote audio. Drives the glow while speaking. */
  remoteStream: MediaStream | null;
  onTap?: () => void;
  label: string;
}

/**
 * Presence — the one living element on the surface.
 *
 * A soft sphere of light. Colour and bloom follow the assistant's real
 * state; while it speaks, the bloom and scale follow the actual energy of
 * its audio and nothing else. Silence is still. No bars, no fake waves.
 *
 * Levels are written straight to CSS custom properties from one frame loop
 * so React never re-renders for audio.
 */
export function Presence({ state, remoteStream, onTap, label }: Props) {
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const meterRef = useRef<PresenceMeter | null>(null);
  const stateRef = useRef<PresenceState>(state);
  const levelRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!remoteStream) return;
    const meter = createPresenceMeter(remoteStream);
    meterRef.current = meter;
    return () => {
      meter?.dispose();
      if (meterRef.current === meter) meterRef.current = null;
    };
  }, [remoteStream]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = stateRef.current === "speaking" ? (meterRef.current?.level() ?? 0) : 0;
      // Ease toward the target so a dropped stream never snaps.
      levelRef.current += (target - levelRef.current) * (target > levelRef.current ? 0.4 : 0.12);
      const el = rootRef.current;
      if (el) el.style.setProperty("--lvl", levelRef.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <button
      ref={rootRef}
      type="button"
      className={`presence is-${state}`}
      onClick={onTap}
      aria-label={label}
      style={{ ["--lvl" as string]: 0 }}
    >
      <span className="p-bloom" aria-hidden="true" />
      <span className="p-ring" aria-hidden="true" />
      <span className="p-core" aria-hidden="true">
        <span className="p-sheen" />
      </span>
    </button>
  );
}
