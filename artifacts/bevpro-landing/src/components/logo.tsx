import { Mic2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary/80 to-[#A855F7]/80 shadow-[0_0_20px_rgba(124,110,245,0.4)] border border-white/10">
        <Mic2 className="w-5 h-5 text-white" />
        <div className="absolute inset-0 rounded-xl bg-white/20 blur-md -z-10 animate-pulse"></div>
      </div>
      {!iconOnly && (
        <span className="font-display font-bold text-2xl tracking-tight text-white">
          Bev<span className="text-primary font-light">pro</span>
        </span>
      )}
    </div>
  );
}
