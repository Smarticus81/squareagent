import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Info, ShieldCheck } from "lucide-react";
import { useSignup } from "@/hooks/use-auth";
import {
  AuthHeader,
  AuthShell,
  ConicSubmitButton,
  Divider,
  ErrorNote,
  GoogleGlyph,
  InputGroup,
  SocialButton,
  SunsetLink,
  XGlyph,
} from "@/components/auth-kit";

export default function Signup() {
  const [, setLocation] = useLocation();
  const signup = useSignup();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [socialNotice, setSocialNotice] = useState<string | null>(null);
  const hasPendingPlan = typeof window !== "undefined" && Boolean(sessionStorage.getItem("voycelab.pending_plan"));

  useEffect(() => {
    if (!socialNotice) return;
    const id = window.setTimeout(() => setSocialNotice(null), 4500);
    return () => window.clearTimeout(id);
  }, [socialNotice]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signup.mutate(
      { name: name.trim(), email: email.trim(), password },
      {
        onSuccess: () => {
          setLocation(sessionStorage.getItem("voycelab.pending_plan") ? "/pricing" : "/onboarding");
        },
      },
    );
  };

  return (
    <AuthShell>
      <AuthHeader
        title="Create account"
        subtitle={hasPendingPlan ? "Create your account, then finish secure checkout." : "14 days free. No card required."}
      />

      <div className="mt-8 space-y-5">
        <div className="space-y-3">
          <SocialButton
            label="Continue with Google"
            icon={<GoogleGlyph />}
            onClick={() => setSocialNotice("Google sign-up is coming soon. Use your email below to continue.")}
          />
          <SocialButton
            label="Continue with X"
            icon={<XGlyph />}
            onClick={() => setSocialNotice("X sign-up is coming soon. Use your email below to continue.")}
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

        <form onSubmit={handleSubmit} className="space-y-3">
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
          <InputGroup label="Email" htmlFor="signup-email">
            <input
              id="signup-email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="name@venue.com"
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
            action={<ConicSubmitButton label={hasPendingPlan ? "Continue to checkout" : "Start free trial"} pending={signup.isPending} />}
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

          <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-gray-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Disconnect Square anytime. Your data stays yours.
          </p>
        </form>
      </div>

      <p className="mt-10 text-center text-sm text-gray-500">
        Have an account? <SunsetLink href="/login">Sign in</SunsetLink>
      </p>
    </AuthShell>
  );
}
