import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Mic,
  Play,
  AlertTriangle,
  TrendingUp,
  Users,
  BarChart3,
  ShieldCheck,
  Bell,
  RefreshCw,
  ClipboardList,
  CalendarRange,
  CreditCard,
  Wine,
  Loader2,
} from "lucide-react";
import { VoiceOrb } from "@/components/voice-orb";
import { useVoycelabDemoRealtime } from "@/hooks/use-voycelab-demo-realtime";

/* animation config */
const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.65, ease },
  }),
};
const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const childFade = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease } },
};

/* -
   PAGE
   - */
export default function Landing() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");

  const startAssistant = () => {
    const trimmed = name.trim();
    if (trimmed) sessionStorage.setItem("voycelab.pending_assistant_name", trimmed);
    navigate("/assistants/new");
  };

  return (
    <div className="vl-landing">
      <Hero onStart={startAssistant} />
      <ConnectedSystems />
      <MinimalLanding onStart={startAssistant} />
    </div>
  );
}

/* -
   CONNECTED SYSTEMS — large brand badges
   - */
function ConnectedSystems() {
  const brands: Array<{ src: string; alt: string; height: number }> = [
    { src: "/brand/square-logo.png",     alt: "Square",  height: 96 },
    { src: "/brand/openai-wordmark.png", alt: "OpenAI",  height: 64 },
    { src: "/brand/google-g.png",        alt: "Google",  height: 96 },
  ];
  return (
    <section className="relative py-16 md:py-24">
      <div className="section-container">
        <div className="text-center mb-10 md:mb-14">
          <p className="vl-eyebrow">Connected systems</p>
          <h2
            className="vl-display mt-3 text-[clamp(1.85rem,4vw,3rem)]"
            style={{ color: "var(--color-vl-ink)" }}
          >
            Built on the systems you already trust.
          </h2>
          <p
            className="mt-4 max-w-xl mx-auto text-[15px] leading-relaxed"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            VoyceLab plugs into Square POS, OpenAI's Realtime voice models,
            and Google Workspace — so your assistant can see your sales,
            speak naturally, and act on your inbox.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {brands.map((b) => (
            <div
              key={b.alt}
              className="vl-card flex items-center justify-center px-6 py-10 md:py-14"
              style={{ minHeight: 180 }}
            >
              <img
                src={b.src}
                alt={b.alt}
                style={{ height: b.height, maxWidth: "85%", objectFit: "contain" }}
                loading="lazy"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -
   HERO
   - */
function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative pt-28 md:pt-36 pb-16 md:pb-24 overflow-hidden">
      {/* Painterly hero washes - peach top-left, lilac top-right, sage right */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div
          className="vl-blob"
          style={{
            top: "-10%",
            left: "-12%",
            width: "44%",
            height: "55%",
            background: "radial-gradient(ellipse at center, rgba(251, 207, 232, 0.55), transparent 60%)",
          }}
        />
        <div
          className="vl-blob"
          style={{
            top: "0%",
            right: "-8%",
            width: "38%",
            height: "48%",
            background: "radial-gradient(ellipse at center, rgba(199, 210, 254, 0.45), transparent 65%)",
          }}
        />
        <div
          className="vl-blob"
          style={{
            top: "30%",
            right: "12%",
            width: "30%",
            height: "40%",
            background: "radial-gradient(ellipse at center, rgba(167, 243, 208, 0.30), transparent 65%)",
          }}
        />
        <div
          className="vl-blob"
          style={{
            bottom: "-14%",
            left: "10%",
            width: "55%",
            height: "45%",
            background: "radial-gradient(ellipse at center, rgba(99, 102, 241, 0.10), transparent 70%)",
          }}
        />
      </div>

      <div className="relative section-container">
        <div className="grid lg:grid-cols-[1fr_1.05fr] gap-10 lg:gap-14 items-start">
          {/* - LEFT: copy column - */}
          <div className="pt-2">
            <motion.div
              initial="hidden"
              animate="visible"
              custom={0}
              variants={fadeUp}
              className="flex items-center gap-3 flex-wrap"
            >
              <span className="vl-eyebrow">Voice assistant for business owners</span>
            </motion.div>

            <motion.h1
              initial="hidden"
              animate="visible"
              custom={1}
              variants={fadeUp}
              className="vl-display mt-5 text-[clamp(2.75rem,6.4vw,4.6rem)]"
            >
              The Voice Assistant
              <br />
              that helps you run your
              <br />
              <em>business.</em>
            </motion.h1>

            <motion.p
              initial="hidden"
              animate="visible"
              custom={2}
              variants={fadeUp}
              className="mt-7 text-[17px] md:text-[18px] leading-relaxed max-w-115"
              style={{ color: "var(--color-vl-ink-soft)" }}
            >
              VoyceLab gives business owners a voice assistant they can talk to
              anywhere. Ask about sales, stock, orders, bookings, payments, and
              daily operations without sitting in front of a computer.
            </motion.p>

            <motion.div
              initial="hidden"
              animate="visible"
              custom={3}
              variants={fadeUp}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <button onClick={onStart} className="vl-btn-primary inline-flex items-center gap-2.5">
                Book a demo
                <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center">
                  <ArrowRight className="w-3 h-3 text-white" />
                </span>
              </button>
              <a href="#voice-demo" className="vl-btn-outline inline-flex items-center gap-2.5">
                See it in action
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(10, 10, 11,0.08)" }}
                >
                  <Play className="w-2.5 h-2.5" style={{ color: "var(--color-vl-ink)" }} />
                </span>
              </a>
            </motion.div>

            {/* Connected systems — Square / OpenAI / Google */}
            <motion.div
              initial="hidden"
              animate="visible"
              custom={4}
              variants={fadeUp}
              className="mt-10"
            >
              <p
                className="vl-eyebrow mb-3"
                style={{ color: "var(--color-vl-ink-soft)" }}
              >
                Connected to
              </p>
              <div className="grid grid-cols-3 gap-3 max-w-[520px]">
                {[
                  { src: "/brand/square-logo.png",     alt: "Square",  height: 44 },
                  { src: "/brand/openai-wordmark.png", alt: "OpenAI",  height: 26 },
                  { src: "/brand/google-g.png",        alt: "Google",  height: 40 },
                ].map((logo) => (
                  <div
                    key={logo.alt}
                    className="vl-card flex items-center justify-center rounded-2xl"
                    style={{ height: 84, padding: "0 16px" }}
                  >
                    <img
                      src={logo.src}
                      alt={logo.alt}
                      style={{ height: logo.height, width: "auto", objectFit: "contain" }}
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* - RIGHT: scene with floating assistants - */}
          <motion.div
            initial="hidden"
            animate="visible"
            custom={6}
            variants={fadeUp}
            className="relative"
          >
            <HeroScene />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function MinimalLanding({ onStart }: { onStart: () => void }) {
  return (
    <main className="section-container pb-20">
      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Connect", "Square, stock, reports, payments."],
          ["Speak", "Ask naturally from the floor."],
          ["Act", "Orders and updates sync live."],
        ].map(([title, body]) => (
          <div key={title} className="vl-card p-5">
            <p className="vl-eyebrow">{title}</p>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ink-soft)" }}>
              {body}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_0.82fr] lg:items-start">
        <div className="vl-card-glass p-6 md:p-8">
          <p className="vl-eyebrow">Minimal setup</p>
          <h2 className="vl-display mt-3 text-[clamp(2rem,4vw,3.4rem)]" style={{ color: "var(--color-vl-ink)" }}>
            One assistant. One wake phrase. Real venue actions.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
            Connect your business systems, speak naturally, and get answers or actions from your assistant while you are on the floor or on the go.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onStart} className="vl-btn-primary inline-flex items-center gap-2">
              Create assistant <ArrowRight className="h-4 w-4" />
            </button>
            <Link href="/pricing" className="vl-btn-outline inline-flex items-center gap-2">
              View billing
            </Link>
          </div>
        </div>

        <div className="vl-card p-5">
          <p className="vl-eyebrow">Live demo</p>
          <ConversationSection compact />
        </div>
      </section>
    </main>
  );
}

/* -- Hero scene: orbit rings + central waveform sphere + 3 floating assistant cards */
function HeroScene() {
  const demo = useVoycelabDemoRealtime();
  const [orbSize, setOrbSize] = useState<number>(() => {
    if (typeof window === "undefined") return 420;
    // Leave at least 32px gutter on each side; cap at 420px.
    return Math.max(220, Math.min(420, window.innerWidth - 64));
  });
  useEffect(() => {
    const onResize = () =>
      setOrbSize(Math.max(220, Math.min(420, window.innerWidth - 64)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="relative aspect-[1/1.05] w-full max-w-160 mx-auto lg:ml-auto">
      {/* Single soft orbit ring - anchors the orb without competing with it */}
      <div aria-hidden className="absolute inset-0">
        <div
          className="vl-orbit-ring"
          style={{ inset: "14%", borderColor: "rgba(99, 102, 241,0.12)" }}
        />
      </div>

      {/* Central voice orb - user mic starts the session; particles react to assistant output */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <VoiceOrb
          size={orbSize}
          outputStream={demo.assistantStream}
          agentState={demo.agentState}
          label={
            demo.isLive
              ? "VoyceLab voice demo is live. Click to stop."
              : "Start the VoyceLab voice demo."
          }
          onListenStart={(stream) => {
            void demo.connect(stream);
          }}
          onListenStop={() => {
            void demo.disconnect();
          }}
          externalError={demo.error}
        />
      </div>

      {/* Floating command chip #1 - POS (top-right) - hidden on narrow screens */}
      <FloatingAssistantCard
        className="hidden sm:block absolute top-[8%] right-[-2%] md:right-[-6%] vl-float-slow"
        index="1"
        title="POS ASSISTANT"
        question="Hey Voyce, split"
        questionAccent="Table 12"
        questionRest="into 3 ways and add a tip."
      />

      {/* Floating command chip #2 - Inventory (right middle) */}
      <FloatingAssistantCard
        className="hidden sm:block absolute top-[48%] right-[-8%] md:right-[-12%] vl-float-medium"
        index="2"
        title="INVENTORY ASSISTANT"
        question="Voyce, do we have"
        questionAccent="enough tequila"
        questionRest="for tonight?"
      />

      {/* Floating command chip #3 - Venue (bottom-left) */}
      <FloatingAssistantCard
        className="hidden sm:block absolute bottom-[8%] left-[-8%] md:left-[-14%] vl-float-fast"
        index="3"
        title="VENUE ASSISTANT"
        question="Hey Voyce, what's"
        questionAccent="the timeline"
        questionRest="for the Johnson wedding?"
      />
    </div>
  );
}

function FloatingAssistantCard({
  className = "",
  index,
  title,
  question,
  questionAccent,
  questionRest,
}: {
  className?: string;
  index: string;
  title: string;
  question: string;
  questionAccent: string;
  questionRest: string;
}) {
  return (
    <div className={className}>
      <div
        className="relative rounded-full pl-2 pr-4 py-2 flex items-center gap-2.5 max-w-75"
        style={{
          background: "rgba(255,255,255,0.72)",
          backdropFilter: "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: "blur(20px) saturate(1.4)",
          border: "1px solid rgba(10, 10, 11,0.06)",
          boxShadow:
            "0 2px 10px rgba(10, 10, 11,0.04), 0 12px 36px rgba(99,102,241,0.10)",
        }}
      >
        <span
          className="shrink-0 w-7 h-7 rounded-full text-[11px] font-semibold flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(236,72,153,0.18))",
            color: "var(--color-vl-ink)",
          }}
        >
          {index}
        </span>
        <div className="flex-1 min-w-0">
          <p
            className="text-[9.5px] font-semibold tracking-[0.16em] leading-none"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            {title}
          </p>
          <p
            className="mt-1 text-[12.5px] leading-tight truncate"
            style={{ color: "var(--color-vl-ink)" }}
            title={`${question} ${questionAccent} ${questionRest}`}
          >
            {question}{" "}
            <span style={{ color: "var(--color-vl-coral)", fontWeight: 600 }}>
              {questionAccent}
            </span>{" "}
            {questionRest}
          </p>
        </div>
        <div className="flex items-end gap-0.5 h-3.5 ml-1 shrink-0">
          {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => (
            <span
              key={i}
              className="w-0.5 rounded-full"
              style={{
                background: "var(--color-vl-coral)",
                height: `${h * 100}%`,
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -
   INTEGRATIONS STRIP
   - */
function IntegrationsStrip() {
  const integrations = [
    { name: "Square", color: "#0A0A0B" },
    { name: "Toast", color: "#FF4F2D" },
    { name: "Lightspeed", color: "#000000" },
    { name: "7Shifts", color: "#0A0A0B" },
    { name: "Xero", color: "#13B5EA" },
    { name: "Resy", color: "#0A0A0B" },
    { name: "OpenTable", color: "#DA3743" },
    { name: "Stripe", color: "#635BFF" },
  ];

  return (
    <section className="py-12 md:py-16">
      <div className="section-container">
        <div className="grid lg:grid-cols-[1fr_2fr] gap-8 items-center">
          <div>
            <p className="vl-eyebrow">Built to connect</p>
            <p
              className="mt-3 text-[14px] leading-relaxed"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              VoyceLab flows into the systems you already use - securely and beautifully.
            </p>
            <Link
              href="/services"
              className="mt-4 inline-flex items-center gap-2 vl-btn-primary text-[13px]"
              style={{ padding: "0.6rem 1.2rem" }}
            >
              Explore integrations
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="flex items-center justify-end gap-3 flex-wrap">
            {integrations.map((it) => (
              <div
                key={it.name}
                className="vl-card px-4 py-3 inline-flex items-center gap-2 text-[13px] font-semibold"
                style={{ color: it.color }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: it.color, opacity: 0.85 }}
                />
                {it.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -
   CONVERSATION SECTION - Live VoyceLab voice FAQ (OpenAI Realtime WebRTC)
   - */
function ConversationSection({ compact = false }: { compact?: boolean }) {
  const demo = useVoycelabDemoRealtime();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [demo.conversation, demo.partialTranscript, demo.agentState]);

  const statusLine = (() => {
    switch (demo.agentState) {
      case "idle":
        return { label: "Ready", color: "var(--color-vl-ink-muted)" };
      case "connecting":
        return { label: "Connecting...", color: "var(--color-vl-honey)" };
      case "listening":
        return { label: "Listening - ask anything about VoyceLab", color: "var(--color-vl-success)" };
      case "thinking":
        return { label: "Thinking...", color: "var(--color-vl-lilac)" };
      case "speaking":
        return { label: "Speaking...", color: "var(--color-vl-coral-deep)" };
      case "error":
        return { label: "Something went wrong", color: "var(--color-vl-danger)" };
      default:
        return { label: "", color: "var(--color-vl-ink-muted)" };
    }
  })();

  const hints = [
    "What is VoyceLab?",
    "How does Square connect?",
    "What voice pipelines can I pick?",
    "How do I start a trial?",
  ];

  return (
    <section id="voice-demo" className={compact ? "relative" : "py-20 md:py-28 relative"}>
      <div className={compact ? "" : "section-container"}>
        <div className={compact ? "grid gap-4" : "grid lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-14 items-start"}>
          {!compact && <div>
            <p className="vl-eyebrow">Less busywork. More guest magic.</p>
            <h2 className="vl-section-heading mt-5 max-w-115">
              Let's put your venue
              <br />
              <em>in conversation.</em>
            </h2>
            <p
              className="mt-6 text-[16px] leading-relaxed max-w-110"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              This is a live, low-latency voice line powered by OpenAI Realtime - ask aloud about VoyceLab:
              integrations, assistants, pricing overview, and how operators use voice day-to-day.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="vl-btn-primary inline-flex items-center gap-2">
                Book a demo
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <a href="#voice-demo-panel" className="vl-btn-outline inline-flex items-center gap-2">
                Try voice FAQ
                <Mic className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="mt-5 flex items-center gap-2 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: "var(--color-vl-success)" }} />
              Microphone required - Answers only cover VoyceLab (demo sandbox - no POS tools).
            </div>

            <p className="mt-4 text-[12px] max-w-110" style={{ color: "var(--color-vl-ink-faint)" }}>
              Hint phrases below are prompts - speak naturally after you tap Start.
            </p>
          </div>}

          <motion.div
            id="voice-demo-panel"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={childFade}
            className={compact ? "scroll-mt-24" : "vl-card-glass p-6 md:p-8 scroll-mt-24"}
          >
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background:
                      "linear-gradient(135deg, #FF8A66, #000000)",
                    boxShadow: "0 8px 20px rgba(99, 102, 241,0.30)",
                  }}
                >
                  {demo.agentState === "connecting" ? (
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  ) : (
                    <Mic className="w-5 h-5 text-white" />
                  )}
                </div>
                <div>
                  <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                    VoyceLab voice guide
                  </p>
                  <p className="text-[12px] font-medium" style={{ color: statusLine.color }}>
                    {statusLine.label}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <DemoStatusWaveform state={demo.agentState} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {!demo.isLive ? (
                <button type="button" onClick={() => void demo.connect()} className="vl-btn-primary text-[13px] px-5 py-2.5 inline-flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  Start voice demo
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => void demo.disconnect()} className="vl-btn-outline text-[13px] px-5 py-2.5">
                    End session
                  </button>
                  {(demo.agentState === "speaking" || demo.agentState === "thinking") && (
                    <button
                      type="button"
                      onClick={demo.interrupt}
                      className="vl-btn-ghost text-[13px] px-4 py-2.5"
                    >
                      Interrupt
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={demo.clearConversation}
                    className="text-[12px] font-medium underline-offset-2 hover:underline"
                    style={{ color: "var(--color-vl-ink-muted)" }}
                  >
                    Clear transcript
                  </button>
                </>
              )}
            </div>

            {demo.error && (
              <p className="mb-3 text-[13px] rounded-xl px-3 py-2" style={{ background: "rgba(215,64,46,0.08)", color: "var(--color-vl-danger)" }}>
                {demo.error}
              </p>
            )}

            {/* Transcript */}
            <div
              ref={scrollRef}
              className={(compact ? "max-h-47.5" : "max-h-[min(340px,50vh)]") + " overflow-y-auto space-y-3 pr-1"}
              style={{ scrollbarWidth: "thin" }}
            >
              {!demo.isLive && demo.conversation.length === 0 && (
                <p className="text-[14px] leading-relaxed py-4 text-center" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Tap <strong style={{ color: "var(--color-vl-ink)" }}>Start voice demo</strong>, allow your microphone,
                  then ask out loud - you'll hear answers through your speakers or headset.
                </p>
              )}

              {demo.conversation.map((msg) => (
                <div key={msg.id} className="flex gap-3">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background:
                        msg.role === "user"
                          ? "rgba(10, 10, 11,0.06)"
                          : "linear-gradient(135deg, #FF8A66, #000000)",
                    }}
                  >
                    {msg.role === "user" ? (
                      <Users className="w-3.5 h-3.5" style={{ color: "var(--color-vl-ink-muted)" }} />
                    ) : (
                      <Mic className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <div
                    className="rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%]"
                    style={
                      msg.role === "user"
                        ? { background: "rgba(10, 10, 11,0.04)" }
                        : {
                            background: "var(--color-vl-coral-tint)",
                            border: "1px solid rgba(99, 102, 241,0.18)",
                          }
                    }
                  >
                    <p className="text-[14px] leading-relaxed" style={{ color: "var(--color-vl-ink-soft)" }}>
                      {msg.content}
                    </p>
                  </div>
                </div>
              ))}

              {demo.partialTranscript.trim().length > 0 && (
                <div className="flex gap-3 opacity-90">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #FF8A66, #000000)" }}
                  >
                    <Mic className="w-3 h-3 text-white" />
                  </div>
                  <div
                    className="rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%] italic"
                    style={{
                      background: "rgba(255,241,235,0.85)",
                      border: "1px dashed rgba(99, 102, 241,0.35)",
                    }}
                  >
                    <p className="text-[14px] leading-relaxed" style={{ color: "var(--color-vl-ink-soft)" }}>
                      {demo.partialTranscript}
                      <span className="inline-block w-1.5 h-4 ml-0.5 align-middle animate-pulse" style={{ background: "var(--color-vl-coral)" }} />
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Hint phrases */}
            <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(10, 10, 11,0.07)" }}>
              <p
                className="text-[10.5px] font-semibold uppercase tracking-[0.2em] mb-3"
                style={{ color: "var(--color-vl-ink-muted)" }}
              >
                Try asking
              </p>
              <div className="flex flex-wrap gap-2">
                {hints.map((h) => (
                  <span key={h} className="vl-chip-light">
                    <Mic className="w-3 h-3" style={{ color: "var(--color-vl-coral)" }} />
                    {h}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

type DemoWaveState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

function DemoStatusWaveform({ state }: { state: DemoWaveState }) {
  const bars = 9;
  const active =
    state === "listening" || state === "speaking" || state === "thinking" || state === "connecting";
  return (
    <div className="flex items-center gap-0.75 h-6">
      {Array.from({ length: bars }, (_, i) => {
        const center = (bars - 1) / 2;
        const distance = Math.abs(i - center) / center;
        const base = active ? 35 + (1 - distance) * 65 : 28 + (1 - distance) * 40;
        const animationDuration =
          state === "connecting" ? 0.55 : state === "thinking" ? 0.85 : state === "speaking" ? 0.65 : 1.15;
        const delay = i * 0.07;
        return (
          <div
            key={i}
            className="w-0.75 rounded-full"
            style={{
              background:
                state === "error"
                  ? "var(--color-vl-danger)"
                  : state === "thinking"
                    ? "var(--color-vl-lilac)"
                    : "var(--color-vl-coral)",
              height: `${base}%`,
              animation: active ? `vl-wave ${animationDuration}s ease-in-out ${delay}s infinite` : undefined,
              opacity: state === "idle" ? 0.45 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

/* -
   ASSISTANT TOUR - three numbered hospitality assistants
   - */
function AssistantTour() {
  const items = [
    {
      index: "01",
      title: "POS Assistant",
      blurb: "Tabs, payments, refunds, and reorders without taking a hand off the floor.",
      icon: <CreditCard className="w-5 h-5" />,
      accent: "var(--color-vl-lilac)",
      tint: "var(--color-vl-lilac-soft)",
      lines: ['Split Table 12 three ways.', 'Comp dessert for the Patel party.', 'Run end-of-night close.'],
    },
    {
      index: "02",
      title: "Inventory Assistant",
      blurb: "Live stock checks, reorder math, and shortage alerts before they hit the shelf.",
      icon: <Wine className="w-5 h-5" />,
      accent: "var(--color-vl-sage)",
      tint: "var(--color-vl-sage-soft)",
      lines: ['Do we have enough tequila for tonight?', 'What\'s low across the bar?', 'Reorder the Pinot Grigio.'],
    },
    {
      index: "03",
      title: "Venue Assistant",
      blurb: "Events, timelines, staffing, packages - orchestrated by voice across the night.",
      icon: <CalendarRange className="w-5 h-5" />,
      accent: "var(--color-vl-coral)",
      tint: "var(--color-vl-coral-tint)",
      lines: ['Walk me through the Johnson wedding.', 'Who\'s on the floor at 8?', 'Update the bar package to premium.'],
    },
  ];

  return (
    <section id="how-it-works" className="py-20 md:py-28">
      <div className="section-container">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={childFade} className="vl-eyebrow">
            Meet your assistants
          </motion.p>
          <motion.h2 variants={childFade} className="vl-section-heading mt-5 max-w-3xl">
            Three voices that already know
            <br />
            <em>how your venue runs.</em>
          </motion.h2>
          <motion.p
            variants={childFade}
            className="mt-5 text-[16px] leading-relaxed max-w-xl"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            VoyceLab ships with hospitality assistants that connect to the tools your team
            already uses. Pick one, name it, and let it run with you.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="grid md:grid-cols-3 gap-5 mt-12"
        >
          {items.map((it) => (
            <motion.div key={it.index} variants={childFade} className="vl-card p-7 relative overflow-hidden">
              <div
                className="absolute -top-12 -right-12 w-40 h-40 rounded-full"
                style={{ background: it.tint, filter: "blur(40px)", opacity: 0.85 }}
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-center justify-between mb-5">
                  <span
                    className="text-[12px] font-semibold tracking-[0.2em]"
                    style={{ color: "var(--color-vl-ink-muted)" }}
                  >
                    {it.index}
                  </span>
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{
                      background: it.tint,
                      color: it.accent,
                      border: `1px solid ${it.accent}`,
                    }}
                  >
                    {it.icon}
                  </span>
                </div>
                <h3
                  className="vl-display text-[26px]"
                  style={{ color: "var(--color-vl-ink)" }}
                >
                  {it.title}
                </h3>
                <p
                  className="mt-3 text-[14px] leading-relaxed"
                  style={{ color: "var(--color-vl-ink-muted)" }}
                >
                  {it.blurb}
                </p>
                <div className="mt-5 space-y-1.5">
                  {it.lines.map((l) => (
                    <div
                      key={l}
                      className="flex items-start gap-2 text-[13px] italic"
                      style={{ color: "var(--color-vl-ink-soft)", fontFamily: "var(--font-display)" }}
                    >
                      <Mic className="w-3 h-3 mt-1 shrink-0" style={{ color: it.accent }} />
                      "{l}"
                    </div>
                  ))}
                </div>
                <Link
                  href="/assistants/new"
                  className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold"
                  style={{ color: it.accent }}
                >
                  Configure {it.title.split(" ")[0].toLowerCase()}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* -
   SHIFT SECTION - old way vs voycelab way
   - */
function ShiftSection() {
  const oldWay = [
    "Open POS",
    "Check spreadsheets",
    "Count bottles",
    "Text staff",
    "Guess reorder quantity",
    "Hope nothing runs out",
  ];
  const newWay = [
    "Ask Voyce",
    "Get the answer",
    "Review the recommendation",
    "Confirm the action",
    "Move on",
  ];

  return (
    <section className="py-20 md:py-28 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 100%, rgba(251, 207, 232,0.20), transparent 70%)",
        }}
      />
      <div className="relative section-container">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={childFade} className="vl-eyebrow">
            The shift
          </motion.p>
          <motion.h2 variants={childFade} className="vl-section-heading mt-5 max-w-3xl">
            Dashboards show what happened.
            <br />
            <em>VoyceLab decides what's next.</em>
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="grid md:grid-cols-2 gap-6 mt-12"
        >
          <motion.div variants={childFade} className="vl-card p-7 md:p-8">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.2em] mb-5"
              style={{ color: "var(--color-vl-ink-faint)" }}
            >
              The old way
            </p>
            <ul className="space-y-3">
              {oldWay.map((step) => (
                <li
                  key={step}
                  className="flex items-center gap-3 text-[14px]"
                  style={{ color: "var(--color-vl-ink-muted)" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: "rgba(10, 10, 11,0.20)" }}
                  />
                  {step}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div variants={childFade} className="vl-panel-coral p-7 md:p-8">
            <p className="vl-eyebrow mb-5">The VoyceLab way</p>
            <ul className="space-y-3">
              {newWay.map((step, i) => (
                <li
                  key={step}
                  className="flex items-center gap-3 text-[14px] font-medium"
                  style={{ color: "var(--color-vl-ink)" }}
                >
                  <span
                    className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 text-white"
                    style={{
                      background: "linear-gradient(135deg, #FF8A66, #000000)",
                    }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* -
   ACTIONS SECTION
   - */
function ActionsSection() {
  const actions = [
    {
      icon: <RefreshCw className="w-5 h-5" />,
      title: "Prepare reorder",
      desc: "Voyce checks projected demand against current inventory and prepares a reorder before the shortage hits the floor.",
      tint: "var(--color-vl-coral-tint)",
      color: "var(--color-vl-coral-deep)",
    },
    {
      icon: <Bell className="w-5 h-5" />,
      title: "Notify bar lead",
      desc: "Alerts your bar lead about what needs attention before doors open - no phone tree, no text chain.",
      tint: "var(--color-vl-honey-soft)",
      color: "#B7791F",
    },
    {
      icon: <BarChart3 className="w-5 h-5" />,
      title: "Update forecast",
      desc: "Adjusts projected usage based on guest count changes, package upgrades, or event-type shifts.",
      tint: "var(--color-vl-sage-soft)",
      color: "#3B7A48",
    },
    {
      icon: <AlertTriangle className="w-5 h-5" />,
      title: "Flag shortage risk",
      desc: "Early warnings when inventory is trending below what upcoming events will demand.",
      tint: "var(--color-vl-coral-tint)",
      color: "var(--color-vl-coral-deep)",
    },
    {
      icon: <ClipboardList className="w-5 h-5" />,
      title: "Recap event",
      desc: "After the event, get a clean recap of what sold, what ran low, and what to change next time.",
      tint: "var(--color-vl-lilac-soft)",
      color: "#6F58B0",
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      title: "Sales pulse",
      desc: "Hourly pace, top sellers, guest spend, and side-by-side comparisons against similar past nights.",
      tint: "var(--color-vl-peach-soft)",
      color: "#C66534",
    },
  ];

  return (
    <section className="py-20 md:py-28">
      <div className="section-container">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={childFade} className="vl-eyebrow">
            Beyond answers
          </motion.p>
          <motion.h2 variants={childFade} className="vl-section-heading mt-5 max-w-2xl">
            Answers are helpful.
            <br />
            <em>Actions change the night.</em>
          </motion.h2>
          <motion.p
            variants={childFade}
            className="mt-5 text-[16px] leading-relaxed max-w-2xl"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            VoyceLab does more than respond. It helps your team prepare, decide, and act
            while the operation is still moving.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12"
        >
          {actions.map((a) => (
            <motion.div key={a.title} variants={childFade} className="vl-card p-6 group">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-105"
                style={{ background: a.tint, color: a.color }}
              >
                {a.icon}
              </div>
              <h3 className="vl-display text-[20px]" style={{ color: "var(--color-vl-ink)" }}>
                {a.title}
              </h3>
              <p
                className="text-[14px] mt-2.5 leading-relaxed"
                style={{ color: "var(--color-vl-ink-muted)" }}
              >
                {a.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* -
   VENUE OUTCOMES
   - */
function VenueOutcomes() {
  const outcomes = [
    "No more surprise shortages",
    "No more guessing orders",
    "No more scattered systems",
    "No more searching for answers",
    "No more reactive nights",
    "No more constant interruptions",
  ];

  const stats = [
    { value: "200+", label: "venues running on VoyceLab" },
    { value: "4.9", label: "average operator rating" },
    { value: "15 min", label: "to deploy your first assistant" },
  ];

  return (
    <section id="use-cases" className="py-20 md:py-28">
      <div className="section-container">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center"
        >
          <motion.p variants={childFade} className="vl-eyebrow">
            The outcome
          </motion.p>
          <motion.h2 variants={childFade} className="vl-section-heading mt-5 mx-auto max-w-2xl">
            Feel ahead of the night,
            <br />
            <em>every night.</em>
          </motion.h2>
          <motion.p
            variants={childFade}
            className="mt-5 text-[16px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            VoyceLab gives owners and managers the calm confidence of knowing what's
            happening, what's at risk, and what needs to happen next.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-12 max-w-4xl mx-auto"
        >
          {outcomes.map((o) => (
            <motion.div
              key={o}
              variants={childFade}
              className="flex items-center gap-3 rounded-2xl px-5 py-3.5"
              style={{
                background: "rgba(255,255,255,0.6)",
                border: "1px solid rgba(10, 10, 11,0.07)",
              }}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--color-vl-sage-soft)" }}
              >
                <Check className="w-3 h-3" style={{ color: "var(--color-vl-success)" }} />
              </span>
              <span className="text-[14px] font-medium" style={{ color: "var(--color-vl-ink)" }}>
                {o}
              </span>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="grid sm:grid-cols-3 gap-5 mt-14 max-w-4xl mx-auto"
        >
          {stats.map((s) => (
            <motion.div
              key={s.label}
              variants={childFade}
              className="vl-card p-6 text-center"
            >
              <p
                className="vl-display text-[30px] sm:text-[40px] md:text-[44px]"
                style={{ color: "var(--color-vl-coral-deep)" }}
              >
                {s.value}
              </p>
              <p
                className="mt-1.5 text-[13px]"
                style={{ color: "var(--color-vl-ink-muted)" }}
              >
                {s.label}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* -
   FINAL CTA
   - */
function FinalCTA({
  name,
  setName,
  onStart,
}: {
  name: string;
  setName: (v: string) => void;
  onStart: () => void;
}) {
  return (
    <section
      id="final-cta"
      className="relative py-24 md:py-32 overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(251, 207, 232,0.40), transparent 65%), radial-gradient(ellipse 50% 40% at 20% 90%, rgba(199, 210, 254,0.35), transparent 65%), radial-gradient(ellipse 50% 40% at 80% 90%, rgba(167, 243, 208,0.30), transparent 65%)",
        }}
      />

      <div className="relative section-container text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          <motion.p variants={childFade} className="vl-eyebrow">
            Less busywork. More guest magic.
          </motion.p>
          <motion.h2 variants={childFade} className="vl-section-heading mt-5 mx-auto max-w-3xl">
            Let's put your venue
            <br />
            <em>in conversation.</em>
          </motion.h2>
          <motion.p
            variants={childFade}
            className="mt-5 text-[17px] max-w-xl mx-auto leading-relaxed"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            Pick a name. Pick a system. Pick a question to ask. Be running in fifteen minutes.
          </motion.p>

          <motion.div variants={childFade} className="mt-9 flex flex-col items-center gap-4 max-w-md mx-auto">
            <div className="w-full flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your assistant - Bev, Sage, Marlowe-"
                className="vl-input flex-1"
                onKeyDown={(e) => e.key === "Enter" && onStart()}
              />
              <button
                onClick={onStart}
                className="vl-btn-primary inline-flex items-center gap-2 shrink-0"
              >
                Create
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className="vl-btn-outline inline-flex items-center gap-2">
                Book a live demo
              </Link>
              <span className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                14-day trial - No card required
              </span>
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="mt-14 flex flex-wrap justify-center gap-2.5"
        >
          {[
            "Are we ready for Saturday's wedding?",
            "What ran low last night?",
            "How much bar revenue?",
            "What should I reorder?",
          ].map((q) => (
            <motion.span
              key={q}
              variants={childFade}
              className="inline-flex items-center gap-2 text-[13px] px-4 py-2 rounded-full"
              style={{
                background: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(10, 10, 11,0.07)",
                color: "var(--color-vl-ink-soft)",
              }}
            >
              <Mic className="w-3 h-3" style={{ color: "var(--color-vl-coral)" }} />
              {q}
            </motion.span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
