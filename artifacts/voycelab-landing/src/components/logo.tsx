import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

/**
 * VoyceLabs wordmark.
 *
 * Icon: concentric sound-wave pulse in the brand gradient,
 * evoking voice and broadcast. Wordmark pairs "Voyce" in the
 * foreground color with an italic "Labs" in the brand primary.
 */
export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <div className="relative w-7 h-7 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="vl-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#7C6EF5" />
              <stop offset="100%" stopColor="#5E56E6" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width="35" height="35" rx="9.5" fill="url(#vl-grad)" />
          {/* Inner speaker / sound-wave glyph */}
          <circle cx="18" cy="18" r="2.2" fill="#FFFFFF" />
          <path d="M11.5 14.5a6.5 6.5 0 0 1 0 7" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.85" />
          <path d="M24.5 14.5a6.5 6.5 0 0 0 0 7" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.85" />
          <path d="M8 11a11 11 0 0 1 0 14" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.5" />
          <path d="M28 11a11 11 0 0 0 0 14" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.5" />
        </svg>
      </div>
      {!iconOnly && (
        <span className="font-display font-bold text-[17px] tracking-tight">
          <span className="text-foreground">Voyce</span>
          <span className="text-primary italic">Labs</span>
        </span>
      )}
    </div>
  );
}
