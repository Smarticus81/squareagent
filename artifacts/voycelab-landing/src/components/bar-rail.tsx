import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The Bar Rail — the hero ambient element shared between the marketing
 * site and the live voice interface. It's modelled on a polished brass
 * rail running the length of a bar top: a slim horizontal element with
 * a faint amber under-glow that breathes at idle, shimmers while the
 * agent is thinking, and releases a soft ripple when an order lands.
 */
export type RailState = "idle" | "listening" | "thinking" | "confirmed" | "error";

interface BarRailProps {
  state?: RailState;
  label?: string;
  className?: string;
  /** When false, the tick marks / listening bars below the rail are hidden. */
  showBars?: boolean;
}

const stateLabel: Record<RailState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Working",
  confirmed: "Done",
  error: "Try again",
};

export function BarRail({
  state = "idle",
  label,
  className,
  showBars = true,
}: BarRailProps) {
  const reduce = useReducedMotion();

  // Amber channel strength by state
  const strength =
    state === "listening"
      ? 1
      : state === "thinking"
        ? 0.85
        : state === "confirmed"
          ? 0.75
          : state === "error"
            ? 0.4
            : 0.45;

  const tint =
    state === "error"
      ? "rgba(217, 90, 59, {a})"
      : state === "confirmed"
        ? "rgba(244, 208, 112, {a})"
        : "rgba(232, 185, 35, {a})";

  const amber = (a: number) => tint.replace("{a}", String(a));

  return (
    <div className={cn("relative w-full select-none", className)}>
      {/* Label */}
      <div className="flex items-center justify-between px-1 mb-3">
        <span className="text-[10px] tracking-[0.32em] uppercase text-foreground/40 font-medium">
          {label ?? stateLabel[state]}
        </span>
        <div className="flex items-center gap-1.5">
          <motion.span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: amber(state === "idle" ? 0.5 : 0.9) }}
            animate={
              reduce
                ? undefined
                : {
                    scale: state === "listening" ? [1, 1.35, 1] : [1, 1.1, 1],
                    opacity: state === "listening" ? [0.6, 1, 0.6] : [0.55, 0.9, 0.55],
                  }
            }
            transition={{
              duration: state === "listening" ? 1.2 : 2.6,
              repeat: Infinity,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
          <span className="text-[10px] tracking-[0.2em] uppercase text-foreground/45">
            {state}
          </span>
        </div>
      </div>

      {/* Rail proper — three stacked layers for a polished-brass depth */}
      <div className="relative h-[6px] rounded-full">
        {/* Bed shadow */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.5)",
          }}
        />
        {/* Amber channel — the living light */}
        <motion.div
          className="absolute inset-y-[1px] left-[6%] right-[6%] rounded-full"
          style={{
            background: `linear-gradient(90deg, ${amber(0)} 0%, ${amber(
              strength * 0.9
            )} 35%, ${amber(strength)} 50%, ${amber(strength * 0.9)} 65%, ${amber(
              0
            )} 100%)`,
            filter: "blur(0.2px)",
          }}
          animate={
            reduce
              ? undefined
              : state === "listening"
                ? { opacity: [0.75, 1, 0.75] }
                : state === "thinking"
                  ? { opacity: [0.6, 0.95, 0.6], x: [-6, 6, -6] }
                  : state === "confirmed"
                    ? { opacity: [0.9, 1, 0.9] }
                    : { opacity: [0.55, 0.8, 0.55] }
          }
          transition={{
            duration:
              state === "listening" ? 1.4 : state === "thinking" ? 2.2 : 3.2,
            repeat: Infinity,
            ease: [0.22, 1, 0.36, 1],
          }}
        />
        {/* Wet-glass sheen across the top */}
        <div
          className="absolute inset-x-0 top-0 h-[2px] rounded-full opacity-70"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
          }}
        />
      </div>

      {/* Under-rail glow */}
      <motion.div
        aria-hidden
        className="absolute left-[10%] right-[10%] -bottom-3 h-8 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(50% 100% at 50% 0%, ${amber(
            strength * 0.6
          )}, transparent 75%)`,
          filter: "blur(6px)",
        }}
        animate={
          reduce
            ? undefined
            : { opacity: state === "listening" ? [0.7, 1, 0.7] : [0.4, 0.75, 0.4] }
        }
        transition={{
          duration: state === "listening" ? 1.4 : 3,
          repeat: Infinity,
          ease: [0.22, 1, 0.36, 1],
        }}
      />

      {/* Optional listening bars */}
      {showBars && (
        <div className="mt-6 flex items-end justify-center gap-[3px] h-10 opacity-75">
          {Array.from({ length: 24 }).map((_, i) => {
            const amp =
              state === "listening"
                ? 22 + Math.sin((i / 24) * Math.PI) * 14
                : state === "thinking"
                  ? 14
                  : 6;
            return (
              <motion.div
                key={i}
                className="w-[2px] rounded-full"
                style={{
                  background: amber(strength * (0.35 + (i % 5) * 0.08)),
                }}
                animate={
                  reduce
                    ? { height: `${amp * 0.5}px` }
                    : {
                        height: [
                          `${Math.max(3, amp * 0.35)}px`,
                          `${amp}px`,
                          `${Math.max(3, amp * 0.35)}px`,
                        ],
                      }
                }
                transition={{
                  duration: 1.6 + (i % 7) * 0.12,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.04,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Ripple burst — fires on "confirmed" */}
      {state === "confirmed" && !reduce && (
        <motion.div
          aria-hidden
          key="ripple"
          initial={{ scale: 0.6, opacity: 0.8 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="absolute left-1/2 top-[3px] -translate-x-1/2 w-[60%] h-[6px] rounded-full pointer-events-none"
          style={{
            boxShadow:
              "0 0 0 1px rgba(244,208,112,0.6), 0 0 24px 4px rgba(232,185,35,0.45)",
          }}
        />
      )}
    </div>
  );
}
