import { Mic2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <div className="relative flex items-center justify-center w-8 h-8 rounded-none bg-primary">
        <Mic2 className="w-4 h-4 text-white" />
      </div>
      {!iconOnly && (
        <span className="font-display font-bold text-xl tracking-tight text-foreground">
          Bev<span className="text-primary font-medium">pro</span>
        </span>
      )}
    </div>
  );
}