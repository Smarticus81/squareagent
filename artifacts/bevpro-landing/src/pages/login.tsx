import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLogin } from "@/hooks/use-auth";
import { ArrowLeft } from "lucide-react";
import { WaveformBackground } from "@/components/waveform-background";

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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4">
      <WaveformBackground />
      
      <Link href="/" className="absolute top-8 left-8 text-muted-foreground hover:text-white flex items-center gap-2 transition-colors z-20">
        <ArrowLeft className="w-4 h-4" /> Home
      </Link>

      <div className="w-full max-w-md glass-panel rounded-3xl p-8 md:p-10 relative z-10 border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="flex justify-center mb-8">
          <Logo />
        </div>
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="text-muted-foreground mt-2 text-sm">Sign in to manage your venue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70 ml-1">Email</label>
            <Input 
              type="email" 
              placeholder="name@venue.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <div className="space-y-1">
            <div className="flex justify-between items-center ml-1">
              <label className="text-xs font-medium text-white/70">Password</label>
              <a href="#" className="text-xs text-primary hover:underline">Forgot?</a>
            </div>
            <Input 
              type="password" 
              placeholder="••••••••" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {login.error && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {login.error.message}
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full h-12 mt-2" 
            disabled={login.isPending}
          >
            {login.isPending ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline font-medium">
            Start free trial
          </Link>
        </div>
      </div>
    </div>
  );
}
