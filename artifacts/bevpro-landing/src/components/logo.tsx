import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-3 select-none", className)}>
      <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-md shadow-violet-500/20">
        {/* Stylized sound wave icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="4" x2="12" y2="20" />
          <line x1="8" y1="8" x2="8" y2="16" />
          <line x1="16" y1="8" x2="16" y2="16" />
          <line x1="4" y1="10" x2="4" y2="14" />
          <line x1="20" y1="10" x2="20" y2="14" />
        </svg>
      </div>
      {!iconOnly && (
        <span className="font-display font-bold text-xl tracking-tight text-foreground">
          Bev<span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-indigo-500">pro</span>
        </span>
      )}
    </div>
  );
}
