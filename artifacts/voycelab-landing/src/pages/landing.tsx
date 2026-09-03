import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowRight, Check, Loader2, Mic, Square as SquareIcon, Volume2 } from "lucide-react";
import { useVoycelabDemoRealtime } from "@/hooks/use-voycelab-demo-realtime";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ═══════════════════════════════════════════════════════════════
   LANDING — one idea, said plainly: you talk, Square updates.
   Minimal chrome, one live control, three names on the door.
   hero (live mic) → things you can say → one line, one result
   → the trio (Square · OpenAI · Google) → the ask.
   ═══════════════════════════════════════════════════════════════ */

export default function Landing() {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <div className="vl-landing relative">
      <Hero reduceMotion={reduceMotion} />
      <SayAnything reduceMotion={reduceMotion} />
      <Playground reduceMotion={reduceMotion} />
      <Trio reduceMotion={reduceMotion} />
      <Closing />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   BRAND MARKS — the Square, OpenAI and Google media-pack assets.
   Black wordmarks live on white tiles; on the film they invert.
   ─────────────────────────────────────────────────────────────── */

type Brand = "square" | "openai" | "google";

const BRAND_META: Record<Brand, { src: string; alt: string; ratio: number }> = {
  square: { src: "/brand/square-logo.png", alt: "Square", ratio: 2000 / 501 },
  openai: { src: "/brand/openai-wordmark.png", alt: "OpenAI", ratio: 1604 / 718 },
  google: { src: "/brand/google-g.png", alt: "Google", ratio: 1 },
};

/** Renders a media-pack logo at a given height. `onDark` inverts the black wordmarks. */
export function BrandMark({
  brand,
  height = 24,
  onDark = false,
  className = "",
}: {
  brand: Brand;
  height?: number;
  onDark?: boolean;
  className?: string;
}) {
  const meta = BRAND_META[brand];
  if (brand === "google") {
    // The G sits in a lot of transparent padding; crop by scaling inside a clipped box.
    return (
      <span
        className={`relative inline-block shrink-0 overflow-hidden ${className}`}
        style={{ width: height, height }}
        aria-label={meta.alt}
        role="img"
      >
        <img
          src={meta.src}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none"
          style={{ transform: "scale(3.05)", transformOrigin: "center" }}
        />
      </span>
    );
  }
  return (
    <img
      src={meta.src}
      alt={meta.alt}
      draggable={false}
      className={`inline-block shrink-0 select-none ${className}`}
      style={{ height, width: height * meta.ratio, filter: onDark ? "invert(1)" : undefined }}
    />
  );
}

/* ───────────────────────────────────────────────────────────────
   HERO — the whole product in one control: tap, talk, watch Square.
   ─────────────────────────────────────────────────────────────── */

function Hero({ reduceMotion }: { reduceMotion: boolean }) {
  const demo = useVoycelabDemoRealtime();
  const live = demo.isLive;
  const busy = demo.agentState === "connecting";

  const status = (() => {
    switch (demo.agentState) {
      case "connecting":
        return "Connecting…";
      case "listening":
        return "Listening. Say “two margaritas and a Modelo.”";
      case "thinking":
        return "Thinking…";
      case "speaking":
        return "Nova is talking.";
      case "error":
        return "Something went wrong. Tap to try again.";
      default:
        return "Tap to talk to Nova. Microphone required.";
    }
  })();

  const words = ["Say", "it."];

  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 pb-14 pt-20 text-center">
      <motion.p
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="font-mono text-[11px] tracking-[0.32em] text-white/55 uppercase"
      >
        Voice for Square POS
      </motion.p>

      <h1 className="vl-display mt-5 text-[clamp(3.4rem,10vw,8.5rem)] leading-[0.92]">
        <span className="block">
          {words.map((w, i) => (
            <motion.span
              key={w}
              initial={reduceMotion ? false : { opacity: 0, y: 40, rotate: -2 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ duration: 0.7, delay: 0.08 + i * 0.09, ease: EASE }}
              className="inline-block"
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </motion.span>
          ))}
        </span>
        <motion.span
          initial={reduceMotion ? false : { opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.32, ease: EASE }}
          className="block"
        >
          <em>Square does it.</em>
        </motion.span>
      </h1>

      <motion.p
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
        className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/70"
      >
        The voice assistant for bars and restaurants on Square. Orders, stock counts and
        sales answers, spoken out loud and synced to your POS in under a second.
      </motion.p>

      {/* The control */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.62, ease: EASE }}
        className="mt-10 flex flex-col items-center"
      >
        <MicDisc
          live={live}
          busy={busy}
          state={demo.agentState}
          onClick={() => (live ? void demo.disconnect() : void demo.connect())}
        />
        <p className="mt-6 min-h-6 font-mono text-[12px] tracking-[0.12em] text-white/60 uppercase">
          {status}
        </p>
        {demo.error && (
          <p className="mt-3 max-w-md rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-200">
            {demo.error}
          </p>
        )}
      </motion.div>

      <LiveTicket demo={demo} />

      {/* Three names on the door */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.85, ease: EASE }}
        className="mt-12 flex flex-col items-center gap-4"
      >
        <span className="font-mono text-[10px] tracking-[0.3em] text-white/40 uppercase">Built with</span>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <LogoPill brand="square" height={26} />
          <LogoPill brand="openai" height={26} />
          <LogoPill brand="google" height={30} />
        </div>
      </motion.div>
    </section>
  );
}

function LogoPill({ brand, height }: { brand: Brand; height: number }) {
  return (
    <span className="inline-flex h-14 items-center rounded-full border border-gray-200 bg-white px-6 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] transition-transform hover:-translate-y-0.5">
      <BrandMark brand={brand} height={height} />
    </span>
  );
}

/** The 176px black disc inside a conic ring. Breathes idle, spins live. */
function MicDisc({
  live,
  busy,
  state,
  onClick,
}: {
  live: boolean;
  busy: boolean;
  state: string;
  onClick: () => void;
}) {
  const hot = state === "listening" || state === "speaking" || state === "thinking";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={live}
      aria-label={live ? "Stop the voice demo" : "Start the voice demo"}
      className={`lx-mic ${live ? "is-live" : ""} ${hot ? "is-hot" : ""}`}
    >
      <span className="lx-mic-halo" aria-hidden="true" />
      <span className="lx-mic-ring" aria-hidden="true" />
      <span className="lx-mic-face">
        {busy ? (
          <Loader2 className="h-10 w-10 animate-spin" />
        ) : live ? (
          <SquareIcon className="h-9 w-9" fill="currentColor" />
        ) : (
          <Mic className="h-11 w-11" />
        )}
      </span>
    </button>
  );
}

/** The live Square ticket, shown only once a session exists. */
function LiveTicket({ demo }: { demo: ReturnType<typeof useVoycelabDemoRealtime> }) {
  const show = demo.isLive || demo.order.length > 0 || demo.conversation.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [demo.conversation, demo.partialTranscript]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="vl-card mt-10 w-full max-w-md p-6 text-left"
        >
          <div className="flex items-center justify-between">
            <BrandMark brand="square" height={18} />
            <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-gray-500">
              <span className={`h-1.5 w-1.5 rounded-full ${demo.isLive ? "animate-pulse bg-emerald-500" : "bg-gray-300"}`} />
              {demo.isLive ? "LIVE · THE DEN" : "SESSION ENDED"}
            </span>
          </div>

          <div className="mt-4 min-h-14">
            {demo.order.length === 0 ? (
              <p className="text-[14px] italic text-gray-400">Ticket’s empty. Say what you’d ring.</p>
            ) : (
              <AnimatePresence initial={false}>
                {demo.order.map((item) => (
                  <motion.div
                    key={item.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="lx-ticket-row"
                  >
                    <span className="text-gray-700">
                      {item.quantity} × {item.name}
                    </span>
                    <span className="font-semibold text-gray-900">${(item.price * item.quantity).toFixed(2)}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>

          {demo.order.length > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-dashed border-gray-300 pt-3 text-[15px] font-semibold text-gray-900">
              <span>Total</span>
              <span>${demo.orderTotal.toFixed(2)}</span>
            </div>
          )}

          {(demo.conversation.length > 0 || demo.partialTranscript.trim()) && (
            <div ref={scrollRef} className="vl-scroll mt-5 max-h-40 space-y-2 overflow-y-auto border-t border-gray-100 pt-4 pr-1">
              {demo.conversation.map((m) => (
                <p key={m.id} className={`text-[13.5px] leading-relaxed ${m.role === "user" ? "text-gray-500" : "text-gray-900"}`}>
                  <span className="mr-2 font-mono text-[10px] tracking-[0.18em] text-gray-400 uppercase">
                    {m.role === "user" ? "You" : "Nova"}
                  </span>
                  {m.content}
                </p>
              ))}
              {demo.partialTranscript.trim() && (
                <p className="text-[13.5px] italic leading-relaxed text-gray-400">{demo.partialTranscript}</p>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {(demo.agentState === "speaking" || demo.agentState === "thinking") && (
              <button type="button" onClick={demo.interrupt} className="vl-btn-outline text-[13px]" style={{ padding: "0.45rem 0.9rem" }}>
                Interrupt
              </button>
            )}
            {demo.order.length > 0 && (
              <Link href="/signup" className="vl-btn-primary gap-2 text-[13px]" style={{ padding: "0.5rem 0.9rem" }}>
                Put this on your Square <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────
   SAY ANYTHING — an endless bar-top marquee of spoken lines.
   ─────────────────────────────────────────────────────────────── */

const LINES_A = [
  "Two margaritas and a Modelo.",
  "Open a tab for Priya.",
  "Split table nine three ways.",
  "Is the IPA keg tapped?",
  "Eighty-six the oysters.",
  "Send table twelve to the terminal.",
];
const LINES_B = [
  "How did happy hour do?",
  "How many bottles of Tito’s are left?",
  "Comp the second round on eleven.",
  "Top five cocktails this weekend?",
  "Add a spicy marg, no triple sec, salt rim.",
  "Who’s clocked in right now?",
];

function SayAnything({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <section aria-label="Things you can say" className="relative py-14 md:py-20">
      <div className="section-container mb-8 flex items-baseline justify-between">
        <p className="font-mono text-[11px] tracking-[0.3em] text-white/45 uppercase">Things you can say</p>
        <p className="hidden font-mono text-[11px] tracking-[0.3em] text-white/30 uppercase sm:block">No buttons. No menus.</p>
      </div>
      <Marquee lines={LINES_A} reverse={false} reduceMotion={reduceMotion} />
      <Marquee lines={LINES_B} reverse reduceMotion={reduceMotion} />
    </section>
  );
}

function Marquee({ lines, reverse, reduceMotion }: { lines: string[]; reverse: boolean; reduceMotion: boolean }) {
  const track = [...lines, ...lines];
  return (
    <div className="lx-marquee" data-reverse={reverse ? "true" : undefined} data-static={reduceMotion ? "true" : undefined}>
      <div className="lx-marquee-track">
        {track.map((line, i) => (
          <span key={`${line}-${i}`} className="lx-marquee-item">
            <Mic className="h-4 w-4 shrink-0 text-[#F09819]" aria-hidden="true" />
            <span className="vl-display text-[clamp(1.4rem,3vw,2.4rem)] italic text-white/90">{line}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   ONE LINE, ONE RESULT — pick a line, watch what Square gets.
   ─────────────────────────────────────────────────────────────── */

type Scene =
  | {
      id: string;
      say: string;
      kind: "receipt";
      title: string;
      rows: Array<[string, string]>;
      total: string;
      stamp: string;
    }
  | { id: string; say: string; kind: "stock"; title: string; value: string; unit: string; pct: number; note: string }
  | { id: string; say: string; kind: "answer"; title: string; brand: Brand; text: string; note: string };

const SCENES: Scene[] = [
  {
    id: "order",
    say: "Two old fashioneds for table twelve, one no cherry.",
    kind: "receipt",
    title: "Table 12 · open tab",
    rows: [
      ["2 × Old Fashioned", "$28.00"],
      ["Mod: no cherry", "✓"],
    ],
    total: "$28.00",
    stamp: "Sent to Square",
  },
  {
    id: "stock",
    say: "How many bottles of Tito’s are left?",
    kind: "stock",
    title: "Bar inventory · live",
    value: "6",
    unit: "bottles",
    pct: 0.4,
    note: "Low-stock alert set at 4. Pulled from Square inventory.",
  },
  {
    id: "sales",
    say: "How did happy hour do tonight?",
    kind: "answer",
    title: "Nova · spoken reply",
    brand: "openai",
    text: "Happy hour did $2,340, up 18% on last Friday. Spicy Margarita led with 41 pours.",
    note: "OpenAI Realtime hears the room and answers in under a second.",
  },
  {
    id: "loud",
    say: "Is the IPA keg tapped?",
    kind: "answer",
    title: "Nova · loud-room voice",
    brand: "google",
    text: "Hazy IPA is at 68%. You’re fine through close.",
    note: "Gemini Live is the engine you switch to when the music’s up.",
  },
];

function Playground({ reduceMotion }: { reduceMotion: boolean }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const scene = SCENES[active];

  useEffect(() => {
    if (!auto || reduceMotion) return;
    const t = window.setInterval(() => setActive((i) => (i + 1) % SCENES.length), 5200);
    return () => window.clearInterval(t);
  }, [auto, reduceMotion]);

  return (
    <section id="how-it-works" className="relative py-20 md:py-28">
      <div className="section-container">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/45 uppercase">One line, one result</p>
            <h2 className="vl-section-heading mt-5">
              You talk. <em>Square updates.</em>
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/65">
              Pick a line. That’s the whole training course.
            </p>

            <div className="mt-8 flex flex-col gap-2">
              {SCENES.map((s, i) => {
                const on = i === active;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setActive(i);
                      setAuto(false);
                    }}
                    className={`group flex items-center gap-3 rounded-full border px-5 py-3 text-left transition-all ${
                      on
                        ? "border-white bg-white text-gray-900 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
                        : "border-white/12 bg-white/5 text-white/75 hover:border-white/30 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        on ? "bg-black text-white" : "bg-white/10 text-white/70 group-hover:bg-white/20"
                      }`}
                    >
                      <Mic className="h-3.5 w-3.5" />
                    </span>
                    <span className="vl-display text-[17px] italic leading-snug sm:text-[19px]">{s.say}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={scene.id}
                initial={reduceMotion ? false : { opacity: 0, y: 20, clipPath: "inset(0 0 100% 0 round 2rem)" }}
                animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0 round 2rem)" }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -14, transition: { duration: 0.22 } }}
                transition={{ duration: 0.55, ease: EASE }}
                className="vl-card p-7"
              >
                <ResultCard scene={scene} reduceMotion={reduceMotion} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function ResultCard({ scene, reduceMotion }: { scene: Scene; reduceMotion: boolean }) {
  const header = (brand: Brand) => (
    <div className="flex items-center justify-between">
      <BrandMark brand={brand} height={brand === "google" ? 26 : 20} />
      <span className="font-mono text-[10px] tracking-[0.22em] text-gray-400 uppercase">{scene.title}</span>
    </div>
  );

  if (scene.kind === "receipt") {
    return (
      <>
        {header("square")}
        <div className="mt-6">
          {scene.rows.map(([l, v], i) => (
            <motion.div
              key={l}
              initial={reduceMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.12, duration: 0.35, ease: EASE }}
              className="lx-ticket-row"
            >
              <span className="text-gray-700">{l}</span>
              <span className="font-semibold text-gray-900">{v}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between pt-2 text-[15px] font-semibold text-gray-900">
          <span>Total</span>
          <span>{scene.total}</span>
        </div>
        <Stamp delay={0.7} reduceMotion={reduceMotion}>
          <Check className="h-3.5 w-3.5" /> {scene.stamp}
        </Stamp>
      </>
    );
  }

  if (scene.kind === "stock") {
    return (
      <>
        {header("square")}
        <div className="mt-6 flex items-end gap-3">
          <motion.span
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4, ease: EASE }}
            className="vl-display text-[72px] leading-none text-gray-900"
          >
            {scene.value}
          </motion.span>
          <span className="pb-2 text-[15px] text-gray-500">{scene.unit} of Tito’s</span>
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-gray-100">
          <motion.div
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${scene.pct * 100}%` }}
            transition={{ delay: 0.35, duration: 0.8, ease: EASE }}
            className="h-full rounded-full"
            style={{ background: "var(--vl-sunset)" }}
          />
        </div>
        <p className="mt-4 text-[13px] text-gray-500">{scene.note}</p>
        <Stamp delay={0.9} reduceMotion={reduceMotion}>
          <Check className="h-3.5 w-3.5" /> Counted in Square
        </Stamp>
      </>
    );
  }

  return (
    <>
      {header(scene.brand)}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4, ease: EASE }}
        className="mt-6 flex gap-3"
      >
        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white">
          <Volume2 className="h-4 w-4" />
        </span>
        <p className="vl-display text-[22px] leading-snug text-gray-900">“{scene.text}”</p>
      </motion.div>
      <p className="mt-5 text-[13px] text-gray-500">{scene.note}</p>
      <Stamp delay={0.8} reduceMotion={reduceMotion}>
        <Volume2 className="h-3.5 w-3.5" /> Answered out loud
      </Stamp>
    </>
  );
}

function Stamp({ children, delay, reduceMotion }: { children: ReactNode; delay: number; reduceMotion: boolean }) {
  return (
    <motion.span
      initial={reduceMotion ? false : { opacity: 0, scale: 1.4, rotate: -6 }}
      animate={{ opacity: 1, scale: 1, rotate: -2 }}
      transition={{ delay, type: "spring", stiffness: 380, damping: 18 }}
      className="lx-stamp mt-6 inline-flex"
    >
      {children}
    </motion.span>
  );
}

/* ───────────────────────────────────────────────────────────────
   THE TRIO — three names on the door, each doing one job.
   ─────────────────────────────────────────────────────────────── */

const TRIO: Array<{ brand: Brand; role: string; line: string; does: string[]; logoHeight: number }> = [
  {
    brand: "square",
    role: "The POS of record",
    line: "Every order, count and refund lands in Square exactly as spoken. Nothing lives outside your books.",
    does: ["Orders and open tabs", "Inventory counts", "Terminal checkout"],
    logoHeight: 44,
  },
  {
    brand: "openai",
    role: "The voice that listens",
    line: "OpenAI Realtime hears the room, reasons in the moment and calls the right command in under a second.",
    does: ["Sub-second replies", "Natural modifiers", "Barge-in mid-sentence"],
    logoHeight: 44,
  },
  {
    brand: "google",
    role: "The voice for loud nights",
    line: "Gemini Live is the engine you switch to when the music’s up. Same commands, different ears.",
    does: ["Far-field listening", "Noise-mode tuning", "One-tap engine switch"],
    logoHeight: 84,
  },
];

function Trio({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <section className="relative py-20 md:py-28">
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] tracking-[0.3em] text-white/45 uppercase">Three names on the door</p>
          <h2 className="vl-section-heading mt-5">
            Built on the best <em>three in the room.</em>
          </h2>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {TRIO.map((t, i) => (
            <TiltCard key={t.brand} index={i} reduceMotion={reduceMotion}>
              <div className="flex h-44 items-center justify-center">
                <BrandMark brand={t.brand} height={t.logoHeight} />
              </div>
              <p className="font-mono text-[10px] tracking-[0.24em] text-gray-400 uppercase">{t.role}</p>
              <p className="mt-3 text-[15px] leading-relaxed text-gray-700">{t.line}</p>
              <ul className="mt-5 space-y-2">
                {t.does.map((d) => (
                  <li key={d} className="flex items-center gap-2.5 text-[13.5px] text-gray-900">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">
                      <Check className="h-3 w-3" />
                    </span>
                    {d}
                  </li>
                ))}
              </ul>
            </TiltCard>
          ))}
        </div>
      </div>
    </section>
  );
}

/** White card that tilts toward the cursor. Pure delight, zero logic. */
function TiltCard({ children, index, reduceMotion }: { children: ReactNode; index: number; reduceMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [7, -7]), { stiffness: 200, damping: 20 });
  const ry = useSpring(useTransform(mx, [0, 1], [-7, 7]), { stiffness: 200, damping: 20 });
  const glowX = useTransform(mx, [0, 1], ["0%", "100%"]);
  const glowY = useTransform(my, [0, 1], ["0%", "100%"]);
  const glow = useMemo(
    () => (reduceMotion ? undefined : `radial-gradient(240px circle at var(--gx) var(--gy), rgba(240,152,25,0.10), transparent 70%)`),
    [reduceMotion],
  );

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay: index * 0.08, ease: EASE }}
      onMouseMove={(e) => {
        if (reduceMotion) return;
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onMouseLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
      style={reduceMotion ? undefined : ({ rotateX: rx, rotateY: ry, transformPerspective: 900, "--gx": glowX, "--gy": glowY } as never)}
      className="vl-card relative overflow-hidden p-7"
    >
      {glow && <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: glow }} />}
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/* ───────────────────────────────────────────────────────────────
   THE ASK — one line, two buttons.
   ─────────────────────────────────────────────────────────────── */

function Closing() {
  return (
    <section className="relative overflow-hidden py-28 md:py-40">
      <div aria-hidden className="vl-halo left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 opacity-25" />
      <div className="section-container relative text-center">
        <h2 className="vl-display text-[clamp(2.8rem,8vw,6.5rem)] leading-[0.95]">
          Give your bar <em>a voice.</em>
        </h2>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="vl-btn-primary gap-2 px-7 py-4 text-[15px]">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/book-demo" className="vl-btn-outline px-7 py-4 text-[15px]">
            Book a demo
          </Link>
        </div>
        <p className="mt-6 font-mono text-[11px] tracking-[0.22em] text-white/45 uppercase">
          14-day free trial · No card · Disconnect Square anytime
        </p>
      </div>
    </section>
  );
}
