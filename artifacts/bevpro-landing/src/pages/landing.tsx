import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Mic, Zap, ShieldCheck, BarChart3, Clock, Smartphone } from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const } }),
};

export default function Landing() {
  return (
    <div className="flex-1 bg-background text-foreground overflow-hidden">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-36 flex items-center justify-center">
        {/* Subtle radial glow behind orb */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-foreground/[0.02] rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mx-auto mb-10 w-20 h-20 relative"
          >
            {/* Animated orb — mirrors the voice agent UI */}
            <div className="absolute inset-0 rounded-full bg-foreground/[0.04] animate-pulse" />
            <div className="absolute inset-2 rounded-full bg-foreground/[0.06]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Mic className="w-7 h-7 text-foreground/40" strokeWidth={1.5} />
            </div>
          </motion.div>

          <motion.p
            initial="hidden" animate="visible" custom={0} variants={fadeUp}
            className="text-[11px] font-medium tracking-[0.3em] uppercase text-foreground/30 mb-5"
          >
            Voice-powered POS
          </motion.p>

          <motion.h1
            initial="hidden" animate="visible" custom={1} variants={fadeUp}
            className="text-4xl md:text-6xl lg:text-7xl font-display font-semibold tracking-tight text-foreground leading-[1.06]"
          >
            Take orders
            <br />
            with your voice
          </motion.h1>

          <motion.p
            initial="hidden" animate="visible" custom={2} variants={fadeUp}
            className="mt-7 text-base md:text-lg text-foreground/45 max-w-md mx-auto font-light leading-relaxed"
          >
            Say the order. It lands in Square instantly.
            No tapping, no screens, no time&nbsp;wasted.
          </motion.p>

          <motion.div
            initial="hidden" animate="visible" custom={3} variants={fadeUp}
            className="mt-10 flex gap-3 justify-center"
          >
            <Link href="/signup">
              <Button size="lg" className="h-11 px-7 text-[14px] group">
                Start free trial
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="h-11 px-7 text-[14px] border-foreground/10 text-foreground/60">
                Sign in
              </Button>
            </Link>
          </motion.div>

          <motion.p
            initial="hidden" animate="visible" custom={4} variants={fadeUp}
            className="mt-4 text-[12px] text-foreground/25 font-light"
          >
            14 days free &middot; No credit card required
          </motion.p>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="py-20 lg:py-28">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-foreground/30 mb-4">How it works</p>
            <h2 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground">
              Three steps. Zero friction.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-6">
            {[
              {
                n: "01",
                title: "Connect Square",
                desc: "Link your account in one click. Your full menu catalog syncs automatically.",
              },
              {
                n: "02",
                title: "Speak the order",
                desc: "\"Four Fosters and two Amarula.\" Confirmed in real time, no typing needed.",
              },
              {
                n: "03",
                title: "Done",
                desc: "Order created, payment logged, inventory updated — all inside Square.",
              },
            ].map((step, i) => (
              <motion.div
                key={step.n}
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
                custom={i} variants={fadeUp}
                className="relative p-6 border border-foreground/[0.06] bg-card"
              >
                <span className="text-[11px] font-medium text-foreground/20 tabular-nums tracking-wider">{step.n}</span>
                <h3 className="text-[16px] font-medium text-foreground mt-3">{step.title}</h3>
                <p className="text-[14px] text-foreground/40 font-light mt-2 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features grid ─────────────────────────────────────── */}
      <section className="py-20 lg:py-28 border-t border-foreground/[0.06]">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-foreground/30 mb-4">Why Bevpro</p>
            <h2 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground">
              Built for speed behind the bar
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-foreground/[0.06]">
            {[
              { icon: Zap, title: "Sub-second response", desc: "Orders confirmed before the customer finishes speaking." },
              { icon: ShieldCheck, title: "Square-native", desc: "Creates real orders with payment records and sales reporting." },
              { icon: Clock, title: "Always listening", desc: "Say \"Hey Bar\" to activate. Hands stay free for pouring." },
              { icon: BarChart3, title: "Live inventory", desc: "Counts update in Square as orders come through." },
              { icon: Smartphone, title: "Any device", desc: "Works on iPad, iPhone, Android — any browser with a mic." },
              { icon: Mic, title: "Natural language", desc: "No rigid commands. Speak like you normally would." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
                custom={i} variants={fadeUp}
                className="bg-background p-7"
              >
                <f.icon className="w-5 h-5 text-foreground/25 mb-4" strokeWidth={1.5} />
                <h3 className="text-[15px] font-medium text-foreground">{f.title}</h3>
                <p className="text-[13px] text-foreground/40 font-light mt-1.5 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────── */}
      <section className="py-20 lg:py-28 border-t border-foreground/[0.06]">
        <div className="max-w-lg mx-auto px-6 text-center">
          <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-foreground/30 mb-4">Pricing</p>
          <h2 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground mb-10">
            Simple, per-venue pricing
          </h2>

          <div className="border border-foreground/[0.06] bg-card p-8 md:p-10">
            <div className="mb-1">
              <span className="text-5xl font-display font-semibold tracking-tight text-foreground">$49</span>
              <span className="text-foreground/30 font-light ml-1">/mo</span>
            </div>
            <p className="text-[13px] text-foreground/35 font-light mb-8">per venue &middot; unlimited orders</p>

            <ul className="text-left space-y-3 mb-8 max-w-[260px] mx-auto">
              {[
                "Unlimited voice orders",
                "Real-time Square sync",
                "Inventory tracking via voice",
                "iPad & mobile access",
                "Wake-word activation",
                "Priority support",
              ].map((f, i) => (
                <li key={i} className="text-[14px] text-foreground/55 font-light flex items-center gap-2.5">
                  <span className="w-1 h-1 rounded-full bg-foreground/20 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Link href="/signup">
              <Button size="lg" className="w-full h-11 text-[14px]">
                Start 14-day free trial
              </Button>
            </Link>
            <p className="text-[12px] text-foreground/25 mt-3 font-light">
              No credit card required
            </p>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <section className="py-20 lg:py-28 border-t border-foreground/[0.06]">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground mb-4">
            Ready to speed up your bar?
          </h2>
          <p className="text-foreground/40 font-light mb-8 max-w-md mx-auto">
            Set up in under two minutes. Connect Square, say your first order, and go.
          </p>
          <Link href="/signup">
            <Button size="lg" className="h-11 px-8 text-[14px] group">
              Get started free
              <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
