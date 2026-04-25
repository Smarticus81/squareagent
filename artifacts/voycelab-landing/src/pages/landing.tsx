import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Mic,
  BarChart3,
  Package,
  CalendarDays,
  Zap,
  Bell,
  RefreshCw,
  TrendingUp,
  Clock,
  Users,
  ChevronRight,
} from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

/* ── Design tokens (light neumorphic) ───────────────────────── */
const bg = "#F7F7F8";
const primary = "#2563EB";
const accent = "#F59E0B";
const text = "#111827";
const muted = "#6B7280";
const cardBg = "#FFFFFF";
const softShadow =
  "6px 6px 12px rgba(0,0,0,0.05), -6px -6px 12px rgba(255,255,255,0.9)";
const softShadowHover =
  "8px 8px 16px rgba(0,0,0,0.07), -8px -8px 16px rgba(255,255,255,0.95)";
const innerShadow =
  "inset 2px 2px 4px rgba(0,0,0,0.04), inset -2px -2px 4px rgba(255,255,255,0.7)";

/* ── Animation variants ─────────────────────────────────────── */
const ease = [0.22, 1, 0.36, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.7, ease },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } },
};

/* Removed — floating handled inline */

/* ── Pulsing dot ─────────────────────────────────────────────── */
function PulseDot({ color = primary, size = 8, className = "" }: { color?: string; size?: number; className?: string }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <motion.span
        animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: color, width: size, height: size }}
      />
      <span
        className="relative rounded-full"
        style={{ backgroundColor: color, width: size, height: size }}
      />
    </span>
  );
}

/* ── Voice waveform visualization ────────────────────────────── */
function VoiceWaveform({ barCount = 24, className = "" }: { barCount?: number; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-[3px] ${className}`}>
      {Array.from({ length: barCount }).map((_, i) => (
        <motion.div
          key={i}
          className="rounded-full"
          style={{ width: 3, backgroundColor: primary }}
          animate={{
            height: [
              `${4 + Math.random() * 8}px`,
              `${16 + Math.random() * 32}px`,
              `${4 + Math.random() * 8}px`,
            ],
            opacity: [0.3, 0.7, 0.3],
          }}
          transition={{
            duration: 1.4 + Math.random() * 1.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.05,
          }}
        />
      ))}
    </div>
  );
}

/* ── Floating card wrapper ───────────────────────────────────── */
function FloatingCard({
  children,
  className = "",
  delay = 0,
  rotate = 0,
  style = {},
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  rotate?: number;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotate: rotate * 0.5 }}
      animate={{ opacity: 1, y: [0, -8, 0], rotate }}
      transition={{
        opacity: { delay: 0.3 + delay * 0.15, duration: 0.9, ease },
        rotate: { delay: 0.3 + delay * 0.15, duration: 0.9, ease },
        y: { delay: 0.3 + delay * 0.15, duration: 5 + delay, repeat: Infinity, ease: "easeInOut" as const },
      }}
      className={`rounded-2xl p-5 ${className}`}
      style={{
        backgroundColor: cardBg,
        boxShadow: softShadow,
        ...style,
      }}
      whileHover={{ scale: 1.03, boxShadow: softShadowHover }}
    >
      {children}
    </motion.div>
  );
}

/* ── Section wrapper ─────────────────────────────────────────── */
function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`py-24 lg:py-32 ${className}`}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8">{children}</div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN LANDING PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function Landing() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.7], [1, 0.97]);

  return (
    <div style={{ backgroundColor: bg, color: text }} className="overflow-hidden font-sans">
      {/* ── HERO ──────────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-screen flex items-center overflow-hidden"
      >
        {/* Background ambient */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 70% 50% at 30% 20%, rgba(37,99,235,0.06), transparent 60%),
              radial-gradient(ellipse 50% 40% at 80% 70%, rgba(245,158,11,0.05), transparent 60%)
            `,
          }}
        />

        <div className="max-w-6xl mx-auto px-6 lg:px-8 w-full relative z-10 pt-24 pb-16">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left — copy */}
            <div>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease }}
                className="flex items-center gap-3 mb-8"
              >
                <PulseDot color={primary} size={8} />
                <span
                  className="text-xs font-semibold tracking-[0.2em] uppercase"
                  style={{ color: primary }}
                >
                  AI-Powered Operations
                </span>
              </motion.div>

              <motion.h1
                initial="hidden"
                animate="visible"
                custom={0}
                variants={fadeUp}
                className="text-5xl md:text-6xl lg:text-[3.75rem] font-bold leading-[1.08] tracking-tight"
                style={{ color: text }}
              >
                Run your venue
                <br />
                operations on{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`,
                  }}
                >
                  autopilot
                </span>
              </motion.h1>

              <motion.p
                initial="hidden"
                animate="visible"
                custom={1}
                variants={fadeUp}
                className="mt-6 text-lg leading-relaxed max-w-lg"
                style={{ color: muted }}
              >
                VoyceLab is the voice control layer for your existing systems.
                Name your agent, choose a SOTA voice pipeline, and ship voice
                ordering on top of Square, Toast, Clover, or any connected service.
              </motion.p>

              <motion.div
                initial="hidden"
                animate="visible"
                custom={2}
                variants={fadeUp}
                className="mt-10 flex flex-wrap items-center gap-4"
              >
                <Link href="#demo">
                  <button
                    className="inline-flex items-center gap-2 h-13 px-8 rounded-xl text-[15px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5"
                    style={{ backgroundColor: primary }}
                  >
                    See it in action
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
                <Link href="/signup">
                  <button
                    className="inline-flex items-center gap-2 h-13 px-8 rounded-xl text-[15px] font-semibold transition-all hover:-translate-y-0.5"
                    style={{
                      color: text,
                      boxShadow: softShadow,
                      backgroundColor: bg,
                    }}
                  >
                    Get demo
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </Link>
              </motion.div>
            </div>

            {/* Right — floating card composition */}
            <div className="relative h-[520px] hidden lg:block">
              {/* POS Revenue card */}
              <FloatingCard
                delay={0}
                rotate={-2}
                className="absolute top-4 left-8 w-[220px]"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ boxShadow: innerShadow, backgroundColor: bg }}
                  >
                    <TrendingUp className="w-4 h-4" style={{ color: primary }} />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>
                    POS Revenue
                  </span>
                </div>
                <p className="text-3xl font-bold tracking-tight" style={{ color: text }}>
                  $12,847
                </p>
                <p className="text-xs mt-1" style={{ color: "#16a34a" }}>
                  +18.3% vs last week
                </p>
                {/* Mini sparkline */}
                <div className="flex items-end gap-[3px] mt-3 h-8">
                  {[40, 55, 35, 65, 50, 80, 70, 90, 75, 95].map((h, i) => (
                    <motion.div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{ backgroundColor: `${primary}20`, height: `${h}%` }}
                      initial={{ height: 0 }}
                      animate={{ height: `${h}%` }}
                      transition={{ delay: 0.8 + i * 0.05, duration: 0.5, ease }}
                    />
                  ))}
                </div>
              </FloatingCard>

              {/* Inventory Alert card */}
              <FloatingCard
                delay={1}
                rotate={1.5}
                className="absolute top-12 right-0 w-[230px]"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ boxShadow: innerShadow, backgroundColor: bg }}
                  >
                    <Package className="w-4 h-4" style={{ color: accent }} />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>
                    Inventory Alert
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: "#EF4444" }}
                  />
                  <p className="text-sm font-medium" style={{ color: text }}>
                    Low: Tito's Vodka
                  </p>
                </div>
                <p className="text-xs mt-2" style={{ color: muted }}>
                  3 bottles remaining — reorder threshold: 12
                </p>
                <div
                  className="mt-3 rounded-lg h-2 overflow-hidden"
                  style={{ backgroundColor: `${bg}` }}
                >
                  <motion.div
                    className="h-full rounded-lg"
                    style={{ backgroundColor: "#EF4444" }}
                    initial={{ width: 0 }}
                    animate={{ width: "25%" }}
                    transition={{ delay: 1.2, duration: 0.8, ease }}
                  />
                </div>
              </FloatingCard>

              {/* Event card */}
              <FloatingCard
                delay={2}
                rotate={-1}
                className="absolute bottom-28 left-0 w-[210px]"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ boxShadow: innerShadow, backgroundColor: bg }}
                  >
                    <CalendarDays className="w-4 h-4" style={{ color: "#8B5CF6" }} />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>
                    Upcoming
                  </span>
                </div>
                <p className="text-sm font-semibold" style={{ color: text }}>
                  Wedding Reception
                </p>
                <p className="text-xs mt-1" style={{ color: muted }}>
                  Saturday · 180 guests · Grand Ballroom
                </p>
                <div className="flex items-center gap-1.5 mt-3">
                  <div className="flex -space-x-1.5">
                    {[primary, accent, "#8B5CF6"].map((c, i) => (
                      <div
                        key={i}
                        className="w-5 h-5 rounded-full border-2 border-white"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px]" style={{ color: muted }}>
                    +4 staff assigned
                  </span>
                </div>
              </FloatingCard>

              {/* Voice bubble — example agent (default name "Bev"; users rename) */}
              <FloatingCard
                delay={3}
                rotate={2}
                className="absolute bottom-8 right-4 w-[260px]"
                style={{
                  backgroundColor: primary,
                  boxShadow: `0 8px 32px rgba(37,99,235,0.25), 0 0 0 1px rgba(37,99,235,0.1)`,
                }}
              >
                <div className="flex items-center gap-3">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0"
                  >
                    <Mic className="w-4 h-4 text-white" />
                  </motion.div>
                  <div>
                    <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                      Bev
                    </p>
                    <p className="text-sm font-medium text-white leading-snug">
                      Reordering 2 cases of tequila from distributor.
                    </p>
                  </div>
                </div>
                {/* Thinking indicator */}
                <div className="flex items-center gap-1 mt-3 ml-12">
                  {[0, 0.2, 0.4].map((d) => (
                    <motion.div
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-white/40"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: d }}
                    />
                  ))}
                </div>
              </FloatingCard>

              {/* Ambient glow behind cards */}
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full blur-3xl pointer-events-none"
                style={{ backgroundColor: `${primary}08` }}
              />
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── CONNECT EVERYTHING ────────────────────────────────── */}
      <Section id="connect">
        <div className="text-center mb-16">
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0}
            variants={fadeUp}
            className="text-xs font-semibold tracking-[0.2em] uppercase mb-4"
            style={{ color: primary }}
          >
            Integrations
          </motion.p>
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            variants={fadeUp}
            className="text-3xl md:text-5xl font-bold tracking-tight"
            style={{ color: text }}
          >
            Connect everything.
            <br />
            <span style={{ color: muted }}>Control it all.</span>
          </motion.h2>
        </div>

        {/* Integration flow */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-4"
        >
          {[
            { icon: BarChart3, label: "POS Systems", color: primary, desc: "Square, Toast, Clover" },
            { icon: Package, label: "Inventory", color: accent, desc: "Real-time stock levels" },
            { icon: CalendarDays, label: "Events", color: "#8B5CF6", desc: "Schedules & bookings" },
            { icon: Mic, label: "VoyceLabs", color: primary, desc: "AI Operations Hub" },
          ].map((item, i) => (
            <motion.div key={item.label} variants={fadeUp} custom={i} className="flex items-center gap-4">
              <div
                className="rounded-2xl p-6 flex flex-col items-center text-center w-[160px] transition-all hover:-translate-y-1"
                style={{ backgroundColor: cardBg, boxShadow: softShadow }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ boxShadow: innerShadow, backgroundColor: bg }}
                >
                  <item.icon className="w-6 h-6" style={{ color: item.color }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: text }}>
                  {item.label}
                </p>
                <p className="text-[11px] mt-1" style={{ color: muted }}>
                  {item.desc}
                </p>
                {item.label === "VoyceLabs" && (
                  <PulseDot color={primary} size={6} className="mt-2" />
                )}
              </div>
              {i < 3 && (
                <motion.div
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  transition={{ delay: 0.3 + i * 0.15, duration: 0.6, ease }}
                  viewport={{ once: true }}
                  className="hidden md:block"
                >
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-[2px] rounded-full" style={{ backgroundColor: `${primary}20` }} />
                    <ChevronRight className="w-4 h-4" style={{ color: `${primary}40` }} />
                  </div>
                </motion.div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ── ASK ANYTHING (VOICE UI) ──────────────────────────── */}
      <Section id="demo" className="relative overflow-hidden">
        {/* Background accent */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 40% at 50% 50%, rgba(37,99,235,0.04), transparent)`,
          }}
        />

        <div className="relative z-10">
          <div className="text-center mb-16">
            <motion.p
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={0}
              variants={fadeUp}
              className="text-xs font-semibold tracking-[0.2em] uppercase mb-4"
              style={{ color: primary }}
            >
              Voice Intelligence
            </motion.p>
            <motion.h2
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={1}
              variants={fadeUp}
              className="text-3xl md:text-5xl font-bold tracking-tight"
              style={{ color: text }}
            >
              Ask anything.
              <br />
              <span style={{ color: muted }}>Get instant answers.</span>
            </motion.h2>
          </div>

          {/* Voice conversation mockup */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={2}
            variants={fadeUp}
            className="max-w-2xl mx-auto"
          >
            <div
              className="rounded-3xl p-8 md:p-12"
              style={{ backgroundColor: cardBg, boxShadow: softShadow }}
            >
              {/* User query */}
              <div className="flex items-start gap-4 mb-8">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ boxShadow: innerShadow, backgroundColor: bg }}
                >
                  <Users className="w-4 h-4" style={{ color: muted }} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: muted }}>
                    You
                  </p>
                  <p className="text-lg font-medium" style={{ color: text }}>
                    "Do we have enough liquor for Saturday?"
                  </p>
                </div>
              </div>

              {/* Waveform divider */}
              <div className="py-4">
                <VoiceWaveform barCount={32} className="h-8" />
              </div>

              {/* AI response */}
              <div className="flex items-start gap-4 mt-8">
                <motion.div
                  animate={{
                    boxShadow: [
                      `0 0 0 0 rgba(37,99,235,0)`,
                      `0 0 20px 4px rgba(37,99,235,0.15)`,
                      `0 0 0 0 rgba(37,99,235,0)`,
                    ],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: primary }}
                >
                  <Mic className="w-4 h-4 text-white" />
                </motion.div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: primary }}>
                    Your agent
                  </p>
                  <p className="text-lg font-medium" style={{ color: text }}>
                    "You're short 24 bottles for the 180-guest wedding.
                  </p>
                  <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.8, duration: 0.6 }}
                    className="text-lg font-semibold mt-1"
                    style={{ color: primary }}
                  >
                    Reordering now."
                  </motion.p>
                  {/* Action tag */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 1.2, duration: 0.5 }}
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-xs font-semibold"
                    style={{ backgroundColor: `${primary}10`, color: primary }}
                  >
                    <Zap className="w-3 h-3" />
                    Auto-reorder triggered
                  </motion.div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ── IT ACTS AUTOMATICALLY ─────────────────────────────── */}
      <Section>
        <div className="text-center mb-16">
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0}
            variants={fadeUp}
            className="text-xs font-semibold tracking-[0.2em] uppercase mb-4"
            style={{ color: accent }}
          >
            Autonomous Actions
          </motion.p>
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            variants={fadeUp}
            className="text-3xl md:text-5xl font-bold tracking-tight"
            style={{ color: text }}
          >
            It doesn't just answer.
            <br />
            <span style={{ color: muted }}>It acts.</span>
          </motion.h2>
        </div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="grid md:grid-cols-3 gap-6"
        >
          {[
            {
              icon: RefreshCw,
              title: "Auto reorder triggered",
              desc: "Detected low stock on Tito's Vodka, Espolòn Tequila, and Hendricks Gin. Purchase order sent to distributor.",
              color: primary,
              tag: "Inventory",
              tagColor: primary,
            },
            {
              icon: Bell,
              title: "Staff notified",
              desc: "Bar manager and shift lead alerted via push notification. Saturday prep checklist updated with new delivery ETA.",
              color: accent,
              tag: "Comms",
              tagColor: accent,
            },
            {
              icon: Package,
              title: "Inventory updated",
              desc: "Expected quantities adjusted. Par levels recalculated for 180-guest event. Dashboard synced across all devices.",
              color: "#16A34A",
              tag: "System",
              tagColor: "#16A34A",
            },
          ].map((card, i) => (
            <motion.div
              key={card.title}
              variants={fadeUp}
              custom={i}
              className="rounded-2xl p-8 transition-all hover:-translate-y-1 group"
              style={{ backgroundColor: cardBg, boxShadow: softShadow }}
            >
              <div className="flex items-center justify-between mb-6">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ boxShadow: innerShadow, backgroundColor: bg }}
                >
                  <card.icon className="w-5 h-5" style={{ color: card.color }} />
                </div>
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
                  style={{ backgroundColor: `${card.tagColor}10`, color: card.tagColor }}
                >
                  {card.tag}
                </span>
              </div>
              <h3 className="text-lg font-bold mb-2" style={{ color: text }}>
                {card.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: muted }}>
                {card.desc}
              </p>
              {/* Progress indicator */}
              <div className="mt-6 flex items-center gap-2">
                <motion.div
                  className="h-1 rounded-full flex-1"
                  style={{ backgroundColor: `${bg}` }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: card.color }}
                    initial={{ width: "0%" }}
                    whileInView={{ width: "100%" }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 + i * 0.2, duration: 1.5, ease }}
                  />
                </motion.div>
                <motion.span
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 1.5 + i * 0.2 }}
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: card.color }}
                >
                  Done
                </motion.span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ── LIVE OPERATIONS DASHBOARD ─────────────────────────── */}
      <Section className="relative overflow-hidden">
        <div className="text-center mb-16">
          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0}
            variants={fadeUp}
            className="text-xs font-semibold tracking-[0.2em] uppercase mb-4"
            style={{ color: primary }}
          >
            Live Dashboard
          </motion.p>
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            variants={fadeUp}
            className="text-3xl md:text-5xl font-bold tracking-tight"
            style={{ color: text }}
          >
            Your venue at a glance.
          </motion.h2>
        </div>

        {/* Dashboard mockup */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          custom={2}
          variants={fadeUp}
          className="rounded-3xl overflow-hidden"
          style={{ backgroundColor: cardBg, boxShadow: `0 25px 60px rgba(0,0,0,0.08), ${softShadow}` }}
        >
          {/* Dashboard top bar */}
          <div
            className="flex items-center justify-between px-8 py-4 border-b"
            style={{ borderColor: `${bg}` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#EF4444" }} />
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accent }} />
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#16A34A" }} />
            </div>
            <div className="flex items-center gap-2">
              <PulseDot color="#16A34A" size={6} />
              <span className="text-xs font-medium" style={{ color: muted }}>
                Live · Grand Ballroom
              </span>
            </div>
          </div>

          <div className="p-6 md:p-8">
            {/* Metrics row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Today's Revenue", value: "$8,423", change: "+12.4%", up: true },
                { label: "Orders Processed", value: "347", change: "+8.1%", up: true },
                { label: "Avg. Order Time", value: "1.2s", change: "-24%", up: true },
                { label: "Active Staff", value: "12", change: "On shift", up: null },
              ].map((m, i) => (
                <motion.div
                  key={m.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.5, ease }}
                  className="rounded-2xl p-5"
                  style={{ boxShadow: innerShadow, backgroundColor: bg }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: muted }}>
                    {m.label}
                  </p>
                  <p className="text-2xl font-bold tracking-tight" style={{ color: text }}>
                    {m.value}
                  </p>
                  {m.up !== null ? (
                    <p className="text-xs font-medium mt-1" style={{ color: m.up ? "#16A34A" : "#EF4444" }}>
                      {m.change}
                    </p>
                  ) : (
                    <p className="text-xs font-medium mt-1" style={{ color: muted }}>
                      {m.change}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Sales chart */}
              <div className="md:col-span-2 rounded-2xl p-6" style={{ boxShadow: innerShadow, backgroundColor: bg }}>
                <div className="flex items-center justify-between mb-6">
                  <p className="text-sm font-semibold" style={{ color: text }}>
                    Hourly Sales
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full" style={{ backgroundColor: `${primary}10`, color: primary }}>
                    Today
                  </span>
                </div>
                <div className="flex items-end gap-[6px] h-32">
                  {[20, 35, 25, 45, 40, 65, 55, 80, 70, 95, 85, 60, 75, 90, 50, 30].map((h, i) => (
                    <motion.div
                      key={i}
                      className="flex-1 rounded-t-md"
                      style={{
                        backgroundColor: i >= 14 ? `${primary}20` : primary,
                        opacity: i >= 14 ? 0.4 : 0.2 + (h / 120),
                      }}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${h}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.2 + i * 0.04, duration: 0.6, ease }}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-3">
                  <span className="text-[10px]" style={{ color: muted }}>6AM</span>
                  <span className="text-[10px]" style={{ color: muted }}>12PM</span>
                  <span className="text-[10px]" style={{ color: muted }}>6PM</span>
                  <span className="text-[10px]" style={{ color: muted }}>Now</span>
                </div>
              </div>

              {/* Inventory levels */}
              <div className="rounded-2xl p-6" style={{ boxShadow: innerShadow, backgroundColor: bg }}>
                <p className="text-sm font-semibold mb-5" style={{ color: text }}>
                  Inventory Status
                </p>
                {[
                  { name: "Vodka", pct: 72, color: "#16A34A" },
                  { name: "Tequila", pct: 45, color: accent },
                  { name: "Whiskey", pct: 88, color: primary },
                  { name: "Gin", pct: 23, color: "#EF4444" },
                  { name: "Rum", pct: 61, color: "#16A34A" },
                ].map((item, i) => (
                  <div key={item.name} className="mb-4 last:mb-0">
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs font-medium" style={{ color: text }}>
                        {item.name}
                      </span>
                      <span className="text-[10px] font-bold" style={{ color: item.color }}>
                        {item.pct}%
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: `${item.color}15` }}
                    >
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: item.color }}
                        initial={{ width: 0 }}
                        whileInView={{ width: `${item.pct}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.4 + i * 0.1, duration: 0.8, ease }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Event timeline */}
            <div className="mt-6 rounded-2xl p-6" style={{ boxShadow: innerShadow, backgroundColor: bg }}>
              <div className="flex items-center justify-between mb-5">
                <p className="text-sm font-semibold" style={{ color: text }}>
                  Event Timeline
                </p>
                <Clock className="w-4 h-4" style={{ color: muted }} />
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {[
                  { time: "2:00 PM", event: "Setup Complete", status: "done", color: "#16A34A" },
                  { time: "4:00 PM", event: "Vendor Delivery", status: "done", color: "#16A34A" },
                  { time: "5:30 PM", event: "Staff Briefing", status: "active", color: primary },
                  { time: "6:00 PM", event: "Doors Open", status: "upcoming", color: muted },
                  { time: "6:30 PM", event: "Cocktail Hour", status: "upcoming", color: muted },
                  { time: "8:00 PM", event: "Dinner Service", status: "upcoming", color: muted },
                ].map((ev, i) => (
                  <motion.div
                    key={ev.event}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + i * 0.08, duration: 0.5, ease }}
                    className="flex-shrink-0 flex items-center gap-3"
                  >
                    <div className="flex flex-col items-center">
                      <div
                        className="w-3 h-3 rounded-full border-2"
                        style={{
                          borderColor: ev.color,
                          backgroundColor: ev.status === "done" ? ev.color : "transparent",
                        }}
                      />
                      {i < 5 && (
                        <div className="w-[2px] h-4" style={{ backgroundColor: `${muted}20` }} />
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold" style={{ color: ev.color }}>
                        {ev.time}
                      </p>
                      <p
                        className="text-xs font-medium whitespace-nowrap"
                        style={{ color: ev.status === "upcoming" ? muted : text }}
                      >
                        {ev.event}
                      </p>
                    </div>
                    {ev.status === "active" && <PulseDot color={primary} size={6} />}
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </Section>

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section className="py-32 lg:py-40 relative overflow-hidden">
        {/* Ambient background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 60% 50% at 50% 100%, rgba(37,99,235,0.06), transparent 60%),
              radial-gradient(ellipse 40% 30% at 20% 50%, rgba(245,158,11,0.04), transparent 50%)
            `,
          }}
        />

        <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0}
            variants={fadeUp}
            className="mb-8"
          >
            <motion.div
              animate={{
                boxShadow: [
                  `0 0 0 0 rgba(37,99,235,0)`,
                  `0 0 40px 8px rgba(37,99,235,0.1)`,
                  `0 0 0 0 rgba(37,99,235,0)`,
                ],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
              style={{ backgroundColor: primary }}
            >
              <Mic className="w-7 h-7 text-white" />
            </motion.div>
          </motion.div>

          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            variants={fadeUp}
            className="text-4xl md:text-6xl font-bold tracking-tight leading-tight"
            style={{ color: text }}
          >
            Let your venue
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`,
              }}
            >
              run itself.
            </span>
          </motion.h2>

          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={2}
            variants={fadeUp}
            className="mt-6 text-lg max-w-md mx-auto leading-relaxed"
            style={{ color: muted }}
          >
            Connect your systems, name your agent, and watch your operations transform in minutes — not months.
          </motion.p>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={3}
            variants={fadeUp}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <Link href="/signup">
              <button
                className="inline-flex items-center gap-2 h-14 px-10 rounded-xl text-base font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5"
                style={{ backgroundColor: primary }}
              >
                Start free trial
                <ArrowRight className="w-5 h-5" />
              </button>
            </Link>
            <Link href="/signup">
              <button
                className="inline-flex items-center gap-2 h-14 px-10 rounded-xl text-base font-semibold transition-all hover:-translate-y-0.5"
                style={{
                  color: text,
                  boxShadow: softShadow,
                  backgroundColor: cardBg,
                }}
              >
                Book a demo
              </button>
            </Link>
          </motion.div>

          <motion.p
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={4}
            variants={fadeUp}
            className="mt-6 text-xs"
            style={{ color: `${muted}90` }}
          >
            14 days free &middot; No credit card required &middot; Setup in 2 minutes
          </motion.p>
        </div>
      </section>
    </div>
  );
}
