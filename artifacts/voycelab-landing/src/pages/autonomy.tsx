import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

type Snapshot = {
  funnel: { visitors:number; signups:number; squareConnected:number; activated:number; paid:number; visitorToSignup:number; signupToConnect:number; connectToActivation:number; activationToPaid:number };
  product: { toolCalls:number; toolFailures:number; toolFailureRate:number; averageToolLatencyMs:number; voiceSessions:number; noSuccessfulToolRate:number };
  revenue: { mrrCents:number; paidOrganizations:number; activeByPlan:Record<string,number> };
  churnEvents:number;
};

type FinanceSnapshot = {
  verdict:"healthy"|"caution"|"veto"|"insufficient_cost_data";
  reasons:string[];
  arpaCents:number;
  campaignSpendCents:number;
  estimatedCacCents:number|null;
  estimatedGrossContributionCents:number|null;
  estimatedGrossMargin:number|null;
  cacPaybackMonths:number|null;
  costCoverageComplete:boolean;
};

type OutboundPerformance = {
  windowDays:number;
  totals:{
    sent:number;
    uniqueRecipients:number;
    signups:number;
    attributedSubscriptions:number;
    attributedMrrCents:number;
    optOuts:number;
    signupRate:number;
    paidConversionRate:number;
    replied:number;
    positiveReplies:number;
    replyRate:number;
  };
  campaigns:Array<{
    campaign:string;
    sent:number;
    signups:number;
    attributedSubscriptions:number;
    attributedMrrCents:number;
    optOuts:number;
    replied:number;
    positiveReplies:number;
  }>;
};

type ControlPlaneStatus = {
  enabled:boolean;
  codeWritesEnabled:boolean;
  outboundEnabled:boolean;
  objectiveScore:number;
  objective:{ northStar:string; hardConstraints:string[] };
  snapshot:Snapshot;
  finance:FinanceSnapshot;
  outbound:OutboundPerformance;
  runs:Array<Record<string,any>>;
  actions:Array<Record<string,any>>;
  productFindings:Array<Record<string,any>>;
  experiments:Array<Record<string,any>>;
  leads:Array<Record<string,any>>;
  opportunities:Array<Record<string,any>>;
};

function headers():Record<string,string>{
  const token=localStorage.getItem("voycelab_token")||"";
  return token?{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}:{"Content-Type":"application/json"};
}
function pct(v:number|null|undefined){return `${((v??0)*100).toFixed(1)}%`;}
function money(c:number|null|undefined){return c==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(c/100);}

function Stat({label,value,note,priority=false}:{label:string;value:string;note?:string;priority?:boolean}){
  return <div className={`vl-panel p-5 ${priority?"ring-1 ring-blue-300/20":""}`}>
    <p className="text-[11px] font-semibold uppercase tracking-[.16em]" style={{color:"var(--color-vl-ink-faint)"}}>{label}</p>
    <p className={`${priority?"text-[34px]":"text-[30px]"} mt-2 font-semibold tracking-[-.04em]`} style={{color:"var(--color-vl-ink)"}}>{value}</p>
    {note&&<p className="mt-1 text-[12px]" style={{color:"var(--color-vl-ink-muted)"}}>{note}</p>}
  </div>;
}
function Pill({active,children}:{active:boolean;children:React.ReactNode}){
  return <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium" style={{borderColor:active?"rgba(75,180,120,.35)":"rgba(255,255,255,.12)",background:active?"rgba(75,180,120,.10)":"rgba(255,255,255,.04)",color:active?"#8DDBAF":"var(--color-vl-ink-muted)"}}>{children}</span>;
}

export default function AutonomyPage(){
  const auth=useAuth();
  const queryClient=useQueryClient();
  const isAdmin=Boolean(auth.data?.isAdmin??auth.data?.user?.isAdmin);
  const status=useQuery<ControlPlaneStatus>({
    queryKey:["/api/v1/autonomy/status"],enabled:isAdmin,refetchInterval:30000,
    queryFn:async()=>{const r=await fetch("/api/v1/autonomy/status",{headers:headers()});if(!r.ok)throw new Error(`Control plane returned ${r.status}`);return r.json();}
  });
  const run=useMutation({
    mutationFn:async()=>{const r=await fetch("/api/v1/autonomy/run",{method:"POST",headers:headers()});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.message??`Autonomy run failed (${r.status})`);return b;},
    onSuccess:()=>queryClient.invalidateQueries({queryKey:["/api/v1/autonomy/status"]})
  });

  if(auth.isLoading)return <div className="vl-page-shell flex-1 px-6 pt-28">Loading…</div>;
  if(!isAdmin)return <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10"><div className="vl-panel mx-auto max-w-2xl p-8"><p className="vl-eyebrow">Founder control plane</p><h1 className="vl-display mt-3 text-[36px]">Platform admin access required.</h1></div></div>;
  if(status.isLoading||!status.data)return <div className="vl-page-shell flex-1 px-6 pt-28">Loading control plane…</div>;
  if(status.error)return <div className="vl-page-shell flex-1 px-6 pt-28">{String(status.error)}</div>;

  const d=status.data,s=d.snapshot,f=d.finance,o=d.outbound,current=d.runs[0];
  const openFindings=d.productFindings.filter(x=>!["resolved","dismissed"].includes(String(x.status)));

  return <div className="vl-page-shell flex-1 px-4 pb-24 pt-24 sm:px-6 lg:px-10">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className="vl-eyebrow">VoyceLab Mission Control</p><Pill active={d.enabled}>{d.enabled?"Brain online":"Brain disabled"}</Pill><Pill active={d.outboundEnabled}>{d.outboundEnabled?"Outbound live":"Outbound off"}</Pill><Pill active={f.verdict!=="veto"}>Finance: {f.verdict.replaceAll("_"," ")}</Pill></div>
          <h1 className="vl-display mt-3 max-w-4xl text-[42px] leading-[1.02] sm:text-[54px]">Customers and revenue. Everything else is diagnostic.</h1>
          <p className="mt-4 max-w-3xl text-[14px] leading-6" style={{color:"var(--color-vl-ink-muted)"}}>{d.objective.northStar}</p>
        </div>
        <button className="vl-btn-primary min-w-40 px-5 py-3 text-[13px]" disabled={run.isPending||!d.enabled} onClick={()=>run.mutate()}>{run.isPending?"Running cycle…":"Run strategy cycle"}</button>
      </header>

      {run.error&&<div className="vl-panel border-red-400/20 p-4 text-[13px] text-red-300">{String(run.error)}</div>}

      <section>
        <div className="mb-3 flex items-end justify-between"><div><p className="vl-eyebrow">Bottom line</p><h2 className="mt-2 text-[22px] font-semibold">The only scoreboard that counts</h2></div><span className="text-[11px]" style={{color:"var(--color-vl-ink-faint)"}}>30-day campaign window</span></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat priority label="Paid customers" value={String(s.revenue.paidOrganizations)} note="Current paid organizations" />
          <Stat priority label="MRR" value={money(s.revenue.mrrCents)} note="Current recurring revenue" />
          <Stat priority label="Campaign paid" value={String(o.totals.attributedSubscriptions)} note={`${pct(o.totals.paidConversionRate)} of delivered emails`} />
          <Stat priority label="Campaign MRR" value={money(o.totals.attributedMrrCents)} note="Attributed recurring revenue" />
          <Stat label="Bottom-line score" value={String(d.objectiveScore)} note="Customers + MRR − churn" />
        </div>
      </section>

      <section className="vl-panel overflow-hidden">
        <div className="flex flex-col justify-between gap-3 border-b border-white/8 p-5 sm:flex-row sm:items-end">
          <div><p className="vl-eyebrow">Conversion funnel</p><h2 className="mt-2 text-[22px] font-semibold">Delivered email → signup → paid</h2></div>
          <Pill active={true}>Provider-confirmed sends</Pill>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Delivered" value={String(o.totals.sent)} note={`${o.totals.uniqueRecipients} unique leads`} />
          <Stat label="Signups" value={String(o.totals.signups)} note={`${pct(o.totals.signupRate)} signup rate`} />
          <Stat label="Paid" value={String(o.totals.attributedSubscriptions)} note={`${pct(o.totals.paidConversionRate)} paid conversion`} />
          <Stat label="Attributed MRR" value={money(o.totals.attributedMrrCents)} />
          <Stat label="Opt-outs" value={String(o.totals.optOuts)} note="Guardrail, not success" />
        </div>
        <div className="border-t border-white/8 px-5 pb-5">
          {o.campaigns.slice(0,6).map(c=><div key={c.campaign} className="grid gap-2 border-b border-white/7 py-3 text-[11px] sm:grid-cols-[1fr_repeat(5,auto)] sm:items-center sm:gap-5"><span className="min-w-0 truncate font-medium">{c.campaign}</span><span style={{color:"var(--color-vl-ink-muted)"}}>{c.sent} sent</span><span style={{color:"var(--color-vl-ink-muted)"}}>{c.signups} signup</span><span style={{color:"var(--color-vl-ink-muted)"}}>{c.attributedSubscriptions} paid</span><span style={{color:"var(--color-vl-ink-muted)"}}>{money(c.attributedMrrCents)} MRR</span><span style={{color:"var(--color-vl-ink-muted)"}}>{c.optOuts} opt-out</span></div>)}
        </div>
      </section>

      <section className="vl-panel p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="vl-eyebrow">Diagnostic signals</p><h2 className="mt-2 text-[22px] font-semibold">Useful for diagnosis. Never counted as success.</h2></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Replies" value={String(o.totals.replied)} note={`${pct(o.totals.replyRate)} reply rate`} />
          <Stat label="Positive replies" value={String(o.totals.positiveReplies)} />
          <Stat label="Site signups" value={String(s.funnel.signups)} note="All acquisition sources" />
          <Stat label="Square connected" value={String(s.funnel.squareConnected)} note={`${pct(s.funnel.signupToConnect)} of signups`} />
          <Stat label="Activated" value={String(s.funnel.activated)} note={`${pct(s.funnel.connectToActivation)} of connected`} />
        </div>
      </section>

      <section className="vl-panel p-5">
        <p className="vl-eyebrow">Unit economics</p><h2 className="mt-2 text-[22px] font-semibold capitalize">Finance verdict: {f.verdict.replaceAll("_"," ")}</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="ARPA" value={money(f.arpaCents)}/><Stat label="Gross margin" value={f.estimatedGrossMargin==null?"—":pct(f.estimatedGrossMargin)}/><Stat label="Gross contribution" value={money(f.estimatedGrossContributionCents)}/><Stat label="Estimated CAC" value={money(f.estimatedCacCents)} note={`${money(f.campaignSpendCents)} measured spend`}/><Stat label="CAC payback" value={f.cacPaybackMonths==null?"—":`${f.cacPaybackMonths.toFixed(1)} mo`}/></div>
        <div className="mt-4 space-y-1">{f.reasons.map(r=><p key={r} className="text-[12px] leading-5" style={{color:"var(--color-vl-ink-muted)"}}>• {r}</p>)}</div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className="vl-panel overflow-hidden"><div className="border-b border-white/8 p-5"><p className="vl-eyebrow">Current business brain</p><h2 className="mt-2 text-[24px] font-semibold">{String(current?.plan?.bottleneck??"No completed strategy cycle yet")}</h2><p className="mt-2 text-[13px] leading-6" style={{color:"var(--color-vl-ink-muted)"}}>{String(current?.plan?.diagnosis??"Waiting for the next strategy cycle.")}</p></div><div className="divide-y divide-white/8">{(current?.plan?.actions??[]).slice(0,6).map((a:any,i:number)=><div key={`${a.actionType}-${i}`} className="p-5"><div className="flex justify-between gap-4"><p className="text-[14px] font-medium">{a.title}</p><span className="text-[10px]" style={{color:"var(--color-vl-ink-faint)"}}>{a.agent} · {a.riskLevel}</span></div><p className="mt-1 text-[12px] leading-5" style={{color:"var(--color-vl-ink-muted)"}}>{a.rationale}</p></div>)}</div></section>
        <section className="vl-panel p-5"><p className="vl-eyebrow">Product health</p><h2 className="mt-2 text-[22px] font-semibold">{openFindings.length} open finding(s)</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><Stat label="Tool failure" value={pct(s.product.toolFailureRate)} note={`${s.product.toolFailures}/${s.product.toolCalls} calls`}/><Stat label="No-success sessions" value={pct(s.product.noSuccessfulToolRate)} note={`${s.product.voiceSessions} sessions`}/></div><div className="mt-4 divide-y divide-white/8">{openFindings.slice(0,5).map(x=><div key={x.id} className="py-3"><p className="text-[13px] font-medium">{x.title}</p><p className="mt-1 text-[11px]" style={{color:"var(--color-vl-ink-muted)"}}>{x.severity} · {x.status} · {x.subsystem}</p></div>)}</div></section>
      </div>

      <section className="vl-panel overflow-hidden"><div className="border-b border-white/8 p-5"><p className="vl-eyebrow">Latest autonomous actions</p><h2 className="mt-2 text-[22px] font-semibold">Auditable execution</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[12px]"><thead style={{color:"var(--color-vl-ink-faint)"}}><tr className="border-b border-white/8"><th className="p-4">Agent</th><th className="p-4">Action</th><th className="p-4">Status</th><th className="p-4">External result</th></tr></thead><tbody className="divide-y divide-white/7">{d.actions.slice(0,18).map(a=><tr key={a.id}><td className="p-4">{a.agent}</td><td className="p-4">{a.action_type}</td><td className="p-4">{a.status}</td><td className="max-w-[320px] truncate p-4" style={{color:"var(--color-vl-ink-muted)"}}>{a.external_ref||"—"}</td></tr>)}</tbody></table></div></section>
    </div>
  </div>;
}
