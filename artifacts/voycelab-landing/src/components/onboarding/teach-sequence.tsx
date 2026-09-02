import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BookOpenText, Check, Loader2, Plug, Sparkles, Wand2 } from "lucide-react";

export type CatalogFetchStatus = "loading" | "done" | "error";

export interface CatalogSummary {
  status: CatalogFetchStatus;
  count: number;
  sampleNames: string[];
}

const STAGES = [
  { icon: Plug, label: "Opening a line to Square" },
  { icon: BookOpenText, label: "Reading your menu" },
  { icon: Wand2, label: "Learning items and prices" },
  { icon: Sparkles, label: "Wiring up voice commands" },
];

const STAGE_DWELL_MS = 1050;

/**
 * The "watch it learn" interstitial. Plays a staged checklist while the
 * real catalog fetch runs, then lands on a stat reveal built from the
 * venue's actual menu. The final stage never completes before the fetch
 * does, so the reveal is always honest.
 */
export function TeachSequence({
  assistantName,
  venueName,
  catalog,
  onContinue,
}: {
  assistantName: string;
  venueName: string;
  catalog: CatalogSummary;
  onContinue: () => void;
}) {
  const reduced = useReducedMotion();
  // How many stages have fully "completed" (0..STAGES.length)
  const [stagesDone, setStagesDone] = useState(0);

  useEffect(() => {
    if (stagesDone >= STAGES.length) return;
    // The final stage holds until the real fetch settles.
    if (stagesDone === STAGES.length - 1 && catalog.status === "loading") return;
    const t = setTimeout(
      () => setStagesDone((n) => n + 1),
      reduced ? 250 : STAGE_DWELL_MS,
    );
    return () => clearTimeout(t);
  }, [stagesDone, catalog.status, reduced]);

  const finished = stagesDone >= STAGES.length;
  const learnedSomething = catalog.status === "done" && catalog.count > 0;

  return (
    <div>
      {/* Staged checklist */}
      <ul className="space-y-2.5" aria-live="polite">
        {STAGES.map((stage, i) => {
          const state: "done" | "active" | "pending" =
            i < stagesDone ? "done" : i === stagesDone ? "active" : "pending";
          const Icon = stage.icon;
          return (
            <motion.li
              key={stage.label}
              initial={false}
              animate={{ opacity: state === "pending" ? 0.38 : 1 }}
              transition={{ duration: 0.25 }}
              className="vl-light flex items-center gap-3 rounded-2xl border px-4 py-3"
              style={{
                borderColor:
                  state === "active" ? "rgba(255, 107, 71, 0.35)" : "var(--vl-line)",
                background:
                  state === "active" ? "#FFF0EA" : "#F9FAFB",
              }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: state === "done" ? "var(--color-vl-success)" : "var(--color-vl-coral-tint)",
                  color: state === "done" ? "#fff" : "var(--color-vl-coral-deep)",
                }}
              >
                {state === "done" ? (
                  <Check className="h-4 w-4" />
                ) : state === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </span>
              <span
                className="text-[14px] font-medium"
                style={{ color: "var(--color-vl-ink)" }}
              >
                {stage.label}
                {state === "active" ? "…" : ""}
              </span>
            </motion.li>
          );
        })}
      </ul>

      {/* The reveal */}
      <AnimatePresence>
        {finished && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.15 }}
            className="mt-6"
          >
            {learnedSomething ? (
              <div
                className="vl-card overflow-hidden p-6 text-center"
                style={{ borderColor: "rgba(255, 107, 71, 0.28)" }}
              >
                <p className="vl-eyebrow" style={{ color: "var(--color-vl-coral-deep)" }}>
                  {venueName}
                </p>
                <p className="vl-display mt-2 text-[44px]" style={{ color: "var(--color-vl-ink)" }}>
                  {catalog.count.toLocaleString()}
                  <span className="ml-2 align-middle text-[17px] font-medium" style={{ fontFamily: "var(--font-sans)", letterSpacing: "-0.01em", color: "var(--color-vl-ink-muted)" }}>
                    items learned
                  </span>
                </p>
                {catalog.sampleNames.length > 0 && (
                  <MenuTicker names={catalog.sampleNames} />
                )}
                <p className="mt-4 text-[13.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                  {assistantName} now knows your menu by heart — every item, every price,
                  ready to hear it out loud.
                </p>
              </div>
            ) : (
              <div className="vl-card p-6 text-center">
                <p className="text-[14.5px] font-medium" style={{ color: "var(--color-vl-ink)" }}>
                  {catalog.status === "error"
                    ? `${assistantName} will finish learning your menu in the background.`
                    : `${assistantName} is connected to ${venueName}.`}
                </p>
                <p className="mt-1.5 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Your catalog syncs automatically — nothing else to do here.
                </p>
              </div>
            )}

            <motion.button
              type="button"
              onClick={onContinue}
              whileTap={reduced ? undefined : { scale: 0.98 }}
              className="vl-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 text-[14.5px]"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A slow, seamless marquee of real menu items — proof the learning was real. */
function MenuTicker({ names }: { names: string[] }) {
  const reduced = useReducedMotion();
  const shown = names.slice(0, 12);

  if (reduced) {
    return (
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {shown.slice(0, 6).map((n) => (
          <TickerChip key={n} label={n} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="relative mt-4 overflow-hidden"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
      }}
      aria-hidden="true"
    >
      <motion.div
        className="flex w-max gap-1.5"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: Math.max(18, shown.length * 2.4), repeat: Infinity, ease: "linear" }}
      >
        {[...shown, ...shown].map((n, i) => (
          <TickerChip key={`${n}-${i}`} label={n} />
        ))}
      </motion.div>
    </div>
  );
}

function TickerChip({ label }: { label: string }) {
  return (
    <span
      className="vl-light whitespace-nowrap rounded-xl border px-2.5 py-1 text-[11.5px]"
      style={{
        fontFamily: "var(--font-mono)",
        color: "var(--color-vl-ink-soft)",
        borderColor: "var(--vl-line)",
        background: "#F9FAFB",
      }}
    >
      {label}
    </span>
  );
}
