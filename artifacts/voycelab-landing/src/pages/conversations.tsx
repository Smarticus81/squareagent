import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

interface ConversationRow {
  id: string;
  when: string;
  assistant: string;
  service: string;
  said: string;
  responded: string;
  actions: string[];
  state: "synced" | "needs_attention" | "waiting_approval";
}

const SAMPLE: ConversationRow[] = [
  {
    id: "c_01",
    when: "Today · 9:42 PM",
    assistant: "Bev",
    service: "Square",
    said: "Add two ranch waters and an espresso martini.",
    responded: "Added. Should I send this to Square Terminal?",
    actions: ["Added 2 ranch waters", "Added 1 espresso martini", "Sent to terminal"],
    state: "synced",
  },
  {
    id: "c_02",
    when: "Today · 8:18 PM",
    assistant: "Bev",
    service: "Square",
    said: "How's tequila looking?",
    responded: "Casamigos Blanco is at 3 bottles. Patrón Silver is at 9.",
    actions: ["Checked stock"],
    state: "synced",
  },
  {
    id: "c_03",
    when: "Today · 6:04 PM",
    assistant: "Bev",
    service: "Square",
    said: "Run the hourly sales summary.",
    responded: "6 PM hour: $1,247 across 28 orders.",
    actions: ["Sales summary"],
    state: "synced",
  },
  {
    id: "c_04",
    when: "Yesterday · 11:18 PM",
    assistant: "Bev",
    service: "Square",
    said: "Send last order to terminal three.",
    responded: "The action did not complete. The Square connection ended.",
    actions: ["Send to terminal — failed"],
    state: "needs_attention",
  },
];

export default function Conversations() {
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
          <p className="vl-eyebrow">Conversations</p>
          <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
            Every word. Every action.
          </h1>
          <p className="mt-3 text-[15px] max-w-2xl" style={{ color: "rgba(245,239,227,0.62)" }}>
            What your assistant heard, what it said, and what it changed in your connected service.
          </p>
        </div>

        <div className="vl-panel divide-y divide-white/[0.05]">
          {SAMPLE.map((c) => (
            <div key={c.id} className="px-6 py-5">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span style={{ width: 130, color: "rgba(245,239,227,0.5)", fontSize: 12 }}>{c.when}</span>
                <span className="vl-chip" style={{ color: "var(--color-vl-brass2)" }}>{c.assistant}</span>
                <span className="vl-chip">{c.service}</span>
                <div className="flex-1" />
                <ConversationState state={c.state} />
              </div>
              <p className="text-[14px]" style={{ color: "var(--color-vl-ivory)" }}>
                <span style={{ color: "rgba(245,239,227,0.55)" }}>You — </span>"{c.said}"
              </p>
              <p className="text-[14px] mt-1.5" style={{ color: "var(--color-vl-brass2)" }}>
                <span style={{ color: "rgba(245,239,227,0.55)" }}>{c.assistant} — </span>{c.responded}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {c.actions.map((a, i) => (
                  <span
                    key={a + i}
                    className="vl-chip"
                    style={{
                      fontSize: 10,
                      color: c.state === "needs_attention" ? "var(--color-vl-danger)" : "rgba(245,239,227,0.7)",
                      borderColor: c.state === "needs_attention" ? "rgba(224,82,82,0.32)" : undefined,
                    }}
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[12px]" style={{ color: "rgba(245,239,227,0.45)" }}>
          Showing recent conversations. Live history is wired to the voice surface.
        </p>
      </div>
    </div>
  );
}

function ConversationState({ state }: { state: ConversationRow["state"] }) {
  if (state === "synced")
    return (
      <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-success)" }}>
        <CheckCircle2 className="w-3.5 h-3.5" /> Synced
      </span>
    );
  if (state === "waiting_approval")
    return (
      <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-warning)" }}>
        <Loader2 className="w-3.5 h-3.5" /> Waiting for approval
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--color-vl-danger)" }}>
      <AlertTriangle className="w-3.5 h-3.5" /> Needs attention
    </span>
  );
}
