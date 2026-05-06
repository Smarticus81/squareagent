import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "dark" | "light" | "mono";
  withTagline?: boolean;
}

/**
 * VoyceLab — symbol mark.
 *
 * A compact stereo waveform: short violet pulse on the left, ascending
 * coral bars at the centre, soft sage tail on the right. Reads as
 * "voice running hospitality" — warm, not corporate.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  variant?: "dark" | "light" | "mono";
  className?: string;
}) {
  const width = Math.round(size * (52 / 32));
  const uid = `vl-mark`;

  return (
    <svg
      className={cn("block select-none", className)}
      width={width}
      height={size}
      viewBox="0 0 52 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-coral`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF8A66" />
          <stop offset="100%" stopColor="#E2502E" />
        </linearGradient>
        <linearGradient id={`${uid}-lilac`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D9CBF0" />
          <stop offset="100%" stopColor="#A38EDC" />
        </linearGradient>
        <linearGradient id={`${uid}-sage`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B9DBBE" />
          <stop offset="100%" stopColor="#7FB386" />
        </linearGradient>
      </defs>

      {/* Lilac entry pulse — small, low */}
      <rect x="1" y="14" width="3" height="4" rx="1.5" fill={`url(#${uid}-lilac)`} />
      <rect x="6" y="11" width="3" height="10" rx="1.5" fill={`url(#${uid}-lilac)`} />

      {/* Coral peaks — the brand voice */}
      <rect x="11" y="6" width="3" height="20" rx="1.5" fill={`url(#${uid}-coral)`} />
      <rect x="16" y="2" width="3" height="28" rx="1.5" fill={`url(#${uid}-coral)`} />
      <rect x="21" y="0" width="3" height="32" rx="1.5" fill={`url(#${uid}-coral)`} />
      <rect x="26" y="2" width="3" height="28" rx="1.5" fill={`url(#${uid}-coral)`} />
      <rect x="31" y="6" width="3" height="20" rx="1.5" fill={`url(#${uid}-coral)`} />

      {/* Sage tail — the calm settle */}
      <rect x="36" y="10" width="3" height="12" rx="1.5" fill={`url(#${uid}-sage)`} />
      <rect x="41" y="13" width="3" height="6" rx="1.5" fill={`url(#${uid}-sage)`} />
      <rect x="46" y="14" width="3" height="4" rx="1.5" fill={`url(#${uid}-sage)`} />
    </svg>
  );
}

/**
 * Horizontal lockup — symbol + wordmark + (optional) tagline.
 *
 * Wordmark is uppercase, tightly tracked, in the deep navy ink.
 * Tagline ("Where voice runs hospitality") sits beneath in a smaller
 * weight when `withTagline` is on — matches the master brand reference.
 */
export function Logo({
  className,
  iconOnly = false,
  size = "md",
  variant = "dark",
  withTagline = false,
}: LogoProps) {
  const dim = { sm: 18, md: 22, lg: 28, xl: 38 }[size];
  const wordSize = { sm: "text-[14px]", md: "text-[16px]", lg: "text-[20px]", xl: "text-[26px]" }[size];
  const tagSize = { sm: "text-[8.5px]", md: "text-[9.5px]", lg: "text-[11px]", xl: "text-[13px]" }[size];
  const wordColor =
    variant === "light" ? "#FBF7F1" : variant === "mono" ? "currentColor" : "#0E1B2C";
  const tagColor = variant === "light" ? "rgba(251,247,241,0.65)" : "rgba(14,27,44,0.55)";

  if (iconOnly) return <LogoMark size={dim} variant={variant} className={className} />;

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark size={dim} variant={variant} />
      <div className="leading-none">
        <span
          className={cn("font-semibold uppercase tracking-[0.02em] block", wordSize)}
          style={{ color: wordColor, letterSpacing: "0.04em" }}
        >
          Voycelab
        </span>
        {withTagline && (
          <span
            className={cn("block mt-1 font-normal", tagSize)}
            style={{ color: tagColor, letterSpacing: "0.02em" }}
          >
            Where voice runs hospitality
          </span>
        )}
      </div>
    </div>
  );
}
