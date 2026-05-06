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
import { connectedServices } from "@/lib/tokens";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
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

  // Capture OAuth callback (return_url=/services)
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

  return (
    <div className="relative flex-1 overflow-hidden px-4 pb-24 pt-16 sm:px-6 lg:px-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-[-12%] top-[-12%] h-[360px] w-[520px] rounded-full blur-3xl"
          style={{ background: "rgba(255, 201, 168, 0.42)" }}
        />
        <div
          className="absolute right-[-10%] top-[5%] h-[420px] w-[520px] rounded-full blur-3xl"
          style={{ background: "rgba(199, 183, 229, 0.30)" }}
        />
        <div
          className="absolute bottom-[-18%] right-[8%] h-[420px] w-[640px] rounded-full blur-3xl"
          style={{ background: "rgba(156, 201, 161, 0.26)" }}
        />
      </div>

      <div className="mx-auto w-full max-w-[1180px]">
        <Link
          href="/command"
          className="inline-flex items-center gap-1.5 text-[12px] mb-5 transition-colors"
          style={{ color: "var(--color-vl-ink-muted)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Console
        </Link>
        <div className="mb-9 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <p className="vl-eyebrow">Connected services</p>
            <h1 className="vl-display mt-4 max-w-[680px] text-[42px] md:text-[62px]" style={{ color: "var(--color-vl-ink)" }}>
              Connect the systems your team already trusts.
            </h1>
            <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
              Start with Square, then bring the rest of your venue stack into voice. Your assistant can read, prepare, and act only where you allow it.
            </p>
          </div>

          <div className="vl-card-glass p-5">
            <div className="flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, var(--color-vl-coral-tint), #fff)",
                  color: "var(--color-vl-coral-deep)",
                  border: "1px solid rgba(255,107,71,0.16)",
                }}
              >
                <PlugZap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                  Live voice actions
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Square powers menu lookup, order workflows, inventory checks, and reporting.
                </p>
              </div>
            </div>
          </div>
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
            Venue service unavailable: {venuesError.message}
          </div>
        )}

        {/* Connected venues */}
        <section className="mb-12">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="vl-eyebrow">Live connections</p>
              <p className="mt-2 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                Active systems your assistants can use right now.
              </p>
            </div>
            {(venues ?? []).length > 0 && (
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

          <div className="vl-card-glass overflow-hidden">
            {(venues ?? []).length === 0 ? (
              <div className="flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between md:p-8">
                <div>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}>
                    <Store className="h-5 w-5" />
                  </div>
                  <p className="text-[18px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                    Connect Square first.
                  </p>
                  <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>
                    Choose the Square location your assistant will control. You can add more locations later.
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
                <div key={v.id} className="grid gap-4 border-b border-[rgba(14,27,44,0.06)] p-5 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center md:p-6">
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px]"
                      style={{
                        background: "linear-gradient(135deg, #FFFFFF, var(--color-vl-coral-tint))",
                        border: "1px solid rgba(255,107,71,0.18)",
                        color: "var(--color-vl-coral-deep)",
                      }}
                    >
                      <Store className="h-6 w-6" />
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[16px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>
                          Square
                        </span>
                        <span
                          className="vl-chip"
                          style={{
                            color: "var(--color-vl-success)",
                            borderColor: "rgba(47,158,100,0.20)",
                            background: "rgba(47,158,100,0.08)",
                            fontSize: 11,
                          }}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Live
                        </span>
                      </div>
                      <p className="mt-1 text-[14px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                        {v.squareLocationName ?? v.name ?? `Venue ${v.id}`}
                      </p>
                      {v.connectedAt && (
                        <p className="mt-1 text-[12px]" style={{ color: "var(--color-vl-ink-faint)" }}>
                          Connected {new Date(v.connectedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteVenue.mutate(v.id)}
                    disabled={deleteVenue.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-60"
                    style={{
                      color: "var(--color-vl-danger)",
                      background: "rgba(215, 64, 46, 0.06)",
                      borderColor: "rgba(215, 64, 46, 0.16)",
                    }}
                  >
                    {deleteVenue.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>
          {(venues ?? []).length > 0 && (
            <div className="mt-4 sm:hidden">
              <button onClick={handleConnectSquare} disabled={connecting} className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-[13px]">
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add another Square location
              </button>
            </div>
          )}
        </section>

        {/* Other providers — request access */}
        <section>
          <div className="mb-4">
            <p className="vl-eyebrow">Request access</p>
            <p className="mt-2 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
              Tell us what you want to connect next. We will prioritize your venue’s stack.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {connectedServices.filter((p: typeof connectedServices[number]) => p.status !== "live").map((p: typeof connectedServices[number]) => (
              <div key={p.id} className="vl-card group relative overflow-hidden p-5">
                <div
                  aria-hidden
                  className="absolute right-[-40px] top-[-50px] h-28 w-28 rounded-full transition-transform duration-300 group-hover:scale-125"
                  style={{ background: "rgba(255, 201, 168, 0.28)" }}
                />
                <div className="relative flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{p.name}</span>
                    <p className="mt-2 min-h-[36px] text-[12.5px] leading-relaxed" style={{ color: "var(--color-vl-ink-muted)" }}>{p.description}</p>
                  </div>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(14,27,44,0.04)",
                      color: "var(--color-vl-ink-muted)",
                      border: "1px solid rgba(14,27,44,0.08)",
                    }}
                  >
                    <PlugZap className="h-4 w-4" />
                  </span>
                </div>
                <a
                  href={`mailto:hello@voycelab.com?subject=Connector%20request%3A%20${encodeURIComponent(p.name)}`}
                  className="relative mt-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
                  style={{
                    color: "var(--color-vl-coral-deep)",
                    background: "var(--color-vl-coral-tint)",
                    border: "1px solid rgba(255,107,71,0.18)",
                  }}
                >
                  Request connector <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Location picker modal */}
      {showLocationPicker && locations.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,27,44,0.36)] p-4 backdrop-blur-sm">
          <div className="vl-card-glass w-full max-w-[520px] p-6 md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="vl-eyebrow">Connect Square</p>
                <h2 className="vl-display mt-2 text-[30px]" style={{ color: "var(--color-vl-ink)" }}>
                  Choose a location
                </h2>
                <p className="mt-2 text-[13px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                  Pick the venue this assistant should control.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowLocationPicker(false);
                  setOauthToken(null);
                  setLocations([]);
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{
                  color: "var(--color-vl-ink-muted)",
                  background: "rgba(14,27,44,0.04)",
                  border: "1px solid rgba(14,27,44,0.08)",
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(loc)}
                  disabled={saveVenue.isPending}
                  className="vl-card flex w-full items-start gap-3 p-4 text-left transition-all hover:-translate-y-0.5 disabled:opacity-50"
                >
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--color-vl-coral-tint)", color: "var(--color-vl-coral-deep)" }}
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ink)" }}>{loc.name}</p>
                    {loc.address && (
                      <p className="mt-1 text-[12px]" style={{ color: "var(--color-vl-ink-muted)" }}>
                        {loc.address}
                      </p>
                    )}
                  </div>
                  {saveVenue.isPending && <Loader2 className="ml-auto mt-2 h-4 w-4 animate-spin" style={{ color: "var(--color-vl-coral)" }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
