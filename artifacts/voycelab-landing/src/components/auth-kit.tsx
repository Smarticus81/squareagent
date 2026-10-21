import { Link } from "wouter";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Wordmark } from "@/components/logo";

/**
 * Building blocks for the sign-in and sign-up screens: one quiet column on
 * the canvas, the stacked input group, a round submit control, and notes.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="vl-auth-shell relative flex min-h-screen flex-col items-center px-5 py-6 sm:px-8">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-medium transition-opacity hover:opacity-80" style={{ color: "var(--color-vl-ink-muted)" }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <Wordmark />
      </div>
      <div className="flex w-full flex-1 items-center justify-center py-12">
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  );
}

export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="text-center">
      <h1 className="vl-display text-[34px]">{title}</h1>
      <p className="mt-3 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>{subtitle}</p>
    </header>
  );
}

export function InputGroup({
  label,
  htmlFor,
  children,
  trailing,
  action,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="vl-input-group">
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <label htmlFor={htmlFor}>{label}</label>
        {children}
      </div>
      {trailing}
      {action}
    </div>
  );
}

/** Round submit control that sits inside an input group. */
export function ConicSubmitButton({ label, pending = false, disabled = false }: { label: string; pending?: boolean; disabled?: boolean }) {
  const inactive = pending || disabled;
  return (
    <button type="submit" aria-label={label} title={label} disabled={inactive} className="vl-conic-disc shrink-0">
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
    </button>
  );
}

export function SocialButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/social flex w-full items-center gap-3 rounded-2xl border p-4 text-left text-[14px] font-medium transition-colors"
      style={{ borderColor: "var(--vl-line)", background: "var(--vl-surface)", color: "var(--color-vl-ink)" }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      <ArrowRight className="h-4 w-4 transition-transform group-hover/social:translate-x-0.5" style={{ color: "var(--color-vl-ink-faint)" }} />
    </button>
  );
}

export function Divider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-4" role="separator" aria-label={label}>
      <span className="h-px flex-1" style={{ background: "var(--vl-line)" }} />
      <span className="text-[10px] font-medium uppercase tracking-[0.25em]" style={{ color: "var(--color-vl-ink-faint)" }}>{label}</span>
      <span className="h-px flex-1" style={{ background: "var(--vl-line)" }} />
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl border px-4 py-3 text-[13px]" style={{ color: "var(--color-vl-danger)", borderColor: "rgba(255,107,107,0.22)", background: "rgba(255,107,107,0.08)" }}>
      {children}
    </p>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex gap-2 rounded-2xl border px-4 py-3 text-[13px] font-medium" style={{ color: "var(--color-vl-success)", borderColor: "rgba(143,227,180,0.22)", background: "rgba(143,227,180,0.08)" }}>
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Inline link used in auth footers. */
export function SunsetLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium underline-offset-4 transition hover:underline" style={{ color: "var(--color-vl-ink)" }}>
      {children}
    </Link>
  );
}

export function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

export function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
