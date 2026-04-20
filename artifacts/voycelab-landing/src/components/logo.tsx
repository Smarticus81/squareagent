import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

/**
 * VoyceLab wordmark — liquid-amber sound-wave mark paired with a
 * lightly condensed Fraunces wordmark. The mark is a single speaker
 * glyph inside an amber "coin" with a faint top highlight, evoking
 * a freshly polished brass fitting.
 */
export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-3 select-none", className)}>
      <div className="relative w-8 h-8 flex items-center justify-center">
        <svg
          width="32"
          height="32"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="drop-shadow-[0_0_12px_rgba(232,185,35,0.25)]"
        >
          <defs>
            <linearGradient id="vl-coin" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F3CE57" />
              <stop offset="55%" stopColor="#E8B923" />
              <stop offset="100%" stopColor="#A87A12" />
            </linearGradient>
            <linearGradient id="vl-sheen" x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
              <stop offset="40%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <circle cx="20" cy="20" r="18.5" fill="url(#vl-coin)" />
          <circle cx="20" cy="20" r="18.5" fill="url(#vl-sheen)" />
          {/* speaker / pulse glyph — single dot + two rings */}
          <circle cx="20" cy="20" r="2.6" fill="#0C0F1A" />
          <path
            d="M13.2 15.5a8 8 0 0 1 0 9"
            stroke="#0C0F1A"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />
          <path
            d="M26.8 15.5a8 8 0 0 0 0 9"
            stroke="#0C0F1A"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />
          <circle cx="20" cy="20" r="18.5" fill="none" stroke="rgba(12,15,26,0.25)" strokeWidth="0.8" />
        </svg>
      </div>
      {!iconOnly && (
        <span className="font-display text-[18px] tracking-[-0.01em] leading-none">
          <span className="font-semibold text-[color:var(--color-cream)]">Voyce</span>
          <span className="font-medium italic text-[color:var(--color-amber)]">Lab</span>
        </span>
      )}
    </div>
  );
}
