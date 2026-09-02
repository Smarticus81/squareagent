import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useForgotPassword, useLogin, useResetPassword } from "@/hooks/use-auth";
import { consumeIntendedPath } from "@/lib/post-login-redirect";

/**
 * Immersive login screen.
 *
 * A full-bleed looping video sits behind a white card. The left 45% of the
 * card masks the same video; the right 55% carries the form. Signing in is a
 * two-step flow (email -> password) so the single "email + arrow" input group
 * from the concept maps cleanly onto the existing email/password JWT login.
 *
 * Forgot-password and reset-link (`/login?reset=<token>`) modes reuse the
 * same input group so every path through the screen feels like one surface.
 */

const AMBIENT_VIDEO_SRC = "https://cdn.midjourney.com/video/71048e88-d8e6-470e-88ef-555c01eacb12/0.mp4";

const CONIC_GRADIENT = "conic-gradient(from 0deg, #00c6ff, #0072ff, #ff007a, #ff8a00, #00c6ff)";

type Mode = "login" | "forgot" | "reset";
type LoginStep = "email" | "password";

const stepMotion = {
  initial: { opacity: 0, x: 24, filter: "blur(4px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -24, filter: "blur(4px)" },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
};

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const resetToken = new URLSearchParams(search).get("reset") ?? "";
  const reduceMotion = useReducedMotion();

  const login = useLogin();
  const forgotPassword = useForgotPassword();
  const resetPassword = useResetPassword();

  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetComplete, setResetComplete] = useState(false);
  const [socialNotice, setSocialNotice] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Keep the keyboard on the active field as the flow advances.
  useEffect(() => {
    if (mode !== "login") return;
    const target = step === "email" ? emailRef.current : passwordRef.current;
    const id = window.setTimeout(() => target?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [mode, step]);

  useEffect(() => {
    if (!socialNotice) return;
    const id = window.setTimeout(() => setSocialNotice(null), 4500);
    return () => window.clearTimeout(id);
  }, [socialNotice]);

  const goToLogin = () => {
    setMode("login");
    setStep("email");
    setPassword("");
    login.reset();
    forgotPassword.reset();
    if (resetToken) window.history.replaceState(null, "", "/login");
  };

  const handleEmailContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    login.reset();
    setStep("password");
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          // Land the user back on the page they originally tried to open.
          const intended = consumeIntendedPath();
          setLocation(sessionStorage.getItem("voycelab.pending_plan") ? "/pricing" : intended ?? "/assistants");
        },
      },
    );
  };

  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPassword.mutate({ email: email.trim() });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return;
    resetPassword.mutate(
      { token: resetToken, newPassword },
      {
        onSuccess: () => {
          setResetComplete(true);
          setPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      },
    );
  };

  const heading =
    mode === "forgot" ? "Reset password" : mode === "reset" ? "Choose a new password" : "Welcome back";
  const subtitle =
    mode === "forgot"
      ? "We’ll email you a secure link to get back in."
      : mode === "reset"
      ? "Pick something memorable. At least 8 characters."
      : step === "password"
      ? "Enter your password to continue."
      : "Sign in to your account";

  const passwordsMismatch = Boolean(newPassword && confirmPassword && newPassword !== confirmPassword);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black p-3 sm:p-6">
      {/* Ambient background: aurora fallback, looping video, dimming veil */}
      <div aria-hidden="true" className="vl-login-aurora fixed inset-0 z-0" />
      <video
        className="fixed inset-0 z-0 h-full w-full scale-105 object-cover"
        src={AMBIENT_VIDEO_SRC}
        autoPlay={!reduceMotion}
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <div aria-hidden="true" className="fixed inset-0 z-0 bg-black/10 backdrop-blur-sm" />

      {/* Main card */}
      <div className="relative z-10 flex w-full max-w-[1040px] flex-col overflow-hidden rounded-[2.5rem] border border-gray-200 bg-white p-2.5 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.75)] md:min-h-[650px] md:flex-row">
        {/* Left: masked video */}
        <div className="relative h-52 shrink-0 overflow-hidden rounded-[2rem] bg-[#0c0c0e] sm:h-64 md:h-auto md:w-[45%]">
          <div aria-hidden="true" className="vl-login-aurora absolute inset-0" />
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

        {/* Right: form */}
        <div className="relative flex flex-1 flex-col justify-center overflow-hidden px-6 py-10 sm:px-12 md:w-[55%] lg:px-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-linear-to-br from-[#FF512F] to-[#F09819] opacity-20 blur-[80px]"
          />

          <div className="relative mx-auto w-full max-w-[400px]">
            <header className="text-center">
              <h1 className="text-[40px] font-semibold leading-none tracking-tight text-gray-900">{heading}</h1>
              <p className="mt-3 text-sm text-gray-500">{subtitle}</p>
            </header>

            <AnimatePresence mode="wait" initial={false}>
              {mode === "login" && step === "email" && (
                <motion.div key="login-email" {...stepMotion} className="mt-8 space-y-5">
                  <div className="space-y-3">
                    <SocialButton
                      label="Continue with Google"
                      icon={<GoogleGlyph />}
                      onClick={() => setSocialNotice("Google sign-in is coming soon. Use your email below to continue.")}
                    />
                    <SocialButton
                      label="Continue with X"
                      icon={<XGlyph />}
                      onClick={() => setSocialNotice("X sign-in is coming soon. Use your email below to continue.")}
                    />
                  </div>

                  <AnimatePresence>
                    {socialNotice && (
                      <motion.p
                        key="social-notice"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800"
                      >
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{socialNotice}</span>
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <Divider />

                  <form onSubmit={handleEmailContinue} noValidate={false}>
                    <InputGroup label="Email" htmlFor="login-email" action={<ConicSubmitButton label="Continue" />}>
                      <input
                        ref={emailRef}
                        id="login-email"
                        type="email"
                        name="email"
                        autoComplete="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="vl-login-input"
                      />
                    </InputGroup>
                  </form>
                </motion.div>
              )}

              {mode === "login" && step === "password" && (
                <motion.form key="login-password" {...stepMotion} onSubmit={handleLogin} className="mt-8 space-y-4">
                  <div className="flex items-center justify-between rounded-[1.25rem] border border-gray-200 bg-gray-50 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Signing in as</p>
                      <p className="truncate text-[14px] font-medium text-gray-900">{email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStep("email");
                        login.reset();
                      }}
                      className="shrink-0 text-[12.5px] font-semibold text-gray-500 transition hover:text-gray-900"
                    >
                      Change
                    </button>
                  </div>

                  <InputGroup
                    label="Password"
                    htmlFor="login-password"
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="rounded-full p-2 text-gray-400 transition hover:text-gray-700"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                    action={<ConicSubmitButton label="Sign in" pending={login.isPending} />}
                  >
                    <input
                      ref={passwordRef}
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="vl-login-input"
                    />
                  </InputGroup>

                  {login.error && <ErrorNote>{login.error.message}</ErrorNote>}

                  <div className="flex justify-end px-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("forgot");
                        forgotPassword.reset();
                      }}
                      className="text-[12.5px] font-semibold text-gray-500 transition hover:text-gray-900"
                    >
                      Forgot password?
                    </button>
                  </div>
                </motion.form>
              )}

              {mode === "forgot" && (
                <motion.form key="forgot" {...stepMotion} onSubmit={handleForgotPassword} className="mt-8 space-y-4">
                  <InputGroup
                    label="Account email"
                    htmlFor="forgot-email"
                    action={<ConicSubmitButton label="Send reset link" pending={forgotPassword.isPending} />}
                  >
                    <input
                      id="forgot-email"
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className="vl-login-input"
                    />
                  </InputGroup>

                  {forgotPassword.data && <SuccessNote>{forgotPassword.data.message}</SuccessNote>}
                  {forgotPassword.error && <ErrorNote>{forgotPassword.error.message}</ErrorNote>}

                  <div className="flex justify-center px-1 pt-1">
                    <button
                      type="button"
                      onClick={goToLogin}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 transition hover:text-gray-900"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                    </button>
                  </div>
                </motion.form>
              )}

              {mode === "reset" && (
                <motion.form key="reset" {...stepMotion} onSubmit={handleResetPassword} className="mt-8 space-y-4">
                  {resetComplete ? (
                    <>
                      <SuccessNote>Password updated. You can sign in with your new password.</SuccessNote>
                      <button type="button" onClick={goToLogin} className="vl-login-secondary">
                        Continue to sign in <ArrowRight className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <InputGroup label="New password" htmlFor="reset-new">
                        <input
                          id="reset-new"
                          type="password"
                          name="new-password"
                          autoComplete="new-password"
                          placeholder="Minimum 8 characters"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          minLength={8}
                          required
                          autoFocus
                          className="vl-login-input"
                        />
                      </InputGroup>
                      <InputGroup
                        label="Confirm password"
                        htmlFor="reset-confirm"
                        action={
                          <ConicSubmitButton
                            label="Update password"
                            pending={resetPassword.isPending}
                            disabled={!resetToken || passwordsMismatch}
                          />
                        }
                      >
                        <input
                          id="reset-confirm"
                          type="password"
                          name="confirm-password"
                          autoComplete="new-password"
                          placeholder="Repeat new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          minLength={8}
                          required
                          className="vl-login-input"
                        />
                      </InputGroup>

                      {passwordsMismatch && <ErrorNote>Passwords do not match.</ErrorNote>}
                      {resetPassword.error && <ErrorNote>{resetPassword.error.message}</ErrorNote>}

                      <div className="flex justify-center px-1 pt-1">
                        <button
                          type="button"
                          onClick={goToLogin}
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 transition hover:text-gray-900"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                        </button>
                      </div>
                    </>
                  )}
                </motion.form>
              )}
            </AnimatePresence>

            <p className="mt-10 text-center text-sm text-gray-500">
              Don&rsquo;t have an account?{" "}
              <Link
                href="/signup"
                className="bg-linear-to-r from-[#FF512F] to-[#F09819] bg-clip-text font-semibold text-transparent transition hover:opacity-80"
              >
                Sign up
              </Link>
            </p>
          </div>
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
        .vl-login-aurora {
          background-color: #0c0c0e;
          background-image:
            radial-gradient(ellipse 60% 50% at 20% 25%, rgba(255, 107, 71, 0.55), transparent 65%),
            radial-gradient(ellipse 55% 45% at 80% 30%, rgba(124, 110, 245, 0.5), transparent 65%),
            radial-gradient(ellipse 65% 55% at 55% 85%, rgba(0, 114, 255, 0.45), transparent 65%),
            radial-gradient(ellipse 45% 40% at 85% 85%, rgba(255, 0, 122, 0.35), transparent 65%);
          background-size: 180% 180%;
          animation: vl-login-aurora 18s ease-in-out infinite alternate;
        }
        @keyframes vl-login-aurora {
          from { background-position: 0% 0%; }
          to { background-position: 100% 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vl-login-aurora { animation: none; }
        }
        .vl-login-secondary {
          display: inline-flex;
          width: 100%;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 1.25rem;
          background: #111827;
          color: #ffffff;
          font-size: 14px;
          font-weight: 600;
          padding: 16px;
          transition: background-color 150ms ease, transform 150ms ease;
        }
        .vl-login-secondary:hover { background: #000000; transform: translateY(-1px); }
        .vl-conic-btn:hover:not(:disabled) .vl-conic-spin,
        .vl-conic-btn:focus-visible .vl-conic-spin {
          animation: vl-conic-spin 1.6s linear infinite;
        }
        @keyframes vl-conic-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .vl-conic-spin { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ── Building blocks ────────────────────────────────────────────────────── */

function InputGroup({
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
function ConicSubmitButton({
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
      {/* Outer glow */}
      <span
        aria-hidden="true"
        className="vl-conic-spin absolute -inset-1.5 rounded-full opacity-0 blur-md transition-opacity duration-300 group-hover/conic:opacity-100 group-focus-visible/conic:opacity-70"
        style={{ background: CONIC_GRADIENT }}
      />
      {/* Ring */}
      <span
        aria-hidden="true"
        className="vl-conic-spin absolute inset-0 rounded-full"
        style={{ background: CONIC_GRADIENT }}
      />
      {/* Disc */}
      <span className="absolute inset-[3px] flex items-center justify-center rounded-full bg-black shadow-[inset_0_2px_4px_rgba(255,255,255,0.18),inset_0_-3px_8px_rgba(0,0,0,0.9)]">
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        ) : (
          <ArrowRight className="h-5 w-5 text-white transition-transform duration-200 group-hover/conic:translate-x-0.5" />
        )}
      </span>
    </button>
  );
}

function SocialButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
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

function Divider() {
  return (
    <div className="flex items-center gap-4" role="separator" aria-label="or">
      <span className="h-px flex-1 bg-linear-to-r from-transparent to-gray-200" />
      <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-gray-400">or</span>
      <span className="h-px flex-1 bg-linear-to-r from-gray-200 to-transparent" />
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
      {children}
    </p>
  );
}

function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
