import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues } from "@/hooks/use-venues";
import { Loader2 } from "lucide-react";

/**
 * Agent Setup wizard — connects a venue's existing service to a named voice
 * agent, picks a SOTA voice pipeline, and saves an agent profile.
 *
 * Steps:
 *   1. Name the agent
 *   2. Choose connected service (Square / Mock / others)
 *   3. Choose location (from connected service)
 *   4. Choose voice pipeline (server-validated availability)
 *   5. Choose noise mode
 *   6. Choose confirmation rules (default policy + tweaks)
 *   7. Test command (push-to-talk smoke test)
 *   8. Launch
 */

interface PipelineReport {
  provider: string;
  displayName: string;
  category: string;
  status: "available" | "needs_configuration" | "request_access" | "experimental" | "unavailable";
  reason?: string;
  missing?: string[];
  shortDescription?: string;
  recommendedFor?: string[];
  isFallback?: boolean;
  isExperimental?: boolean;
  notes?: string;
}

interface ConnectedServiceProvider {
  provider: string;
  displayName: string;
  description: string;
  status: "available" | "needs_configuration" | "request_access" | "unavailable";
  capabilities: string[];
  notes?: string;
  isImplemented: boolean;
}

const NOISE_MODES = [
  { value: "quiet_room", label: "Quiet room", description: "Office, tasting room, private space." },
  { value: "restaurant", label: "Restaurant", description: "Moderate background noise." },
  { value: "bar", label: "Bar", description: "Loud crowd; push-to-talk recommended." },
  { value: "nightclub", label: "Nightclub", description: "Very loud; PTT default; strict confirms." },
  { value: "event_venue", label: "Event venue", description: "Variable noise; event context loaded." },
  { value: "manual_push_to_talk", label: "Push-to-talk only", description: "Button trigger required." },
] as const;

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, { bg: string; text: string; label: string }> = {
    available: { bg: "#DCFCE7", text: "#166534", label: "Available" },
    needs_configuration: { bg: "#FEF3C7", text: "#92400E", label: "Needs configuration" },
    request_access: { bg: "#E0E7FF", text: "#3730A3", label: "Request access" },
    experimental: { bg: "#FCE7F3", text: "#9D174D", label: "Experimental" },
    unavailable: { bg: "#F1F5F9", text: "#475569", label: "Unavailable" },
  };
  const p = palette[status] ?? palette.unavailable;
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: p.bg, color: p.text }}
    >
      {p.label}
    </span>
  );
}

export default function AgentSetup() {
  const [, navigate] = useLocation();
  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: venues } = useVenues();
  const [step, setStep] = useState(1);

  const [agentName, setAgentName] = useState("Bev");
  const [wakePhrase, setWakePhrase] = useState("");
  const [connectedServiceId, setConnectedServiceId] = useState<string>("");
  const [venueId, setVenueId] = useState<number | null>(null);
  const [pipelineProvider, setPipelineProvider] = useState<string>("openai_realtime_webrtc");
  const [noiseMode, setNoiseMode] = useState<string>("restaurant");

  const [providers, setProviders] = useState<ConnectedServiceProvider[]>([]);
  const [pipelines, setPipelines] = useState<PipelineReport[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !auth) navigate("/login");
  }, [auth, authLoading, navigate]);

  useEffect(() => {
    fetch("/api/v1/connected-service-providers")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
    fetch("/api/v1/voice-pipelines")
      .then((r) => r.json())
      .then((d) => setPipelines(d.pipelines ?? []))
      .catch(() => setPipelines([]));
  }, []);

  useEffect(() => {
    if (!wakePhrase) setWakePhrase(`Hey ${agentName}`);
  }, [agentName, wakePhrase]);

  const groupedPipelines = useMemo(() => {
    const groups = new Map<string, PipelineReport[]>();
    for (const p of pipelines) {
      const cat = p.category;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
    return groups;
  }, [pipelines]);

  async function save() {
    if (!venueId) {
      setError("Pick a venue first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/agent-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth?.organizationId ?? "",
          venueId,
          connectedServiceId: connectedServiceId || undefined,
          displayName: agentName,
          wakePhrase,
          voicePipelineProvider: pipelineProvider,
          voicePipelineConfig: {},
          noiseMode,
          allowedTools: [],
          confirmationPolicy: {},
          personality: "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      navigate("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agent profile");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-semibold mb-2">Agent setup</h1>
      <p className="text-sm text-gray-500 mb-8">
        Voice control layer for your venue. Name your agent, pick the system to bolt onto, and choose the voice pipeline.
      </p>

      <ol className="flex flex-wrap gap-2 mb-8">
        {["Name", "Service", "Location", "Pipeline", "Noise", "Launch"].map((label, i) => (
          <li
            key={label}
            className={`text-xs px-3 py-1 rounded-full border ${
              step === i + 1 ? "bg-black text-white border-black" : "bg-white text-gray-700 border-gray-200"
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="space-y-4">
          <label className="block">
            <div className="text-sm font-medium mb-1">Agent name</div>
            <input
              className="w-full border rounded px-3 py-2"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Bev, Aurora, Sage…"
            />
            <p className="text-xs text-gray-500 mt-1">
              The default suggestion is "Bev" — you can choose any name for your agent.
            </p>
          </label>
          <label className="block">
            <div className="text-sm font-medium mb-1">Wake phrase</div>
            <input
              className="w-full border rounded px-3 py-2"
              value={wakePhrase}
              onChange={(e) => setWakePhrase(e.target.value)}
            />
          </label>
          <button className="px-4 py-2 bg-black text-white rounded" onClick={() => setStep(2)}>
            Next
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Choose connected system</h2>
          <p className="text-sm text-gray-500">
            VoyceLab is a bolt-on voice layer. Pick the system VoyceLab will control.
          </p>
          <div className="space-y-2">
            {providers.map((p) => (
              <label
                key={p.provider}
                className="flex items-start gap-3 border rounded p-3 cursor-pointer hover:bg-gray-50"
                style={{ opacity: p.isImplemented ? 1 : 0.7 }}
              >
                <input
                  type="radio"
                  name="provider"
                  className="mt-1"
                  disabled={!p.isImplemented}
                  checked={connectedServiceId === p.provider}
                  onChange={() => setConnectedServiceId(p.provider)}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.displayName}</span>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="text-sm text-gray-500">{p.description}</div>
                  {p.notes ? <div className="text-xs text-gray-400 mt-1">{p.notes}</div> : null}
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="px-4 py-2 bg-black text-white rounded"
              onClick={() => setStep(3)}
              disabled={!connectedServiceId}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Choose location</h2>
          <p className="text-sm text-gray-500">Pick a venue you've already added on the dashboard.</p>
          <div className="space-y-2">
            {(venues ?? []).map((v) => (
              <label
                key={v.id}
                className="flex items-center gap-3 border rounded p-3 cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="venue"
                  checked={venueId === v.id}
                  onChange={() => setVenueId(v.id)}
                />
                <div className="flex-1">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-gray-500">{v.squareLocationName ?? "no location set"}</div>
                </div>
              </label>
            ))}
            {(!venues || venues.length === 0) && (
              <div className="border border-dashed rounded p-4 text-sm text-gray-500">
                No venues yet — add one on the{" "}
                <a className="underline" onClick={() => navigate("/dashboard")}>
                  Dashboard
                </a>
                .
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => setStep(2)}>
              Back
            </button>
            <button
              className="px-4 py-2 bg-black text-white rounded"
              onClick={() => setStep(4)}
              disabled={!venueId}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Choose voice pipeline</h2>
          <p className="text-sm text-gray-500">
            All categories shown. Availability reflects server-side credentials. Fallbacks marked degraded.
          </p>
          {Array.from(groupedPipelines.entries()).map(([category, list]) => (
            <div key={category}>
              <div className="text-xs uppercase tracking-wider text-gray-500 mt-3 mb-1">
                {category.replaceAll("_", " ")}
              </div>
              <div className="space-y-1">
                {list.map((p) => (
                  <label
                    key={p.provider}
                    className="flex items-start gap-3 border rounded p-3 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="radio"
                      name="pipeline"
                      className="mt-1"
                      checked={pipelineProvider === p.provider}
                      onChange={() => setPipelineProvider(p.provider)}
                      disabled={p.status === "unavailable" || p.status === "request_access"}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.displayName}</span>
                        <StatusPill status={p.status} />
                        {p.isFallback ? (
                          <span className="text-[11px] text-gray-500">(fallback)</span>
                        ) : null}
                      </div>
                      <div className="text-sm text-gray-500">{p.shortDescription}</div>
                      {p.reason ? <div className="text-xs text-gray-400 mt-1">{p.reason}</div> : null}
                      {p.missing && p.missing.length > 0 ? (
                        <div className="text-xs text-amber-700 mt-1">
                          Missing env vars: {p.missing.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => setStep(3)}>
              Back
            </button>
            <button className="px-4 py-2 bg-black text-white rounded" onClick={() => setStep(5)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Choose noise mode</h2>
          <div className="space-y-2">
            {NOISE_MODES.map((n) => (
              <label
                key={n.value}
                className="flex items-start gap-3 border rounded p-3 cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="noise"
                  className="mt-1"
                  checked={noiseMode === n.value}
                  onChange={() => setNoiseMode(n.value)}
                />
                <div>
                  <div className="font-medium">{n.label}</div>
                  <div className="text-sm text-gray-500">{n.description}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => setStep(4)}>
              Back
            </button>
            <button className="px-4 py-2 bg-black text-white rounded" onClick={() => setStep(6)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 6 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Launch</h2>
          <ul className="text-sm border rounded divide-y">
            <li className="px-3 py-2 flex justify-between"><span>Agent name</span><span>{agentName}</span></li>
            <li className="px-3 py-2 flex justify-between"><span>Wake phrase</span><span>{wakePhrase}</span></li>
            <li className="px-3 py-2 flex justify-between"><span>Service</span><span>{connectedServiceId || "—"}</span></li>
            <li className="px-3 py-2 flex justify-between"><span>Venue</span><span>{venueId ?? "—"}</span></li>
            <li className="px-3 py-2 flex justify-between"><span>Pipeline</span><span>{pipelineProvider}</span></li>
            <li className="px-3 py-2 flex justify-between"><span>Noise mode</span><span>{noiseMode}</span></li>
          </ul>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <div className="flex gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => setStep(5)}>
              Back
            </button>
            <button
              className="px-4 py-2 bg-black text-white rounded inline-flex items-center gap-2"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Launch agent
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
