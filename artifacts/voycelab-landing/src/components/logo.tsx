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
 * Eight rounded capsules sitting on a shared baseline, rising and falling
 * like a sound wave. A single vertical gradient — lilac at the very top,
 * through hot magenta and coral, into a warm amber at the base — is shared
 * across the whole canvas, so each pill reveals the slice of the gradient
 * its height occupies. Tall bars carry the full lilac→amber sweep; short
 * bars show only the warm amber base. Reads as "voice running hospitality".
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
  // 80 wide × 100 tall canvas, 8 pills sitting on a baseline at y=98.
  const width = Math.round(size * (80 / 100));
  const uid = `vl-mark-${++__vlMarkSeq}`;

  // Pill geometry: width 9, step 10 (1px optical breathing room).
  // Heights tuned to the reference wave: med, tall, taller, tallest, tall,
  // med, short, dot.
  const baseline = 98;
  const barW = 9;
  const bars: Array<{ x: number; h: number }> = [
    { x: 1,  h: 50 },
    { x: 11, h: 72 },
    { x: 21, h: 84 },
    { x: 31, h: 92 },
    { x: 41, h: 78 },
    { x: 51, h: 58 },
    { x: 61, h: 32 },
    { x: 71, h: 14 },
  ];

  return (
    <svg
      className={cn("block select-none", className)}
      width={width}
      height={size}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Single shared vertical gradient mapped to the full canvas height,
            so each pill samples the slice of the gradient at its own y. */}
        <linearGradient
          id={`${uid}-wave`}
          x1="0"
          y1="0"
          x2="0"
          y2={baseline}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%"   stopColor="#B89AE0" />
          <stop offset="22%"  stopColor="#D26FB0" />
          <stop offset="48%"  stopColor="#FF4F7A" />
          <stop offset="74%"  stopColor="#FF7A3C" />
          <stop offset="100%" stopColor="#F5B23A" />
        </linearGradient>
      </defs>

      {bars.map((b) => (
        <rect
          key={b.x}
          x={b.x}
          y={baseline - b.h}
          width={barW}
          height={b.h}
          rx={barW / 2}
          fill={`url(#${uid}-wave)`}
        />
      ))}
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
  const dim = { sm: 24, md: 32, lg: 44, xl: 64 }[size];
  const wordSize = { sm: "text-[14px]", md: "text-[18px]", lg: "text-[26px]", xl: "text-[40px]" }[size];
  const wordColor =
    variant === "light" ? "#FFFFFF" : variant === "mono" ? "currentColor" : "#0A0A0B";

  if (iconOnly) return <LogoMark size={dim} variant={variant} className={className} />;

  return (
    <div className={cn("inline-flex flex-col items-center gap-2 select-none leading-none", className)}>
      <LogoMark size={dim} variant={variant} />
      <span
        className={cn("font-black uppercase block", wordSize)}
        style={{ color: wordColor, letterSpacing: "0.08em" }}
      >
        Voycelab
      </span>
    </div>
  );
}
