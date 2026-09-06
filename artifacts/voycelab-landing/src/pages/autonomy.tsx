import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

type Snapshot = {
  generatedAt: string;
  funnel: {
    visitors: number;
    signups: number;
    squareConnected: number;
    activated: number;
    paid: number;
    visitorToSignup: number;
    signupToConnect: number;
    connectToActivation: number;
    activationToPaid: number;
  };
  product: {
    toolCalls: number;
    toolFailures: number;
    toolFailureRate: number;
    averageToolLatencyMs: number;
    voiceSessions: number;
    noSuccessfulToolRate: number;
  };
  revenue: { mrrCents: number; paidOrganizations: number; activeByPlan: Record<string, number> };
  churnEvents: number;
  supportOpened: number;
  supportResolved: number;
};

type ControlPlaneStatus = {
  enabled: boolean;
  codeWritesEnabled: boolean;
  outboundEnabled: boolean;
  objectiveScore: number;
  objective: { northStar: string; hardConstraints: string[] };
  budget: Record<string, number>;
  snapshot: Snapshot;
  runs: Array<Record<string, any>>;
  actions: Array<Record<string, any>>;
  productFindings: Array<Record<string, any>>;
  experiments: Array<Record<string, any>>;
  leads: Array<Record<string, any>>;
};

function headers(): Record<string, string> {
  const token = localStorage.getItem("voycelab_token") || "";
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function pct(value: number | null | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((cents ?? 0) / 100);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="vl-panel p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-vl-ink-faint)" }}>{label}</p>
      <p className="mt-2 text-[30px] font-semibold tracking-[-0.04em]" style={{ color: "var(--color-vl-ink)" }}>{value}</p>
      {note && <p className="mt-1 text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>{note}</p>}
    </div>
  );
}

function StatusPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{
      borderColor: active ? "rgba(75, 180, 120, .35)" : "rgba(255,255,255,.12)",
      background: active ? "rgba(75, 180, 120, .10)" : "rgba(255,255,255,.04)",
      color: active ? "#8DDBAF" : "var(--color-vl-ink-muted)",
    }}>{children}</span>
  );
}

export default function AutonomyPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = Boolean(auth.data?.isAdmin ?? auth.data?.user?.isAdmin);

  const status = useQuery<ControlPlaneStatus>({
    queryKey: ["/api/v1/autonomy/status"],
    enabled: isAdmin,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/v1/autonomy/status", { headers: headers() });
      if (!res.ok) throw new Error(`Control plane returned ${res.status}`);
      return res.json();
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/autonomy/run", { method: "POST", headers: headers() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? `Autonomy run failed (${res.status})`);
      return body;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v1/autonomy/status"] }),
  });

  if (auth.isLoading) return <div className="vl-page-shell flex-1 px-6 pt-28">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
        <div className="vl-panel mx-auto max-w-2xl p-8">
          <p className="vl-eyebrow">Founder control plane</p>
          <h1 className="vl-display mt-3 text-[36px]">Platform admin access required.</h1>
          <p className="mt-3 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>This surface can inspect and trigger company-wide autonomous operations.</p>
        </div>
      </div>
    );
  }

  if (status.isLoading || !status.data) return <div className="vl-page-shell flex-1 px-6 pt-28">Loading control plane…</div>;
  if (status.error) return <div className="vl-page-shell flex-1 px-6 pt-28">{String(status.error)}</div>;

  const data = status.data;
  const s = data.snapshot;
  const currentRun = data.runs[0];
  const openFindings = data.productFindings.filter((finding) => !["resolved", "dismissed"].includes(String(finding.status)));
  const activeExperiments = data.experiments.filter((experiment) => experiment.status === "running");

  return (
    <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="vl-eyebrow">VoyceLab autonomous operations</p>
              <StatusPill active={data.enabled}>{data.enabled ? "Brain online" : "Brain disabled"}</StatusPill>
              <StatusPill active={data.outboundEnabled}>{data.outboundEnabled ? "Outbound live" : "Outbound off"}</StatusPill>
              <StatusPill active={data.codeWritesEnabled}>{data.codeWritesEnabled ? "Code repair enabled" : "Code repair off"}</StatusPill>
            </div>
            <h1 className="vl-display mt-3 max-w-4xl text-[42px] leading-[1.02] sm:text-[54px]">The company can see itself, judge itself, and improve itself.</h1>
            <p className="mt-4 max-w-3xl text-[14px] leading-6" style={{ color: "var(--color-vl-ink-muted)" }}>{data.objective.northStar}</p>
          </div>
          <button className="vl-btn-primary min-w-40 px-5 py-3 text-[13px]" disabled={run.isPending || !data.enabled} onClick={() => run.mutate()}>
            {run.isPending ? "Running cycle…" : "Run strategy cycle"}
          </button>
        </div>

        {run.error && <div className="vl-panel border-red-400/20 p-4 text-[13px] text-red-300">{String(run.error)}</div>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Objective score" value={String(data.objectiveScore)} note="MRR + activation + conversion − reliability/churn" />
          <Stat label="MRR" value={money(s.revenue.mrrCents)} note={`${s.revenue.paidOrganizations} paid organization(s)`} />
          <Stat label="Activation" value={pct(s.funnel.connectToActivation)} note={`${s.funnel.activated}/${s.funnel.squareConnected} connected signups`} />
          <Stat label="Trial → paid" value={pct(s.funnel.activationToPaid)} note={`${s.funnel.paid}/${s.funnel.activated} activated`} />
          <Stat label="Tool failure" value={pct(s.product.toolFailureRate)} note={`${s.product.toolFailures}/${s.product.toolCalls} tool calls`} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
          <section className="vl-panel overflow-hidden">
            <div className="border-b border-white/8 p-5">
              <p className="vl-eyebrow">Current business brain</p>
              <h2 className="mt-2 text-[24px] font-semibold">{String(currentRun?.plan?.bottleneck ?? "No completed strategy cycle yet")}</h2>
              <p className="mt-2 text-[13px] leading-6" style={{ color: "var(--color-vl-ink-muted)" }}>{String(currentRun?.plan?.diagnosis ?? "The scheduler will produce the first diagnosis after autonomy is enabled.")}</p>
            </div>
            <div className="divide-y divide-white/8">
              {(currentRun?.plan?.actions ?? []).slice(0, 6).map((action: any, index: number) => (
                <div key={`${action.actionType}-${index}`} className="grid gap-2 p-5 sm:grid-cols-[28px_1fr_auto] sm:items-start">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/6 text-[11px]">{index + 1}</div>
                  <div>
                    <p className="text-[14px] font-medium">{action.title}</p>
                    <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--color-vl-ink-muted)" }}>{action.rationale}</p>
                  </div>
                  <span className="text-[11px]" style={{ color: "var(--color-vl-ink-faint)" }}>{action.agent} · {action.riskLevel}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="vl-panel p-5">
            <p className="vl-eyebrow">30-day funnel</p>
            <div className="mt-5 space-y-4">
              {[
                ["Visitors", s.funnel.visitors, null],
                ["Signups", s.funnel.signups, s.funnel.visitorToSignup],
                ["Square connected", s.funnel.squareConnected, s.funnel.signupToConnect],
                ["Activated", s.funnel.activated, s.funnel.connectToActivation],
                ["Paid", s.funnel.paid, s.funnel.activationToPaid],
              ].map(([label, count, rate]) => (
                <div key={String(label)} className="flex items-baseline justify-between border-b border-white/7 pb-3">
                  <span className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>{String(label)}</span>
                  <div className="text-right"><span className="text-[19px] font-semibold">{Number(count)}</span>{rate !== null && <span className="ml-2 text-[11px]" style={{ color: "var(--color-vl-ink-faint)" }}>{pct(Number(rate))}</span>}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="vl-panel p-5">
            <div className="flex items-end justify-between gap-4">
              <div><p className="vl-eyebrow">Product self-repair</p><h2 className="mt-2 text-[22px] font-semibold">{openFindings.length} open finding(s)</h2></div>
              <span className="text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>{s.product.averageToolLatencyMs} ms avg tool latency</span>
            </div>
            <div className="mt-4 divide-y divide-white/8">
              {openFindings.slice(0, 8).map((finding) => (
                <div key={finding.id} className="py-3">
                  <div className="flex items-start justify-between gap-4"><p className="text-[13px] font-medium">{finding.title}</p><span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-vl-ink-faint)" }}>{finding.severity} · {finding.status}</span></div>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--color-vl-ink-muted)" }}>{finding.subsystem}{finding.github_pr_url ? " · repair PR opened" : ""}</p>
                </div>
              ))}
              {!openFindings.length && <p className="py-6 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>No unresolved product regressions detected.</p>}
            </div>
          </section>

          <section className="vl-panel p-5">
            <p className="vl-eyebrow">Experiment engine</p>
            <h2 className="mt-2 text-[22px] font-semibold">{activeExperiments.length} running experiment(s)</h2>
            <div className="mt-4 divide-y divide-white/8">
              {data.experiments.slice(0, 8).map((experiment) => (
                <div key={experiment.id} className="py-3">
                  <div className="flex justify-between gap-4"><p className="text-[13px] font-medium">{experiment.slug}</p><span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-vl-ink-faint)" }}>{experiment.status}</span></div>
                  <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--color-vl-ink-muted)" }}>{experiment.hypothesis}</p>
                </div>
              ))}
              {!data.experiments.length && <p className="py-6 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>No experiments have been launched yet.</p>}
            </div>
          </section>
        </div>

        <section className="vl-panel overflow-hidden">
          <div className="flex flex-col justify-between gap-3 border-b border-white/8 p-5 sm:flex-row sm:items-end">
            <div><p className="vl-eyebrow">Autonomous activity</p><h2 className="mt-2 text-[22px] font-semibold">Latest actions</h2></div>
            <span className="text-[11px]" style={{ color: "var(--color-vl-ink-faint)" }}>Everything is auditable; founder-gated actions remain blocked until approved.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-[12px]">
              <thead style={{ color: "var(--color-vl-ink-faint)" }}><tr className="border-b border-white/8"><th className="p-4 font-medium">Agent</th><th className="p-4 font-medium">Action</th><th className="p-4 font-medium">Risk</th><th className="p-4 font-medium">Authority</th><th className="p-4 font-medium">Status</th><th className="p-4 font-medium">External result</th></tr></thead>
              <tbody className="divide-y divide-white/7">
                {data.actions.slice(0, 20).map((action) => (
                  <tr key={action.id}><td className="p-4">{action.agent}</td><td className="p-4">{action.action_type}</td><td className="p-4">{action.risk_level}</td><td className="p-4">{action.authority}</td><td className="p-4">{action.status}</td><td className="max-w-[260px] truncate p-4" style={{ color: "var(--color-vl-ink-muted)" }}>{action.external_ref || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="vl-panel p-5">
          <p className="vl-eyebrow">Qualified acquisition graph</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.leads.slice(0, 12).map((lead) => (
              <div key={lead.id} className="rounded-2xl border border-white/8 bg-white/[.025] p-4">
                <div className="flex items-start justify-between gap-3"><p className="text-[13px] font-medium">{lead.company_name}</p><span className="text-[11px]">{lead.fit_score}/100</span></div>
                <p className="mt-1 text-[11px]" style={{ color: "var(--color-vl-ink-muted)" }}>{lead.segment} · {lead.stage}</p>
              </div>
            ))}
            {!data.leads.length && <p className="text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>The acquisition worker has not populated leads yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
