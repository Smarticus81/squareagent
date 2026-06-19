import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Logo } from "@/components/logo";
import { VoiceRail } from "@/components/voice-rail";
import { useForgotPassword, useLogin, useResetPassword } from "@/hooks/use-auth";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const resetToken = new URLSearchParams(search).get("reset") ?? "";
  const login = useLogin();
  const forgotPassword = useForgotPassword();
  const resetPassword = useResetPassword();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot" | "reset">(resetToken ? "reset" : "login");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetComplete, setResetComplete] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, {
      onSuccess: () => {
        setLocation(sessionStorage.getItem("voycelab.pending_plan") ? "/pricing" : "/assistants");
      },
    });
  };

  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPassword.mutate({ email });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return;
    resetPassword.mutate({ token: resetToken, newPassword }, {
      onSuccess: () => {
        setResetComplete(true);
        setPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
    });
  };

  const heading = mode === "forgot" ? "Recover access." : mode === "reset" ? "Set a new password." : "Welcome back.";
  const subtitle =
    mode === "forgot"
      ? "Enter your account email and we’ll send a secure reset link."
      : mode === "reset"
      ? "Choose a new password for your VoyceLab account."
      : "Open your assistants and pick up where you left off.";

  return (
    <div className="vl-auth-shell relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 45% at 15% 20%, rgba(251, 207, 232,0.30), transparent 65%), radial-gradient(ellipse 50% 40% at 90% 80%, rgba(199, 210, 254,0.28), transparent 65%)",
        }}
      />

      <div className="relative w-full max-w-105">
        <div className="mb-5 flex justify-start">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-2xl border bg-white/70 px-3 py-2 text-[13px] font-semibold shadow-sm backdrop-blur transition hover:bg-white hover:shadow"
            style={{ color: "var(--color-vl-ink-muted)", borderColor: "rgba(10,10,11,0.08)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Link>
        </div>
        <div className="flex justify-center mb-8">
          <Logo size="lg" withTagline />
        </div>

        <div className="vl-card vl-edge-coral p-8 login-card">
          <h1
            className="vl-display text-[28px] text-center"
            style={{ color: "var(--color-vl-ink)" }}
          >
            {heading.includes(" ") ? (
              <>
                {heading.split(" ")[0]} <em>{heading.split(" ").slice(1).join(" ")}</em>
              </>
            ) : heading}
          </h1>
          <p
            className="text-[14px] text-center mt-2"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            {subtitle}
          </p>
          <div className="mt-6 mb-2">
            <VoiceRail state="ready" intensity={0.4} />
          </div>

          {mode === "login" && (
            <form onSubmit={handleSubmit} className="space-y-5 mt-6">
              <Field label="Email">
                <input
                  type="email"
                  placeholder="name@venue.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="vl-input login-input"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="vl-input login-input"
                />
              </Field>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-[12.5px] font-bold hover:underline"
                  style={{ color: "var(--color-vl-coral-deep)" }}
                >
                  Forgot password?
                </button>
              </div>

              {login.error && (
                <p className="text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                  {login.error.message}
                </p>
              )}

              <button type="submit" disabled={login.isPending} className="vl-btn-primary w-full">
                {login.isPending ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Signing in…
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={handleForgotPassword} className="space-y-5 mt-6">
              <Field label="Account email">
                <input
                  type="email"
                  placeholder="name@venue.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="vl-input login-input"
                />
              </Field>

              {forgotPassword.data && (
                <div className="rounded-2xl border bg-emerald-50/70 p-4 text-[13px] font-semibold text-emerald-700">
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{forgotPassword.data.message}</span>
                  </div>
                </div>
              )}

              {forgotPassword.error && (
                <p className="text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                  {forgotPassword.error.message}
                </p>
              )}

              <button type="submit" disabled={forgotPassword.isPending} className="vl-btn-primary w-full">
                {forgotPassword.isPending ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending link…
                  </span>
                ) : (
                  "Send reset link"
                )}
              </button>
              <button
                type="button"
                onClick={() => setMode("login")}
                className="vl-btn-ghost w-full"
              >
                Back to sign in
              </button>
            </form>
          )}

          {mode === "reset" && (
            <form onSubmit={handleResetPassword} className="space-y-5 mt-6">
              {resetComplete ? (
                <div className="rounded-2xl border bg-emerald-50/70 p-4 text-[13px] font-semibold text-emerald-700">
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Password updated. You can sign in with your new password.</span>
                  </div>
                </div>
              ) : (
                <>
                  <Field label="New password">
                    <input
                      type="password"
                      placeholder="Minimum 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={8}
                      required
                      className="vl-input login-input"
                    />
                  </Field>
                  <Field label="Confirm password">
                    <input
                      type="password"
                      placeholder="Repeat new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={8}
                      required
                      className="vl-input login-input"
                    />
                  </Field>
                  {newPassword && confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                      Passwords do not match.
                    </p>
                  )}
                  {resetPassword.error && (
                    <p className="text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                      {resetPassword.error.message}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={resetPassword.isPending || !resetToken || newPassword !== confirmPassword}
                    className="vl-btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {resetPassword.isPending ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Updating password…
                      </span>
                    ) : (
                      "Update password"
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  window.history.replaceState(null, "", "/login");
                }}
                className="vl-btn-ghost w-full"
              >
                Back to sign in
              </button>
            </form>
          )}
        </div>

        <p
          className="mt-8 text-center text-[13.5px]"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          No account?{" "}
          <Link
            href="/signup"
            className="font-semibold hover:underline"
            style={{ color: "var(--color-vl-coral-deep)" }}
          >
            Create your assistant
          </Link>
        </p>
      </div>
      <style>{`
        .login-card {
          background: rgba(255, 255, 255, 0.92);
          border-color: rgba(10, 10, 11, 0.08);
          box-shadow:
            0 1px 2px rgba(10, 10, 11, 0.04),
            0 18px 48px -32px rgba(10, 10, 11, 0.35);
        }
        .login-input {
          background: #ffffff;
          border-color: rgba(10, 10, 11, 0.14);
          color: var(--color-vl-ink);
          box-shadow: inset 0 1px 0 rgba(10, 10, 11, 0.02);
        }
        .login-input:focus {
          border-color: var(--color-vl-accent);
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.14);
        }
        .login-input:-webkit-autofill,
        .login-input:-webkit-autofill:hover,
        .login-input:-webkit-autofill:focus {
          -webkit-text-fill-color: var(--color-vl-ink);
          box-shadow: 0 0 0 1000px #ffffff inset, 0 0 0 4px rgba(99, 102, 241, 0.14);
          transition: background-color 9999s ease-out 0s;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 text-[11px] font-semibold tracking-[0.18em] uppercase"
        style={{ color: "var(--color-vl-ink-muted)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
