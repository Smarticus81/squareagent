import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import { VoiceRail } from "@/components/voice-rail";
import { useSignup } from "@/hooks/use-auth";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function Signup() {
  const [, setLocation] = useLocation();
  const signup = useSignup();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signup.mutate({ name, email, password }, { onSuccess: () => setLocation("/onboarding") });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative p-6 py-12 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 45% at 15% 15%, rgba(251, 207, 232,0.40), transparent 65%), radial-gradient(ellipse 50% 40% at 85% 85%, rgba(167, 243, 208,0.35), transparent 65%), radial-gradient(ellipse 40% 35% at 90% 15%, rgba(199, 210, 254,0.30), transparent 65%)",
        }}
      />

      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-1.5 text-[13px] font-medium hover:opacity-80 transition-opacity"
        style={{ color: "var(--color-vl-ink-muted)" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="relative w-full max-w-105">
        <div className="flex justify-center mb-8">
          <Logo size="lg" withTagline />
        </div>

        <div className="vl-card vl-edge-coral p-8">
          <h1
            className="vl-display text-[28px] text-center"
            style={{ color: "var(--color-vl-ink)" }}
          >
            Put your venue <em>in conversation.</em>
          </h1>
          <p
            className="text-[14px] text-center mt-2"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            14 days free · No card required
          </p>
          <div className="mt-6 mb-2">
            <VoiceRail state="ready" intensity={0.5} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 mt-6">
            <Field label="Name">
              <input
                type="text"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="vl-input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                placeholder="name@venue.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="vl-input"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="vl-input"
              />
            </Field>

            {signup.error && (
              <p className="text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
                {signup.error.message}
              </p>
            )}

            <button type="submit" disabled={signup.isPending} className="vl-btn-primary w-full">
              {signup.isPending ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating account…
                </span>
              ) : (
                "Start free trial"
              )}
            </button>
          </form>
        </div>

        <p
          className="mt-8 text-center text-[13.5px]"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          Have an account?{" "}
          <Link
            href="/login"
            className="font-semibold hover:underline"
            style={{ color: "var(--color-vl-coral-deep)" }}
          >
            Sign in
          </Link>
        </p>
      </div>
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
