import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Lock,
  Radio,
  ShieldCheck,
  Zap,
  Volume2,
  Mic,
  History,
  Power,
  Plug,
} from "lucide-react";
import { VoiceRail } from "@/components/voice-rail";
import { LogoMark } from "@/components/logo";
import {
  voyceCopy,
  noiseModes,
  pipelineOutcomes,
  connectedProviders,
} from "@/lib/tokens";

const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.7, ease },
  }),
};

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  intro?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`relative py-24 lg:py-32 ${className}`}>
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10">
        {(eyebrow || title || intro) && (
          <div className="max-w-3xl mb-14 lg:mb-20">
            {eyebrow && (
              <motion.p
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={0}
                variants={fadeUp}
                className="vl-eyebrow"
              >
                {eyebrow}
              </motion.p>
            )}
            {title && (
              <motion.h2
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={1}
                variants={fadeUp}
                className="vl-display text-[40px] md:text-[64px] mt-3"
                style={{ color: "var(--color-vl-ivory)" }}
              >
                {title}
              </motion.h2>
            )}
            {intro && (
              <motion.p
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={2}
                variants={fadeUp}
                className="text-[17px] mt-5 leading-relaxed max-w-2xl"
                style={{ color: "rgba(245,239,227,0.62)" }}
              >
                {intro}
              </motion.p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   HERO — cinematic dark composition with the rail as the centerpiece.
   ───────────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative min-h-[100svh] flex items-center pt-24 overflow-hidden">
      {/* Atmospheric background */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 30%, rgba(124,110,245,0.10), transparent 60%), radial-gradient(ellipse 60% 40% at 50% 90%, rgba(255,106,42,0.08), transparent 60%)",
        }}
      />
      {/* Brass top edge */}
      <div
        aria-hidden
        className="absolute top-16 inset-x-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(224,183,106,0.45), transparent)",
        }}
      />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 lg:px-10 py-16">
        <motion.p
          initial="hidden"
          animate="visible"
          custom={0}
          variants={fadeUp}
          className="vl-eyebrow"
        >
          Voice layer · Bolts onto Square
        </motion.p>

        <motion.h1
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="vl-display mt-6 text-[44px] sm:text-[64px] md:text-[88px] max-w-5xl"
          style={{ color: "var(--color-vl-ivory)" }}
        >
          The voice layer for modern{" "}
          <span style={{ color: "var(--color-vl-brass2)" }}>venue operations.</span>
        </motion.h1>

        <motion.p
          initial="hidden"
          animate="visible"
          custom={2}
          variants={fadeUp}
          className="mt-7 text-[17px] md:text-[19px] max-w-2xl leading-relaxed"
          style={{ color: "rgba(245,239,227,0.66)" }}
        >
          Connect Square or another service, name your agent, and control approved
          actions by voice. Orders, stock checks, reports, and workflows update in
          the system your venue already uses.
        </motion.p>

        <motion.div
          initial="hidden"
          animate="visible"
          custom={3}
          variants={fadeUp}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <Link href="/signup">
            <button className="vl-btn-primary inline-flex items-center gap-2 text-[14px]">
              Configure your agent
              <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
          <a href="#how" className="vl-btn-ghost text-[14px]">
            Try the voice demo
          </a>
        </motion.div>

        {/* Hero canvas — voice instrument */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.9, ease }}
          className="mt-16 relative"
        >
          <div className="vl-panel vl-edge-brass relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(224,183,106,0.55), transparent)" }} />
            {/* Top status row */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-brass2)" }} />
                  Agent · Bev
                </span>
                <span className="vl-chip">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-success)" }} />
                  Square synced
                </span>
                <span className="vl-chip">
                  <Volume2 className="w-3 h-3" />
                  Bar mode
                </span>
              </div>
              <div className="vl-chip" style={{ color: "rgba(245,239,227,0.6)" }}>
                Latency 412 ms
              </div>
            </div>

            {/* Rail — the centerpiece */}
            <div className="px-6 py-10 md:py-14">
              <VoiceRail state="listening" intensity={0.8} />
              <div className="mt-6 flex items-center gap-3 justify-center text-[12px]" style={{ color: "rgba(245,239,227,0.55)" }}>
                <span className="vl-eyebrow" style={{ color: "rgba(124,110,245,0.85)" }}>Listening</span>
                <span className="opacity-50">·</span>
                <span>Tap to interrupt · Hold to push-to-talk</span>
              </div>
            </div>

            {/* Transcript + confirmation gate */}
            <div className="grid md:grid-cols-2 gap-px bg-white/[0.06]">
              <div className="bg-[#0E1015] p-6">
                <p className="vl-eyebrow mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>Transcript</p>
                <p className="text-[15px] leading-relaxed" style={{ color: "rgba(245,239,227,0.92)" }}>
                  <span className="opacity-60">You · </span>
                  Add two ranch waters.
                </p>
                <p className="text-[15px] mt-3 leading-relaxed" style={{ color: "var(--color-vl-brass2)" }}>
                  <span className="opacity-60">Bev · </span>
                  Added two ranch waters. Confirm send to terminal?
                </p>
              </div>
              <div className="bg-[#0E1015] p-6">
                <p className="vl-eyebrow mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>Confirmation gate</p>
                <div className="flex items-center gap-3">
                  <button className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold" style={{ background: "rgba(53,194,117,0.14)", color: "var(--color-vl-success)", border: "1px solid rgba(53,194,117,0.4)" }}>
                    <Check className="w-4 h-4" />
                    Confirm
                  </button>
                  <button className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold" style={{ background: "rgba(224,82,82,0.10)", color: "var(--color-vl-danger)", border: "1px solid rgba(224,82,82,0.32)" }}>
                    Cancel
                  </button>
                </div>
                <p className="text-[12px] mt-3" style={{ color: "rgba(245,239,227,0.5)" }}>
                  Risky tools always require confirmation. Your agent, your rules.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   HOW IT WORKS — Speak and sync
   ───────────────────────────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    { n: "01", title: "Connect your service", body: "Bolt onto Square or another connected service in two clicks." },
    { n: "02", title: "Name your agent", body: "Bev, Kora, Friday — anything your team will trust." },
    { n: "03", title: "Set what it can control", body: "Approved tools only. Risky actions go through a confirmation gate." },
    { n: "04", title: "Speak and sync", body: "Your team speaks. Your systems move. Real-time, in the room." },
  ];
  return (
    <Section
      id="how"
      eyebrow="Speak and sync"
      title="Four steps. One instrument."
      intro="Configuration is the emotional moment. After that, the agent stays out of the way."
    >
      <div className="grid md:grid-cols-4 gap-px bg-white/[0.06] vl-panel overflow-hidden">
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="bg-[#0D0F14] p-8 md:p-10 min-h-[260px] flex flex-col justify-between"
          >
            <p className="vl-eyebrow" style={{ color: "rgba(224,183,106,0.85)" }}>
              {s.n}
            </p>
            <div>
              <h3 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
                {s.title}
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(245,239,227,0.6)" }}>
                {s.body}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   NOISY ROOMS — major section
   ───────────────────────────────────────────────────────────────── */
function NoisyRooms() {
  return (
    <Section
      id="noise"
      eyebrow="Built for loud rooms"
      title="A loud room is the normal environment."
      intro="Wake behavior, voice activity detection, and confirmation strictness adjust by room. Pick a mode — the rail, the agent, and the gates change with you."
    >
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {noiseModes.map((m, i) => (
          <motion.div
            key={m.value}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="vl-panel p-6 relative overflow-hidden"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="vl-eyebrow">{m.label}</p>
              <Volume2 className="w-3.5 h-3.5" style={{ color: "rgba(224,183,106,0.7)" }} />
            </div>
            <p className="text-[14px] mb-5" style={{ color: "rgba(245,239,227,0.62)" }}>
              {m.description}
            </p>
            <VoiceRail
              state={m.intensity > 0.65 ? "listening" : m.intensity > 0.4 ? "ready" : "ready"}
              intensity={m.intensity}
              showWaveform={m.intensity > 0.55}
            />
            <ul className="mt-6 space-y-1.5 text-[12px]" style={{ color: "rgba(245,239,227,0.55)" }}>
              <li className="flex justify-between"><span>Wake</span><span style={{ color: "rgba(245,239,227,0.85)" }}>{m.wake}</span></li>
              <li className="flex justify-between"><span>VAD</span><span style={{ color: "rgba(245,239,227,0.85)" }}>{m.vad}</span></li>
              <li className="flex justify-between"><span>Confirm</span><span style={{ color: "rgba(245,239,227,0.85)" }}>{m.confirm}</span></li>
            </ul>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   CONNECTED SERVICES — honest list
   ───────────────────────────────────────────────────────────────── */
function ConnectedServicesSection() {
  return (
    <Section
      id="services"
      eyebrow="Connected services"
      title="Bolt onto the systems your venue already uses."
      intro="VoyceLab is not a POS, not an inventory system, not a chatbot. It's a voice command layer that talks to your existing service."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {connectedProviders.map((p, i) => {
          const live = p.status === "live";
          return (
            <motion.div
              key={p.id}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              variants={fadeUp}
              className="vl-panel p-5"
              style={{ opacity: live ? 1 : 0.78 }}
            >
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
                  {p.name}
                </span>
                {live ? (
                  <span className="vl-chip" style={{ color: "var(--color-vl-success)", borderColor: "rgba(53,194,117,0.4)" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-success)" }} />
                    Live
                  </span>
                ) : (
                  <span className="vl-chip" style={{ color: "rgba(245,239,227,0.5)" }}>
                    Request access
                  </span>
                )}
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: "rgba(245,239,227,0.55)" }}>
                {p.description}
              </p>
            </motion.div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   CONTROL BOUNDARIES — trust
   ───────────────────────────────────────────────────────────────── */
function ControlBoundaries() {
  const items = [
    { icon: Plug, title: "Approved tools only", body: "Allowlist what the agent can do per venue. Anything else is rejected." },
    { icon: ShieldCheck, title: "Confirmation gates", body: "Risky tools route through a spoken or tapped confirmation before sync." },
    { icon: Lock, title: "Role-based permissions", body: "Bartender, manager, owner — different capabilities, same agent." },
    { icon: History, title: "Session history", body: "Every transcript, tool call, and synced action is auditable." },
    { icon: Radio, title: "Real-time sync status", body: "Sync, retry, draft. Failures surface to the room, not into a queue." },
    { icon: Power, title: "Emergency stop / sleep", body: "One word, one tap. The rail goes calm. The agent steps back." },
  ];
  return (
    <Section
      id="boundaries"
      eyebrow="Control boundaries"
      title="A voice you can trust on the floor."
      intro="The agent only does what you allow, in the system you connected. No silent autonomy."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item, i) => (
          <motion.div
            key={item.title}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="vl-panel p-6"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(224,183,106,0.10)", border: "1px solid rgba(224,183,106,0.18)" }}>
              <item.icon className="w-4 h-4" style={{ color: "var(--color-vl-brass2)" }} />
            </div>
            <h3 className="text-[16px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
              {item.title}
            </h3>
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "rgba(245,239,227,0.6)" }}>
              {item.body}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   VOICE PIPELINES — outcome-based UX
   ───────────────────────────────────────────────────────────────── */
function VoicePipelines() {
  return (
    <Section
      id="pipelines"
      eyebrow="SOTA voice options"
      title="Pick the outcome. We pick the engine."
      intro="State-of-the-art realtime, managed agents, noise-tuned pipelines, and a manual fallback. Advanced detail lives in settings."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {pipelineOutcomes.map((p, i) => (
          <motion.div
            key={p.id}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="vl-panel p-5 flex flex-col"
          >
            <Zap className="w-4 h-4" style={{ color: "var(--color-vl-voice)" }} />
            <h3 className="mt-4 text-[15px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
              {p.label}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed flex-1" style={{ color: "rgba(245,239,227,0.6)" }}>
              {p.description}
            </p>
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <p className="vl-eyebrow" style={{ color: "rgba(140,145,154,0.7)" }}>Advanced</p>
              <p className="text-[11px] mt-1" style={{ color: "rgba(245,239,227,0.5)" }}>
                {p.advanced.join(" · ")}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PRICING — minimal honest
   ───────────────────────────────────────────────────────────────── */
function Pricing() {
  const tiers = [
    {
      name: "Core",
      price: "$49",
      cadence: "/ month",
      features: ["1 agent · 1 venue", "Square connected", "POS skill: orders, terminal", "Reporting skill", "Email support"],
    },
    {
      name: "Standard",
      price: "$129",
      cadence: "/ month",
      features: ["Up to 3 agents · 3 venues", "Inventory + catalog skills", "Customers + payments skill", "Workflows", "Priority support"],
      highlight: true,
    },
    {
      name: "Premium",
      price: "Custom",
      cadence: "",
      features: ["Unlimited agents", "Team & labor skills", "Self-hosted realtime", "Audit + role-based access", "Dedicated success"],
    },
  ];
  return (
    <Section
      id="pricing"
      eyebrow="Pricing"
      title="Per venue. Per voice."
      intro="14 days free. No credit card to configure. Cancel any time."
    >
      <div className="grid md:grid-cols-3 gap-3">
        {tiers.map((t, i) => (
          <motion.div
            key={t.name}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="vl-panel p-7 relative"
            style={t.highlight ? { borderColor: "rgba(224,183,106,0.4)" } : undefined}
          >
            {t.highlight && (
              <span className="absolute top-4 right-4 vl-chip" style={{ color: "var(--color-vl-brass2)", borderColor: "rgba(224,183,106,0.4)" }}>
                Most teams
              </span>
            )}
            <p className="vl-eyebrow">{t.name}</p>
            <p className="vl-display text-[44px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
              {t.price}
              <span className="text-[14px] ml-1 font-normal" style={{ color: "rgba(245,239,227,0.5)" }}>
                {t.cadence}
              </span>
            </p>
            <ul className="mt-6 space-y-2.5 text-[14px]" style={{ color: "rgba(245,239,227,0.7)" }}>
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5" style={{ color: "var(--color-vl-brass2)" }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/signup">
              <button className={t.highlight ? "vl-btn-primary mt-7 w-full" : "vl-btn-ghost mt-7 w-full"}>
                {t.highlight ? "Start free trial" : "Choose plan"}
              </button>
            </Link>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FINAL CTA
   ───────────────────────────────────────────────────────────────── */
function FinalCTA() {
  return (
    <section id="configure" className="relative py-32 lg:py-40">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 100%, rgba(124,110,245,0.10), transparent 60%), radial-gradient(ellipse 60% 50% at 50% 0%, rgba(224,183,106,0.06), transparent 60%)",
        }}
      />
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <LogoMark size={56} className="mx-auto" />
        <h2 className="vl-display mt-8 text-[44px] md:text-[64px]" style={{ color: "var(--color-vl-ivory)" }}>
          Give your venue a voice it can trust.
        </h2>
        <p className="mt-5 text-[16px] max-w-xl mx-auto leading-relaxed" style={{ color: "rgba(245,239,227,0.62)" }}>
          {voyceCopy.promise} Configure your agent in minutes. Bolt onto Square. Speak. Confirm. Sync.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup">
            <button className="vl-btn-primary inline-flex items-center gap-2">
              Configure your agent
              <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
          <Link href="/signup">
            <button className="vl-btn-ghost inline-flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Connect Square
            </button>
          </Link>
        </div>
        <p className="mt-6 text-[12px]" style={{ color: "rgba(245,239,227,0.5)" }}>
          14 days free · No credit card · Cancel any time
        </p>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="relative">
      <Hero />
      <HowItWorks />
      <NoisyRooms />
      <ConnectedServicesSection />
      <ControlBoundaries />
      <VoicePipelines />
      <Pricing />
      <FinalCTA />
    </div>
  );
}
