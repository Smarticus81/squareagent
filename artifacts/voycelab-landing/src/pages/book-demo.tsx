import { CalendarRange, ArrowLeft, ArrowUpRight, Mail } from "lucide-react";
import { Link } from "wouter";

const bookingUrl = (import.meta.env.VITE_DEMO_BOOKING_URL as string | undefined)?.trim() ?? "";
const salesEmail = (import.meta.env.VITE_SALES_EMAIL as string | undefined)?.trim() || "hello@voycelab.ai";

function mailtoHref(): string {
  const subject = encodeURIComponent("Book a VoyceLab demo");
  const body = encodeURIComponent(
    "Hi VoyceLab,\n\nI would like to book a live demo for my hospitality venue.\n\nVenue name:\nRole:\nPreferred times:\n",
  );
  return `mailto:${salesEmail}?subject=${subject}&body=${body}`;
}

export default function BookDemo() {
  const hasBookingUrl = /^https?:\/\//i.test(bookingUrl);

  return (
    <div className="vl-page-shell relative flex-1 overflow-hidden px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-240">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[12px] transition-colors"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Home
        </Link>

        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <section className="vl-panel p-6 md:p-8">
            <div
              className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg"
              style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}
            >
              <CalendarRange className="h-5 w-5" />
            </div>
            <p className="vl-eyebrow">Live demo</p>
            <h1 className="vl-display mt-3 text-[40px] md:text-[56px]" style={{ color: "var(--color-vl-ink)" }}>
              Book a VoyceLab demo.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              See how voice ordering, reporting, inventory, wake phrase setup, and Square-connected operations fit your venue.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {hasBookingUrl ? (
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="vl-btn-primary inline-flex items-center gap-2 text-[13px]"
                >
                  Open scheduler
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              ) : (
                <a href={mailtoHref()} className="vl-btn-primary inline-flex items-center gap-2 text-[13px]">
                  Request times
                  <Mail className="h-3.5 w-3.5" />
                </a>
              )}
              <Link href="/pricing" className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                View plans
              </Link>
            </div>
          </section>

          <section className="vl-panel min-h-120 overflow-hidden p-3 md:p-4">
            {hasBookingUrl ? (
              <iframe
                title="Book a VoyceLab demo"
                src={bookingUrl}
                className="h-[680px] w-full rounded-2xl border-0 bg-white/85"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="flex min-h-120 flex-col justify-center rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "rgba(10,10,11,0.16)" }}>
                <p className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                  Tell us when you would like to meet.
                </p>
                <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                  We will coordinate a live walkthrough for your venue and show the workflows that matter most.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
