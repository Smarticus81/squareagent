import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useSignup } from "@/hooks/use-auth";
import { trackBusinessEvent } from "@/components/autonomy-telemetry";
import {
  AuthHeader,
  AuthShell,
  ErrorNote,
  InputGroup,
  SunsetLink,
} from "@/components/auth-kit";

export default function Signup() {
  const [, setLocation] = useLocation();
  const signup = useSignup();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const hasPendingPlan = typeof window !== "undefined" && Boolean(sessionStorage.getItem("voycelab.pending_plan"));

  useEffect(() => {
    trackBusinessEvent("signup_started", { path: "/signup" });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (signup.isPending) return;
    signup.mutate(
      { name: name.trim(), email: email.trim(), password },
      {
        onSuccess: () => {
          trackBusinessEvent("signup_completed", { path: "/signup", signupMethod: "email" });
          setLocation(sessionStorage.getItem("voycelab.pending_plan") ? "/pricing" : "/onboarding");
        },
      },
    );
  };

  return (
    <AuthShell>
      <AuthHeader
        title="Start free"
        subtitle={hasPendingPlan ? "Create your account, then finish secure checkout." : "14 days free. No card required. Takes about a minute."}
      />

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <InputGroup label="Name" htmlFor="signup-name">
          <input
            id="signup-name"
            type="text"
            name="name"
            autoComplete="name"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            className="vl-login-input"
          />
        </InputGroup>

        <InputGroup label="Work email" htmlFor="signup-email">
          <input
            id="signup-email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@yourvenue.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="vl-login-input"
          />
        </InputGroup>

        <InputGroup
          label="Password"
          htmlFor="signup-password"
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
        >
          <input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="vl-login-input"
          />
        </InputGroup>

        {signup.error && <ErrorNote>{signup.error.message}</ErrorNote>}

        <button
          type="submit"
          disabled={signup.isPending}
          className="vl-btn-primary flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {signup.isPending ? "Creating your account…" : hasPendingPlan ? "Create account and continue" : "Start free — no card required"}
        </button>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] leading-5 text-gray-500">
          <p className="font-medium text-gray-700">What happens next</p>
          <p className="mt-1">Create the account, connect Square, then set up your venue assistant. No sales call required.</p>
        </div>

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-gray-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Disconnect Square anytime. Your data stays yours.
        </p>
      </form>

      <p className="mt-8 text-center text-sm text-gray-500">
        Have an account? <SunsetLink href="/login">Sign in</SunsetLink>
      </p>
    </AuthShell>
  );
}
