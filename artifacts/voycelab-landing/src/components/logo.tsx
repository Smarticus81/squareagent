import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

/**
 * VoyceLabs logo — a glowing blue circle with concentric sound-wave arcs
 * radiating from the center, paired with a clean sans-serif wordmark.
 */
export function Logo({ className, iconOnly = false, size = "md" }: LogoProps) {
  const dims = { sm: 28, md: 34, lg: 44 }[size];
  const textSize = { sm: "text-[15px]", md: "text-[18px]", lg: "text-[24px]" }[size];

  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <div className="relative flex items-center justify-center" style={{ width: dims, height: dims }}>
        {/* Ambient glow */}
        <div
          className="absolute inset-0 rounded-full blur-lg opacity-30"
          style={{ backgroundColor: "#2563EB" }}
        />
        <svg
          width={dims}
          height={dims}
          viewBox="0 0 44 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="vl-bg" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id="vl-sheen" x1="0" y1="0" x2="0" y2="44" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          {/* Base circle */}
          <circle cx="22" cy="22" r="20" fill="url(#vl-bg)" />
          <circle cx="22" cy="22" r="20" fill="url(#vl-sheen)" />
          {/* Center dot */}
          <circle cx="22" cy="22" r="3" fill="white" />
          {/* Inner wave arcs */}
          <path
            d="M15.5 17a9 9 0 0 0 0 10"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <path
            d="M28.5 17a9 9 0 0 1 0 10"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          {/* Outer wave arcs */}
          <path
            d="M11.5 13.5a14 14 0 0 0 0 17"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.4"
          />
          <path
            d="M32.5 13.5a14 14 0 0 1 0 17"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.4"
          />
        </svg>
      </div>
      {!iconOnly && (
        <span className={cn("font-bold tracking-tight leading-none", textSize)} style={{ color: "#111827" }}>
          Voyce<span style={{ color: "#2563EB" }}>Labs</span>
        </span>
      )}
    </div>
  );
}
