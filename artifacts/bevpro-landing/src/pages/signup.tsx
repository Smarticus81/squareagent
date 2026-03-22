import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSignup } from "@/hooks/use-auth";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

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
    <div className="min-h-screen flex items-center justify-center relative bg-background p-4 py-12">
      
      <Link href="/" className="absolute top-8 left-8 text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors z-20 text-sm font-medium">
        <ArrowLeft className="w-4 h-4" /> Home
      </Link>

      <div className="w-full max-w-[900px] grid md:grid-cols-2 gap-12 lg:gap-24 items-center z-10">
        {/* Left Side - Value Prop */}
        <div className="hidden md:flex flex-col pr-8">
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-8 text-foreground leading-[1.1]">Run faster.<br/>Serve more.</h2>
          <ul className="space-y-6">
            {[
              "14-day full access free trial",
              "No credit card required",
              "Connect Square in 30 seconds",
              "Start taking voice orders instantly"
            ].map((text, i) => (
              <li key={i} className="flex items-center gap-4 text-muted-foreground text-lg font-light">
                <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* Right Side - Form */}
        <div className="w-full bg-card rounded-3xl border border-border p-10 md:p-12 shadow-xl shadow-primary/5">
          <div className="flex justify-center mb-10 md:hidden">
            <Logo />
          </div>
          
          <div className="mb-10">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Create your account</h1>
            <p className="text-muted-foreground mt-2 text-sm font-light">Get 14 days free. Cancel anytime.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground uppercase tracking-wide">Full Name</label>
              <Input 
                type="text" 
                placeholder="Jane Doe" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="rounded-xl border-border focus-visible:ring-primary bg-background"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground uppercase tracking-wide">Work Email</label>
              <Input 
                type="email" 
                placeholder="name@venue.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="rounded-xl border-border focus-visible:ring-primary bg-background"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground uppercase tracking-wide">Password</label>
              <Input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="rounded-xl border-border focus-visible:ring-primary bg-background"
              />
            </div>

            {signup.error && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {signup.error.message}
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full h-12 mt-6 rounded-2xl" 
              disabled={signup.isPending}
            >
              {signup.isPending ? "Creating account..." : "Start Free Trial"}
            </Button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground font-light">
            Already have an account?{" "}
            <Link href="/login" className="text-foreground hover:text-primary font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}