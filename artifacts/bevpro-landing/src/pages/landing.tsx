import { Link } from "wouter";
import { motion } from "framer-motion";
import { WaveformBackground } from "@/components/waveform-background";
import { Button } from "@/components/ui/button";
import { Mic, Zap, BarChart3, ArrowRight, CheckCircle2 } from "lucide-react";

export default function Landing() {
  return (
    <div className="flex-1">
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden min-h-[90vh] flex items-center">
        <WaveformBackground />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-panel mb-8"
          >
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse"></span>
            <span className="text-sm font-medium text-white/80">Bevpro Voice Agent is Live</span>
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter text-white max-w-5xl mx-auto leading-[1.1]"
          >
            Your bar runs on <br className="hidden md:block"/>
            <span className="gradient-text-primary glow-text">your voice.</span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="mt-8 text-xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed"
          >
            The ultra-low latency voice ordering system for high-volume event bars. 
            Connects seamlessly to Square POS. No tapping, no screens—just speak.
          </motion.p>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
            className="mt-12 flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Link href="/signup">
              <Button size="lg" className="w-full sm:w-auto text-lg group">
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="glass" size="lg" className="w-full sm:w-auto text-lg">
                See How It Works
              </Button>
            </a>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 bg-background border-t border-white/5 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">It's incredibly simple.</h2>
            <p className="text-muted-foreground text-lg">Set up in minutes, train staff in seconds.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <BarChart3 className="w-8 h-8 text-primary" />,
                title: "1. Connect Square",
                desc: "Securely link your existing Square account. Bevpro instantly imports your menu catalog and prices."
              },
              {
                icon: <Mic className="w-8 h-8 text-primary" />,
                title: '2. Say "Hey Bar"',
                desc: "Walk up to the iPad and say the wake word. Then naturally state the order: '4 Fosters, 2 Amarula'."
              },
              {
                icon: <Zap className="w-8 h-8 text-primary" />,
                title: "3. Order Processed",
                desc: "The AI confirms the order instantly, logs it in Square, and records the external payment automatically."
              }
            ].map((step, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="glass-panel rounded-3xl p-8 relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors"></div>
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                  {step.icon}
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Square Callout */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary/5"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-primary/10 blur-[120px] rounded-full pointer-events-none"></div>
        
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white shadow-2xl mb-8">
            {/* Minimal Square logo representation */}
            <div className="w-8 h-8 bg-black rounded-sm relative">
              <div className="absolute inset-2 bg-white rounded-sm"></div>
            </div>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Built natively for Square.</h2>
          <p className="text-xl text-muted-foreground mb-10 leading-relaxed font-light">
            Works with Square Point of Sale — the world's leading bar & restaurant platform. 
            You need a Square account to use Bevpro. Every voice order appears in your standard sales reports.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-sm font-medium text-white/80">
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Syncs Catalog</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Creates Orders</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Logs Payments</span>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-background border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Simple, transparent pricing.</h2>
            <p className="text-muted-foreground text-lg">One flat rate for your venue. Unlimited orders.</p>
          </div>

          <div className="max-w-lg mx-auto">
            <div className="glass-panel rounded-3xl p-8 md:p-12 relative overflow-hidden border-primary/20">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
              
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">Venue Pro</h3>
                <div className="flex items-end justify-center gap-1 mb-2">
                  <span className="text-5xl font-bold text-white">$49</span>
                  <span className="text-muted-foreground mb-1">/ month</span>
                </div>
                <p className="text-primary font-medium text-sm">14-day free trial</p>
              </div>

              <ul className="space-y-4 mb-10">
                {[
                  "Unlimited voice orders",
                  "Continuous wake-word listening",
                  "Real-time Square POS sync",
                  "Live inventory queries via voice",
                  "iPad & Mobile web app access",
                  "Premium email support"
                ].map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-white/80">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link href="/signup">
                <Button size="lg" className="w-full text-base h-14">
                  Start Free Trial
                </Button>
              </Link>
              <p className="text-center text-xs text-muted-foreground mt-4">
                No credit card required to start. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
