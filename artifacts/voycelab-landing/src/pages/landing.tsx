import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { voyceCopy } from "@/lib/tokens";

const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.55, ease },
  }),
};

export default function Landing() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const start = () => {
    if (trimmed) sessionStorage.setItem("voycelab.pending_assistant_name", trimmed);
    navigate("/assistants/new");
  };
  const canStart = trimmed.length > 0;

  return (
    <div className="relative">
      <Hero name={name} setName={setName} onStart={start} canStart={canStart} />
      <AskRow />
      <Products />
      <Steps />
      <Closer name={name} setName={setName} onStart={start} canStart={canStart} />
      <InputStyles />
    </div>
  );
}

/* ───────────────── Hero — single viewport, compact ───────────────── */
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
    <section className="relative pt-28 pb-14 md:pt-32 md:pb-20 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 25%, rgba(90,160,255,0.07), transparent 60%), radial-gradient(ellipse 60% 40% at 50% 95%, rgba(245,166,35,0.06), transparent 60%)",
        }}
      />
      <div className="relative max-w-[1120px] mx-auto px-6 lg:px-10">
        <motion.p initial="hidden" animate="visible" custom={0} variants={fadeUp} className="vl-eyebrow">
          The voice operating assistant for modern venues
        </motion.p>

        <motion.h1
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="vl-display mt-4 text-[40px] sm:text-[52px] md:text-[64px] max-w-[900px]"
          style={{ color: "var(--color-vl-ivory)" }}
        >
          {voyceCopy.tagline}
        </motion.h1>

        <motion.p
          initial="hidden"
          animate="visible"
          custom={2}
          variants={fadeUp}
          className="mt-5 text-[15px] md:text-[16px] max-w-xl leading-relaxed"
          style={{ color: "rgba(245,239,227,0.62)" }}
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
          className="mt-7 flex items-center gap-2 max-w-md"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your assistant"
            className="vl-compact-input flex-1"
            maxLength={32}
          />
          <button
            type="submit"
            disabled={!canStart}
            className="vl-btn-primary inline-flex items-center gap-2 text-[13px] px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Get started
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </motion.form>

        <motion.p
          initial="hidden"
          animate="visible"
          custom={4}
          variants={fadeUp}
          className="mt-2.5 text-[11px]"
          style={{ color: "rgba(245,239,227,0.42)" }}
        >
          14-day trial. No card required.
        </motion.p>

        <motion.div
          initial="hidden"
          animate="visible"
          custom={5}
          variants={fadeUp}
          className="mt-12 md:mt-16"
        >
          <HeroSample name={name || "Bev"} />
        </motion.div>
      </div>
    </section>
  );
}

function HeroSample({ name }: { name: string }) {
  const lines = [
    { who: "You", text: "How much Tito's do we have left?" },
    { who: name, text: "4 bottles. Stage 3 for tonight's wedding, keep one in reserve." },
  ];
  return (
    <div className="grid md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-10 items-center">
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.who} className="flex items-baseline gap-3 text-[14px] leading-snug">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.2em] shrink-0 w-14"
              style={{ color: "rgba(245,239,227,0.4)" }}
            >
              {l.who.slice(0, 8)}
            </span>
            <span style={{ color: l.who === "You" ? "var(--color-vl-ivory)" : "var(--color-vl-brass2)" }}>
              {l.text}
            </span>
          </div>
        ))}
      </div>
      <div className="hidden md:block w-px h-16 bg-white/10" aria-hidden />
      <div className="grid grid-cols-3 gap-4 text-[11px] tracking-[0.15em] uppercase">
        {[
          { label: "Events", value: "3 tonight" },
          { label: "Inventory", value: "Synced" },
          { label: "Sales", value: "$4.2k" },
        ].map((s) => (
          <div key={s.label} className="border-l border-white/10 pl-3">
            <p style={{ color: "rgba(245,239,227,0.42)" }}>{s.label}</p>
            <p className="mt-1 text-[12px] font-medium tracking-normal normal-case" style={{ color: "var(--color-vl-ivory)" }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────── Ask row — dense single-line sampler ───────────────── */
function AskRow() {
  const asks = [
    "What's tonight's bar package?",
    "Are we low on beer before cocktail hour?",
    "Which bartender is selling the most?",
    "Can we add a champagne toast?",
    "How much did Bar 2 sell so far?",
    "What's in the signature cocktail?",
  ];
  return (
    <section className="relative border-y border-white/[0.06] py-4">
      <div className="max-w-[1120px] mx-auto px-6 lg:px-10 flex items-center gap-6 overflow-x-auto whitespace-nowrap scrollbar-hide">
        <span className="vl-eyebrow shrink-0">Asks</span>
        {asks.map((q) => (
          <span key={q} className="text-[13px] shrink-0" style={{ color: "rgba(245,239,227,0.55)" }}>
            <span className="mr-1.5" style={{ color: "var(--color-vl-brass2)" }}>›</span>
            {q}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ───────────────── Products / capabilities — tight grid ───────────────── */
function Products() {
  const items = [
    {
      label: "Events",
      title: "Every detail, on voice.",
      body: "Package type, guest count, signature drinks, client notes — served conversationally instead of buried in PDFs.",
    },
    {
      label: "Inventory",
      title: "Counts without counting.",
      body: "Ask what you have, what you're burning, and what to reorder. Inventory becomes intelligence, not a clipboard.",
    },
    {
      label: "Sales",
      title: "POS data, spoken.",
      body: "Hourly pace, top movers, guest spend, minimum tracking — without opening a dashboard.",
    },
    {
      label: "Operations",
      title: "One place to ask.",
      body: "Fewer interruptions, fewer mistakes, faster decisions. Your team stops chasing the manager.",
    },
  ];

  return (
    <section className="py-16 md:py-20">
      <div className="max-w-[1120px] mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-8 md:mb-10 gap-6">
          <div>
            <p className="vl-eyebrow">Capabilities</p>
            <h2 className="vl-display text-[28px] md:text-[36px] mt-3 max-w-xl" style={{ color: "var(--color-vl-ivory)" }}>
              A voice that understands your venue.
            </h2>
          </div>
          <Link
            href="/signup"
            className="hidden md:inline-flex items-center gap-1 text-[12px] shrink-0"
            style={{ color: "var(--color-vl-brass2)" }}
          >
            Start trial <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.06] border border-white/[0.06] rounded-xl overflow-hidden">
          {items.map((item, i) => (
            <motion.article
              key={item.label}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              custom={i}
              variants={fadeUp}
              className="bg-[#0B0D12] p-5 md:p-6 min-h-[180px] flex flex-col"
            >
              <p className="vl-eyebrow">{item.label}</p>
              <h3 className="text-[17px] font-semibold tracking-tight mt-3" style={{ color: "var(--color-vl-ivory)" }}>
                {item.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "rgba(245,239,227,0.56)" }}>
                {item.body}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────── Steps — inline, one line per step ───────────────── */
function Steps() {
  const steps = [
    { n: "01", t: "Name", d: "Pick a name your team will use." },
    { n: "02", t: "Connect", d: "Link your POS, inventory, and event data." },
    { n: "03", t: "Rules", d: "Choose what it can do and what asks first." },
    { n: "04", t: "Ask", d: "Your team talks to it on the floor." },
  ];
  return (
    <section className="pb-16 md:pb-20">
      <div className="max-w-[1120px] mx-auto px-6 lg:px-10">
        <p className="vl-eyebrow mb-6">How it works</p>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 border-t border-white/[0.06]">
          {steps.map((s) => (
            <li key={s.n} className="pt-5 lg:border-l lg:first:border-l-0 lg:pl-6 border-white/[0.06]">
              <p className="font-mono text-[11px] tracking-[0.2em]" style={{ color: "rgba(224,183,106,0.7)" }}>
                {s.n}
              </p>
              <p className="mt-2 text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
                {s.t}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "rgba(245,239,227,0.55)" }}>
                {s.d}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────── Closer — compact CTA ───────────────── */
function Closer({
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
    <section className="relative py-20 border-t border-white/[0.06]">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 60% at 50% 100%, rgba(90,160,255,0.08), transparent 60%)",
        }}
      />
      <div className="relative max-w-[1120px] mx-auto px-6 lg:px-10 grid md:grid-cols-[1fr_auto] items-end gap-8">
        <div>
          <p className="vl-eyebrow">Get started</p>
          <h2 className="vl-display text-[32px] md:text-[44px] mt-3 max-w-xl" style={{ color: "var(--color-vl-ivory)" }}>
            Give your venue a voice.
          </h2>
          <p className="mt-3 text-[14px] max-w-md" style={{ color: "rgba(245,239,227,0.6)" }}>
            Name your assistant, connect your systems, and let your team start asking.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) onStart();
          }}
          className="flex items-center gap-2 md:w-[380px]"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Assistant name"
            className="vl-compact-input flex-1"
            maxLength={32}
          />
          <button
            type="submit"
            disabled={!canStart}
            className="vl-btn-primary inline-flex items-center gap-2 text-[13px] px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
      <div className="relative max-w-[1120px] mx-auto px-6 lg:px-10 mt-6 text-[12px]" style={{ color: "rgba(245,239,227,0.45)" }}>
        Already have an account?{" "}
        <Link href="/login" className="underline" style={{ color: "var(--color-vl-brass2)" }}>
          Open your console
        </Link>
      </div>
    </section>
  );
}

function InputStyles() {
  return (
    <style>{`
      .vl-compact-input {
        height: 42px;
        padding: 0 14px;
        background: rgba(245,239,227,0.04);
        border: 1px solid rgba(245,239,227,0.12);
        border-radius: 10px;
        color: var(--color-vl-ivory);
        font-size: 14px;
        font-weight: 500;
        outline: 0;
        transition: border-color .2s ease, background .2s ease;
      }
      .vl-compact-input::placeholder { color: rgba(245,239,227,0.35); font-weight: 400; }
      .vl-compact-input:focus { border-color: rgba(90,160,255,0.55); background: rgba(245,239,227,0.06); }
      .scrollbar-hide::-webkit-scrollbar { display: none; }
      .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
    `}</style>
  );
}
