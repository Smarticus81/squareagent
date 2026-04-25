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
    signup.mutate({ name, email, password }, { onSuccess: () => setLocation("/command") });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative p-6 py-12">
      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-1.5 text-[13px] font-medium"
        style={{ color: "rgba(245,239,227,0.55)" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-10">
          <Logo size="lg" />
        </div>

        <div className="vl-panel vl-edge-brass p-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-center" style={{ color: "var(--color-vl-ivory)" }}>
            Configure your agent
          </h1>
          <p className="text-[13px] text-center mt-1.5" style={{ color: "rgba(245,239,227,0.55)" }}>
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

        <p className="mt-8 text-center text-[13px]" style={{ color: "rgba(245,239,227,0.55)" }}>
          Have an account?{" "}
          <Link href="/login" className="font-medium hover:underline" style={{ color: "var(--color-vl-brass2)" }}>
            Sign in
          </Link>
        </p>
      </div>

      <style>{`
        .vl-input {
          width: 100%;
          height: 44px;
          padding: 0 14px;
          border-radius: 12px;
          background: rgba(245,239,227,0.04);
          border: 1px solid rgba(245,239,227,0.12);
          color: var(--color-vl-ivory);
          font-size: 14px;
          outline: none;
          transition: border-color .2s ease, background .2s ease;
        }
        .vl-input::placeholder { color: rgba(245,239,227,0.35); }
        .vl-input:focus { border-color: rgba(124,110,245,0.7); background: rgba(245,239,227,0.06); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="vl-eyebrow block mb-1.5" style={{ color: "rgba(245,239,227,0.55)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
