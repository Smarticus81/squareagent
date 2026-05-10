import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "dark" | "light" | "mono";
  withTagline?: boolean;
  /** When true, the tagline is rendered on sm+ screens only. */
  hideTaglineOnMobile?: boolean;
}

/**
 * VoyceLab — symbol mark.
 *
 * Seven rounded "pill" bars in a soft waveform — short → tall → tall → short —
 * sharing a single vertical gradient that fades from lilac at the top through
 * magenta to a warm amber/coral at the base. Reads as "voice running
 * hospitality" — warm, sensory, never corporate.
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
  // viewBox tuned to the new lockup: 7 pills across a 64-wide canvas.
  const width = Math.round(size * (64 / 40));
  const uid = `vl-mark-${++__vlMarkSeq}`;

  // Heights and y-offsets for the 7 bars (canvas height = 40).
  // Pattern: medium, tall, very-tall, very-tall, tall, medium, short.
  const bars: Array<{ x: number; h: number }> = [
    { x: 2, h: 18 },
    { x: 11, h: 28 },
    { x: 20, h: 38 },
    { x: 29, h: 38 },
    { x: 38, h: 28 },
    { x: 47, h: 18 },
    { x: 56, h: 10 },
  ];

  return (
    <svg
      className={cn("block select-none", className)}
      width={width}
      height={size}
      viewBox="0 0 64 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Single shared vertical gradient — lilac → magenta → coral → amber. */}
        <linearGradient id={`${uid}-wave`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#C9B6E8" />
          <stop offset="28%"  stopColor="#E879A8" />
          <stop offset="58%"  stopColor="#FF5A7E" />
          <stop offset="82%"  stopColor="#FF7A45" />
          <stop offset="100%" stopColor="#F2A93D" />
        </linearGradient>
      </defs>

      {bars.map((b) => (
        <rect
          key={b.x}
          x={b.x}
          y={(40 - b.h) / 2}
          width={6}
          height={b.h}
          rx={3}
          fill={`url(#${uid}-wave)`}
        />
      ))}
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
  hideTaglineOnMobile = false,
}: LogoProps) {
  const dim = { sm: 18, md: 22, lg: 28, xl: 38 }[size];
  const wordSize = { sm: "text-[14px]", md: "text-[16px]", lg: "text-[20px]", xl: "text-[26px]" }[size];
  const tagSize = { sm: "text-[8.5px]", md: "text-[9.5px]", lg: "text-[11px]", xl: "text-[13px]" }[size];
  const wordColor =
    variant === "light" ? "#FFFFFF" : variant === "mono" ? "currentColor" : "#0A0A0B";
  const tagColor = variant === "light" ? "rgba(255, 255, 255,0.65)" : "rgba(10, 10, 11,0.55)";

  if (iconOnly) return <LogoMark size={dim} variant={variant} className={className} />;

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark size={dim} variant={variant} />
      <div className="leading-none">
        <span
          className={cn("font-extrabold uppercase block", wordSize)}
          style={{ color: wordColor, letterSpacing: "0.005em" }}
        >
          Voycelab
        </span>
        {withTagline && (
          <span
            className={cn(
              "block mt-1 font-medium uppercase",
              tagSize,
              hideTaglineOnMobile && "hidden sm:block",
            )}
            style={{ color: tagColor, letterSpacing: "0.14em" }}
          >
            Where voice runs hospitality
          </span>
        )}
      </div>
    </div>
  );
}
