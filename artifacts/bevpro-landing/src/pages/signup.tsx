import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSignup } from "@/hooks/use-auth";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { WaveformBackground } from "@/components/waveform-background";

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

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4 py-12">
      <WaveformBackground />
      
      <Link href="/" className="absolute top-8 left-8 text-muted-foreground hover:text-white flex items-center gap-2 transition-colors z-20">
        <ArrowLeft className="w-4 h-4" /> Home
      </Link>

      <div className="w-full max-w-[900px] grid md:grid-cols-2 gap-8 items-center z-10">
        {/* Left Side - Value Prop */}
        <div className="hidden md:flex flex-col text-white pr-8">
          <h2 className="text-4xl font-bold tracking-tight mb-6 glow-text">Run faster.<br/>Serve more.</h2>
          <ul className="space-y-6">
            {[
              "14-day full access free trial",
              "No credit card required",
              "Connect Square in 30 seconds",
              "Start taking voice orders instantly"
            ].map((text, i) => (
              <li key={i} className="flex items-center gap-3 text-white/80 text-lg font-light">
                <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* Right Side - Form */}
        <div className="w-full glass-panel rounded-3xl p-8 md:p-10 border-white/10 shadow-[0_0_50px_rgba(124,110,245,0.15)]">
          <div className="flex justify-center mb-8 md:hidden">
            <Logo />
          </div>
          
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Create your account</h1>
            <p className="text-muted-foreground mt-2 text-sm">Get 14 days free. Cancel anytime.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/70 ml-1">Full Name</label>
              <Input 
                type="text" 
                placeholder="Jane Doe" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-white/70 ml-1">Work Email</label>
              <Input 
                type="email" 
                placeholder="name@venue.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/70 ml-1">Password</label>
              <Input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            {signup.error && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {signup.error.message}
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full h-12 mt-4" 
              disabled={signup.isPending}
            >
              {signup.isPending ? "Creating account..." : "Start Free Trial"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
