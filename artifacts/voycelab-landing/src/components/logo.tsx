import { cn } from "@/lib/utils";

const VOYCELAB_LOGO_SRC = "/brand/voycelab-logo.png";

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

export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  variant?: "dark" | "light" | "mono";
  className?: string;
}) {
  return (
    <img
      src={VOYCELAB_LOGO_SRC}
      alt=""
      className={cn("block select-none", className)}
      width={size}
      height={size}
      aria-hidden="true"
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

export function Logo({ className, iconOnly = false, size = "md", variant = "dark" }: LogoProps) {
  const dim = { sm: 34, md: 46, lg: 72, xl: 110 }[size];
  if (iconOnly) return <LogoMark size={dim} variant={variant} className={className} />;
  return (
    <img
      src={VOYCELAB_LOGO_SRC}
      alt="VoyceLab"
      className={cn("block select-none", className)}
      width={dim}
      height={dim}
      style={{ width: dim, height: dim, objectFit: "contain" }}
    />
  );
}

/**
 * The wordmark is a small presence dot and the name. The dot is the same
 * object the product is built around, at the smallest size it reads.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="block h-3.5 w-3.5 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 34% 30%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 25%, transparent 50%), radial-gradient(circle, #E9E7E2 0%, #8c8a85 100%)",
          boxShadow: "0 0 12px rgba(233,231,226,0.35)",
        }}
      />
      <span className="text-[14px] font-medium tracking-tight" style={{ color: "var(--color-vl-ink)" }}>VoyceLab</span>
    </span>
  );
}
