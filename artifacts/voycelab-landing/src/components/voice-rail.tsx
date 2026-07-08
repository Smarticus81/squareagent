import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

type RailState =
  | "offline"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "confirming"
  | "executing"
  | "synced"
  | "error";

interface VoiceRailProps {
  state?: RailState;
  width?: string | number;
  className?: string;
  intensity?: number;
  showWaveform?: boolean;
}

const STATE_COLOR: Record<RailState, string> = {
  offline: "rgba(90, 101, 119, 0.45)",
  ready: "#0A0A0B",
  listening: "#A38EDC",
  thinking: "#000000",
  speaking: "#A5B4FC",
  confirming: "#FDE68A",
  executing: "#0A0A0B",
  synced: "#2F9E64",
  error: "#D7402E",
};

/**
 * VoiceRail — the brand signature.
 *
 * A thin horizontal strip of live sound that signals the system's mood:
 * ready (slow brass pulse), listening (violet bloom), thinking (ember scan),
 * speaking (waveform), confirming (split), executing (sweep), synced (calm pulse),
 * error (fracture).
 */
export function VoiceRail({
  state = "ready",
  width = "100%",
  className,
  intensity = 0.6,
  showWaveform = false,
}: VoiceRailProps) {
  const reduce = useReducedMotion();
  const color = STATE_COLOR[state];

  return (
    <div
      className={cn("relative h-12 select-none", className)}
      style={{ width }}
      role="status"
      aria-label={`voice rail: ${state}`}
    >
      {/* Glow halo */}
      <motion.div
        aria-hidden
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 rounded-full blur-2xl"
        style={{ backgroundColor: color, opacity: 0.18 + intensity * 0.18 }}
        animate={
          reduce
            ? {}
            : state === "listening"
            ? { opacity: [0.18, 0.42, 0.18] }
            : state === "ready"
            ? { opacity: [0.12, 0.28, 0.12] }
            : state === "thinking"
            ? { opacity: [0.16, 0.34, 0.16] }
            : state === "synced"
            ? { opacity: [0.14, 0.32, 0.14] }
            : { opacity: 0.18 }
        }
        transition={{
          duration: state === "ready" ? 2.6 : state === "thinking" ? 1.2 : 1.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Base rail line */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${color} 22%, ${color} 78%, transparent 100%)`,
          opacity: state === "offline" ? 0.4 : 0.85,
        }}
      />

      {/* Listening / speaking — waveform riding the rail */}
      {(state === "listening" || state === "speaking" || showWaveform) && !reduce && (
        <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
          {Array.from({ length: 28 }).map((_, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="rounded-full"
              style={{ width: 2, backgroundColor: color }}
              animate={{
                height: [
                  `${4 + Math.random() * 6}px`,
                  `${10 + Math.random() * 22}px`,
                  `${4 + Math.random() * 6}px`,
                ],
                opacity: [0.45, 1, 0.45],
              }}
              transition={{
                duration: 0.9 + Math.random() * 0.6,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.04,
              }}
            />
          ))}
        </div>
      )}

      {/* Thinking — ember scan passes across the rail */}
      {state === "thinking" && !reduce && (
        <motion.div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 h-[3px] w-24 rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
            filter: "blur(0.5px)",
          }}
          animate={{ left: ["-15%", "115%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Executing — fast coral sweep */}
      {state === "executing" && !reduce && (
        <motion.div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 h-[3px] w-32 rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, #0A0A0B, transparent)`,
          }}
          animate={{ left: ["-20%", "120%"] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Confirming — rail splits into confirm/cancel energy */}
      {state === "confirming" && !reduce && (
        <>
          <motion.div
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 h-[3px] left-0 w-1/2 rounded-full origin-left"
            style={{ backgroundColor: "#2F9E64" }}
            animate={{ scaleX: [0.8, 1, 0.8], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 h-[3px] right-0 w-1/2 rounded-full origin-right"
            style={{ backgroundColor: "#D7402E" }}
            animate={{ scaleX: [0.8, 1, 0.8], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: 0.55 }}
          />
        </>
      )}

      {/* Error — fracture */}
      {state === "error" && (
        <div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-2 h-3 rotate-12"
          style={{
            background: "linear-gradient(180deg, transparent, #D7402E, transparent)",
          }}
        />
      )}

      {/* Center node */}
      <motion.span
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 7,
          height: 7,
          backgroundColor: color,
          boxShadow: `0 0 18px ${color}`,
        }}
        animate={
          reduce
            ? {}
            : state === "listening" || state === "ready" || state === "synced"
            ? { scale: [1, 1.25, 1] }
            : { scale: 1 }
        }
        transition={{ duration: state === "listening" ? 1.4 : 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
