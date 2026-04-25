import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

interface SessionRow {
  id: string;
  when: string;
  agent: string;
  venue: string;
  transcript: string;
  toolCalls: string[];
  state: "synced" | "pending" | "error";
}

const SESSIONS: SessionRow[] = [
  {
    id: "s_01",
    when: "Today · 9:42 PM",
    agent: "Bev",
    venue: "Grand Ballroom",
    transcript: "Add two ranch waters and an espresso martini.",
    toolCalls: ["add_item × 2", "add_item × 1", "send_to_terminal"],
    state: "synced",
  },
  {
    id: "s_02",
    when: "Today · 8:18 PM",
    agent: "Bev",
    venue: "Grand Ballroom",
    transcript: "How's tequila looking?",
    toolCalls: ["check_inventory(tequila)"],
    state: "synced",
  },
  {
    id: "s_03",
    when: "Today · 6:04 PM",
    agent: "Bev",
    venue: "Grand Ballroom",
    transcript: "Run the hourly sales report.",
    toolCalls: ["hourly_sales", "list_open_orders"],
    state: "synced",
  },
  {
    id: "s_04",
    when: "Yesterday",
    agent: "Bev",
    venue: "Grand Ballroom",
    transcript: "Send last order to terminal three.",
    toolCalls: ["send_to_terminal(t3)"],
    state: "error",
  },
];

export default function Sessions() {
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
        <div className="mb-10">
          <p className="vl-eyebrow">Sessions</p>
          <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
            Every word. Every action.
          </h1>
          <p className="mt-3 text-[15px] max-w-2xl" style={{ color: "rgba(245,239,227,0.6)" }}>
            Transcripts and tool calls for every voice session. For trust, for tuning, and for debugging.
          </p>
        </div>

        <div className="vl-panel divide-y divide-white/[0.05]">
          {SESSIONS.map((s) => (
            <div key={s.id} className="px-6 py-5">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span style={{ width: 130, color: "rgba(245,239,227,0.5)", fontSize: 12 }}>{s.when}</span>
                <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>{s.agent}</span>
                <span className="vl-chip">{s.venue}</span>
                <div className="flex-1" />
                <SessionState state={s.state} />
              </div>
              <p className="text-[14px] mb-3" style={{ color: "var(--color-vl-ivory)" }}>
                "{s.transcript}"
              </p>
              <div className="flex flex-wrap gap-1.5">
                {s.toolCalls.map((t) => (
                  <span key={t} className="vl-chip" style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "none", letterSpacing: 0 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[12px]" style={{ color: "rgba(245,239,227,0.45)" }}>
          Showing recent sessions. Live session storage is wired to the voice surface.
        </p>
      </div>
    </div>
  );
}

function SessionState({ state }: { state: "synced" | "pending" | "error" }) {
  if (state === "synced")
    return (
      <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-success)" }}>
        <CheckCircle2 className="w-3.5 h-3.5" /> Synced
      </span>
    );
  if (state === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-warning)" }}>
        <Loader2 className="w-3.5 h-3.5" /> Pending
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-danger)" }}>
      <AlertTriangle className="w-3.5 h-3.5" /> Failed
    </span>
  );
}
