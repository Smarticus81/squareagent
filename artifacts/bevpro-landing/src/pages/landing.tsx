import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Mic, Zap, BarChart3, ArrowRight, CheckCircle2 } from "lucide-react";

export default function Landing() {
  return (
    <div className="flex-1 bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 min-h-[90vh] flex items-center justify-center">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-card/50 backdrop-blur-sm mb-12"
          >
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-medium text-foreground tracking-wide uppercase">Bevpro Voice Agent is Live</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-7xl lg:text-[6rem] font-bold tracking-tighter text-foreground mx-auto leading-[1.05]"
          >
            Your bar runs on <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500">your voice.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-8 text-xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed"
          >
            The ultra-low latency voice ordering system for high-volume event bars.
            Connects seamlessly to Square POS. No tapping, no screens — just speak.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-12 flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Link href="/signup">
              <Button size="lg" className="w-full sm:w-auto text-lg rounded-2xl h-14 px-8 group shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow">
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="outline" size="lg" className="w-full sm:w-auto text-lg rounded-2xl h-14 px-8">
                See How It Works
              </Button>
            </a>
          </motion.div>
        </div>
      </section>

      <div className="w-full max-w-5xl mx-auto px-8">
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
      </div>

      {/* How It Works */}
      <section id="how-it-works" className="py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-6">It's incredibly simple.</h2>
            <p className="text-muted-foreground text-xl font-light">Set up in minutes, train staff in seconds.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {[
              {
                icon: <BarChart3 className="w-6 h-6 text-violet-500" />,
                title: "1. Connect Square",
                desc: "Securely link your existing Square account. Bevpro instantly imports your menu catalog and prices.",
                gradient: "from-violet-500/10 to-violet-500/5",
              },
              {
                icon: <Mic className="w-6 h-6 text-indigo-500" />,
                title: '2. Say "Hey Bar"',
                desc: "Walk up to the iPad and say the wake word. Then naturally state the order: '4 Fosters, 2 Amarula'.",
                gradient: "from-indigo-500/10 to-indigo-500/5",
              },
              {
                icon: <Zap className="w-6 h-6 text-cyan-500" />,
                title: "3. Order Processed",
                desc: "The AI confirms the order instantly, logs it in Square, and records the external payment automatically.",
                gradient: "from-cyan-500/10 to-cyan-500/5",
              }
            ].map((step, i) => (
              <div
                key={i}
                className="bg-card rounded-3xl border border-border p-10 flex flex-col items-start transition-all hover:border-foreground/15 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.gradient} flex items-center justify-center mb-8 border border-border`}>
                  {step.icon}
                </div>
                <h3 className="text-xl font-bold text-foreground mb-4">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed font-light">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="w-full max-w-5xl mx-auto px-8">
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
      </div>

      {/* Square Callout */}
      <section className="py-32 bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-foreground rounded-2xl mb-10 shadow-lg">
            {/* Minimal Square logo representation */}
            <div className="w-6 h-6 bg-foreground relative border-2 border-background rounded-sm">
              <div className="absolute inset-1 bg-background rounded-[1px]"></div>
            </div>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-8">Built natively for Square.</h2>
          <p className="text-xl text-muted-foreground mb-12 leading-relaxed font-light">
            Works with Square Point of Sale — the world's leading bar & restaurant platform.
            You need a Square account to use Bevpro. Every voice order appears in your standard sales reports.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm font-medium text-foreground">
            {["Syncs Catalog", "Creates Orders", "Logs Payments"].map((feature) => (
              <span key={feature} className="flex items-center gap-2 bg-card border border-border rounded-full px-5 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {feature}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="w-full max-w-5xl mx-auto px-8">
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
      </div>

      {/* Pricing */}
      <section id="pricing" className="py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-6">Simple pricing.</h2>
            <p className="text-muted-foreground text-xl font-light">One flat rate for your venue. Unlimited orders.</p>
          </div>

          <div className="max-w-md mx-auto">
            <div className="bg-card rounded-3xl border border-border p-10 md:p-12 relative overflow-hidden shadow-lg shadow-primary/5">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500 rounded-t-3xl"></div>

              <div className="mb-10">
                <h3 className="text-2xl font-bold text-foreground mb-2">Venue Pro</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-6xl font-bold tracking-tighter text-foreground">$49</span>
                  <span className="text-muted-foreground font-light">/ month</span>
                </div>
                <p className="text-emerald-500 font-medium text-sm">14-day free trial</p>
              </div>

              <ul className="space-y-5 mb-12">
                {[
                  "Unlimited voice orders",
                  "Continuous wake-word listening",
                  "Real-time Square POS sync",
                  "Live inventory queries via voice",
                  "iPad & Mobile web app access",
                  "Premium email support"
                ].map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground font-light">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link href="/signup">
                <Button size="lg" className="w-full text-base h-14 rounded-2xl shadow-lg shadow-primary/20">
                  Start Free Trial
                </Button>
              </Link>
              <p className="text-center text-xs text-muted-foreground mt-6 font-light">
                No credit card required to start. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
