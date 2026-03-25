import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <div className="relative w-7 h-7 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="17" fill="#E8A020"/>
          <rect x="5.5"  y="13" width="3" height="10" rx="1.5" fill="#140b05"/>
          <rect x="11"   y="10" width="3" height="16" rx="1.5" fill="#140b05"/>
          <rect x="16.5" y="7"  width="3" height="22" rx="1.5" fill="#140b05"/>
          <rect x="22"   y="10" width="3" height="16" rx="1.5" fill="#140b05"/>
          <rect x="27.5" y="13" width="3" height="10" rx="1.5" fill="#140b05"/>
        </svg>
      </div>
      {!iconOnly && (
        <span className="font-display font-bold text-[17px] tracking-tight">
          <span className="text-[#EBE5D9]">Bev</span>
          <span className="text-[#E8A020] italic">Pro</span>
        </span>
      )}
    </div>
  );
}
