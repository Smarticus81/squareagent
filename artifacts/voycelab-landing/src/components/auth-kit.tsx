import { Link } from "wouter";
import { useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { AMBIENT_VIDEO_SRC } from "@/components/layout";

/**
 * Shared building blocks for the sign-in / sign-up screens: the two-panel
 * white card over the ambient film, the stacked input group, the conic-ring
 * submit disc, social buttons, divider and status notes.
 */

/** Two-panel card: masked film on the left, form column on the right. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative flex min-h-screen items-center justify-center p-3 sm:p-6">
      <div className="relative z-10 flex w-full max-w-[1040px] flex-col overflow-hidden rounded-[2.5rem] border border-gray-200 bg-white p-2.5 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.75)] md:min-h-[650px] md:flex-row">
        <div className="relative h-52 shrink-0 overflow-hidden rounded-[2rem] bg-[#0c0c0e] sm:h-64 md:h-auto md:w-[45%]">
          <div aria-hidden="true" className="vl-ambient-aurora" />
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src={AMBIENT_VIDEO_SRC}
            autoPlay={!reduceMotion}
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
          />

          <Link
            href="/"
            className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to site
          </Link>

          <div className="absolute inset-x-4 bottom-4 hidden items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 text-white backdrop-blur-md md:flex">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/90">
              <LogoMark size={26} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight">VoyceLab</p>
              <p className="truncate text-[12px] leading-tight text-white/70">
                Run your bar by voice. Orders, reports, stock.
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex flex-1 flex-col justify-center overflow-hidden px-6 py-10 sm:px-12 md:w-[55%] lg:px-16">
          <div aria-hidden="true" className="vl-halo -left-16 -top-16" />
          <div className="relative mx-auto w-full max-w-[400px]">{children}</div>
        </div>
      </div>

      <style>{`
        .vl-login-input {
          width: 100%;
          background: transparent;
          border: 0;
          outline: none;
          font-size: 15px;
          line-height: 1.4;
          color: #111827;
          padding: 0;
        }
        .vl-login-input::placeholder { color: #9ca3af; }
        .vl-login-input:-webkit-autofill,
        .vl-login-input:-webkit-autofill:hover,
        .vl-login-input:-webkit-autofill:focus {
          -webkit-text-fill-color: #111827;
          transition: background-color 9999s ease-out 0s;
        }
      `}</style>
    </div>
  );
}

export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="text-center">
      <h1 className="text-[40px] font-semibold leading-none tracking-tight text-gray-900">{title}</h1>
      <p className="mt-3 text-sm text-gray-500">{subtitle}</p>
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
    <div className="flex items-center gap-2 rounded-[1.25rem] border border-gray-200 bg-gray-50 p-2 pl-5 transition-colors duration-200 focus-within:border-gray-400 focus-within:bg-white">
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <label htmlFor={htmlFor} className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-gray-500">
          {label}
        </label>
        {children}
      </div>
      {trailing}
      {action}
    </div>
  );
}

/**
 * The hero control: a 52px black disc wrapped in a conic-gradient ring. On
 * hover the ring spins and a matching blurred halo fades in behind it.
 */
export function ConicSubmitButton({
  label,
  pending = false,
  disabled = false,
}: {
  label: string;
  pending?: boolean;
  disabled?: boolean;
}) {
  const inactive = pending || disabled;
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={inactive}
      className="group/conic vl-conic-btn relative h-[52px] w-[52px] shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className="vl-conic-spin absolute -inset-1.5 rounded-full opacity-0 blur-md transition-opacity duration-300 group-hover/conic:opacity-100 group-focus-visible/conic:opacity-70"
        style={{ background: "var(--vl-conic)" }}
      />
      <span aria-hidden="true" className="vl-conic-spin absolute inset-0 rounded-full" style={{ background: "var(--vl-conic)" }} />
      <span className="absolute inset-[3px] flex items-center justify-center rounded-full bg-black shadow-[inset_0_2px_4px_rgba(255,255,255,0.18),inset_0_-3px_8px_rgba(0,0,0,0.9)]">
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        ) : (
          <ArrowRight className="h-5 w-5 text-white transition-transform duration-200 group-hover/conic:translate-x-0.5" />
        )}
      </span>
      <style>{`
        .vl-conic-btn:hover:not(:disabled) .vl-conic-spin,
        .vl-conic-btn:focus-visible .vl-conic-spin {
          animation: vl-conic-spin 1.6s linear infinite;
        }
        @keyframes vl-conic-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .vl-conic-spin { animation: none !important; }
        }
      `}</style>
    </button>
  );
}

export function SocialButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/social flex w-full items-center gap-3 rounded-[1.25rem] border border-gray-200 bg-gray-50 p-4 text-left text-[14px] font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-100"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      <ArrowRight className="h-4 w-4 text-gray-400 transition-all group-hover/social:translate-x-0.5 group-hover/social:text-gray-700" />
    </button>
  );
}

export function Divider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-4" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-linear-to-r from-transparent to-gray-200" />
      <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-gray-400">{label}</span>
      <span className="h-px flex-1 bg-linear-to-r from-gray-200 to-transparent" />
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
      {children}
    </p>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Sunset-gradient inline link used in auth footers. */
export function SunsetLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="bg-linear-to-r from-[#FF512F] to-[#F09819] bg-clip-text font-semibold text-transparent transition hover:opacity-80"
    >
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
