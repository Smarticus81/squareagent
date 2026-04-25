import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import { VoiceRail } from "@/components/voice-rail";
import { useLogin } from "@/hooks/use-auth";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => setLocation("/command") });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative p-6">
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
            Open the console
          </h1>
          <p className="text-[13px] text-center mt-1.5" style={{ color: "rgba(245,239,227,0.55)" }}>
            Welcome back.
          </p>
          <div className="mt-6 mb-2">
            <VoiceRail state="ready" intensity={0.4} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 mt-6">
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
                className="vl-input"
              />
            </Field>

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
        </div>

        <p className="mt-8 text-center text-[13px]" style={{ color: "rgba(245,239,227,0.55)" }}>
          No account?{" "}
          <Link href="/signup" className="font-medium hover:underline" style={{ color: "var(--color-vl-brass2)" }}>
            Configure your agent
          </Link>
        </p>
      </div>

      <FieldStyles />
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

function FieldStyles() {
  return (
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
  );
}
