import { useEffect, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  useVenues,
  useSaveVenue,
  useDeleteVenue,
  useSquareLocations,
  type SquareLocation,
} from "@/hooks/use-venues";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Plus,
  PlugZap,
  Store,
  Trash2,
  X,
} from "lucide-react";

export default function ConnectedServices() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const { data: venues, isLoading: venuesLoading, error: venuesError } = useVenues();
  const saveVenue = useSaveVenue();
  const deleteVenue = useDeleteVenue();
  const fetchLocations = useSquareLocations();

  const [oauthToken, setOauthToken] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthTs = params.get("oauth_ts");
    const oauthError = params.get("oauth_error");
    if (!oauthTs && !oauthError) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("oauth_ts");
    url.searchParams.delete("oauth_error");
    window.history.replaceState({}, "", url.pathname + url.search);

    if (oauthError) {
      setErrorMsg(`Square authorization failed: ${oauthError}`);
      return;
    }
    if (oauthTs) {
      (async () => {
        setConnecting(true);
        try {
          const tokenRes = await fetch(`/api/square/oauth/token?ts=${encodeURIComponent(oauthTs)}`);
          const tokenData = await tokenRes.json();
          if (!tokenRes.ok) throw new Error(tokenData.error || "Failed to get token");
          setOauthToken(tokenData.token);
          setOauthMerchantId(tokenData.merchantId || null);
          const locs = await fetchLocations.mutateAsync(tokenData.token);
          setLocations(locs);
          setShowLocationPicker(true);
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : "Failed to connect Square");
        } finally {
          setConnecting(false);
        }
      })();
    }
  }, [fetchLocations]);

  const handleConnectSquare = useCallback(() => {
    setConnecting(true);
    window.location.href = "/api/square/oauth/authorize?mode=redirect&return_url=/services";
  }, []);

  const handleSelectLocation = useCallback(
    async (loc: SquareLocation) => {
      if (!oauthToken) return;
      try {
        await saveVenue.mutateAsync({
          accessToken: oauthToken,
          merchantId: oauthMerchantId || undefined,
          locationId: loc.id,
          locationName: loc.name,
          name: loc.name,
        });
        setOauthToken(null);
        setOauthMerchantId(null);
        setLocations([]);
        setShowLocationPicker(false);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to save location");
      }
    },
    [oauthToken, oauthMerchantId, saveVenue],
  );

  if (isLoading || (venuesLoading && !venuesError)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const hasVenues = (venues ?? []).length > 0;

  return (
    <div className="flex-1 pt-20 sm:pt-24 pb-16">
      <div className="w-full max-w-240 mx-auto px-4 sm:px-6 lg:px-10">
        <Link
          href="/command"
          className="inline-flex items-center gap-1.5 text-[12px] mb-5 transition-colors"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Console
        </Link>

        <div className="mb-10">
          <p className="vl-eyebrow">Integrations</p>
          <h1
            className="text-[28px] md:text-[34px] font-semibold tracking-tight mt-2"
            style={{ color: "var(--color-vl-ink)" }}
          >
            Connected systems
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed max-w-xl" style={{ color: "rgba(10,10,11,0.62)" }}>
            Your assistant can only act on systems you connect here. Start with Square for live POS actions, then add knowledge and data sources to expand what it can do.
          </p>
        </div>

        {errorMsg && (
          <div
            className="mb-6 rounded-2xl border px-4 py-3 text-[13px]"
            style={{
              color: "var(--color-vl-danger)",
              background: "rgba(215, 64, 46, 0.08)",
              borderColor: "rgba(215, 64, 46, 0.18)",
            }}
          >
            {errorMsg}
            <button
              onClick={() => setErrorMsg(null)}
              className="ml-3 underline text-[12px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {venuesError && (
          <div
            className="mb-6 rounded-2xl border px-4 py-3 text-[13px]"
            style={{
              color: "var(--color-vl-danger)",
              background: "rgba(215, 64, 46, 0.08)",
              borderColor: "rgba(215, 64, 46, 0.18)",
            }}
          >
            Could not reach the venue service: {venuesError.message}
          </div>
        )}

        {/* ── Square POS ──────────────────────────────────────── */}
        <section className="mb-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: "linear-gradient(135deg, #FFFFFF, var(--color-vl-coral-tint))",
                  border: "1px solid rgba(10,10,11,0.08)",
                  color: "var(--color-vl-coral-deep)",
                }}
              >
                <Store className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>Square POS</p>
                <p className="text-[12px]" style={{ color: "rgba(10,10,11,0.52)" }}>
                  Menu, orders, inventory, reporting, terminals
                </p>
              </div>
            </div>
            {hasVenues && (
              <button
                onClick={handleConnectSquare}
                disabled={connecting}
                className="vl-btn-outline hidden items-center gap-2 px-4 py-2 text-[13px] sm:inline-flex"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add location
              </button>
            )}
          </div>

          <div
            className="rounded-2xl border bg-white overflow-hidden"
            style={{ borderColor: "rgba(10,10,11,0.08)", boxShadow: "0 1px 2px rgba(10,10,11,0.04), 0 8px 24px -12px rgba(10,10,11,0.08)" }}
          >
            {!hasVenues ? (
              <div className="flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between md:p-8">
                <div>
                  <p className="text-[16px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                    Connect your Square account
                  </p>
                  <p className="mt-2 max-w-md text-[13px] leading-relaxed" style={{ color: "rgba(10,10,11,0.55)" }}>
                    Choose a Square location so your assistant can search the menu, build orders, check inventory, and send to your terminal.
                  </p>
                </div>
                <button onClick={handleConnectSquare} disabled={connecting} className="vl-btn-primary inline-flex shrink-0 items-center gap-2">
                  {connecting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Connect Square
                  {!connecting && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              (venues ?? []).map((v) => (
                <div key={v.id} className="flex items-center gap-4 border-b border-[rgba(10,10,11,0.06)] p-5 last:border-b-0 md:p-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold truncate" style={{ color: "var(--color-vl-ink)" }}>
                        {v.squareLocationName ?? v.name ?? `Venue ${v.id}`}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase"
                        style={{
                          color: "var(--color-vl-success)",
                          borderColor: "rgba(47,158,100,0.20)",
                          background: "rgba(47,158,100,0.08)",
                        }}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Live
                      </span>
                    </div>
                    {v.connectedAt && (
                      <p className="mt-1 text-[12px]" style={{ color: "rgba(10,10,11,0.42)" }}>
                        Connected {new Date(v.connectedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteVenue.mutate(v.id)}
                    disabled={deleteVenue.isPending}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60"
                    style={{
                      color: "var(--color-vl-danger)",
                      background: "rgba(215, 64, 46, 0.06)",
                      borderColor: "rgba(215, 64, 46, 0.16)",
                    }}
                  >
                    {deleteVenue.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>
          {hasVenues && (
            <div className="mt-3 sm:hidden">
              <button onClick={handleConnectSquare} disabled={connecting} className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-[13px]">
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add another location
              </button>
            </div>
          )}
        </section>

        {/* ── Data & Knowledge ──────────────────────────────────── */}
        <section className="mb-8">
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: "linear-gradient(135deg, #FFFFFF, rgba(199,210,254,0.4))",
                border: "1px solid rgba(10,10,11,0.08)",
                color: "var(--color-vl-accent)",
              }}
            >
              <Database className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>Data sources</p>
              <p className="text-[12px]" style={{ color: "rgba(10,10,11,0.52)" }}>
                Knowledge base, database, and email
              </p>
            </div>
          </div>

          <Link
            href="/data-sources"
            className="group flex items-center justify-between rounded-2xl border bg-white p-5 md:p-6 transition-all hover:-translate-y-0.5"
            style={{ borderColor: "rgba(10,10,11,0.08)", boxShadow: "0 1px 2px rgba(10,10,11,0.04), 0 8px 24px -12px rgba(10,10,11,0.08)" }}
          >
            <div className="flex items-start gap-4">
              <FileText className="h-5 w-5 mt-0.5 shrink-0" style={{ color: "var(--color-vl-accent)" }} />
              <div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                  Upload documents, connect a database, or configure email
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "rgba(10,10,11,0.55)" }}>
                  Your assistant can search your knowledge base, run read-only queries, and send emails you approve.
                </p>
              </div>
            </div>
            <ArrowRight
              className="w-4 h-4 shrink-0 ml-4 transition-transform group-hover:translate-x-0.5"
              style={{ color: "rgba(10,10,11,0.35)" }}
            />
          </Link>
        </section>

        {/* ── Coming soon ────────────────────────────────────── */}
        <section>
          <div className="mb-4">
            <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ink-muted)" }}>
              Coming soon
            </p>
            <p className="mt-1 text-[12px]" style={{ color: "rgba(10,10,11,0.42)" }}>
              Tell us what to build next.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {UPCOMING_INTEGRATIONS.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border bg-white p-4 flex items-start gap-3"
                style={{ borderColor: "rgba(10,10,11,0.06)" }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5"
                  style={{
                    background: "rgba(10, 10, 11,0.03)",
                    color: "rgba(10,10,11,0.35)",
                    border: "1px solid rgba(10, 10, 11,0.06)",
                  }}
                >
                  <PlugZap className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{p.name}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: "rgba(10,10,11,0.45)" }}>{p.description}</p>
                  <a
                    href={`mailto:hello@voycelab.com?subject=${encodeURIComponent(`Integration request: ${p.name}`)}`}
                    className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium transition-colors"
                    style={{ color: "var(--color-vl-accent)" }}
                  >
                    Request <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Location picker modal */}
      {showLocationPicker && locations.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,10,11,0.36)] p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border bg-white p-6 md:p-7"
            style={{ borderColor: "rgba(10,10,11,0.10)", boxShadow: "0 24px 48px -12px rgba(10,10,11,0.25)" }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="vl-eyebrow">Square</p>
                <h2 className="text-[22px] font-semibold tracking-tight mt-1" style={{ color: "var(--color-vl-ink)" }}>
                  Choose a location
                </h2>
                <p className="mt-1 text-[13px]" style={{ color: "rgba(10,10,11,0.55)" }}>
                  Pick the venue this assistant will control.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowLocationPicker(false);
                  setOauthToken(null);
                  setLocations([]);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{
                  color: "rgba(10,10,11,0.45)",
                  background: "rgba(10, 10, 11,0.04)",
                  border: "1px solid rgba(10, 10, 11,0.08)",
                }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(loc)}
                  disabled={saveVenue.isPending}
                  className="flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[rgba(124,110,245,0.4)] disabled:opacity-50"
                  style={{ borderColor: "rgba(10,10,11,0.08)" }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "var(--color-vl-ink)" }}>{loc.name}</p>
                    {loc.address && (
                      <p className="mt-0.5 text-[11.5px] truncate" style={{ color: "rgba(10,10,11,0.45)" }}>
                        {loc.address}
                      </p>
                    )}
                  </div>
                  {saveVenue.isPending && <Loader2 className="ml-auto h-4 w-4 animate-spin" style={{ color: "var(--color-vl-coral)" }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const UPCOMING_INTEGRATIONS = [
  { id: "toast", name: "Toast", description: "Restaurant POS, kitchen display, tabs." },
  { id: "clover", name: "Clover", description: "Clover Station, Mini, and Flex." },
  { id: "lightspeed", name: "Lightspeed", description: "Retail and Restaurant K-Series." },
  { id: "shopify_pos", name: "Shopify POS", description: "Unified in-store and online." },
  { id: "revel", name: "Revel", description: "Enterprise iPad POS for QSR." },
  { id: "custom", name: "Custom API", description: "Bring your own system via webhook." },
] as const;
