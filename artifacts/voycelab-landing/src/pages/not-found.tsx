import { Link } from "wouter";
import { Presence } from "@/components/presence";

export default function NotFound() {
  return (
    <div className="vl-page-shell flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <Presence state="dormant" size={120} label="Nothing here" />
      <h1 className="vl-display mt-8 text-[32px]">Nothing here.</h1>
      <p className="mt-3 max-w-sm text-[15px]" style={{ color: "var(--color-vl-ink-muted)" }}>
        That page doesn't exist. Your assistant does.
      </p>
      <Link href="/" className="vl-btn-primary mt-8">Go home</Link>
    </div>
  );
}
