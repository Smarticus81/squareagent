import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Check, Mic, Volume2 } from "lucide-react";
import { VoiceRail } from "@/components/voice-rail";
import { LogoMark } from "@/components/logo";
import {
  voyceCopy,
  roomSettings,
  voiceOptions,
  connectedServices,
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

/**
 * Landing — not a brochure. A guided start.
 *
 * The user names their assistant on the homepage. That commit carries them
 * through the rest of setup. Every section is the next step in the journey,
 * not a generic feature card.
 */
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
      <UnderstandPreview />
      <ChooseWhatItCanDo />
      <RoomAndVoice />
      <ConnectedHonestly />
      <FinalStart name={name} setName={setName} onStart={start} canStart={trimmed.length > 0} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   1 — Arrive: opening scene + name input.
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
          Voice assistants for connected services
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

        {/* The first decision: name your assistant */}
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
              placeholder="Bev, Kora, Friday, Barback, Ruby…"
              className="vl-input-naked"
              maxLength={32}
            />
          </label>
          <button
            type="submit"
            disabled={!canStart}
            className="vl-btn-primary inline-flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create your assistant
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
          14-day trial. No card required. Choose any name — you can change it later.
        </motion.p>

        {/* Live preview that mirrors the conversion moment */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.9, ease }}
          className="mt-16"
        >
          <LivePreview name={name || "Kora"} />
        </motion.div>
      </div>
    </section>
  );
}

/* The hero canvas — a working preview, not a brochure card. */
function LivePreview({ name }: { name: string }) {
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
            Assistant · {name}
          </span>
          <span className="vl-chip">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-success)" }} />
            Square synced
          </span>
          <span className="vl-chip">
            <Volume2 className="w-3 h-3" />
            Bar
          </span>
        </div>
        <div className="vl-chip" style={{ color: "rgba(245,239,227,0.55)" }}>
          Ready
        </div>
      </div>

      <div className="px-6 py-10 md:py-14">
        <VoiceRail state="listening" intensity={0.8} />
      </div>

      <div className="grid md:grid-cols-2 gap-px bg-white/[0.06]">
        <div className="bg-[#0E1015] p-6">
          <p className="vl-eyebrow mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>You said</p>
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ivory)" }}>
            Add two ranch waters.
          </p>
          <p className="vl-eyebrow mt-5 mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>{name}</p>
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--color-vl-brass2)" }}>
            Added. Should I send this to Square Terminal?
          </p>
        </div>
        <div className="bg-[#0E1015] p-6">
          <p className="vl-eyebrow mb-3" style={{ color: "rgba(140,145,154,0.8)" }}>Approval</p>
          <div className="flex items-center gap-3">
            <button
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold"
              style={{
                background: "rgba(53,194,117,0.14)",
                color: "var(--color-vl-success)",
                border: "1px solid rgba(53,194,117,0.4)",
              }}
            >
              <Check className="w-4 h-4" />
              Confirm
            </button>
            <button
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold"
              style={{
                background: "rgba(224,82,82,0.10)",
                color: "var(--color-vl-danger)",
                border: "1px solid rgba(224,82,82,0.32)",
              }}
            >
              Cancel
            </button>
          </div>
          <p className="text-[12px] mt-4" style={{ color: "rgba(245,239,227,0.55)" }}>
            Sensitive actions always ask first. You set what asks and what runs.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   2 — Understand: a single quiet section, not a feature grid.
   ───────────────────────────────────────────────────────────────── */
function UnderstandPreview() {
  return (
    <Section
      eyebrow="What you get"
      title="A useful assistant — bounded, named, and ready."
      intro="Your assistant only acts inside the services you connect. You decide what runs and what asks first."
    >
      <div className="grid md:grid-cols-3 gap-px bg-white/[0.06] vl-panel overflow-hidden">
        {[
          {
            title: "It works inside your service",
            body: "Connect Square or another service. The assistant uses what you already have.",
          },
          {
            title: "It only does what you allow",
            body: "Choose actions, decide which ones ask first, mark sensitive things as not allowed.",
          },
          {
            title: "It asks before sensitive things",
            body: "Submitting orders, sending to terminal, refunds — all guarded by approval.",
          },
        ].map((b, i) => (
          <motion.div
            key={b.title}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={i}
            variants={fadeUp}
            className="bg-[#0D0F14] p-8 md:p-10 min-h-[200px]"
          >
            <h3 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
              {b.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(245,239,227,0.6)" }}>
              {b.body}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   3 — Choose what it can do: a preview of the action chooser.
   ───────────────────────────────────────────────────────────────── */
function ChooseWhatItCanDo() {
  return (
    <Section
      eyebrow="Choose what it can do"
      title="Your assistant only does what you allow."
      intro="Group actions in plain language. Mark what runs without asking, what asks first, and what is not allowed."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Look up",
            desc: "Information your assistant can read but never change.",
            example: "Search menu · Check stock · Get sales summary",
            tone: "no_approval" as const,
          },
          {
            label: "Prepare",
            desc: "Help build something the user will confirm.",
            example: "Add an item · Prepare checkout",
            tone: "ask_first" as const,
          },
          {
            label: "Act",
            desc: "Real changes in the connected service.",
            example: "Submit order · Send to terminal · Adjust stock",
            tone: "ask_first" as const,
          },
          {
            label: "Sensitive",
            desc: "Changes that affect money, catalog, or your team.",
            example: "Refunds · Delete · Catalog edits",
            tone: "not_allowed" as const,
          },
        ].map((g, i) => {
          const toneColor =
            g.tone === "no_approval"
              ? "var(--color-vl-success)"
              : g.tone === "ask_first"
              ? "var(--color-vl-brass2)"
              : "var(--color-vl-danger)";
          const toneLabel =
            g.tone === "no_approval" ? "No approval needed" : g.tone === "ask_first" ? "Ask first" : "Not allowed by default";
          return (
            <motion.div
              key={g.label}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              variants={fadeUp}
              className="vl-panel p-5"
            >
              <p className="vl-eyebrow">{g.label}</p>
              <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(245,239,227,0.7)" }}>
                {g.desc}
              </p>
              <p className="mt-3 text-[12px]" style={{ color: "rgba(245,239,227,0.5)" }}>
                {g.example}
              </p>
              <p className="mt-5 text-[11px] inline-flex items-center gap-1.5" style={{ color: toneColor }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: toneColor }} />
                {toneLabel}
              </p>
            </motion.div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   4 — Tune how it listens, choose voice — combined preview.
   ───────────────────────────────────────────────────────────────── */
function RoomAndVoice() {
  return (
    <Section
      eyebrow="Tune for the room"
      title="Choose the room. Choose the voice."
      intro="Pick a room setting — quiet to nightclub. Pick a voice option by outcome, not provider name."
    >
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="vl-panel p-6">
          <p className="vl-eyebrow mb-4">Room setting</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {roomSettings.slice(0, 4).map((m) => (
              <div key={m.value} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/[0.06]">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{m.label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "rgba(245,239,227,0.55)" }}>{m.listens}</p>
                </div>
                <RoomIntensity level={m.intensity} />
              </div>
            ))}
          </div>
        </div>

        <div className="vl-panel p-6">
          <p className="vl-eyebrow mb-4">Voice option</p>
          <div className="space-y-2">
            {voiceOptions.slice(0, 4).map((v) => (
              <div key={v.id} className="px-4 py-3 rounded-xl border border-white/[0.06]">
                <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{v.label}</p>
                <p className="text-[11px] mt-0.5" style={{ color: "rgba(245,239,227,0.55)" }}>{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function RoomIntensity({ level }: { level: number }) {
  return (
    <div className="flex items-end gap-[2px]">
      {[0.2, 0.4, 0.6, 0.8].map((threshold) => (
        <div
          key={threshold}
          className="w-1 rounded-full"
          style={{
            height: 6 + threshold * 12,
            background: level >= threshold ? "var(--color-vl-brass2)" : "rgba(245,239,227,0.18)",
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   5 — Connected services, honest list.
   ───────────────────────────────────────────────────────────────── */
function ConnectedHonestly() {
  return (
    <Section
      eyebrow="Connected services"
      title="Bolt onto the systems you already use."
      intro="Your assistant does not replace your system. It works inside it."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {connectedServices.map((p, i) => {
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
                <span className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{p.name}</span>
                {live ? (
                  <span
                    className="vl-chip"
                    style={{ color: "var(--color-vl-success)", borderColor: "rgba(53,194,117,0.4)" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-success)" }} />
                    Available
                  </span>
                ) : (
                  <span className="vl-chip" style={{ color: "rgba(245,239,227,0.5)" }}>Request access</span>
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
   Final start — repeat the prompt at the end so we close the loop.
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
          Name yours and start.
        </h2>
        <p className="mt-5 text-[16px] max-w-xl mx-auto leading-relaxed" style={{ color: "rgba(245,239,227,0.62)" }}>
          You can change everything later. We will walk you through connecting Square, choosing what it can do, tuning the room, and testing a command.
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
              placeholder="Bev, Kora, Friday…"
              className="vl-input-naked"
              maxLength={32}
            />
          </label>
          <button
            type="submit"
            disabled={!canStart}
            className="vl-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create your assistant
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

/* Shared shell for the inline-named-input on the landing only. */
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
