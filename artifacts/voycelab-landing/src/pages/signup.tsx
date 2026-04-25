import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
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
    signup.mutate(
      { name, email, password },
      { onSuccess: () => setLocation("/dashboard") }
    );
  };

  const inputStyle = {
    backgroundColor: "#F7F7F8",
    boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.04), inset -2px -2px 4px rgba(255,255,255,0.7)",
    color: "#111827",
    border: "1px solid #E5E7EB",
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center relative p-6 py-12"
      style={{ backgroundColor: "#F7F7F8" }}
    >
      <Link
        href="/"
        className="absolute top-6 left-6 flex items-center gap-1.5 transition-colors text-[13px] font-medium"
        style={{ color: "#9CA3AF" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-10">
          <Logo size="lg" />
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            backgroundColor: "#FFFFFF",
            boxShadow: "6px 6px 12px rgba(0,0,0,0.05), -6px -6px 12px rgba(255,255,255,0.9)",
          }}
        >
          <h1 className="text-xl font-bold tracking-tight text-center" style={{ color: "#111827" }}>
            Create account
          </h1>
          <p className="text-[13px] text-center mt-1.5 mb-8" style={{ color: "#9CA3AF" }}>
            14 days free, no card required
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold tracking-wide" style={{ color: "#6B7280" }}>
                Name
              </label>
              <input
                type="text"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                style={inputStyle}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold tracking-wide" style={{ color: "#6B7280" }}>
                Email
              </label>
              <input
                type="email"
                placeholder="name@venue.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                style={inputStyle}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold tracking-wide" style={{ color: "#6B7280" }}>
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full h-11 px-4 rounded-xl text-[14px] outline-none transition-all focus:ring-2 focus:ring-[#2563EB]/20"
                style={inputStyle}
              />
            </div>

            {signup.error && (
              <p className="text-[13px]" style={{ color: "#EF4444" }}>{signup.error.message}</p>
            )}

            <button
              type="submit"
              disabled={signup.isPending}
              className="w-full h-11 rounded-xl text-[14px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5 disabled:opacity-60"
              style={{ backgroundColor: "#2563EB" }}
            >
              {signup.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating account...
                </span>
              ) : (
                "Get Started"
              )}
            </button>
          </form>
        </div>

        <p className="mt-8 text-center text-[13px]" style={{ color: "#9CA3AF" }}>
          Have an account?{" "}
          <Link href="/login" className="font-medium transition-colors hover:underline" style={{ color: "#2563EB" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
