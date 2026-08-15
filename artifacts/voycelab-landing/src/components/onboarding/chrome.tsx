import { motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

/**
 * Minimal full-screen chrome for the onboarding flow: a hairline gradient
 * progress bar hugging the top edge, the logo, a back affordance, and a
 * quiet escape hatch. No app nav — the wizard owns the whole screen.
 */
export function OnboardingChrome({
  progress,
  stepLabel,
  canGoBack,
  onBack,
}: {
  /** 0..1 across the whole flow. */
  progress: number;
  /** e.g. "Step 2 of 5" — announced for screen readers, shown on desktop. */
  stepLabel: string;
  canGoBack: boolean;
  onBack: () => void;
}) {
  const reduced = useReducedMotion();
  const pct = Math.max(0.04, Math.min(1, progress)) * 100;

  return (
    <>
      {/* Flow progress — a luminous thread across the very top edge */}
      <div
        className="fixed inset-x-0 top-0 z-50 h-[3px]"
        style={{ background: "rgba(14, 27, 44, 0.07)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={stepLabel}
      >
        <motion.div
          className="h-full"
          style={{
            background: "linear-gradient(90deg, #E54F2D, #FF6B47 55%, #7C6EF5)",
            boxShadow: "0 0 12px rgba(255, 107, 71, 0.45)",
            borderRadius: "0 3px 3px 0",
          }}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={
            reduced
              ? { duration: 0 }
              : { type: "spring", stiffness: 90, damping: 22 }
          }
        />
      </div>

      <header className="fixed inset-x-0 top-[3px] z-40">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              initial={false}
              animate={{
                opacity: canGoBack ? 1 : 0,
                x: canGoBack ? 0 : -6,
                pointerEvents: canGoBack ? "auto" : "none",
              }}
              transition={{ duration: 0.2 }}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{
                color: "var(--color-vl-ink-soft)",
                border: "1px solid rgba(14, 27, 44, 0.10)",
                background: "rgba(255, 252, 248, 0.7)",
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </motion.button>
            <Link href="/" className="transition-opacity hover:opacity-80">
              <Logo size="sm" />
            </Link>
          </div>

          <span
            className="hidden text-[11.5px] font-medium tracking-[0.14em] uppercase sm:block"
            style={{ color: "var(--color-vl-ink-faint)" }}
          >
            {stepLabel}
          </span>

          <Link
            href="/assistants"
            className="rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            Finish later
          </Link>
        </div>
      </header>
    </>
  );
}
