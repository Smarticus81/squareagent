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
 * A horizontal rail under a central signal node, flanked by two asymmetric
 * sound arcs. The negative space between the upper arc and the rail forms
 * a quiet "V". No microphone cliché.
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
  // Stroke + node colors — brass on dark, graphite on light, ink on mono.
  const stroke = variant === "light" ? "#111318" : variant === "mono" ? "currentColor" : "#E0B76A";
  const node = variant === "light" ? "#07080A" : variant === "mono" ? "currentColor" : "#F5EFE3";
  const rail = variant === "light" ? "rgba(17,19,24,0.55)" : variant === "mono" ? "currentColor" : "rgba(245,239,227,0.55)";

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Rail — the signature horizontal line */}
      <line
        x1="3"
        y1="28"
        x2="37"
        y2="28"
        stroke={rail}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Outer arc, left — wider, lighter */}
      <path
        d="M7 22 Q12 8 20 8"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      {/* Outer arc, right — asymmetric, slightly tighter */}
      <path
        d="M33 22 Q28 12 20 12"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      {/* Inner arcs — the quiet "V" sits between these and the rail */}
      <path
        d="M11 24 Q15 14 20 14"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M29 24 Q25 16 20 16"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Signal node */}
      <circle cx="20" cy="28" r="2.4" fill={node} />
      <circle cx="20" cy="28" r="4.6" stroke={stroke} strokeWidth="1.2" opacity="0.45" />
    </svg>
  );
}

/**
 * Horizontal lockup — symbol + wordmark.
 */
export function Logo({ className, iconOnly = false, size = "md", variant = "dark" }: LogoProps) {
  const dim = { sm: 22, md: 28, lg: 36, xl: 48 }[size];
  const text = { sm: "text-[14px]", md: "text-[16px]", lg: "text-[20px]", xl: "text-[28px]" }[size];
  const wordColor =
    variant === "light" ? "#07080A" : variant === "mono" ? "currentColor" : "#F5EFE3";

  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <LogoMark size={dim} variant={variant} />
      {!iconOnly && (
        <span
          className={cn("font-semibold tracking-[-0.01em] leading-none", text)}
          style={{ color: wordColor, fontFeatureSettings: '"ss01"' }}
        >
          Voyce<span style={{ fontWeight: 400, opacity: 0.78 }}>Lab</span>
        </span>
      )}
    </div>
  );
}
