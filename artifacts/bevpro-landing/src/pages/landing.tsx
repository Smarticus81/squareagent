import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, AudioLines, Layers, Mic, Volume2 } from "lucide-react";
import { motion, useScroll, useTransform, useMotionValue, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/* ── Animation variants ────────────────────────────────────── */
const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.12, duration: 0.7, ease },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.3 } },
};

/* ── Live waveform bars ────────────────────────────────────── */
function WaveformBars({ count = 32, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`flex items-end justify-center gap-[3px] ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-primary/30"
          animate={{
            height: [
              `${12 + Math.random() * 16}px`,
              `${28 + Math.random() * 52}px`,
              `${12 + Math.random() * 16}px`,
            ],
          }}
          transition={{
            duration: 1.8 + Math.random() * 1.4,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.06,
          }}
        />
      ))}
    </div>
  );
}

/* ── Animated counter ──────────────────────────────────────── */
function Counter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const count = useMotionValue(0);
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const controls = animate(count, value, {
      duration: 2,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v).toString()),
    });
    return controls.stop;
  }, [value, count]);

  return <>{display}{suffix}</>;
}

/* ── Bar Rail mockup ───────────────────────────────────────── */
function BarRailMockup() {
  return (
    <div className="relative w-full max-w-[360px] mx-auto">
      {/* Phone frame */}
      <div className="relative bg-secondary border border-border rounded-2xl aspect-[9/16] overflow-hidden">
        {/* Status bar */}
        <div className="h-6 bg-background/50 flex items-center justify-between px-4">
          <span className="text-[8px] text-foreground/40">9:41</span>
          <div className="flex gap-1">
            <div className="w-3 h-1.5 rounded-sm bg-foreground/20" />
            <div className="w-3 h-1.5 rounded-sm bg-foreground/20" />
          </div>
        </div>

        {/* Ghost conversation */}
        <div className="flex-1 flex flex-col justify-end px-6 pt-12 pb-4 gap-3">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 0.3 }}
            transition={{ delay: 0.6, duration: 1 }}
            className="text-center text-[11px] text-foreground font-light"
          >
            two Hendricks gin and tonics
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 0.7 }}
            transition={{ delay: 1.0, duration: 1 }}
            className="text-center text-[13px] text-foreground font-normal"
          >
            Got it — 2 Hendricks G&T added. $28.00 total.
          </motion.p>
        </div>

        {/* Bar rail at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <motion.div
            initial={{ scaleX: 0.3, opacity: 0 }}
            whileInView={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: 0.3, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="h-[3px] rounded-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"
          />
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.6 }}
            className="mt-3 flex items-center justify-between"
          >
            <span className="text-[9px] tracking-[3px] text-primary/50 uppercase">listening</span>
            <div className="flex gap-[2px]">
              {Array.from({ length: 8 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-[2px] rounded-full bg-primary/40"
                  animate={{ height: [`${3}px`, `${6 + Math.random() * 10}px`, `${3}px`] }}
                  transition={{ duration: 0.8 + Math.random() * 0.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.08 }}
                />
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ── Main landing page ─────────────────────────────────────── */
export default function Landing() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.8], [1, 0.96]);

  return (
    <div className="flex-1 bg-background text-foreground overflow-hidden">

      {/* ── Hero — "Your Bar, In Sync" ─────────────────────── */}
      <motion.section
        ref={heroRef}
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-[100vh] flex items-center justify-center overflow-hidden"
      >
        {/* Atmospheric gradient layers */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,_hsl(var(--primary)/0.15),_transparent_70%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background to-transparent" />

        {/* Subtle waveform background */}
        <div className="absolute bottom-24 left-0 right-0 opacity-40 pointer-events-none">
          <WaveformBars count={48} className="h-20" />
        </div>

        <div className="max-w-4xl mx-auto px-6 text-center relative z-10 pt-20">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="mb-8 flex items-center justify-center gap-3"
          >
            <motion.div
              animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="w-2 h-2 rounded-full bg-primary/60"
            />
            <span className="text-[11px] font-medium tracking-[0.35em] uppercase text-primary/70">
              Voice-Powered Assistant
            </span>
            <motion.div
              animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
              className="w-2 h-2 rounded-full bg-primary/60"
            />
          </motion.div>

          <motion.h1
            initial="hidden" animate="visible" custom={0} variants={fadeUp}
            className="text-5xl md:text-7xl lg:text-8xl font-display font-semibold tracking-tight text-foreground leading-[1.02]"
          >
            Your Bar,
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary to-primary/60">
              In Sync
            </span>
          </motion.h1>

          <motion.p
            initial="hidden" animate="visible" custom={1} variants={fadeUp}
            className="mt-8 text-lg md:text-xl text-foreground/60 max-w-lg mx-auto font-light leading-relaxed"
          >
            A voice agent that works at the speed of your bar.
            Speak the order — it lands in Square&nbsp;instantly.
          </motion.p>

          <motion.div
            initial="hidden" animate="visible" custom={2} variants={fadeUp}
            className="mt-12"
          >
            <Link href="/signup">
              <Button size="lg" className="h-12 px-10 text-[15px] group">
                Get Started
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <p className="mt-4 text-[12px] text-foreground/40 font-light">
              14 days free &middot; No credit card
            </p>
          </motion.div>
        </div>
      </motion.section>

      {/* ── Social proof bar ──────────────────────────────────── */}
      <section className="py-16 border-y border-border">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={stagger}
            className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12"
          >
            {[
              { value: 200, suffix: "+", label: "Venues" },
              { value: 50, suffix: "K+", label: "Voice orders" },
              { value: 400, suffix: "ms", label: "Avg. response" },
              { value: 99.9, suffix: "%", label: "Uptime" },
            ].map((stat, i) => (
              <motion.div key={stat.label} variants={fadeUp} custom={i} className="text-center">
                <div className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-foreground">
                  {stat.suffix === "%" ? "99.9%" : <Counter value={stat.value} suffix={stat.suffix} />}
                </div>
                <p className="text-[12px] text-foreground/50 font-light mt-1 tracking-wider uppercase">{stat.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── How it works — visual story ───────────────────────── */}
      <section className="py-24 lg:py-36">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-20">
            <motion.p
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
              className="text-[11px] font-medium tracking-[0.3em] uppercase text-primary/60 mb-4"
            >
              How it works
            </motion.p>
            <motion.h2
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
              className="text-3xl md:text-5xl font-display font-semibold tracking-tight text-foreground"
            >
              Three moments. Zero&nbsp;friction.
            </motion.h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                n: "01",
                title: "Speak naturally",
                desc: "\"Four Fosters and two Amarula on tab twelve.\" Just talk — the agent understands context, corrections, and bar slang.",
                visual: (
                  <div className="flex items-center justify-center gap-[3px] h-16 mt-4 mb-2">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-[3px] rounded-full bg-primary/20"
                        animate={{ height: [`${6}px`, `${14 + Math.random() * 30}px`, `${6}px`] }}
                        transition={{ duration: 1.2 + Math.random(), repeat: Infinity, ease: "easeInOut", delay: i * 0.07 }}
                      />
                    ))}
                  </div>
                ),
              },
              {
                n: "02",
                title: "See instantly",
                desc: "The order appears on your bar rail in real time. Confirm with a glance — no screens to tap, no menus to scroll.",
                visual: (
                  <div className="mt-4 mb-2 flex flex-col items-center gap-2">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: "80%" }}
                      transition={{ delay: 0.5, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      className="h-[2px] rounded-full bg-primary/30"
                    />
                    <div className="flex items-center gap-3 text-[11px] text-foreground/50">
                      <span>4× Foster's</span>
                      <span className="w-0.5 h-0.5 rounded-full bg-foreground/15" />
                      <span>2× Amarula</span>
                    </div>
                  </div>
                ),
              },
              {
                n: "03",
                title: "Serve faster",
                desc: "Order created in Square, inventory updated, payment logged. You're already pouring the next drink.",
                visual: (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.6 }}
                    className="mt-4 mb-2 flex items-center justify-center"
                  >
                    <div className="w-10 h-10 border border-border rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-primary/60" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                  </motion.div>
                ),
              },
            ].map((step, i) => (
              <motion.div
                key={step.n}
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
                custom={i} variants={fadeUp}
                className="relative p-8 md:p-10 border border-border rounded-xl bg-card group hover:bg-secondary transition-colors"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[40px] font-display font-semibold text-primary/20 leading-none">{step.n}</span>
                </div>
                {step.visual}
                <h3 className="text-[18px] font-display font-medium text-foreground mt-4">{step.title}</h3>
                <p className="text-[14px] text-foreground/60 font-light mt-2 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features — 3 large blocks ─────────────────────────── */}
      <section className="py-24 lg:py-36 border-t border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-20">
            <motion.p
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
              className="text-[11px] font-medium tracking-[0.3em] uppercase text-primary/60 mb-4"
            >
              Why Bevpro
            </motion.p>
            <motion.h2
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
              className="text-3xl md:text-5xl font-display font-semibold tracking-tight text-foreground"
            >
              Built for the pace<br className="hidden md:block" /> behind the bar
            </motion.h2>
          </div>

          {/* Feature 1: Fluid Voice */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="grid md:grid-cols-2 gap-0 border border-border rounded-xl overflow-hidden mb-4"
          >
            <div className="p-10 md:p-14 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 border border-border rounded-lg flex items-center justify-center">
                  <AudioLines className="w-5 h-5 text-primary/60" strokeWidth={1.5} />
                </div>
                <span className="text-[11px] tracking-[0.2em] uppercase text-foreground/50 font-medium">Voice</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground leading-tight">
                Fluid voice interaction
              </h3>
              <p className="text-[15px] text-foreground/60 font-light mt-4 leading-relaxed max-w-sm">
                No rigid commands. Speak naturally — corrections, additions, bar slang. The agent adapts to your rhythm, not the other way around.
              </p>
            </div>
            <div className="bg-secondary p-10 flex items-center justify-center min-h-[280px]">
              <WaveformBars count={24} className="h-24" />
            </div>
          </motion.div>

          {/* Feature 2: Square Integration */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
            className="grid md:grid-cols-2 gap-0 border border-border rounded-xl overflow-hidden mb-4"
          >
            <div className="bg-secondary p-10 flex items-center justify-center min-h-[280px] order-2 md:order-1">
              <div className="flex flex-col items-center gap-5">
                <svg className="h-12 w-12 text-foreground/30" viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 0C4.477 0 0 4.477 0 10v44c0 5.523 4.477 10 10 10h44c5.523 0 10-4.477 10-10V10c0-5.523-4.477-10-10-10H10zm30.5 16h-17C20.462 16 18 18.462 18 21.5v17c0 3.038 2.462 5.5 5.5 5.5h17c3.038 0 5.5-2.462 5.5-5.5v-17c0-3.038-2.462-5.5-5.5-5.5zM38 34a4 4 0 01-4 4H30a4 4 0 01-4-4v-4a4 4 0 014-4h4a4 4 0 014 4v4z" />
                </svg>
                <div className="flex items-center gap-2 text-[11px] text-foreground/40 tracking-wider uppercase">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
                  <span>Connected</span>
                </div>
              </div>
            </div>
            <div className="p-10 md:p-14 flex flex-col justify-center order-1 md:order-2">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 border border-border rounded-lg flex items-center justify-center">
                  <Layers className="w-5 h-5 text-primary/60" strokeWidth={1.5} />
                </div>
                <span className="text-[11px] tracking-[0.2em] uppercase text-foreground/50 font-medium">Integration</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground leading-tight">
                Seamless Square sync
              </h3>
              <p className="text-[15px] text-foreground/60 font-light mt-4 leading-relaxed max-w-sm">
                Real orders, real payments, real inventory counts. Everything flows into your Square dashboard — no middleware, no export.
              </p>
            </div>
          </motion.div>

          {/* Feature 3: Unified Agent */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={2} variants={fadeUp}
            className="grid md:grid-cols-2 gap-0 border border-border rounded-xl overflow-hidden"
          >
            <div className="p-10 md:p-14 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 border border-border rounded-lg flex items-center justify-center">
                  <Volume2 className="w-5 h-5 text-primary/60" strokeWidth={1.5} />
                </div>
                <span className="text-[11px] tracking-[0.2em] uppercase text-foreground/50 font-medium">Intelligence</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-foreground leading-tight">
                All-in-one assistant
              </h3>
              <p className="text-[15px] text-foreground/60 font-light mt-4 leading-relaxed max-w-sm">
                One voice assistant handles everything — take orders, check stock, adjust inventory, and process payments. All synced with Square.
              </p>
            </div>
            <div className="bg-secondary p-10 flex items-center justify-center min-h-[280px]">
              <div className="flex flex-col items-center gap-6">
                <div className="text-center">
                  <div className="w-14 h-14 border border-border rounded-lg flex items-center justify-center mb-2">
                    <Mic className="w-6 h-6 text-primary/40" strokeWidth={1.5} />
                  </div>
                  <span className="text-[10px] text-foreground/50 tracking-wider uppercase">Assistant</span>
                </div>
                <div className="w-16 h-[1px] bg-border" />
                <span className="text-[10px] text-foreground/40 tracking-wider">One voice. Everything handled.</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Product preview ────────────────────────────────────── */}
      <section className="py-24 lg:py-36 border-t border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            >
              <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-primary/60 mb-4">
                The Bar Rail
              </p>
              <h2 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-foreground leading-tight">
                A UI that stays<br />out of your way
              </h2>
              <p className="text-[15px] text-foreground/60 font-light mt-5 leading-relaxed">
                No dashboards. No complex menus. Just a thin, ambient rail at the bottom of your screen that pulses when listening, shimmers when thinking, and flows when speaking.
              </p>
              <p className="text-[15px] text-foreground/60 font-light mt-4 leading-relaxed">
                It's the UI equivalent of a great bartender's shadow — always there, never in the way.
              </p>
            </motion.div>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
            >
              <BarRailMockup />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Testimonials ──────────────────────────────────────── */}
      <section className="py-24 lg:py-36 border-t border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <motion.h2
              initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
              className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-foreground"
            >
              From the bar floor
            </motion.h2>
          </div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-4"
          >
            {[
              {
                quote: "We cut order time in half on our busiest nights. The bartenders love that they never have to stop pouring.",
                name: "Marcus T.",
                venue: "The Copper Fox, Austin",
              },
              {
                quote: "I check stock levels by voice between rushes. It's like having an extra manager on shift.",
                name: "Sarah K.",
                venue: "Nightcap Lounge, Miami",
              },
              {
                quote: "Set it up during happy hour, ran it through a Saturday rush. Haven't touched the old POS since.",
                name: "James R.",
                venue: "Warehouse 42, Brooklyn",
              },
            ].map((t, i) => (
              <motion.div
                key={t.name}
                variants={fadeUp} custom={i}
                className="p-8 border border-border rounded-xl bg-card"
              >
                <p className="text-[14px] text-foreground/70 font-light leading-relaxed italic">
                  "{t.quote}"
                </p>
                <div className="mt-6">
                  <p className="text-[13px] font-medium text-foreground/80">{t.name}</p>
                  <p className="text-[12px] text-foreground/50 font-light">{t.venue}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────── */}
      <section className="py-24 lg:py-36 border-t border-border">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <motion.p
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="text-[11px] font-medium tracking-[0.3em] uppercase text-primary/60 mb-4"
          >
            Pricing
          </motion.p>
          <motion.h2
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
            className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-foreground mb-12"
          >
            Simple, per-venue pricing
          </motion.h2>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={2} variants={fadeUp}
            className="grid md:grid-cols-3 gap-4"
          >
            {/* Standard */}
            <div className="border border-border rounded-xl bg-card p-8 md:p-10 flex flex-col">
              <p className="text-[11px] tracking-[0.2em] uppercase text-foreground/50 font-medium mb-4">Standard</p>
              <div className="mb-2">
                <span className="text-5xl font-display font-semibold tracking-tight text-foreground">$29</span>
                <span className="text-foreground/50 font-light ml-1 text-lg">/mo</span>
              </div>
              <p className="text-[13px] text-foreground/50 font-light mb-8">per venue</p>
              <ul className="text-left space-y-3 mb-8 flex-1">
                {["Unlimited voice orders", "Real-time Square sync", "Wake-word activation", "Any device with a mic"].map((f, i) => (
                  <li key={i} className="text-[13px] text-foreground/60 font-light flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button variant="outline" size="lg" className="w-full h-11 text-[14px]">Start free trial</Button>
              </Link>
            </div>

            {/* Plus */}
            <div className="border-2 border-primary/30 rounded-xl bg-card p-8 md:p-10 flex flex-col relative shadow-lg shadow-primary/10">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.15em] uppercase bg-primary text-primary-foreground px-3 py-1 rounded-full font-medium">Popular</span>
              <p className="text-[11px] tracking-[0.2em] uppercase text-foreground/50 font-medium mb-4">Plus</p>
              <div className="mb-2">
                <span className="text-5xl font-display font-semibold tracking-tight text-foreground">$49</span>
                <span className="text-foreground/50 font-light ml-1 text-lg">/mo</span>
              </div>
              <p className="text-[13px] text-foreground/50 font-light mb-8">per venue</p>
              <ul className="text-left space-y-3 mb-8 flex-1">
                {["Everything in Standard", "Inventory management", "Low-stock alerts", "Priority support", "Early access to new features"].map((f, i) => (
                  <li key={i} className="text-[13px] text-foreground/60 font-light flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button size="lg" className="w-full h-11 text-[14px]">Start free trial</Button>
              </Link>
            </div>

            {/* Enterprise */}
            <div className="border border-border rounded-xl bg-card p-8 md:p-10 flex flex-col">
              <p className="text-[11px] tracking-[0.2em] uppercase text-foreground/50 font-medium mb-4">Enterprise</p>
              <div className="mb-2">
                <span className="text-5xl font-display font-semibold tracking-tight text-foreground">Custom</span>
              </div>
              <p className="text-[13px] text-foreground/50 font-light mb-8">multi-venue pricing</p>
              <ul className="text-left space-y-3 mb-8 flex-1">
                {["Everything in Plus", "Multi-venue management", "Dedicated support", "Custom integrations"].map((f, i) => (
                  <li key={i} className="text-[13px] text-foreground/60 font-light flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button variant="outline" size="lg" className="w-full h-11 text-[14px]">Contact us</Button>
              </Link>
            </div>
          </motion.div>
          <p className="text-[12px] text-foreground/40 mt-4 font-light">14-day free trial &middot; No credit card required</p>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <section className="py-28 lg:py-40 border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_100%,_hsl(var(--primary)/0.1),_transparent_70%)]" />
        <div className="max-w-2xl mx-auto px-6 text-center relative z-10">
          <motion.h2
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={0} variants={fadeUp}
            className="text-3xl md:text-5xl font-display font-semibold tracking-tight text-foreground mb-5"
          >
            Ready to speed up<br />your bar?
          </motion.h2>
          <motion.p
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={1} variants={fadeUp}
            className="text-foreground/60 font-light mb-10 max-w-md mx-auto text-lg"
          >
            Set up in under two minutes. Connect Square, speak your first order, and&nbsp;go.
          </motion.p>
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }} custom={2} variants={fadeUp}
          >
            <Link href="/signup">
              <Button size="lg" className="h-12 px-10 text-[15px] group">
                Get started free
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
