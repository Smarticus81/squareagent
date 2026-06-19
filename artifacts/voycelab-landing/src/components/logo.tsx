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
