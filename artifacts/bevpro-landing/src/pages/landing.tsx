import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Landing() {
  return (
    <div className="flex-1 bg-background text-foreground">
      {/* Hero */}
      <section className="pt-36 pb-24 lg:pt-52 lg:pb-40 flex items-center justify-center">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-semibold tracking-tight text-foreground leading-[1.08]">
            Voice-first
            <br />
            ordering
          </h1>

          <p className="mt-8 text-lg text-foreground/50 max-w-lg mx-auto font-light leading-relaxed">
            Speak your order. It lands in Square instantly.
            <br className="hidden sm:block" />
            No screens, no tapping, no training.
          </p>

          <div className="mt-12 flex gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="h-11 px-7 text-[14px] group">
                Get Started
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How it works — three numbered lines */}
      <section className="py-24 lg:py-32">
        <div className="max-w-2xl mx-auto px-6">
          <p className="text-[12px] font-medium tracking-[0.25em] uppercase text-foreground/30 mb-16">How it works</p>

          <div className="space-y-12">
            {[
              { n: "01", title: "Connect Square", desc: "Link your account. Your menu catalog syncs automatically." },
              { n: "02", title: "Speak the order", desc: "\"Four Fosters, two Amarula.\" The AI confirms in under a second." },
              { n: "03", title: "Done", desc: "Order created, payment logged, inventory updated — all in Square." },
            ].map((step) => (
              <div key={step.n} className="flex gap-6 items-start">
                <span className="text-[13px] font-medium text-foreground/25 pt-0.5 tabular-nums">{step.n}</span>
                <div>
                  <h3 className="text-[17px] font-medium text-foreground">{step.title}</h3>
                  <p className="text-[15px] text-foreground/45 font-light mt-1 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-6">
        <div className="h-px bg-foreground/[0.06]" />
      </div>

      {/* Square */}
      <section className="py-24 lg:py-32">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <p className="text-[12px] font-medium tracking-[0.25em] uppercase text-foreground/30 mb-6">Built for</p>
          <h2 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-foreground mb-6">Square POS</h2>
          <p className="text-foreground/45 font-light leading-relaxed max-w-md mx-auto">
            Every voice order creates a real Square order with an external payment record.
            It shows up in your sales reports like any other transaction.
          </p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-6">
        <div className="h-px bg-foreground/[0.06]" />
      </div>

      {/* Pricing */}
      <section className="py-24 lg:py-32">
        <div className="max-w-sm mx-auto px-6 text-center">
          <p className="text-[12px] font-medium tracking-[0.25em] uppercase text-foreground/30 mb-12">Pricing</p>

          <div className="mb-2">
            <span className="text-5xl font-display font-semibold tracking-tight text-foreground">$49</span>
            <span className="text-foreground/35 font-light ml-1">/mo</span>
          </div>
          <p className="text-[13px] text-foreground/40 font-light mb-8">per venue · unlimited orders</p>

          <ul className="text-left space-y-3 mb-10 max-w-[240px] mx-auto">
            {[
              "Unlimited voice orders",
              "Real-time Square sync",
              "Inventory via voice",
              "iPad & mobile access",
            ].map((f, i) => (
              <li key={i} className="text-[14px] text-foreground/60 font-light flex items-center gap-2.5">
                <span className="w-1 h-1 rounded-full bg-foreground/25 shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          <Link href="/signup">
            <Button size="lg" className="w-full h-11 text-[14px]">
              Start 14-day free trial
            </Button>
          </Link>
          <p className="text-[12px] text-foreground/30 mt-4 font-light">
            No credit card required
          </p>
        </div>
      </section>
    </div>
  );
}
