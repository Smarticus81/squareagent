import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Play, Plus } from "lucide-react";

const ROUTINES = [
  {
    id: "opening_check",
    name: "Opening check",
    when: 'Say: "Run the opening check"',
    steps: [
      "Stock summary",
      "Items below 10 units",
      "Who's on shift",
      "Where the team is working",
    ],
    enabled: true,
  },
  {
    id: "stock_count",
    name: "Stock count",
    when: 'Say: "Run a stock count"',
    steps: ["Check all stock", "Stock summary"],
    enabled: true,
  },
  {
    id: "end_of_day_close",
    name: "End-of-day close",
    when: 'Say: "Close out the day"',
    steps: ["Daily summary", "Open orders", "Items below 10 units"],
    enabled: true,
  },
];

export default function Routines() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }
  if (!auth?.user) return null;

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[1100px] mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <p className="vl-eyebrow">Routines</p>
            <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
              Sequences your team can speak.
            </h1>
            <p className="mt-3 text-[15px] max-w-2xl" style={{ color: "rgba(245,239,227,0.62)" }}>
              A routine is a named group of actions your assistant can help start or run on command.
            </p>
          </div>
          <button className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
            <Plus className="w-4 h-4" /> New routine
          </button>
        </div>

        <div className="space-y-3">
          {ROUTINES.map((r) => (
            <article key={r.id} className="vl-panel p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
                    {r.name}
                  </h2>
                  <p className="text-[13px] mt-1.5" style={{ color: "rgba(245,239,227,0.6)" }}>
                    {r.when}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="vl-chip"
                    style={{
                      color: r.enabled ? "var(--color-vl-success)" : "rgba(245,239,227,0.5)",
                      borderColor: r.enabled ? "rgba(53,194,117,0.4)" : undefined,
                    }}
                  >
                    {r.enabled ? "On" : "Off"}
                  </span>
                  <button className="vl-btn-ghost inline-flex items-center gap-2 text-[12px]">
                    <Play className="w-3.5 h-3.5" /> Test
                  </button>
                </div>
              </div>

              <ol className="mt-5 grid sm:grid-cols-2 gap-1.5">
                {r.steps.map((s, i) => (
                  <li
                    key={s + i}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/[0.06] text-[12px]"
                    style={{ color: "rgba(245,239,227,0.78)" }}
                  >
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: "rgba(224,183,106,0.85)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
