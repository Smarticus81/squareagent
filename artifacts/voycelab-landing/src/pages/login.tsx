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
    login.mutate({ email, password }, {
      onSuccess: () => {
        setLocation(sessionStorage.getItem("voycelab.pending_plan") ? "/pricing" : "/assistants");
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative p-6 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 45% at 15% 20%, rgba(251, 207, 232,0.40), transparent 65%), radial-gradient(ellipse 50% 40% at 90% 80%, rgba(199, 210, 254,0.35), transparent 65%)",
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

        <div className="vl-card vl-edge-coral p-8 login-card">
          <h1
            className="vl-display text-[28px] text-center"
            style={{ color: "var(--color-vl-ink)" }}
          >
            Welcome <em>back.</em>
          </h1>
          <p
            className="text-[14px] text-center mt-2"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            Open your assistants and pick up where you left off.
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
