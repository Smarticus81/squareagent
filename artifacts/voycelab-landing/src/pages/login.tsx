import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Info } from "lucide-react";
import { useForgotPassword, useLogin, useResetPassword } from "@/hooks/use-auth";
import { consumeIntendedPath } from "@/lib/post-login-redirect";
import {
  AuthHeader,
  AuthShell,
  ConicSubmitButton,
  Divider,
  ErrorNote,
  GoogleGlyph,
  InputGroup,
  SocialButton,
  SuccessNote,
  SunsetLink,
  XGlyph,
} from "@/components/auth-kit";

/**
 * Sign-in screen.
 *
 * Signing in is a two-step flow (email -> password) so the single
 * "email + arrow" input group maps cleanly onto the email/password JWT login.
 * Forgot-password and reset-link (`/login?reset=<token>`) modes reuse the
 * same input group so every path through the screen feels like one surface.
 */

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
    <AuthShell>
      <AuthHeader title={heading} subtitle={subtitle} />

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

            <form onSubmit={handleEmailContinue}>
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
                <button type="button" onClick={goToLogin} className="vl-btn-primary w-full gap-2 py-4 text-[14px]">
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
        Don&rsquo;t have an account? <SunsetLink href="/signup">Sign up</SunsetLink>
      </p>
    </AuthShell>
  );
}
