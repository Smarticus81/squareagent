import { useRef } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Check,
  CreditCard,
  Loader2,
  Mic,
  Package,
  Square as StopIcon,
  Volume2,
  Zap,
} from "lucide-react";
import { useVoycelabDemoRealtime } from "@/hooks/use-voycelab-demo-realtime";
import { HERO_GRAPHIC } from "@/lib/marketing-graphics";

const EASE = [0.22, 1, 0.36, 1] as const;

const examples = [
  "How are sales tonight?",
  "What are we low on behind the bar?",
  "Show me the open tabs.",
  "Add two Old Fashioneds.",
];

export default function Landing() {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <div className="vl-landing relative overflow-hidden">
      <Hero reduceMotion={reduceMotion} />
      <WhyItMatters />
      <LiveDemo />
      <OwnerView />
      <Closing />
    </div>
  );
}

function Hero({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <section className="relative px-5 pb-20 pt-28 sm:px-8 lg:px-10 lg:pb-28 lg:pt-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(71,143,255,.18),transparent_34%),radial-gradient(circle_at_20%_70%,rgba(255,175,95,.08),transparent_28%)]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[.92fr_1.08fr]">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-blue-200">
              <Volume2 className="h-3.5 w-3.5" /> Voice for event venues
            </span>
            <span className="inline-flex items-center gap-2 text-[12px] text-white/55">
              <img src="/brand/square-logo.png" alt="Square" className="h-4 w-auto invert" />
              Works with Square
            </span>
          </div>

          <h1 className="vl-display max-w-3xl text-[clamp(3.5rem,7.7vw,7.2rem)] leading-[.91] tracking-[-.055em]">
            Less tapping.
            <span className="block bg-gradient-to-r from-[#86baff] via-[#5d9fff] to-[#a9cfff] bg-clip-text text-transparent">
              Faster service.
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-[18px] leading-8 text-white/70 sm:text-[20px]">
            VoyceLab lets bartenders and venue managers use voice to get things done in Square while they keep serving guests.
          </p>

          <div className="mt-7 grid max-w-xl gap-3 text-[15px] text-white/75 sm:grid-cols-2">
            {[
              "Ask for sales and open tabs",
              "Check and update inventory",
              "Run common Square tasks by voice",
              "Built for busy event service",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-400/15 text-blue-200">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {item}
              </div>
            ))}
          </div>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/signup" className="vl-btn-primary group min-w-44 justify-center gap-2 px-6 py-3.5 text-[15px]">
              Start free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a href="#demo" className="vl-btn-outline min-w-44 justify-center px-6 py-3.5 text-[15px]">
              Try the demo here
            </a>
          </div>
          <p className="mt-3 text-[12px] text-white/45">14 days free. No card required. No sales call required.</p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24, scale: .98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: .8, delay: .12, ease: EASE }}
          className="relative"
        >
          <div className="absolute -inset-5 rounded-[2.5rem] bg-blue-500/10 blur-3xl" />
          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#07111f] shadow-[0_45px_100px_-35px_rgba(0,0,0,.9)]">
            <img
              src={HERO_GRAPHIC}
              alt="VoyceLab voice assistant for bartenders and event venue owners"
              className="aspect-video w-full object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function WhyItMatters() {
  const cards = [
    {
      label: "Bartender",
      title: "Keep your hands on the job.",
      text: "Ask VoyceLab for the task you need instead of stopping service to dig through screens.",
      icon: Mic,
    },
    {
      label: "Venue manager",
      title: "Get answers without chasing a dashboard.",
      text: "Ask for sales, inventory and open tabs while the event is happening.",
      icon: BarChart3,
    },
    {
      label: "Owner",
      title: "Know what is happening now.",
      text: "See the operation clearly and let your team move faster without adding another complicated system.",
      icon: Zap,
    },
  ];

  return (
    <section className="border-y border-white/8 bg-white/[.025] px-5 py-20 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <p className="font-mono text-[11px] uppercase tracking-[.24em] text-blue-200/70">Built for live events</p>
        <h2 className="vl-display mt-3 max-w-4xl text-[clamp(2.6rem,5vw,5rem)] leading-[.98]">
          Your staff should be serving guests, not fighting the POS.
        </h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-[1.75rem] border border-white/10 bg-[#0b1625]/80 p-6 shadow-[0_25px_60px_-35px_rgba(0,0,0,.95)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-300/20 bg-blue-400/10 text-blue-200">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="mt-6 text-[11px] font-semibold uppercase tracking-[.2em] text-blue-200/65">{card.label}</p>
                <h3 className="mt-2 text-[24px] font-semibold tracking-[-.035em] text-white">{card.title}</h3>
                <p className="mt-3 text-[14px] leading-6 text-white/58">{card.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LiveDemo() {
  const demo = useVoycelabDemoRealtime();
  const scrollRef = useRef<HTMLDivElement>(null);
  const live = demo.isLive;
  const busy = demo.agentState === "connecting";

  const status =
    demo.agentState === "connecting" ? "Connecting…" :
    demo.agentState === "listening" ? "Listening — say what you need." :
    demo.agentState === "thinking" ? "Working on it…" :
    demo.agentState === "speaking" ? "VoyceLab is responding." :
    live ? "Voice demo is live." : "Tap the mic and try it.";

  return (
    <section id="demo" className="relative px-5 py-24 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[.24em] text-blue-200/70">The demo is right here</p>
          <h2 className="vl-display mt-3 text-[clamp(2.8rem,5vw,5.3rem)] leading-[.96]">Try it before you sign up.</h2>
          <p className="mt-5 max-w-xl text-[17px] leading-7 text-white/65">
            No booking. No meeting. Tap the mic and talk to the demo the way a bartender or venue manager would.
          </p>
          <div className="mt-7 space-y-2.5">
            {examples.map((line) => (
              <div key={line} className="flex items-center gap-3 text-[14px] text-white/68">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-300" /> “{line}”
              </div>
            ))}
          </div>
          <Link href="/signup" className="mt-8 inline-flex items-center gap-2 text-[14px] font-semibold text-blue-200 hover:text-white">
            Like it? Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0d1928] to-[#07111d] p-5 shadow-[0_40px_100px_-45px_rgba(18,87,180,.45)] sm:p-7">
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => (live ? void demo.disconnect() : void demo.connect())}
              className="group relative flex h-28 w-28 items-center justify-center rounded-full border border-blue-300/25 bg-[#0b1726] text-blue-100 shadow-[0_0_80px_rgba(74,144,255,.18)] transition hover:scale-[1.03]"
              aria-label={live ? "Stop demo" : "Start demo"}
            >
              <span className={`absolute inset-2 rounded-full border ${live ? "animate-pulse border-blue-300/45" : "border-white/8"}`} />
              {busy ? <Loader2 className="h-9 w-9 animate-spin" /> : live ? <StopIcon className="h-8 w-8" fill="currentColor" /> : <Mic className="h-10 w-10" />}
            </button>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[.16em] text-white/52">{status}</p>
            {demo.error && <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{demo.error}</p>}
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[.14em] text-white/45">
                <span>Live ticket</span><CreditCard className="h-4 w-4" />
              </div>
              <div className="mt-4 min-h-24 space-y-2">
                {demo.order.length ? demo.order.map((item) => (
                  <div key={item.name} className="flex justify-between gap-3 text-[13px] text-white/72">
                    <span>{item.quantity} × {item.name}</span>
                    <span className="font-semibold text-white">${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                )) : <p className="text-[13px] text-white/35">Your voice-built ticket will appear here.</p>}
              </div>
              {demo.order.length > 0 && (
                <div className="mt-3 flex justify-between border-t border-white/8 pt-3 text-[14px] font-semibold text-white">
                  <span>Total</span><span>${demo.orderTotal.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div ref={scrollRef} className="max-h-56 overflow-y-auto rounded-2xl border border-white/8 bg-black/15 p-4">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[.14em] text-white/45">
                <span>Conversation</span><Volume2 className="h-4 w-4" />
              </div>
              <div className="mt-4 space-y-3">
                {demo.conversation.length ? demo.conversation.map((message) => (
                  <p key={message.id} className="text-[13px] leading-5 text-white/65">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[.12em] text-blue-200/60">{message.role === "user" ? "You" : "VoyceLab"}</span>
                    {message.content}
                  </p>
                )) : <p className="text-[13px] text-white/35">Speak naturally. The demo will respond here.</p>}
                {demo.partialTranscript.trim() && <p className="text-[13px] italic text-white/42">{demo.partialTranscript}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OwnerView() {
  return (
    <section className="border-y border-white/8 bg-[#07111d] px-5 py-24 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div className="order-2 lg:order-1">
          <div className="rounded-[2rem] border border-white/10 bg-[#0b1725] p-4 shadow-[0_35px_90px_-45px_rgba(0,0,0,.95)] sm:p-6">
            <div className="flex items-center justify-between border-b border-white/8 pb-4">
              <div>
                <p className="text-[13px] font-semibold text-white">Tonight at your venue</p>
                <p className="mt-1 text-[11px] text-white/38">A simple owner view—not another complicated back office.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Live
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric icon={BarChart3} label="Sales" value="Live total" />
              <Metric icon={Package} label="Inventory" value="What’s low" />
              <Metric icon={CreditCard} label="Open tabs" value="Right now" />
            </div>
            <div className="mt-4 rounded-2xl border border-blue-300/10 bg-blue-400/[.04] p-4">
              <div className="flex h-20 items-center gap-1 overflow-hidden" aria-hidden="true">
                {Array.from({ length: 44 }, (_, i) => (
                  <span key={i} className="w-1 shrink-0 rounded-full bg-blue-300/60" style={{ height: `${18 + ((i * 19) % 52)}%` }} />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/38">Your team speaks. VoyceLab keeps the work moving.</p>
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <p className="font-mono text-[11px] uppercase tracking-[.24em] text-blue-200/70">For owners and managers</p>
          <h2 className="vl-display mt-3 text-[clamp(2.8rem,5vw,5.2rem)] leading-[.96]">Know what’s happening. Instantly.</h2>
          <p className="mt-5 max-w-xl text-[17px] leading-7 text-white/65">
            Bartenders use voice on the floor. Owners get a clear view of sales, inventory and what still needs attention.
          </p>
          <Link href="/signup" className="vl-btn-primary mt-8 inline-flex min-w-44 justify-center gap-2 px-6 py-3.5 text-[15px]">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof BarChart3; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
      <Icon className="h-4 w-4 text-blue-200" />
      <p className="mt-5 text-[11px] uppercase tracking-[.14em] text-white/38">{label}</p>
      <p className="mt-1 text-[17px] font-semibold text-white">{value}</p>
    </div>
  );
}

function Closing() {
  return (
    <section className="relative px-5 py-28 text-center sm:px-8 lg:px-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(75,145,255,.13),transparent_32%)]" />
      <div className="relative mx-auto max-w-4xl">
        <p className="font-mono text-[11px] uppercase tracking-[.24em] text-blue-200/70">Voice for event venues</p>
        <h2 className="vl-display mt-4 text-[clamp(3.2rem,7vw,7rem)] leading-[.92]">Let them talk. Let the work move.</h2>
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-7 text-white/62">
          If your venue uses Square, you can try VoyceLab now. The demo is already on this page. When you’re ready, start free.
        </p>
        <Link href="/signup" className="vl-btn-primary mt-9 inline-flex min-w-52 justify-center gap-2 px-7 py-4 text-[16px]">
          Start free <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-3 text-[12px] text-white/38">14 days free · no card · cancel anytime</p>
      </div>
    </section>
  );
}
