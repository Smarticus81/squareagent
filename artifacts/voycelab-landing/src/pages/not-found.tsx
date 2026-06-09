import { Link } from "wouter";
import { LogoMark } from "@/components/logo";
import { VoiceRail } from "@/components/voice-rail";

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[80vh] px-6">
      <div className="text-center max-w-md">
        <LogoMark size={56} className="mx-auto" />
        <p className="vl-eyebrow mt-6">404</p>
        <h1 className="vl-display text-[44px] mt-2" style={{ color: "var(--color-vl-ivory)" }}>
          Off the rail.
        </h1>
        <p className="mt-3 text-[14px]" style={{ color: "rgba(245,239,227,0.6)" }}>
          That page does not exist. Your assistant is still listening.
        </p>
        <div className="mt-6">
          <VoiceRail state="error" />
        </div>
        <div className="mt-8 flex items-center justify-center gap-2">
          <Link href="/">
            <button className="vl-btn-primary text-[13px]">Back home</button>
          </Link>
          <Link href="/assistants">
            <button className="vl-btn-ghost text-[13px]">Open assistants</button>
          </Link>
        </div>
      </div>
    </div>
  );
}
