import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Mic } from "lucide-react";
import { VoiceRail } from "@/components/voice-rail";
import { LogoMark } from "@/components/logo";
import { voyceCopy } from "@/lib/tokens";

const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.7, ease },
  }),
};

export default function Landing() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const start = () => {
    const target = "/assistants/new";
    if (trimmed) sessionStorage.setItem("voycelab.pending_assistant_name", trimmed);
    navigate(target);
  };

  return (
    <div className="relative">
      <Hero name={name} setName={setName} onStart={start} canStart={trimmed.length > 0} />
      <WhatTeamsAsk />
      <VenueValue />
      <HowItWorks />
      <FinalStart name={name} setName={setName} onStart={start} canStart={trimmed.length > 0} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   1 — Hero
   ───────────────────────────────────────────────────────────────── */
function Hero({
  name,
  setName,
  onStart,
  canStart,
}: {
  name: string;
  setName: (v: string) => void;
  onStart: () => void;
  canStart: boolean;
}) {
  return (
    <section className="relative min-h-[100svh] flex items-center pt-24 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 30%, rgba(124,110,245,0.10), transparent 60%), radial-gradient(ellipse 60% 40% at 50% 90%, rgba(255,106,42,0.08), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-16 inset-x-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(224,183,106,0.45), transparent)",
        }}
      />

      <div className="relative z-10 w-full max-w-[1100px] mx-auto px-6 lg:px-10 py-16">
        <motion.p
          initial="hidden"
          animate="visible"
          custom={0}
          variants={fadeUp}
          className="vl-eyebrow"
        >
          The voice operating assistant for modern venues
        </motion.p>

        <motion.h1
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="vl-display mt-6 text-[44px] sm:text-[60px] md:text-[80px] max-w-5xl"
          style={{ color: "var(--color-vl-ivory)" }}
        >
          {voyceCopy.tagline}
        </motion.h1>

        <motion.p
          initial="hidden"
          animate="visible"
          custom={2}
          variants={fadeUp}
          className="mt-6 text-[17px] md:text-[19px] max-w-2xl leading-relaxed"
          style={{ color: "rgba(245,239,227,0.66)" }}
        >
          {voyceCopy.promise}
        </motion.p>

        <motion.form
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) onStart();
          }}
          initial="hidden"
          animate="visible"
          custom={3}
          variants={fadeUp}
          className="mt-10 flex flex-col sm:flex-row items-stretch gap-3 max-w-xl"
        >
          <label className="flex-1 vl-input-shell">
            <span className="vl-eyebrow" style={{ color: "rgba(224,183,106,0.85)" }}>
              Name your assistant
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bev, Kora, Friday, Barback, Ruby..."
              className="vl-input-naked"
              maxLength={32}
            />
          </label>
          <button
            type="submit"
            disabled={!canStart}
            className="vl-btn-primary inline-flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Get started
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.form>

        <motion.p
          initial="hidden"
          animate="visible"
          custom={4}
          variants={fadeUp}
          className="mt-3 text-[12px]"
          style={{ color: "rgba(245,239,227,0.5)" }}
        >
          14-day trial. No card required.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.9, ease }}
          className="mt-16"
        >
          <VenuePreview name={name || "Kora"} />
        </motion.div>
      </div>
    </section>
  );
}

function VenuePreview({ name }: { name: string }) {
  return (
    <div className="vl-panel vl-edge-brass relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(224,183,106,0.55), transparent)" }}
      />
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-brass2)" }} />
            {name}
          </span>
          <span className="vl-chip">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-success)" }} />
            Live
          </span>
        </div>
        <div className="vl-chip" style={{ color: "rgba(245,239,227,0.55)" }}>
          Listening
        </div>
      </div>

      <div className="px-6 py-10 md:py-14">
        <VoiceRail state="listening" intensity={0.8} />
      </div>

      <div className="grid md:grid-cols-2 gap-px bg-white/[0.06]">
        <div className="bg-[#0E1015] p-6">
          <p className="vl-eyebrow mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>You said</p>
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ivory)" }}>
            How much Tito's do we have left?
          </p>
          <p className="vl-eyebrow mt-5 mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>{name}</p>
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--color-vl-brass2)" }}>
            You have 4 bottles on hand. Based on tonight's 180-person wedding and similar events, you should stage 3 and keep 1 in reserve.
          </p>
        </div>
        <div className="bg-[#0E1015] p-6 flex flex-col justify-between">
          <div>
            <p className="vl-eyebrow mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>Also asked tonight</p>
            <div className="space-y-2.5">
              {[
                "What bar package is this wedding on?",
                "Are signature cocktails included?",
                "How much did Bar 2 sell so far?",
              ].map((q) => (
                <p key={q} className="text-[13px] leading-relaxed" style={{ color: "rgba(245,239,227,0.5)" }}>
                  "{q}"
                </p>
              ))}
            </div>
          </div>
          <p className="text-[12px] mt-5" style={{ color: "rgba(245,239,227,0.4)" }}>
            Answers come from your POS, inventory, and event data.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   2 — What teams actually ask
   ───────────────────────────────────────────────────────────────── */
function WhatTeamsAsk() {
  const questions = [
    { q: "What does tonight's event include?", context: "Events" },
    { q: "Do we need to restock beer before cocktail hour?", context: "Inventory" },
    { q: "Which bartender is selling the most?", context: "Sales" },
    { q: "What bar package is tonight's wedding on?", context: "Packages" },
    { q: "Can we add a champagne toast?", context: "Client requests" },
    { q: "What do I need to know for tonight?", context: "Briefing" },
    { q: "Are we on pace to hit the minimum?", context: "Revenue" },
    { q: "Which events are draining premium liquor?", context: "Analysis" },
  ];

  return (
    <Section
      eyebrow="Real questions from real venues"
      title="Your team already asks these. Now they get answers."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {questions.map((item, i) => (
          <motion.div
            key={item.q}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="vl-panel p-5"
          >
            <p className="vl-eyebrow mb-3" style={{ color: "rgba(224,183,106,0.7)" }}>{item.context}</p>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--color-vl-ivory)" }}>
              "{item.q}"
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   3 — Venue value: why this matters
   ───────────────────────────────────────────────────────────────── */
function VenueValue() {
  const values = [
    {
      title: "Less chaos during events",
      body: "Fewer interruptions, fewer mistakes, faster decisions. One place to ask instead of chasing managers, checking spreadsheets, or digging through emails.",
    },
    {
      title: "More revenue per event",
      body: "Surface upsell opportunities, track consumption against minimums, and catch premium add-on moments your team is too busy to notice.",
    },
    {
      title: "Better inventory control",
      body: "Know what you started with, what you sold, what should be left, and what needs reordering. Inventory becomes intelligence, not a counting problem.",
    },
    {
      title: "Faster staff onboarding",
      body: "New bartenders and event staff ask the same questions every shift. The assistant gives venue-specific answers without interrupting a manager.",
    },
    {
      title: "Cleaner event execution",
      body: "Package details, guest counts, bar hours, signature drinks, client notes, restrictions — all available conversationally, not buried in PDFs.",
    },
    {
      title: "Less dependence on one person",
      body: "Every venue has someone who knows everything. VoyceLab captures that knowledge and makes it available to the whole team.",
    },
  ];

  return (
    <Section
      eyebrow="Why venues use VoyceLab"
      title="Your venue runs smoother, sells more, and wastes less."
    >
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.06] vl-panel overflow-hidden">
        {values.map((v, i) => (
          <motion.div
            key={v.title}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="bg-[#0D0F14] p-8 md:p-10"
          >
            <h3 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
              {v.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(245,239,227,0.6)" }}>
              {v.body}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   4 — How it works (minimal)
   ───────────────────────────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    {
      step: "01",
      title: "Name your assistant",
      body: "Give it a name your team will actually use. Bev, Friday, Barback — whatever fits.",
    },
    {
      step: "02",
      title: "Connect your systems",
      body: "Link your POS, inventory, and event data. It works inside what you already run on.",
    },
    {
      step: "03",
      title: "Set the rules",
      body: "Choose what it can look up, what it can do, and what needs approval first.",
    },
    {
      step: "04",
      title: "Ask it anything",
      body: "Your team talks to it. It answers, takes action, and helps run the night.",
    },
  ];

  return (
    <Section
      eyebrow="How it works"
      title="Running in minutes, not weeks."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <motion.div
            key={s.step}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="vl-panel p-6"
          >
            <p className="text-[32px] font-semibold tracking-tight" style={{ color: "rgba(224,183,106,0.3)" }}>
              {s.step}
            </p>
            <h3 className="text-[17px] font-semibold mt-3" style={{ color: "var(--color-vl-ivory)" }}>
              {s.title}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "rgba(245,239,227,0.55)" }}>
              {s.body}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Final CTA
   ───────────────────────────────────────────────────────────────── */
function FinalStart({
  name,
  setName,
  onStart,
  canStart,
}: {
  name: string;
  setName: (v: string) => void;
  onStart: () => void;
  canStart: boolean;
}) {
  return (
    <section id="start" className="relative py-32 lg:py-40">
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
        <h2 className="vl-display mt-8 text-[40px] md:text-[60px]" style={{ color: "var(--color-vl-ivory)" }}>
          Give your venue a voice.
        </h2>
        <p className="mt-5 text-[16px] max-w-xl mx-auto leading-relaxed" style={{ color: "rgba(245,239,227,0.62)" }}>
          Name your assistant, connect your systems, and let your team start asking. You can change everything later.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) onStart();
          }}
          className="mt-9 flex flex-col sm:flex-row items-stretch gap-3 max-w-lg mx-auto text-left"
        >
          <label className="flex-1 vl-input-shell">
            <span className="vl-eyebrow" style={{ color: "rgba(224,183,106,0.85)" }}>
              Assistant name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bev, Kora, Friday..."
              className="vl-input-naked"
              maxLength={32}
            />
          </label>
          <button
            type="submit"
            disabled={!canStart}
            className="vl-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Get started
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
        <p className="mt-5 text-[12px]" style={{ color: "rgba(245,239,227,0.5)" }}>
          Already have an account?{" "}
          <Link href="/login" className="underline" style={{ color: "var(--color-vl-brass2)" }}>
            Open your console
          </Link>
        </p>

        <div className="mt-10 inline-flex items-center justify-center gap-2 text-[12px]" style={{ color: "rgba(245,239,227,0.5)" }}>
          <Mic className="w-3.5 h-3.5" />
          {voyceCopy.conversion}
        </div>
      </div>

      <InputStyles />
    </section>
  );
}

function InputStyles() {
  return (
    <style>{`
      .vl-input-shell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 16px;
        border-radius: 14px;
        border: 1px solid rgba(245,239,227,0.14);
        background: rgba(245,239,227,0.04);
        cursor: text;
        transition: border-color .2s ease, background .2s ease;
      }
      .vl-input-shell:focus-within {
        border-color: rgba(124,110,245,0.7);
        background: rgba(245,239,227,0.06);
      }
      .vl-input-naked {
        background: transparent;
        border: 0;
        outline: 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--color-vl-ivory);
        font-family: inherit;
        padding: 0;
      }
      .vl-input-naked::placeholder { color: rgba(245,239,227,0.35); font-weight: 400; }
    `}</style>
  );
}

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="relative py-24 lg:py-28">
      <div className="max-w-[1100px] mx-auto px-6 lg:px-10">
        <div className="max-w-3xl mb-12 lg:mb-16">
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
          <motion.h2
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={1}
            variants={fadeUp}
            className="vl-display text-[36px] md:text-[52px] mt-3"
            style={{ color: "var(--color-vl-ivory)" }}
          >
            {title}
          </motion.h2>
          {intro && (
            <motion.p
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={2}
              variants={fadeUp}
              className="text-[16px] mt-4 leading-relaxed max-w-2xl"
              style={{ color: "rgba(245,239,227,0.62)" }}
            >
              {intro}
            </motion.p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
