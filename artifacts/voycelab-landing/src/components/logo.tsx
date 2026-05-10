import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "dark" | "light" | "mono";
  /** Deprecated — tagline has been removed from the lockup. */
  withTagline?: boolean;
  /** Deprecated — kept for prop-compat with existing call sites. */
  hideTaglineOnMobile?: boolean;
}

/**
 * VoyceLab — symbol mark.
 *
 * Seven rounded capsules rising and falling like the supplied mark. The base
 * vertical gradient is shared across the full canvas, then soft translucent
 * color blooms are clipped inside the capsules to mirror the reference's
 * painterly magenta, coral, amber, and lilac overlaps.
 *
 * Use a unique gradient id per mount so multiple marks on a page don't
 * collide when styled.
 */
let __vlMarkSeq = 0;

export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  variant?: "dark" | "light" | "mono";
  className?: string;
}) {
  const width = Math.round(size * (184 / 104));
  const uid = `vl-mark-${++__vlMarkSeq}`;

  const barW = 22;
  const bars: Array<{ x: number; y: number; h: number; opacity?: number }> = [
    { x: 0, y: 39, h: 54, opacity: 0.72 },
    { x: 27, y: 25, h: 76 },
    { x: 54, y: 11, h: 94 },
    { x: 81, y: 0, h: 104 },
    { x: 108, y: 19, h: 82 },
    { x: 135, y: 26, h: 66 },
    { x: 162, y: 37, h: 53 },
  ];

  return (
    <svg
      className={cn("block select-none", className)}
      width={width}
      height={size}
      viewBox="0 0 184 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          {bars.map((b) => (
            <rect key={b.x} x={b.x} y={b.y} width={barW} height={b.h} rx={barW / 2} />
          ))}
        </clipPath>
        <linearGradient
          id={`${uid}-wave`}
          x1="0"
          y1="0"
          x2="0"
          y2="104"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#AD91D8" />
          <stop offset="32%" stopColor="#E44B9A" />
          <stop offset="62%" stopColor="#FF6245" />
          <stop offset="100%" stopColor="#FDBA2E" />
        </linearGradient>
      </defs>

      {bars.map((b) => (
        <rect
          key={b.x}
          x={b.x}
          y={b.y}
          width={barW}
          height={b.h}
          rx={barW / 2}
          fill={`url(#${uid}-wave)`}
          opacity={b.opacity ?? 1}
        />
      ))}

      <g clipPath={`url(#${uid}-clip)`}>
        <ellipse cx="13" cy="61" rx="25" ry="24" fill="#E2C7E8" fillOpacity="0.62" />
        <ellipse cx="55" cy="73" rx="63" ry="31" fill="#E52F8E" fillOpacity="0.46" />
        <ellipse cx="98" cy="78" rx="45" ry="31" fill="#FF6B37" fillOpacity="0.45" />
        <ellipse cx="144" cy="49" rx="18" ry="18" fill="#F2A0C6" fillOpacity="0.58" />
        <ellipse cx="166" cy="72" rx="19" ry="22" fill="#FDB62F" fillOpacity="0.76" />
      </g>
    </svg>
  );
}

/**
 * Vertical lockup — symbol stacked above wordmark.
 *
 * Wordmark is uppercase, tightly tracked, in the deep navy ink.
 * No tagline.
 */
export function Logo({
  className,
  iconOnly = false,
  size = "md",
  variant = "dark",
}: LogoProps) {
  const dim = { sm: 22, md: 30, lg: 42, xl: 62 }[size];
  const wordSize = { sm: "text-[15px]", md: "text-[20px]", lg: "text-[29px]", xl: "text-[43px]" }[size];
  const wordColor =
    variant === "light" ? "#FFFFFF" : variant === "mono" ? "currentColor" : "#0A0A0B";

  if (iconOnly) return <LogoMark size={dim} variant={variant} className={className} />;

  return (
    <div className={cn("inline-flex flex-col items-center gap-2.5 select-none leading-none", className)}>
      <LogoMark size={dim} variant={variant} />
      <span
        className={cn("font-black uppercase block", wordSize)}
        style={{ color: wordColor, letterSpacing: "0.02em" }}
      >
        Voycelab
      </span>
    </div>
  );
}
