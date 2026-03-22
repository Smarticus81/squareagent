import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLogin } from "@/hooks/use-auth";
import { ArrowLeft } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: () => setLocation("/dashboard") }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-background p-6">
      <Link href="/" className="absolute top-6 left-6 text-foreground/35 hover:text-foreground flex items-center gap-1.5 transition-colors text-[13px]">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="w-full max-w-[340px]">
        <div className="flex justify-center mb-10">
          <Logo />
        </div>

        <h1 className="text-xl font-display font-medium tracking-tight text-foreground text-center">Sign in</h1>
        <p className="text-foreground/40 text-[13px] font-light text-center mt-1.5 mb-8">Welcome back</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground/50 tracking-wide">Email</label>
            <Input
              type="email"
              placeholder="name@venue.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-10 bg-background border-foreground/10 focus-visible:ring-foreground/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground/50 tracking-wide">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-10 bg-background border-foreground/10 focus-visible:ring-foreground/20"
            />
          </div>

          {login.error && (
            <p className="text-[13px] text-destructive">{login.error.message}</p>
          )}

          <Button type="submit" className="w-full h-10 mt-2" disabled={login.isPending}>
            {login.isPending ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <p className="mt-8 text-center text-[13px] text-foreground/35 font-light">
          No account?{" "}
          <Link href="/signup" className="text-foreground/70 hover:text-foreground transition-colors">
            Get started
          </Link>
        </p>
      </div>
    </div>
  );
}