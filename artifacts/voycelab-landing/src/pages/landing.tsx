import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useVoycelabDemoRealtime, type DemoAgentState } from "@/hooks/use-voycelab-demo-realtime";
import { Presence, type PresenceState } from "@/components/presence";

/**
 * The landing page is the product: one presence you can talk to, a few
 * lines about what it does, and a way in. No feature grids, no screenshots.
 */
export default function Landing() {
  return (
    <div className="vl-landing">
      <Hero />
      <Beliefs />
      <HowItRuns />
      <Closing />
    </div>
  );
}

function toPresence(state: DemoAgentState): PresenceState {
  switch (state) {
    case "connecting": return "connecting";
    case "listening": return "listening";
    case "thinking": return "thinking";
    case "speaking": return "speaking";
    case "error": return "error";
    default: return "ready";
  }
}

function Hero() {
  const demo = useVoycelabDemoRealtime();
  const live = demo.isLive;
  const busy = demo.agentState === "connecting";
  const state = toPresence(demo.agentState);
  const lastAgent = [...demo.conversation].reverse().find((m) => m.role !== "user")?.content ?? null;
  const lastUser = [...demo.conversation].reverse().find((m) => m.role === "user")?.content ?? null;
  const ticketRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ticketRef.current?.scrollTo({ top: ticketRef.current.scrollHeight, behavior: "smooth" });
  }, [demo.order.length]);

  const status =
    demo.agentState === "connecting" ? "Connecting" :
    demo.agentState === "listening" ? "Listening" :
    demo.agentState === "thinking" ? "Working on it" :
    demo.agentState === "speaking" ? "Speaking" :
    demo.agentState === "error" ? "Needs attention" :
    "Tap to talk to Nova";

  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center px-5 py-16 text-center sm:px-8">
      <p className="vl-eyebrow vl-rise">An always-on assistant for venues</p>
      <h1 className="vl-display vl-rise mt-5 max-w-3xl text-[clamp(2.4rem,6vw,4.6rem)]" style={{ animationDelay: "60ms" }}>
        Talk to your venue.<br />
        <em>It gets it done.</em>
      </h1>
      <p className="vl-rise mt-5 max-w-xl text-[16px] leading-7 sm:text-[17px]" style={{ color: "var(--color-vl-ink-muted)", animationDelay: "120ms" }}>
        Tickets, stock, sales, open tabs: say it once and it happens in Square. It listens all night, so nobody has to touch a screen.
      </p>

      <div className="vl-rise mt-12 flex flex-col items-center gap-6" style={{ animationDelay: "200ms" }}>
        <Presence
          state={state}
          stream={demo.assistantStream}
          size={200}
          label={live ? "Stop the demo" : "Start the demo"}
          onClick={() => { if (busy) return; void (live ? demo.disconnect() : demo.connect()); }}
        />
        <p className="text-[12.5px] font-medium" style={{ color: "var(--color-vl-ink-faint)" }}>
          {status}
        </p>
        <div className="flex min-h-16 max-w-lg flex-col items-center gap-2">
          {lastUser && <p className="text-[14px]" style={{ color: "var(--color-vl-ink-faint)" }}>{lastUser}</p>}
          {demo.partialTranscript.trim() && <p className="text-[14px]" style={{ color: "var(--color-vl-ink-faint)", opacity: 0.6 }}>{demo.partialTranscript}</p>}
          {lastAgent ? (
            <p className="text-[20px] leading-snug" style={{ color: "var(--color-vl-ink)" }}>{lastAgent}</p>
          ) : (
            !live && (
              <p className="text-[15px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                Try “add two Old Fashioneds” or “what are we low on?”
              </p>
            )
          )}
          {demo.error && <p className="text-[13px]" style={{ color: "var(--color-vl-danger)" }}>{demo.error}</p>}
        </div>

        {demo.order.length > 0 && (
          <div ref={ticketRef} className="vl-rise w-full max-w-sm rounded-2xl border px-4 py-3 text-left" style={{ borderColor: "var(--vl-line)", background: "var(--vl-surface)" }}>
            {demo.order.map((item) => (
              <div key={item.name} className="flex justify-between gap-3 py-1 text-[14px]" style={{ color: "var(--color-vl-ink-soft)" }}>
                <span>{item.quantity} × {item.name}</span>
                <span style={{ color: "var(--color-vl-ink)" }}>${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t pt-2 text-[14px]" style={{ borderColor: "var(--vl-line)", color: "var(--color-vl-ink-muted)" }}>
              <span>Total</span>
              <strong style={{ color: "var(--color-vl-ink)" }}>${demo.orderTotal.toFixed(2)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="vl-rise mt-14 flex flex-col items-center gap-3 sm:flex-row" style={{ animationDelay: "280ms" }}>
        <Link href="/signup" className="vl-btn-primary min-w-40 justify-center px-6 py-3 text-[15px]">Start free</Link>
        <Link href="/pricing" className="vl-btn-ghost min-w-40 justify-center px-6 py-3 text-[15px]">See pricing</Link>
      </div>
      <p className="mt-4 text-[12.5px]" style={{ color: "var(--color-vl-ink-faint)" }}>14 days free · no card · works with Square</p>
    </section>
  );
}

function Beliefs() {
  const lines = [
    { k: "Always on", v: "It waits for its name. Say it from across the bar and it's there, no tapping, no unlocking." },
    { k: "Runs the room", v: "Builds tickets, sends them to the terminal, counts stock, pulls the night's numbers. All in Square, all by voice." },
    { k: "Nothing to learn", v: "No menus to memorise. If you can ask a good bartender, you can ask VoyceLab." },
  ];
  return (
    <section className="border-t px-5 py-20 sm:px-8" style={{ borderColor: "var(--vl-line)" }}>
      <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-3">
        {lines.map((l) => (
          <div key={l.k}>
            <p className="text-[17px] font-medium" style={{ color: "var(--color-vl-ink)" }}>{l.k}</p>
            <p className="mt-2 text-[15px] leading-7" style={{ color: "var(--color-vl-ink-muted)" }}>{l.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItRuns() {
  const moments = [
    ["“Hey Nova, two Old Fashioneds and a Guinness.”", "Added 2 × Old Fashioned, 1 × Guinness"],
    ["“Send it.”", "Sent the ticket to Square"],
    ["“What are we low on?”", "Ran the low stock report"],
    ["“How did we do tonight?”", "Ran today's sales summary"],
  ];
  return (
    <section className="border-t px-5 py-20 sm:px-8" style={{ borderColor: "var(--vl-line)" }}>
      <div className="mx-auto max-w-3xl">
        <p className="vl-eyebrow">A night with VoyceLab</p>
        <ol className="mt-8 flex flex-col">
          {moments.map(([said, did]) => (
            <li key={said} className="grid gap-1 border-b py-5 md:grid-cols-[1.2fr_1fr] md:gap-8" style={{ borderColor: "var(--vl-line)" }}>
              <p className="text-[18px] leading-snug" style={{ color: "var(--color-vl-ink)" }}>{said}</p>
              <p className="flex items-center gap-2 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-vl-success)" }} />
                {did}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="border-t px-5 py-24 text-center sm:px-8" style={{ borderColor: "var(--vl-line)" }}>
      <h2 className="vl-display mx-auto max-w-2xl text-[clamp(2rem,4.5vw,3.4rem)]">Give the venue a voice it answers to.</h2>
      <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7" style={{ color: "var(--color-vl-ink-muted)" }}>
        Connect Square, name your assistant, and leave it running on any phone or tablet behind the bar.
      </p>
      <Link href="/signup" className="vl-btn-primary mt-8 inline-flex min-w-44 justify-center px-7 py-3.5 text-[15px]">Start free</Link>
    </section>
  );
}
