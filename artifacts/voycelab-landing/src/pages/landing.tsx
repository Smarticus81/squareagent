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
import { ArrowDown, ArrowRight, Loader2, Mic, Square } from "lucide-react";
import { VoiceOrb } from "@/components/voice-orb";
import { useVoycelabDemoRealtime } from "@/hooks/use-voycelab-demo-realtime";

const VoiceField = lazy(() => import("@/components/landing/voice-field"));

const EASE = [0.22, 1, 0.36, 1] as const;

/* ═══════════════════════════════════════════════════════════════
   LAST CALL CINEMA
   One job: get operators to start the free trial, because every
   trip to the touchscreen is time the bar isn't making money.
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
    // No overflow-hidden on this root — it would become the sticky theater's
    // containing block and kill the pin. html/body already clip overflow-x.
    <div className="vl-nx relative -mt-16 sm:-mt-18">
      <Hero reduceMotion={reduceMotion} />
      <TapCost />
      <CommandTheater reduceMotion={reduceMotion} />
      <LiveDemo />
      <Vocabulary />
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
   Magnetic wrapper — the primary CTA's signature micro-interaction.
   Transform-only, springs settle with slight overshoot.
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
   HERO — the voice field, the promise, one ember CTA.
   H1 renders statically (LCP is never gated on animation).
   ─────────────────────────────────────────────────────────────── */

const HERO_TICKER: Array<{ say: string; lines: Array<[string, string]> }> = [
  {
    say: "Start a tab for Maya — two Palomas.",
    lines: [
      ["Tab opened · MAYA", ""],
      ["2 × Paloma", "$24.00"],
    ],
  },
  {
    say: "86 the oysters, everywhere.",
    lines: [
      ["Oysters", "86'D"],
      ["Menu synced across POS", ""],
    ],
  },
  {
    say: "Send table 9 to the terminal.",
    lines: [
      ["Check · Table 9", "$142.50"],
      ["→ Terminal, awaiting tap", ""],
    ],
  },
  {
    say: "What's low behind the main bar?",
    lines: [
      ["Espolòn Blanco", "4 left"],
      ["Reorder drafted", ""],
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
    <section className="relative min-h-[100svh] flex flex-col overflow-hidden">
      {/* Procedural atmosphere — back-bar glow, no network cost */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 90% 55% at 50% 118%, rgba(232,163,61,0.20), transparent 62%)," +
              "radial-gradient(ellipse 45% 32% at 82% 108%, rgba(255,90,45,0.10), transparent 70%)," +
              "radial-gradient(ellipse 60% 40% at 12% -8%, rgba(232,163,61,0.05), transparent 65%)",
          }}
        />
      </div>

      {/* Signature: the voice field */}
      {fieldReady && (
        <Suspense fallback={null}>
          <VoiceField className="opacity-90" />
        </Suspense>
      )}

      {/* Vignette so type always wins the contrast fight */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,10,9,0.55) 0%, rgba(11,10,9,0.05) 34%, rgba(11,10,9,0.05) 62%, rgba(11,10,9,0.82) 100%)",
        }}
      />
      <div className="nx-grain" aria-hidden />

      <div className="relative section-container flex-1 flex items-center pt-28 pb-24 md:pt-32">
        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-14 items-center w-full">
          <div>
            <p className="nx-eyebrow">
              Voice-run Square POS · Bars · Restaurants · Venues
            </p>

            <h1 className="nx-display mt-6 text-[clamp(3rem,8vw,6.2rem)]">
              Speak.
              <br />
              It&rsquo;s <em>rung in.</em>
            </h1>

            <motion.p
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
              className="nx-body mt-7 max-w-130 text-[17px] md:text-[18px] leading-relaxed"
            >
              VoyceLab is a voice layer over your Square POS. It rings orders,
              splits checks, 86&rsquo;s items, counts stock, reads the
              night&rsquo;s numbers, and fires the terminal — in the time it
              takes to say it.
            </motion.p>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.6, ease: EASE }}
              className="mt-9 flex flex-wrap items-center gap-4"
            >
              <Magnetic>
                <Link href="/signup" className="nx-btn-ember">
                  Start free trial
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Magnetic>
              <a href="#live-demo" className="nx-btn-quiet">
                Talk to it live
                <Mic className="w-4 h-4" style={{ color: "var(--nx-amber)" }} />
              </a>
            </motion.div>

            <motion.p
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="mt-5 text-[13px]"
              style={{ color: "var(--nx-ink-faint)" }}
            >
              14 days free · No card · Works on your real Square account
            </motion.p>
          </div>

          {/* Above-the-fold mechanism proof: commands landing as tickets */}
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
        href="#tap-cost"
        aria-label="Scroll to see how it works"
        className="relative mx-auto mb-8 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ border: "1px solid var(--nx-line-strong)", color: "var(--nx-ink-dim)" }}
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
    <div className="nx-glass p-7 max-w-105 ml-auto">
      <div className="flex items-center justify-between">
        <span className="nx-eyebrow">Live floor</span>
        <span className="flex items-center gap-1.5 nx-mono text-[10px] tracking-[0.18em]"
          style={{ color: "var(--nx-amber)" }}>
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--nx-amber)" }} />
          SQUARE · SYNCED
        </span>
      </div>

      <div className="mt-6 min-h-38">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <p
              className="text-[19px] leading-snug"
              style={{ fontFamily: "var(--nx-display)", fontStyle: "italic", color: "var(--nx-ink)" }}
            >
              &ldquo;{item.say}&rdquo;
            </p>
            <div className="mt-5">
              {item.lines.map(([label, value]) => (
                <div key={label} className="nx-ticket-row">
                  <span style={{ color: "var(--nx-ink-dim)" }}>{label}</span>
                  {value && (
                    <span style={{ color: value.includes("86") ? "var(--nx-ember)" : "var(--nx-amber)" }}>
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
            style={{ background: i === idx ? "var(--nx-amber)" : "var(--nx-line)" }}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   TAP COST — the felt cost of the problem, in one contrast.
   ─────────────────────────────────────────────────────────────── */
function TapCost() {
  return (
    <section id="tap-cost" className="relative py-24 md:py-36">
      <div className="section-container">
        <div className="nx-hairline mb-16 md:mb-24" />
        <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-end">
          <div>
            <p className="nx-eyebrow">The cost of the screen</p>
            <h2 className="nx-display mt-6 text-[clamp(2.2rem,4.6vw,3.9rem)]">
              A three-way split
              <br />
              is fourteen taps.
              <br />
              <em>Or one sentence.</em>
            </h2>
          </div>
          <div className="max-w-105">
            <p className="nx-body text-[16px] md:text-[17px] leading-relaxed">
              Every tap is eyes off the room and hands off the pour. VoyceLab
              gives your register ears — what your team says gets rung,
              counted, fired, and filed in Square while service keeps moving.
            </p>
            <div className="mt-8 space-y-3">
              <div className="nx-command">Split table nine three ways, even.</div>
              <div className="nx-command">Comp the dessert on four.</div>
              <div className="nx-command">Move two cases of Tito&rsquo;s to the main bar.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   COMMAND THEATER — the mechanism, shown not told.
   Desktop: pinned, scroll-scrubbed. One sentence per scene is
   spoken word-by-word as you scroll; the Square result assembles.
   Mobile / reduced-motion: the same three scenes, static.
   ─────────────────────────────────────────────────────────────── */

interface TheaterSceneData {
  id: string;
  eyebrow: string;
  sentence: string;
  title: string;
  rows: Array<[string, string, boolean?]>; // label, value, alarm
  stamp: string;
  note: string;
}

const SCENES: TheaterSceneData[] = [
  {
    id: "ring",
    eyebrow: "01 · Service",
    sentence:
      "Two espresso martinis and a Negroni on table twelve — and 86 the calamari.",
    title: "TABLE 12 — OPEN CHECK",
    rows: [
      ["2 × Espresso Martini", "$32.00"],
      ["1 × Negroni", "$16.00"],
      ["Calamari", "86'D — OFF MENU", true],
    ],
    stamp: "RUNG INTO SQUARE",
    note: "On the ticket, and the calamari pulled everywhere, before the shaker stops.",
  },
  {
    id: "count",
    eyebrow: "02 · Stock",
    sentence: "How much Espolòn is left — and will it last tonight?",
    title: "ESPOLÒN BLANCO — WELL",
    rows: [
      ["On hand", "4 bottles"],
      ["Tonight's projected pour", "6 bottles"],
      ["Shortfall", "2 — LOW", true],
    ],
    stamp: "REORDER DRAFTED",
    note: "Counted, checked against tonight's demand, reorder ready before doors.",
  },
  {
    id: "close",
    eyebrow: "03 · The close",
    sentence: "Run the end-of-day close.",
    title: "SATURDAY — CLOSEOUT",
    rows: [
      ["Gross sales", "$18,412"],
      ["Top seller", "Espresso Martini × 62"],
      ["Open tabs", "3 flagged", true],
      ["Low stock", "5 items listed"],
    ],
    stamp: "NIGHT CLOSED",
    note: "Summary, open orders, low stock — the whole close, spoken once.",
  },
];

function CommandTheater({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <section className="relative">
      <div className="section-container">
        <p className="nx-eyebrow">How a shift sounds</p>
        <h2 className="nx-display mt-6 max-w-3xl text-[clamp(2.2rem,4.6vw,3.9rem)]">
          Three sentences,
          <br />
          <em>three jobs done.</em>
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
        {/* Amber progress rail */}
        <motion.div
          aria-hidden
          className="absolute left-0 top-0 w-0.5 origin-top"
          style={{
            height: "100%",
            background: "linear-gradient(180deg, var(--nx-amber), var(--nx-ember))",
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

          {/* Scene index */}
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
      style={{ opacity, background: "var(--nx-amber)" }}
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

  // Crossfade overlaps the neighbour scene — no dead-black window between scenes.
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
          <p className="nx-eyebrow">{scene.eyebrow}</p>
          <p
            className="mt-6 text-[clamp(1.6rem,3vw,2.5rem)] leading-[1.18]"
            style={{ fontFamily: "var(--nx-display)", fontStyle: "italic" }}
          >
            <span aria-hidden className="inline-flex items-center mr-3 align-middle">
              <Mic className="w-5 h-5" style={{ color: "var(--nx-amber)" }} />
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
            <p className="nx-body mt-6 text-[14.5px] leading-relaxed max-w-95">{scene.note}</p>
          </ScrubReveal>
        </div>

        <div className="nx-card p-7 lg:p-9 relative">
          <div className="flex items-center justify-between">
            <span className="nx-mono text-[11px] tracking-[0.2em]" style={{ color: "var(--nx-ink-faint)" }}>
              {scene.title}
            </span>
            <Square className="w-3.5 h-3.5" style={{ color: "var(--nx-ink-faint)" }} />
          </div>
          <div className="mt-4">
            {scene.rows.map(([label, value, alarm], k) => (
              <ScrubRow
                key={label}
                progress={progress}
                at={rowsStart + k * 0.02}
                label={label}
                value={value}
                alarm={Boolean(alarm)}
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
  const opacity = useTransform(progress, [start, start + 0.012], [0.3, 1]);
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
  alarm,
}: {
  progress: MotionValue<number>;
  at: number;
  label: string;
  value: string;
  alarm: boolean;
}) {
  const opacity = useTransform(progress, [at, at + 0.02], [0, 1]);
  const y = useTransform(progress, [at, at + 0.02], [10, 0]);
  return (
    <motion.div style={{ opacity, y }} className="nx-ticket-row">
      <span style={{ color: "var(--nx-ink-dim)" }}>{label}</span>
      <span style={{ color: alarm ? "var(--nx-ember)" : "var(--nx-amber)" }}>{value}</span>
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
    <motion.div
      style={{ opacity, scale }}
      className="mt-6 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 nx-mono text-[11px] tracking-[0.18em]"
    >
      <span
        className="absolute inset-0 rounded-lg"
        style={{ border: "1px solid var(--nx-amber)", opacity: 0.6 }}
        aria-hidden
      />
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--nx-amber)" }} />
      <span style={{ color: "var(--nx-amber)" }}>{label}</span>
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
    <div className="section-container mt-14 pb-8 space-y-6">
      {SCENES.map((scene) => (
        <div key={scene.id} className="nx-card p-6 md:p-8">
          <p className="nx-eyebrow">{scene.eyebrow}</p>
          <p
            className="mt-4 text-[20px] leading-snug"
            style={{ fontFamily: "var(--nx-display)", fontStyle: "italic" }}
          >
            &ldquo;{scene.sentence}&rdquo;
          </p>
          <div className="mt-5">
            {scene.rows.map(([label, value, alarm]) => (
              <div key={label} className="nx-ticket-row">
                <span style={{ color: "var(--nx-ink-dim)" }}>{label}</span>
                <span style={{ color: alarm ? "var(--nx-ember)" : "var(--nx-amber)" }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <p
            className="mt-5 nx-mono text-[11px] tracking-[0.18em]"
            style={{ color: "var(--nx-amber)" }}
          >
            ● {scene.stamp}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   LIVE DEMO — proof by experience. Real OpenAI Realtime WebRTC.
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
        return { label: "Connecting…", color: "var(--nx-amber)" };
      case "listening":
        return { label: "Listening — ask it anything", color: "var(--nx-amber)" };
      case "thinking":
        return { label: "Thinking…", color: "var(--nx-ink-dim)" };
      case "speaking":
        return { label: "Speaking…", color: "var(--nx-ember)" };
      case "error":
        return { label: "Something went wrong", color: "var(--nx-ember)" };
      default:
        return { label: "Ready when you are", color: "var(--nx-ink-faint)" };
    }
  })();

  return (
    <section id="live-demo" className="relative py-24 md:py-36 scroll-mt-20">
      <div className="section-container">
        <div className="nx-hairline mb-16 md:mb-24" />
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20 items-start">
          <div className="lg:sticky lg:top-28">
            <p className="nx-eyebrow">Proof, not promises</p>
            <h2 className="nx-display mt-6 text-[clamp(2.2rem,4.6vw,3.9rem)]">
              Don&rsquo;t take
              <br />
              the tour.
              <br />
              <em>Take the mic.</em>
            </h2>
            <p className="nx-body mt-7 max-w-100 text-[16px] leading-relaxed">
              This is a live voice line — the same low-latency pipeline your
              venue would run on. Ask it what VoyceLab can do behind your bar,
              out loud, right now.
            </p>
            <p className="mt-6 text-[13px]" style={{ color: "var(--nx-ink-faint)" }}>
              Microphone required · Demo sandbox — answers cover VoyceLab, no
              live POS commands.
            </p>
          </div>

          <div className="nx-glass p-6 md:p-9">
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
              <p className="mt-1 nx-mono text-[12px]" style={{ color: status.color }}>
                {status.label}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {!demo.isLive ? (
                <button
                  type="button"
                  onClick={() => void demo.connect()}
                  className="nx-btn-quiet text-[14px]"
                  style={{ padding: "0.7rem 1.3rem" }}
                >
                  <Mic className="w-4 h-4" style={{ color: "var(--nx-amber)" }} />
                  Start talking
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void demo.disconnect()}
                    className="nx-btn-quiet text-[14px]"
                    style={{ padding: "0.7rem 1.3rem" }}
                  >
                    End session
                  </button>
                  {(demo.agentState === "speaking" || demo.agentState === "thinking") && (
                    <button
                      type="button"
                      onClick={demo.interrupt}
                      className="nx-btn-quiet text-[14px]"
                      style={{ padding: "0.7rem 1.3rem" }}
                    >
                      Interrupt
                    </button>
                  )}
                </>
              )}
              {demo.agentState === "connecting" && (
                <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--nx-ink-dim)" }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                </span>
              )}
            </div>

            {demo.error && (
              <p
                className="mt-4 rounded-xl px-4 py-3 text-[13px]"
                style={{ background: "rgba(255,90,45,0.10)", color: "var(--nx-ember)" }}
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
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: msg.role === "user" ? "var(--nx-ink-faint)" : "var(--nx-amber)",
                      }}
                    />
                    <p className="text-[14px] leading-relaxed" style={{ color: "var(--nx-ink-dim)" }}>
                      {msg.content}
                    </p>
                  </div>
                ))}
                {demo.partialTranscript.trim().length > 0 && (
                  <div className="flex gap-3 opacity-80">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--nx-amber)" }} />
                    <p className="text-[14px] italic leading-relaxed" style={{ color: "var(--nx-ink-dim)" }}>
                      {demo.partialTranscript}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-7 pt-5" style={{ borderTop: "1px solid var(--nx-line)" }}>
              <p className="nx-eyebrow mb-3" style={{ fontSize: 10 }}>
                Try asking
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "What can it do during a rush?",
                  "How does it handle inventory?",
                  "What happens at close?",
                ].map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-[12.5px]"
                    style={{
                      border: "1px solid var(--nx-line)",
                      color: "var(--nx-ink-dim)",
                    }}
                  >
                    <Mic className="w-3 h-3" style={{ color: "var(--nx-amber)" }} />
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
   VOCABULARY — what it runs, said the way staff say it.
   ─────────────────────────────────────────────────────────────── */

const VOCAB = [
  {
    title: "Ring & fire",
    outcome: "Orders move at speaking pace, checks land on the terminal.",
    commands: [
      "Start a tab for Maya.",
      "Split table nine three ways.",
      "Comp the dessert on four.",
      "Send it to the terminal.",
    ],
  },
  {
    title: "Count & move stock",
    outcome: "Stock stays counted, shortages get caught before doors.",
    commands: [
      "Count the well tequila.",
      "What's low before doors?",
      "Move two cases of Tito's to the main bar.",
      "Set the Pinot Grigio to twelve.",
    ],
  },
  {
    title: "Read the night",
    outcome: "The numbers read themselves out while you keep moving.",
    commands: [
      "How are we pacing against last Friday?",
      "Top seller right now?",
      "Read me the hourly.",
      "Any refunds today?",
    ],
  },
  {
    title: "Run the room",
    outcome: "Tabs, shifts, and loose ends closed by the time you lock up.",
    commands: [
      "Who's clocked in?",
      "Clock Dre out at eleven.",
      "Any open tabs left?",
      "Run the end-of-day close.",
    ],
  },
];

function Vocabulary() {
  return (
    <section className="relative py-24 md:py-36">
      <div className="section-container">
        <div className="nx-hairline mb-16 md:mb-24" />
        <div className="max-w-3xl">
          <p className="nx-eyebrow">The vocabulary</p>
          <h2 className="nx-display mt-6 text-[clamp(2.2rem,4.6vw,3.9rem)]">
            Say it the way
            <br />
            <em>you&rsquo;d say it to staff.</em>
          </h2>
          <p className="nx-body mt-6 max-w-xl text-[16px] leading-relaxed">
            No menus to memorize, no magic words. VoyceLab speaks
            bar — plain commands in, Square actions out.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 gap-5">
          {VOCAB.map((group, i) => (
            <motion.div
              key={group.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: (i % 2) * 0.08, ease: EASE }}
              className="nx-card p-7 md:p-8"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3
                  className="text-[24px]"
                  style={{ fontFamily: "var(--nx-display)", fontWeight: 560 }}
                >
                  {group.title}
                </h3>
                <span className="nx-mono text-[11px] tracking-[0.18em]" style={{ color: "var(--nx-ink-faint)" }}>
                  0{i + 1}
                </span>
              </div>
              <p className="nx-body mt-2 text-[14px] leading-relaxed">{group.outcome}</p>
              <div className="mt-6 space-y-2.5">
                {group.commands.map((c) => (
                  <div key={c} className="nx-command">{c}</div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   PROOF BAND — numbers and the systems it stands on.
   ─────────────────────────────────────────────────────────────── */
function ProofBand() {
  const stats = [
    { value: "200+", label: "venues running on VoyceLab" },
    { value: "4.9", label: "average operator rating" },
    { value: "100%", label: "of actions logged in Square — auditable, reversible" },
  ];

  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 100%, rgba(232,163,61,0.10), transparent 65%)",
        }}
      />
      <div className="relative section-container">
        <div className="nx-hairline mb-16 md:mb-20" />
        <div className="grid md:grid-cols-3 gap-10 md:gap-6">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: i * 0.08, ease: EASE }}
              className={i > 0 ? "md:pl-6 md:border-l" : ""}
              style={i > 0 ? { borderColor: "var(--nx-line)" } : undefined}
            >
              <p
                className="text-[clamp(3rem,6vw,4.6rem)] leading-none"
                style={{ fontFamily: "var(--nx-display)", color: "var(--nx-amber)" }}
              >
                {s.value}
              </p>
              <p className="nx-body mt-3 max-w-60 text-[14px] leading-relaxed">{s.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 flex flex-wrap items-center gap-4">
          <span className="nx-eyebrow mr-2">Runs on</span>
          {[
            { src: "/brand/square-logo.png", alt: "Square" },
            { src: "/brand/openai-wordmark.png", alt: "OpenAI" },
            { src: "/brand/google-g.png", alt: "Google" },
          ].map((logo) => (
            <span
              key={logo.alt}
              className="inline-flex h-12 items-center rounded-xl px-5"
              style={{ background: "#F3EADC" }}
            >
              <img src={logo.src} alt={logo.alt} loading="lazy" style={{ maxHeight: 22, width: "auto" }} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   FINAL CTA — commitment device: name it, and it's yours.
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
    <section className="relative py-28 md:py-40 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 65% at 50% 115%, rgba(232,163,61,0.22), transparent 62%)," +
            "radial-gradient(ellipse 40% 30% at 78% 105%, rgba(255,90,45,0.12), transparent 70%)",
        }}
      />
      <div className="nx-grain" aria-hidden />

      <div className="relative section-container text-center">
        <p className="nx-eyebrow">Last call</p>
        <h2 className="nx-display mx-auto mt-6 max-w-3xl text-[clamp(2.6rem,6vw,4.8rem)]">
          Give your venue
          <br />
          <em>its voice.</em>
        </h2>
        <p className="nx-body mx-auto mt-6 max-w-lg text-[16px] md:text-[17px] leading-relaxed">
          Name your assistant, connect Square, and run tonight&rsquo;s shift by
          voice.
        </p>

        <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-5">
          <div className="flex w-full flex-col sm:flex-row gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your assistant — Bev, Marlowe, Ash…"
              aria-label="Assistant name"
              className="nx-input flex-1"
              onKeyDown={(e) => e.key === "Enter" && onStart()}
            />
            <Magnetic>
              <button onClick={onStart} className="nx-btn-ember w-full sm:w-auto justify-center">
                {trimmed ? `Meet ${trimmed}` : "Create yours"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </Magnetic>
          </div>
          <p className="text-[13px]" style={{ color: "var(--nx-ink-faint)" }}>
            14 days free · No card · Disconnect Square anytime
          </p>
        </div>

        <div className="mt-14 flex flex-wrap justify-center gap-2.5">
          {[
            "Are we ready for Saturday?",
            "What ran low last night?",
            "Split table nine three ways.",
            "Run the close.",
          ].map((q) => (
            <span
              key={q}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px]"
              style={{ border: "1px solid var(--nx-line)", color: "var(--nx-ink-dim)" }}
            >
              <Mic className="w-3 h-3" style={{ color: "var(--nx-amber)" }} />
              {q}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
