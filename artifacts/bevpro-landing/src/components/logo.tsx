import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <div className="relative w-7 h-7 flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" className="text-foreground" />
          <circle cx="10" cy="10" r="2" fill="currentColor" className="text-foreground" />
        </svg>
      </div>
      {!iconOnly && (
        <span className="font-display font-medium text-[15px] tracking-[0.2em] uppercase text-foreground">
          Bevpro
        </span>
      )}
    </div>
  );
}
