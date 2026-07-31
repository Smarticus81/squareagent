import { Link } from "wouter";
import { LogoMark } from "@/components/logo";
import { VoiceRail } from "@/components/voice-rail";

export default function NotFound() {
  return (
    <div className="vl-page-shell flex min-h-[80vh] flex-1 items-center justify-center px-6">
      <div className="vl-panel max-w-md p-8 text-center">
        <LogoMark size={56} className="mx-auto" />
        <p className="vl-eyebrow mt-6">404</p>
        <h1 className="vl-display mt-2 text-[44px]" style={{ color: "var(--color-vl-ink)" }}>
          Off the rail.
        </h1>
        <p className="mt-3 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
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
