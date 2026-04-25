import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  useVenues,
  useSaveVenue,
  useDeleteVenue,
  useSquareLocations,
  type SquareLocation,
} from "@/hooks/use-venues";
import { connectedProviders } from "@/lib/tokens";
import { Loader2, Trash2, ExternalLink, MapPin, X } from "lucide-react";

export default function ConnectedServices() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();
  const { data: venues, isLoading: venuesLoading } = useVenues();
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

  if (isLoading || venuesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  return (
    <div className="flex-1 pt-24 pb-24">
      <div className="w-full max-w-[1200px] mx-auto px-6 lg:px-10">
        <div className="mb-10">
          <p className="vl-eyebrow">Connected services</p>
          <h1 className="vl-display text-[40px] md:text-[56px] mt-3" style={{ color: "var(--color-vl-ivory)" }}>
            Bolt onto your stack.
          </h1>
          <p className="mt-3 text-[15px] max-w-2xl" style={{ color: "rgba(245,239,227,0.6)" }}>
            VoyceLab does not replace your POS or inventory system. It controls them by voice. Connect Square to start.
          </p>
        </div>

        {errorMsg && (
          <div className="vl-panel p-4 mb-6 text-[13px]" style={{ color: "var(--color-vl-danger)" }}>
            {errorMsg}
          </div>
        )}

        {/* Connected venues */}
        <section className="mb-10">
          <p className="vl-eyebrow mb-3">Live</p>
          <div className="vl-panel divide-y divide-white/[0.05]">
            {(venues ?? []).length === 0 ? (
              <div className="p-8 flex items-center justify-between">
                <div>
                  <p className="text-[16px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
                    No services connected yet.
                  </p>
                  <p className="text-[13px] mt-1" style={{ color: "rgba(245,239,227,0.55)" }}>
                    Connect Square to give your agent something to control.
                  </p>
                </div>
                <button onClick={handleConnectSquare} disabled={connecting} className="vl-btn-primary inline-flex items-center gap-2">
                  {connecting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Connect Square
                </button>
              </div>
            ) : (
              (venues ?? []).map((v) => (
                <div key={v.id} className="px-6 py-5 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>
                        Square
                      </span>
                      <span
                        className="vl-chip"
                        style={{ color: "var(--color-vl-success)", borderColor: "rgba(53,194,117,0.4)", fontSize: 10 }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-vl-success)" }} />
                        Live
                      </span>
                    </div>
                    <p className="text-[13px] mt-0.5" style={{ color: "rgba(245,239,227,0.6)" }}>
                      {v.squareLocationName ?? v.name ?? `Venue ${v.id}`}
                    </p>
                    {v.connectedAt && (
                      <p className="text-[11px] mt-0.5" style={{ color: "rgba(245,239,227,0.4)" }}>
                        Connected {new Date(v.connectedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteVenue.mutate(v.id)}
                    disabled={deleteVenue.isPending}
                    className="vl-btn-ghost inline-flex items-center gap-2 text-[12px]"
                    style={{ color: "var(--color-vl-danger)" }}
                  >
                    {deleteVenue.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>
          {(venues ?? []).length > 0 && (
            <div className="mt-3">
              <button onClick={handleConnectSquare} disabled={connecting} className="vl-btn-ghost inline-flex items-center gap-2 text-[13px]">
                {connecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Add another Square location
              </button>
            </div>
          )}
        </section>

        {/* Other providers — request access */}
        <section>
          <p className="vl-eyebrow mb-3">Request access</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {connectedProviders.filter((p) => p.status !== "live").map((p) => (
              <div key={p.id} className="vl-panel p-5" style={{ opacity: 0.78 }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{p.name}</span>
                  <span className="vl-chip" style={{ fontSize: 10, color: "rgba(245,239,227,0.5)" }}>Request access</span>
                </div>
                <p className="text-[12px]" style={{ color: "rgba(245,239,227,0.55)" }}>{p.description}</p>
                <a
                  href={`mailto:hello@voycelab.com?subject=Connector%20request%3A%20${encodeURIComponent(p.name)}`}
                  className="mt-3 inline-flex items-center gap-1 text-[12px]"
                  style={{ color: "var(--color-vl-brass2)" }}
                >
                  Request <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Location picker modal */}
      {showLocationPicker && locations.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full vl-panel vl-edge-brass p-7">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="vl-eyebrow">Connect Square</p>
                <h2 className="text-[20px] font-semibold mt-1" style={{ color: "var(--color-vl-ivory)" }}>
                  Choose a location
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowLocationPicker(false);
                  setOauthToken(null);
                  setLocations([]);
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(loc)}
                  disabled={saveVenue.isPending}
                  className="w-full text-left vl-panel p-4 flex items-start gap-3 disabled:opacity-50 transition-all hover:-translate-y-0.5"
                >
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--color-vl-brass2)" }} />
                  <div>
                    <p className="text-[14px] font-semibold" style={{ color: "var(--color-vl-ivory)" }}>{loc.name}</p>
                    {loc.address && (
                      <p className="text-[12px] mt-0.5" style={{ color: "rgba(245,239,227,0.55)" }}>
                        {loc.address}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
