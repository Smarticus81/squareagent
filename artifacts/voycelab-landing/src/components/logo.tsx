import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "dark" | "light" | "mono";
}

/**
 * VoyceLab — symbol mark.
 *
 * An equalizer silhouette: a small leading pulse, four ascending blue bars,
 * four descending gold bars, and a single warm crest arcing over the peak.
 * Rendered as pure SVG so it blends on any canvas without a visible edge.
 */
export function LogoMark({
  size = 32,
  variant = "dark",
  className,
}: {
  size?: number;
  variant?: "dark" | "light" | "mono";
  className?: string;
}) {
  const width = Math.round(size * (62 / 58));
  const uid = `vl-${variant}`;

  return (
    <svg
      className={cn("block select-none", className)}
      width={width}
      height={size}
      viewBox="0 0 62 58"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-blue`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5AA0FF" />
          <stop offset="100%" stopColor="#1F4FE0" />
        </linearGradient>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD34A" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>
      </defs>

      <circle cx="3" cy="30" r="2.4" fill={`url(#${uid}-blue)`} />
      <rect x="7" y="22" width="5" height="16" rx="2.5" fill={`url(#${uid}-blue)`} />
      <rect x="15" y="14" width="5" height="32" rx="2.5" fill={`url(#${uid}-blue)`} />
      <rect x="23" y="6" width="5" height="48" rx="2.5" fill={`url(#${uid}-blue)`} />
      <rect x="31" y="6" width="5" height="48" rx="2.5" fill={`url(#${uid}-gold)`} />
      <rect x="39" y="14" width="5" height="32" rx="2.5" fill={`url(#${uid}-gold)`} />
      <rect x="47" y="22" width="5" height="16" rx="2.5" fill={`url(#${uid}-gold)`} />
      <rect x="55" y="26" width="5" height="8" rx="2.5" fill={`url(#${uid}-gold)`} />

      {/* Warm crest arcing across the peak of the wave */}
      <path
        d="M25 5.5 Q33 0 40 5.5"
        stroke="#FF8A2B"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Horizontal lockup — symbol + wordmark, rendered in the site's own typography
 * so it blends naturally into any surface.
 */
export function Logo({ className, iconOnly = false, size = "md", variant = "dark" }: LogoProps) {
  const dim = { sm: 22, md: 28, lg: 36, xl: 48 }[size];
  const text = { sm: "text-[16px]", md: "text-[19px]", lg: "text-[24px]", xl: "text-[32px]" }[size];
  const wordColor =
    variant === "light" ? "#0B1120" : variant === "mono" ? "currentColor" : "#F5EFE3";

  if (iconOnly) return <LogoMark size={dim} variant={variant} className={className} />;

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark size={dim} variant={variant} />
      <span
        className={cn("font-semibold tracking-[-0.02em] leading-none", text)}
        style={{ color: wordColor }}
      >
        Voyce<span style={{ fontWeight: 500, opacity: 0.92 }}>Lab</span>
      </span>
    </div>
  );
}
