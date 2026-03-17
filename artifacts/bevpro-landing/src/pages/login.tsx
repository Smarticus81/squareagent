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
    <div className="min-h-screen flex items-center justify-center relative bg-background p-4">
      
      <Link href="/" className="absolute top-8 left-8 text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors z-20 text-sm font-medium">
        <ArrowLeft className="w-4 h-4" /> Home
      </Link>

      <div className="w-full max-w-sm bg-card border border-border p-10 md:p-12 relative z-10">
        <div className="flex justify-center mb-10">
          <Logo />
        </div>
        
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-2 text-sm font-light">Sign in to manage your venue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground uppercase tracking-wide">Email</label>
            <Input 
              type="email" 
              placeholder="name@venue.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-none border-border focus-visible:ring-primary bg-background"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium text-foreground uppercase tracking-wide">Password</label>
              <a href="#" className="text-xs text-primary hover:underline font-medium">Forgot?</a>
            </div>
            <Input 
              type="password" 
              placeholder="••••••••" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded-none border-border focus-visible:ring-primary bg-background"
            />
          </div>

          {login.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {login.error.message}
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full h-12 mt-4 rounded-none" 
            disabled={login.isPending}
          >
            {login.isPending ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground font-light">
          Don't have an account?{" "}
          <Link href="/signup" className="text-foreground hover:text-primary font-medium transition-colors">
            Start free trial
          </Link>
        </div>
      </div>
    </div>
  );
}