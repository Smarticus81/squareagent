import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Play, Plus } from "lucide-react";

const WORKFLOWS = [
  {
    id: "opening_checklist",
    name: "Opening checklist",
    when: 'Spoken: "Run the opening checklist"',
    steps: ["inventory_summary", "low_stock_report(10)", "current_shifts", "list_locations"],
    enabled: true,
  },
  {
    id: "stock_take",
    name: "Stock take",
    when: 'Spoken: "Run a stock take"',
    steps: ["check_all_inventory", "inventory_summary"],
    enabled: true,
  },
  {
    id: "end_of_day_close",
    name: "End-of-day close",
    when: 'Spoken: "Close out the day"',
    steps: ["daily_summary", "list_open_orders", "low_stock_report"],
    enabled: true,
  },
];

export default function Workflows() {
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
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="vl-eyebrow">Workflows</p>
            <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
              Sequences your team can speak.
            </h1>
            <p className="mt-3 text-[15px] max-w-2xl" style={{ color: "rgba(245,239,227,0.6)" }}>
              Multi-step routines bundled behind a single spoken command. Lightweight by design.
            </p>
          </div>
          <button className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
            <Plus className="w-4 h-4" /> New workflow
          </button>
        </div>

        <div className="space-y-3">
          {WORKFLOWS.map((w) => (
            <article key={w.id} className="vl-panel p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--color-vl-ivory)" }}>
                    {w.name}
                  </h2>
                  <p className="text-[13px] mt-1.5" style={{ color: "rgba(245,239,227,0.6)" }}>
                    {w.when}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="vl-chip"
                    style={{
                      color: w.enabled ? "var(--color-vl-success)" : "rgba(245,239,227,0.5)",
                      borderColor: w.enabled ? "rgba(53,194,117,0.4)" : undefined,
                    }}
                  >
                    {w.enabled ? "Enabled" : "Off"}
                  </span>
                  <button className="vl-btn-ghost inline-flex items-center gap-2 text-[12px]">
                    <Play className="w-3.5 h-3.5" /> Test
                  </button>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 flex-wrap">
                {w.steps.map((s, i) => (
                  <span
                    key={s + i}
                    className="vl-chip"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "none", letterSpacing: 0 }}
                  >
                    {i + 1}. {s}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
