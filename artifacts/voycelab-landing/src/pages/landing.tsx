import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  CalendarRange,
  CheckCheck,
  GraduationCap,
  Hand,
  Loader2,
  Mic,
  Percent,
  ReceiptText,
  Sparkles,
  Square,
  TrendingUp,
  Users,
  Volume2,
  Wine,
  Zap,
} from "lucide-react";
import { VoiceOrb } from "@/components/voice-orb";
import { useVoycelabDemoRealtime } from "@/hooks/use-voycelab-demo-realtime";

const VoiceField = lazy(() => import("@/components/landing/voice-field"));

const EASE = [0.22, 1, 0.36, 1] as const;

/* ═══════════════════════════════════════════════════════════════
   LANDING — light theme, plain claims.
   One job: get operators to start the free trial. Sections:
   hero → what it does for staff → how it works (scroll theater)
   → live demo → what it does for the business → proof → ask.
   ═══════════════════════════════════════════════════════════════ */

export default function Landing() {
  const [, navigate] = useLocation();
  const [assistantName, setAssistantName] = useState("");
  const reduceMotion = useReducedMotion() ?? false;

  const startAssistant = () => {
    const trimmed = assistantName.trim();
    if (trimmed) sessionStorage.setItem("voycelab.pending_assistant_name", trimmed);
    navigate("/assistants/new");
  };

  return (
    <div className="vl-landing vl-page-shell relative">
      <Hero reduceMotion={reduceMotion} />
      <TeamSection />
      <CommandTheater reduceMotion={reduceMotion} />
      <LiveDemo />
      <OwnerSection />
      <ProofBand />
      <FinalCTA
        name={assistantName}
        setName={setAssistantName}
        onStart={startAssistant}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   Magnetic wrapper — primary CTA micro-interaction. Transform-only.
   ─────────────────────────────────────────────────────────────── */
function Magnetic({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 260, damping: 17 });
  const y = useSpring(0, { stiffness: 260, damping: 17 });

  return (
    <motion.div
      ref={ref}
      style={{ x, y, display: "inline-block" }}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType === "touch") return;
        const r = el.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * 0.22);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.22);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────────────────────────────────────────────
   HERO — plain claim over the particle voice field.
   H1 renders statically; LCP never waits on JS animation.
   ─────────────────────────────────────────────────────────────── */

const HERO_TICKER: Array<{ say: string; lines: Array<[string, string]> }> = [
  {
    say: "Two old fashioneds — one extra bitters, one no cherry.",
    lines: [
      ["2 × Old Fashioned", "$28.00"],
      ["Mods: extra bitters · no cherry", ""],
    ],
  },
  {
    say: "How many bottles of Tito's are left?",
    lines: [
      ["Tito's Handmade", "6 bottles"],
      ["Low-stock alert", "set"],
    ],
  },
  {
    say: "Split table 9 three ways.",
    lines: [
      ["Check 9 · 3 ways", "$47.50 each"],
      ["Sent to Square", ""],
    ],
  },
  {
    say: "How did happy hour perform?",
    lines: [
      ["Happy hour sales", "$2,340"],
      ["vs last Friday", "+18%"],
    ],
  },
];

function Hero({ reduceMotion }: { reduceMotion: boolean }) {
  const [fieldReady, setFieldReady] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;
    let idleId = 0;
    let timeoutId = 0;
    const arm = () => setFieldReady(true);
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(arm, { timeout: 1400 });
    } else {
      timeoutId = window.setTimeout(arm, 350);
    }
    return () => {
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [reduceMotion]);

  return (
    <section className="relative min-h-[92svh] flex flex-col overflow-hidden">
      {/* Signature: the voice field, in brand pastels */}
      {fieldReady && (
        <Suspense fallback={null}>
          <VoiceField className="opacity-80" />
        </Suspense>
      )}

      {/* Paper wash so type always wins over the field */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.30) 38%, rgba(255,255,255,0.30) 60%, rgba(255,255,255,0.92) 100%)",
        }}
      />

      <div className="relative section-container flex-1 flex items-center pt-16 pb-16 md:pt-20">
        <div className="grid lg:grid-cols-[1.12fr_0.88fr] gap-12 items-center w-full">
          <div>
            <p className="vl-eyebrow">Voice assistant for Square POS · Bars · Restaurants · Venues</p>

            <h1 className="vl-display mt-5 text-[clamp(2.9rem,7vw,5.4rem)]">
              Run your bar
              <br />
              <em>by voice.</em>
            </h1>

            <motion.p
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
              className="mt-6 max-w-130 text-[17px] md:text-[18px] leading-relaxed"
              style={{ color: "var(--color-vl-ink-soft)" }}
            >
              VoyceLab connects to your Square POS. Your team places orders,
              checks inventory, and pulls sales numbers by speaking — sub-second
              responses, hands free, everything synced to Square.
            </motion.p>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.6, ease: EASE }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Magnetic>
                <Link href="/signup" className="vl-btn-primary inline-flex items-center gap-2.5">
                  Start free trial
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/25">
                    <ArrowRight className="w-3 h-3 text-white" />
                  </span>
                </Link>
              </Magnetic>
              <a href="#live-demo" className="vl-btn-outline inline-flex items-center gap-2.5">
                Hear it live
                <Mic className="w-3.5 h-3.5" style={{ color: "var(--color-vl-accent)" }} />
              </a>
            </motion.div>

            <motion.p
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="mt-5 text-[13px]"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              14-day free trial · No card required · Works with your Square account
            </motion.p>
          </div>

          {/* Above-the-fold proof: spoken commands landing in Square */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.7, ease: EASE }}
            className="hidden lg:block"
          >
            <HeroTicker reduceMotion={reduceMotion} />
          </motion.div>
        </div>
      </div>

      <a
        href="#for-your-team"
        aria-label="Scroll to see what it does"
        className="relative mx-auto mb-7 flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          border: "1px solid rgba(10, 10, 11, 0.14)",
          color: "var(--color-vl-ink-muted)",
          background: "rgba(255,255,255,0.7)",
        }}
      >
        <ArrowDown className="w-4 h-4" />
      </a>
    </section>
  );
}

function HeroTicker({ reduceMotion }: { reduceMotion: boolean }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % HERO_TICKER.length),
      4200,
    );
    return () => window.clearInterval(t);
  }, [reduceMotion]);

  const item = HERO_TICKER[idx];

  return (
    <div className="vl-card-glass p-7 max-w-105 ml-auto">
      <div className="flex items-center justify-between">
        <p className="vl-eyebrow">On the floor</p>
        <span
          className="flex items-center gap-1.5 text-[10px] font-mono tracking-[0.18em]"
          style={{ color: "var(--color-vl-accent-deep)" }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ background: "var(--color-vl-accent)" }}
          />
          SQUARE · SYNCED
        </span>
      </div>

      <div className="mt-6 min-h-36">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <p
              className="text-[17px] leading-snug font-medium italic"
              style={{ color: "var(--color-vl-ink)" }}
            >
              &ldquo;{item.say}&rdquo;
            </p>
            <div className="mt-4">
              {item.lines.map(([label, value]) => (
                <div key={label} className="lx-ticket-row">
                  <span style={{ color: "var(--color-vl-ink-soft)" }}>{label}</span>
                  {value && (
                    <span style={{ color: "var(--color-vl-accent-deep)", fontWeight: 600 }}>
                      {value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex gap-1.5">
        {HERO_TICKER.map((_, i) => (
          <span
            key={i}
            className="h-0.75 flex-1 rounded-full transition-colors duration-300"
            style={{
              background: i === idx ? "var(--color-vl-accent)" : "rgba(10, 10, 11, 0.10)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   FOR YOUR TEAM — operational advantages, stated plainly.
   ─────────────────────────────────────────────────────────────── */

const TEAM_CARDS = [
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Keeps up with back-to-back orders",
    text: "Sub-second responses built for the rush. Ask, confirm, and send drinks to the POS without making guests wait.",
  },
  {
    icon: <Hand className="w-5 h-5" />,
    title: "Hands stay free",
    text: "Place or modify orders, check tabs, or split checks while shaking, pouring, or talking to guests. No fumbling with tablets mid-pour.",
  },
  {
    icon: <CheckCheck className="w-5 h-5" />,
    title: "Complex orders, rung correctly",
    text: "“Spicy margarita, no triple sec, salt rim” lands in Square exactly as spoken. Fewer remakes, less wasted liquor.",
  },
  {
    icon: <Wine className="w-5 h-5" />,
    title: "Inventory answers on the spot",
    text: "“How many bottles of Tito's left?” “Is the IPA keg tapped?” Live counts from Square — before you 86 a popular pour or over-order.",
  },
  {
    icon: <ReceiptText className="w-5 h-5" />,
    title: "Straight into Square tabs",
    text: "Voice orders flow into open tabs, payments, and inventory updates. No double entry, no missed modifiers, clean close-out.",
  },
  {
    icon: <GraduationCap className="w-5 h-5" />,
    title: "New bartenders, productive day one",
    text: "New hires speak naturally instead of memorizing POS buttons. Consistent execution across every shift, even with turnover.",
  },
];

function TeamSection() {
  return (
    <section id="for-your-team" className="py-20 md:py-28 scroll-mt-20">
      <div className="section-container">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <p className="vl-eyebrow">For your team during service</p>
          <h2 className="vl-section-heading mt-5 max-w-2xl">
            Built for <em>the rush.</em>
          </h2>
          <p
            className="mt-5 text-[16px] leading-relaxed max-w-xl"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            Everything your team does on the POS screen, done by speaking —
            faster, and with fewer mistakes.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
          {TEAM_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.07, ease: EASE }}
              className="vl-card p-6"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                style={{
                  background: "var(--color-vl-accent-tint)",
                  color: "var(--color-vl-accent-deep)",
                }}
              >
                {card.icon}
              </div>
              <h3 className="text-[17px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                {card.title}
              </h3>
              <p
                className="text-[14px] mt-2.5 leading-relaxed"
                style={{ color: "var(--color-vl-ink-muted)" }}
              >
                {card.text}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-6 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(10, 10, 11, 0.07)",
          }}
        >
          <Volume2 className="w-4.5 h-4.5 shrink-0" style={{ color: "var(--color-vl-accent)" }} />
          <p className="text-[14px]" style={{ color: "var(--color-vl-ink-soft)" }}>
            Noise-resistant and context-aware — it holds up when the bar is
            three deep and the music is up.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   HOW IT WORKS — pinned scroll theater. A spoken sentence fills
   word by word; the Square result assembles beside it.
   Mobile / reduced-motion: the same scenes as static cards.
   ─────────────────────────────────────────────────────────────── */

interface TheaterSceneData {
  id: string;
  eyebrow: string;
  sentence: string;
  title: string;
  rows: Array<[string, string, boolean?]>; // label, value, alert
  stamp: string;
  note: string;
}

const SCENES: TheaterSceneData[] = [
  {
    id: "orders",
    eyebrow: "01 · Orders",
    sentence:
      "Two old fashioneds for table 12 — one with extra bitters, one no cherry.",
    title: "TABLE 12 — OPEN TAB",
    rows: [
      ["2 × Old Fashioned", "$28.00"],
      ["Mod: extra bitters", "✓"],
      ["Mod: no cherry", "✓"],
    ],
    stamp: "SENT TO SQUARE",
    note: "Modifiers land exactly as spoken — fewer remakes, less wasted liquor.",
  },
  {
    id: "inventory",
    eyebrow: "02 · Inventory",
    sentence: "How many bottles of Tito's are left — and is the IPA keg tapped?",
    title: "BAR INVENTORY — LIVE",
    rows: [
      ["Tito's Handmade", "6 bottles"],
      ["Hazy IPA keg", "68% full"],
      ["Low-stock alert", "set for vodka", true],
    ],
    stamp: "PULLED FROM SQUARE",
    note: "Live counts from Square inventory — before you 86 a popular pour or over-order.",
  },
  {
    id: "reports",
    eyebrow: "03 · Reports",
    sentence: "How did happy hour perform?",
    title: "TONIGHT — 5–7 PM",
    rows: [
      ["Happy hour sales", "$2,340"],
      ["vs last Friday", "+18%"],
      ["Top pour", "Spicy Margarita × 41"],
    ],
    stamp: "ANSWERED BY VOICE",
    note: "Sales, pour cost, and trends the moment you ask — no dashboards during service.",
  },
];

function CommandTheater({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <section className="relative">
      <div className="section-container">
        <p className="vl-eyebrow">How it works</p>
        <h2 className="vl-section-heading mt-5 max-w-3xl">
          You talk. <em>Square updates.</em>
        </h2>
      </div>

      {reduceMotion ? (
        <TheaterStatic />
      ) : (
        <>
          <div className="hidden md:block">
            <TheaterScrub />
          </div>
          <div className="md:hidden">
            <TheaterStatic />
          </div>
        </>
      )}
    </section>
  );
}

function TheaterScrub() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  return (
    <div ref={ref} style={{ height: `${SCENES.length * 130}vh` }}>
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        {/* Progress rail */}
        <motion.div
          aria-hidden
          className="absolute left-0 top-0 w-0.5 origin-top"
          style={{
            height: "100%",
            background: "linear-gradient(180deg, #6366F1, #EC4899)",
            scaleY: scrollYProgress,
          }}
        />
        <div className="section-container w-full relative" style={{ height: "min(560px, 72vh)" }}>
          {SCENES.map((scene, i) => (
            <TheaterScene
              key={scene.id}
              scene={scene}
              index={i}
              total={SCENES.length}
              progress={scrollYProgress}
            />
          ))}

          <div className="absolute right-6 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3">
            {SCENES.map((s, i) => (
              <SceneDot key={s.id} index={i} total={SCENES.length} progress={scrollYProgress} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneDot({
  index,
  total,
  progress,
}: {
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const s = index / total;
  const e = (index + 1) / total;
  const opacity = useTransform(progress, [s - 0.02, s, e, e + 0.02], [0.25, 1, 1, 0.25]);
  return (
    <motion.span
      style={{ opacity, background: "var(--color-vl-accent)" }}
      className="h-1.5 w-1.5 rounded-full"
    />
  );
}

function TheaterScene({
  scene,
  index,
  total,
  progress,
}: {
  scene: TheaterSceneData;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const s = index / total;
  const e = (index + 1) / total;
  const first = index === 0;
  const last = index === total - 1;

  // Crossfade overlaps the neighbour scene — no dead window between scenes.
  const opacity = useTransform(
    progress,
    [first ? 0 : s - 0.012, first ? 0.0001 : s + 0.028, last ? 0.9999 : e - 0.03, last ? 1 : e],
    [first ? 1 : 0, 1, 1, last ? 1 : 0],
  );
  const y = useTransform(
    progress,
    [first ? 0 : s - 0.012, first ? 0.0001 : s + 0.028],
    [first ? 0 : 34, 0],
  );

  const words = scene.sentence.split(" ");
  const wordsStart = s + 0.012;
  const wordsEnd = s + 0.095;
  const rowsStart = s + 0.105;
  const stampAt = rowsStart + scene.rows.length * 0.02 + 0.012;

  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 flex items-center">
      <div className="grid md:grid-cols-[1fr_1fr] gap-12 lg:gap-20 items-center w-full">
        <div>
          <p className="vl-eyebrow">{scene.eyebrow}</p>
          <p
            className="mt-6 text-[clamp(1.5rem,2.7vw,2.2rem)] leading-[1.22] font-medium italic"
            style={{ color: "var(--color-vl-ink)" }}
          >
            <span aria-hidden className="inline-flex items-center mr-3 align-middle">
              <Mic className="w-5 h-5" style={{ color: "var(--color-vl-accent)" }} />
            </span>
            {words.map((w, j) => (
              <ScrubWord
                key={j}
                progress={progress}
                start={wordsStart + (j / words.length) * (wordsEnd - wordsStart)}
              >
                {w}
              </ScrubWord>
            ))}
          </p>
          <ScrubReveal progress={progress} at={stampAt}>
            <p
              className="mt-6 text-[14.5px] leading-relaxed max-w-95"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              {scene.note}
            </p>
          </ScrubReveal>
        </div>

        <div className="vl-card p-7 lg:p-9 relative">
          <div className="flex items-center justify-between">
            <span
              className="font-mono text-[11px] tracking-[0.2em]"
              style={{ color: "var(--color-vl-ink-faint)" }}
            >
              {scene.title}
            </span>
            <Square className="w-3.5 h-3.5" style={{ color: "var(--color-vl-ink-faint)" }} />
          </div>
          <div className="mt-4">
            {scene.rows.map(([label, value, alert], k) => (
              <ScrubRow
                key={label}
                progress={progress}
                at={rowsStart + k * 0.02}
                label={label}
                value={value}
                alert={Boolean(alert)}
              />
            ))}
          </div>
          <ScrubStamp progress={progress} at={stampAt} label={scene.stamp} />
        </div>
      </div>
    </motion.div>
  );
}

function ScrubWord({
  progress,
  start,
  children,
}: {
  progress: MotionValue<number>;
  start: number;
  children: string;
}) {
  const opacity = useTransform(progress, [start, start + 0.012], [0.22, 1]);
  return (
    <motion.span style={{ opacity }} className="inline">
      {children}{" "}
    </motion.span>
  );
}

function ScrubRow({
  progress,
  at,
  label,
  value,
  alert,
}: {
  progress: MotionValue<number>;
  at: number;
  label: string;
  value: string;
  alert: boolean;
}) {
  const opacity = useTransform(progress, [at, at + 0.02], [0, 1]);
  const y = useTransform(progress, [at, at + 0.02], [10, 0]);
  return (
    <motion.div style={{ opacity, y }} className="lx-ticket-row">
      <span style={{ color: "var(--color-vl-ink-soft)" }}>{label}</span>
      <span
        style={{
          color: alert ? "var(--color-vl-warning)" : "var(--color-vl-accent-deep)",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </motion.div>
  );
}

function ScrubStamp({
  progress,
  at,
  label,
}: {
  progress: MotionValue<number>;
  at: number;
  label: string;
}) {
  const opacity = useTransform(progress, [at, at + 0.02], [0, 1]);
  const scale = useTransform(progress, [at, at + 0.025], [1.25, 1]);
  return (
    <motion.div style={{ opacity, scale }} className="mt-6 lx-stamp">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-vl-accent)" }} />
      {label}
    </motion.div>
  );
}

function ScrubReveal({
  progress,
  at,
  children,
}: {
  progress: MotionValue<number>;
  at: number;
  children: ReactNode;
}) {
  const opacity = useTransform(progress, [at, at + 0.025], [0, 1]);
  return <motion.div style={{ opacity }}>{children}</motion.div>;
}

function TheaterStatic() {
  return (
    <div className="section-container mt-12 pb-8 space-y-6">
      {SCENES.map((scene) => (
        <div key={scene.id} className="vl-card p-6 md:p-8">
          <p className="vl-eyebrow">{scene.eyebrow}</p>
          <p
            className="mt-4 text-[19px] leading-snug font-medium italic"
            style={{ color: "var(--color-vl-ink)" }}
          >
            &ldquo;{scene.sentence}&rdquo;
          </p>
          <div className="mt-5">
            {scene.rows.map(([label, value, alert]) => (
              <div key={label} className="lx-ticket-row">
                <span style={{ color: "var(--color-vl-ink-soft)" }}>{label}</span>
                <span
                  style={{
                    color: alert ? "var(--color-vl-warning)" : "var(--color-vl-accent-deep)",
                    fontWeight: 600,
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 lx-stamp">{scene.stamp}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   LIVE DEMO — the real OpenAI Realtime pipeline, on this page.
   ─────────────────────────────────────────────────────────────── */
function LiveDemo() {
  const demo = useVoycelabDemoRealtime();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [demo.conversation, demo.partialTranscript, demo.agentState]);

  const status = (() => {
    switch (demo.agentState) {
      case "connecting":
        return { label: "Connecting…", color: "var(--color-vl-warning)" };
      case "listening":
        return { label: "Listening — ask it anything", color: "var(--color-vl-success)" };
      case "thinking":
        return { label: "Thinking…", color: "var(--color-vl-accent-deep)" };
      case "speaking":
        return { label: "Speaking…", color: "var(--color-vl-accent-deep)" };
      case "error":
        return { label: "Something went wrong", color: "var(--color-vl-danger)" };
      default:
        return { label: "Ready when you are", color: "var(--color-vl-ink-muted)" };
    }
  })();

  return (
    <section id="live-demo" className="relative py-20 md:py-28 scroll-mt-20">
      <div className="section-container">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20 items-start">
          <div className="lg:sticky lg:top-28">
            <p className="vl-eyebrow">Live demo</p>
            <h2 className="vl-section-heading mt-5">
              Hear it <em>for yourself.</em>
            </h2>
            <p
              className="mt-6 max-w-100 text-[16px] leading-relaxed"
              style={{ color: "var(--color-vl-ink-muted)" }}
            >
              This demo runs on the same low-latency voice pipeline venues use
              in service. Ask it what VoyceLab can do — out loud.
            </p>
            <p className="mt-5 text-[13px]" style={{ color: "var(--color-vl-ink-faint)" }}>
              Microphone required · Demo sandbox — answers cover VoyceLab, no
              live POS commands.
            </p>
          </div>

          <div className="vl-card-glass p-6 md:p-9">
            <div className="flex flex-col items-center">
              <VoiceOrb
                size={230}
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
              <p className="mt-1 font-mono text-[12px]" style={{ color: status.color }}>
                {status.label}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {!demo.isLive ? (
                <button
                  type="button"
                  onClick={() => void demo.connect()}
                  className="vl-btn-primary text-[14px] inline-flex items-center gap-2"
                >
                  <Mic className="w-4 h-4" />
                  Start talking
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void demo.disconnect()}
                    className="vl-btn-outline text-[14px]"
                  >
                    End session
                  </button>
                  {(demo.agentState === "speaking" || demo.agentState === "thinking") && (
                    <button
                      type="button"
                      onClick={demo.interrupt}
                      className="vl-btn-ghost text-[14px]"
                    >
                      Interrupt
                    </button>
                  )}
                </>
              )}
              {demo.agentState === "connecting" && (
                <span
                  className="inline-flex items-center gap-2 text-[13px]"
                  style={{ color: "var(--color-vl-ink-muted)" }}
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                </span>
              )}
            </div>

            {demo.error && (
              <p
                className="mt-4 rounded-xl px-4 py-3 text-[13px]"
                style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-vl-danger)" }}
              >
                {demo.error}
              </p>
            )}

            {(demo.conversation.length > 0 || demo.partialTranscript.trim().length > 0) && (
              <div
                ref={scrollRef}
                className="vl-scroll mt-6 max-h-70 space-y-3 overflow-y-auto pr-2"
                style={{ scrollbarWidth: "thin" }}
              >
                {demo.conversation.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background:
                          msg.role === "user"
                            ? "var(--color-vl-ink-faint)"
                            : "var(--color-vl-accent)",
                      }}
                    />
                    <p
                      className="text-[14px] leading-relaxed"
                      style={{ color: "var(--color-vl-ink-soft)" }}
                    >
                      {msg.content}
                    </p>
                  </div>
                ))}
                {demo.partialTranscript.trim().length > 0 && (
                  <div className="flex gap-3 opacity-80">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: "var(--color-vl-accent)" }}
                    />
                    <p
                      className="text-[14px] italic leading-relaxed"
                      style={{ color: "var(--color-vl-ink-soft)" }}
                    >
                      {demo.partialTranscript}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-7 pt-5" style={{ borderTop: "1px solid rgba(10, 10, 11, 0.07)" }}>
              <p className="vl-eyebrow mb-3" style={{ fontSize: 10 }}>
                Try asking
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "What can it do during a rush?",
                  "How does inventory work?",
                  "What does it cost?",
                ].map((h) => (
                  <span key={h} className="vl-chip-light">
                    <Mic className="w-3 h-3" style={{ color: "var(--color-vl-accent)" }} />
                    {h}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   FOR OWNERS — business advantages, stated plainly.
   ─────────────────────────────────────────────────────────────── */

const OWNER_CARDS = [
  {
    icon: <BarChart3 className="w-5 h-5" />,
    title: "Ask your Square data anything",
    text: "“Top 5 cocktails this weekend?” “Liquor cost last night?” “Low-stock alerts for vodka?” Spoken answers on demand — no dashboards during service.",
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    title: "More drinks served per hour",
    text: "Faster order entry means faster turns — plus natural upsell suggestions, like a pairing that's still in stock.",
  },
  {
    icon: <Percent className="w-5 h-5" />,
    title: "Tighter pour costs",
    text: "Real-time inventory and accurate ordering cut over-pours, spoilage, and shrinkage on premium spirits, craft beer, and fresh mixers.",
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: "Labor that goes further",
    text: "Bartenders spend their time with guests and sales instead of admin and stock runs. Less overtime, better morale.",
  },
  {
    icon: <CalendarRange className="w-5 h-5" />,
    title: "Menu and schedule decisions on data",
    text: "Spot slow movers, peak pour times, and trending drinks instantly. Set happy hours, specials, and staffing from real numbers.",
  },
  {
    icon: <Sparkles className="w-5 h-5" />,
    title: "Service guests notice",
    text: "Smoother nights for guests and modern tools that respect the craft — easier to hire for, easier to keep.",
  },
];

function OwnerSection() {
  return (
    <section className="py-20 md:py-28">
      <div className="section-container">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <p className="vl-eyebrow">For owners</p>
          <h2 className="vl-section-heading mt-5 max-w-2xl">
            Better numbers at <em>the close.</em>
          </h2>
          <p
            className="mt-5 text-[16px] leading-relaxed max-w-xl"
            style={{ color: "var(--color-vl-ink-muted)" }}
          >
            The same voice line answers business questions and tightens the
            costs that eat bar margins.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
          {OWNER_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.07, ease: EASE }}
              className="vl-card p-6"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                style={{
                  background: "var(--color-vl-lilac-soft)",
                  color: "var(--color-vl-accent-deep)",
                }}
              >
                {card.icon}
              </div>
              <h3 className="text-[17px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                {card.title}
              </h3>
              <p
                className="text-[14px] mt-2.5 leading-relaxed"
                style={{ color: "var(--color-vl-ink-muted)" }}
              >
                {card.text}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   PROOF — numbers and the systems it runs on.
   ─────────────────────────────────────────────────────────────── */
function ProofBand() {
  const stats = [
    { value: "200+", label: "venues running on VoyceLab" },
    { value: "4.9", label: "average operator rating" },
    { value: "100%", label: "of actions logged in Square — auditable, reversible" },
  ];

  return (
    <section className="py-20 md:py-24">
      <div className="section-container">
        <div className="vl-line mb-14" />
        <div className="grid md:grid-cols-3 gap-10 md:gap-6">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: i * 0.08, ease: EASE }}
              className={i > 0 ? "md:pl-6 md:border-l" : ""}
              style={i > 0 ? { borderColor: "rgba(10, 10, 11, 0.08)" } : undefined}
            >
              <p className="vl-display vl-gradient-text text-[clamp(2.6rem,5vw,3.8rem)] leading-none">
                {s.value}
              </p>
              <p
                className="mt-3 max-w-60 text-[14px] leading-relaxed"
                style={{ color: "var(--color-vl-ink-muted)" }}
              >
                {s.label}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-4">
          <span className="vl-eyebrow mr-2">Runs on</span>
          {[
            { src: "/brand/square-logo.png", alt: "Square" },
            { src: "/brand/openai-wordmark.png", alt: "OpenAI" },
            { src: "/brand/google-g.png", alt: "Google" },
          ].map((logo) => (
            <span key={logo.alt} className="vl-card inline-flex h-12 items-center px-5">
              <img src={logo.src} alt={logo.alt} loading="lazy" style={{ maxHeight: 22, width: "auto" }} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   FINAL CTA — name it, connect Square, try it on your own menu.
   ─────────────────────────────────────────────────────────────── */
function FinalCTA({
  name,
  setName,
  onStart,
}: {
  name: string;
  setName: (v: string) => void;
  onStart: () => void;
}) {
  const trimmed = name.trim();

  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(251, 207, 232, 0.40), transparent 65%), radial-gradient(ellipse 50% 40% at 20% 90%, rgba(199, 210, 254, 0.35), transparent 65%), radial-gradient(ellipse 50% 40% at 80% 90%, rgba(167, 243, 208, 0.30), transparent 65%)",
        }}
      />

      <div className="relative section-container text-center">
        <p className="vl-eyebrow">Get started</p>
        <h2 className="vl-section-heading mt-5 mx-auto max-w-3xl">
          Give your venue <em>a voice.</em>
        </h2>
        <p
          className="mt-5 mx-auto max-w-lg text-[16px] md:text-[17px] leading-relaxed"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          Name your assistant, connect Square, and try it on your own menu.
        </p>

        <div className="mx-auto mt-9 flex max-w-lg flex-col items-center gap-4">
          <div className="flex w-full flex-col sm:flex-row gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your assistant — Bev, Marlowe, Ash…"
              aria-label="Assistant name"
              className="vl-input flex-1"
              onKeyDown={(e) => e.key === "Enter" && onStart()}
            />
            <Magnetic>
              <button
                onClick={onStart}
                className="vl-btn-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
              >
                {trimmed ? `Meet ${trimmed}` : "Create yours"}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </Magnetic>
          </div>
          <p className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
            14-day free trial · No card required · Disconnect Square anytime
          </p>
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-2.5">
          {[
            "How many bottles of Tito's are left?",
            "Split table 9 three ways.",
            "Top 5 cocktails this weekend?",
            "Is the IPA keg tapped?",
          ].map((q) => (
            <span key={q} className="vl-chip-light">
              <Mic className="w-3 h-3" style={{ color: "var(--color-vl-accent)" }} />
              {q}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
