import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion language for the onboarding flow.
 *
 * Direction-aware screen transitions (forward = rise in / lift out,
 * backward = the reverse) plus a stagger system for each screen's
 * contents so headlines, controls, and footnotes arrive in sequence.
 */

export const SCREEN_SPRING: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 32,
  mass: 0.9,
};

export const EASE_OUT: Transition = { duration: 0.4, ease: [0.22, 1, 0.36, 1] };

/** Whole-screen enter/exit. `custom` is the travel direction: 1 forward, -1 back. */
export const screenVariants: Variants = {
  enter: (dir: number) => ({
    opacity: 0,
    y: dir >= 0 ? 34 : -34,
    scale: 0.985,
    filter: "blur(7px)",
  }),
  center: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      y: SCREEN_SPRING,
      scale: SCREEN_SPRING,
      opacity: EASE_OUT,
      filter: EASE_OUT,
      staggerChildren: 0.055,
      delayChildren: 0.04,
    },
  },
  exit: (dir: number) => ({
    opacity: 0,
    y: dir >= 0 ? -26 : 26,
    scale: 0.985,
    filter: "blur(7px)",
    transition: { duration: 0.26, ease: [0.4, 0, 1, 1] },
  }),
};

/** Reduced-motion replacement: plain cross-fade, no travel, no blur. */
export const screenVariantsReduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Per-element rise used inside a screen; inherits the parent stagger. */
export const riseVariants: Variants = {
  enter: { opacity: 0, y: 16 },
  center: {
    opacity: 1,
    y: 0,
    transition: { y: { type: "spring", stiffness: 340, damping: 30 }, opacity: EASE_OUT },
  },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const riseVariantsReduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0 },
};
