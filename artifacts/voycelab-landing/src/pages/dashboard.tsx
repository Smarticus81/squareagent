import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { useVenues, useSaveVenue, useDeleteVenue, useSquareLocations, type SquareLocation } from "@/hooks/use-venues";
import {
  ExternalLink,
  AlertCircle,
  Trash2,
  MapPin,
  Loader2,
  ShoppingCart,
  Settings,
  CreditCard,
  LogOut,
  Smartphone,
  Share,
  PlusSquare,
  X,
} from "lucide-react";

/* ── Design tokens ────────────────────────────────────────────── */
const bg = "#F7F7F8";
const card = "#FFFFFF";
const text = "#111827";
const muted = "#6B7280";
const border = "#E5E7EB";
const primary = "#2563EB";
const primaryDark = "#1D4ED8";
const destructive = "#EF4444";
const neuShadow = "6px 6px 12px rgba(0,0,0,0.05), -6px -6px 12px rgba(255,255,255,0.9)";
const neuInset = "inset 2px 2px 4px rgba(0,0,0,0.04), inset -2px -2px 4px rgba(255,255,255,0.7)";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, error, isFetching } = useAuth();
  const logout = useLogout();
  const { data: venues, isLoading: venuesLoading } = useVenues();
  const saveVenue = useSaveVenue();
  const deleteVenue = useDeleteVenue();
  const fetchLocations = useSquareLocations();

  const [oauthToken, setOauthToken] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!isLoading && !isFetching && !auth?.user) {
      setLocation("/login");
    }
  }, [isLoading, isFetching, auth, setLocation]);

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
      alert(`Square authorization failed: ${oauthError}`);
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
        } catch (e: any) {
          console.error("Square OAuth redirect error:", e);
          alert(e.message || "Failed to connect Square");
        } finally {
          setConnecting(false);
        }
      })();
    }
  }, [fetchLocations]);

  const handleConnectSquare = useCallback(() => {
    setConnecting(true);
    window.location.href = "/api/square/oauth/authorize?mode=redirect&return_url=/dashboard";
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
      } catch (e: any) {
        alert(e.message || "Failed to save location");
      }
    },
    [oauthToken, oauthMerchantId, saveVenue]
  );

  const handleDisconnect = useCallback(
    async (venueId: number) => {
      if (!confirm("Disconnect this venue from Square? Voice orders will stop working until reconnected.")) return;
      try {
        await deleteVenue.mutateAsync(venueId);
      } catch (e: any) {
        alert(e.message || "Failed to disconnect");
      }
    },
    [deleteVenue]
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: bg }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: primary }} />
      </div>
    );
  }

  if (!auth?.user) return null;

  const primaryVenue = (venues ?? []).slice().sort((left, right) => {
    const leftTs = new Date(left.connectedAt ?? 0).getTime();
    const rightTs = new Date(right.connectedAt ?? 0).getTime();
    return rightTs - leftTs;
  })[0] ?? null;
  const isSquareConnected = !!primaryVenue?.squareLocationId;
  const isLocalDev = !import.meta.env.PROD &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const voiceAgentBaseUrl = isLocalDev
    ? `${window.location.protocol}//${window.location.hostname}:8081/`
    : `${window.location.origin}/agent/`;

  const getTrialDaysLeft = () => {
    if (!auth.subscription?.trialEndsAt) return 0;
    const end = new Date(auth.subscription.trialEndsAt);
    const now = new Date();
    const diffTime = Math.abs(end.getTime() - now.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const plan = auth.subscription?.plan ?? "trial";
  const subStatus = auth.subscription?.status ?? "trialing";
  const trialExpired = subStatus === "trialing" && auth.subscription?.trialEndsAt && new Date(auth.subscription.trialEndsAt) < new Date();
  const canUseAgent = !trialExpired && (subStatus === "trialing" || subStatus === "active");

  const handleManageSubscription = async () => {
    try {
      const token = localStorage.getItem("voycelab_token") || "";
      const res = await fetch("/api/subscriptions/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to open billing portal");
      const { url } = await res.json();
      window.location.href = url;
    } catch (e: any) {
      alert(e.message || "Failed to open billing portal");
    }
  };

  return (
    <div className="flex-1" style={{ backgroundColor: bg, color: text }}>
      <div className="w-full max-w-[1200px] mx-auto px-6 lg:px-10 py-12 pt-28">

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: text }}>
              {auth.user.name.split(" ")[0]}
            </h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLocation("/account")}
                className="text-[13px] font-medium flex items-center gap-1.5 px-4 py-2 rounded-xl transition-colors hover:bg-black/[0.04]"
                style={{ color: muted }}
              >
                <Settings className="w-3.5 h-3.5" />
                Account
              </button>
              <button
                onClick={() => logout.mutate()}
                className="text-[13px] font-medium flex items-center gap-1.5 px-4 py-2 rounded-xl transition-colors hover:bg-[#2563EB]/5"
                style={{ color: primary }}
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
          <p className="text-[14px] mt-1" style={{ color: muted }}>Manage your venue and voice agent</p>
          {auth.subscription?.status === "trialing" && (
            <p className="text-[12px] mt-3 tracking-wide" style={{ color: "#9CA3AF" }}>
              Trial &middot; {getTrialDaysLeft()} days remaining
            </p>
          )}
        </div>

        {/* Location Picker Modal */}
        {showLocationPicker && locations.length > 0 && (
          <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
            <div
              className="max-w-md w-full rounded-2xl p-8"
              style={{ backgroundColor: card, boxShadow: "0 25px 60px rgba(0,0,0,0.15)" }}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold" style={{ color: text }}>Select a location</h2>
                  <p className="text-[13px] mt-1" style={{ color: muted }}>
                    Choose the Square location to connect.
                  </p>
                </div>
                <button
                  onClick={() => { setShowLocationPicker(false); setOauthToken(null); setLocations([]); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/[0.04] transition-colors"
                >
                  <X className="w-4 h-4" style={{ color: muted }} />
                </button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {locations.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => handleSelectLocation(loc)}
                    disabled={saveVenue.isPending}
                    className="w-full text-left p-4 rounded-xl flex items-start gap-3 disabled:opacity-50 transition-all hover:-translate-y-0.5"
                    style={{ backgroundColor: bg, boxShadow: neuShadow }}
                  >
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: primary }} />
                    <div>
                      <div className="text-[14px] font-semibold" style={{ color: text }}>{loc.name}</div>
                      {loc.address && <div className="text-[12px] mt-0.5" style={{ color: muted }}>{loc.address}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Cards grid */}
        <div className="grid lg:grid-cols-2 gap-6">

          {/* POS Integrations — spans full width */}
          <div
            className="lg:col-span-2 rounded-2xl p-8"
            style={{ backgroundColor: card, boxShadow: neuShadow }}
          >
            <div className="mb-6">
              <p className="text-[11px] font-bold tracking-[0.15em] uppercase mb-2" style={{ color: "#9CA3AF" }}>
                POS Integrations
              </p>
              <p className="text-[14px]" style={{ color: muted }}>
                Connect the point-of-sale that powers your venue.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Square — live */}
              <div
                className="rounded-xl p-5 transition-all"
                style={{
                  backgroundColor: isSquareConnected ? `${primary}08` : bg,
                  boxShadow: neuInset,
                  border: isSquareConnected ? `1px solid ${primary}30` : `1px solid ${border}`,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5" style={{ color: text }} viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M10 0C4.477 0 0 4.477 0 10v44c0 5.523 4.477 10 10 10h44c5.523 0 10-4.477 10-10V10c0-5.523-4.477-10-10-10H10zm30.5 16h-17C20.462 16 18 18.462 18 21.5v17c0 3.038 2.462 5.5 5.5 5.5h17c3.038 0 5.5-2.462 5.5-5.5v-17c0-3.038-2.462-5.5-5.5-5.5zM38 34a4 4 0 01-4 4H30a4 4 0 01-4-4v-4a4 4 0 014-4h4a4 4 0 014 4v4z" />
                    </svg>
                    <span className="text-[14px] font-semibold" style={{ color: text }}>Square</span>
                  </div>
                  {isSquareConnected && (
                    <span className="text-[10px] font-bold tracking-wider uppercase flex items-center gap-1.5" style={{ color: primary }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primary }} />
                      Live
                    </span>
                  )}
                </div>
                <p className="text-[12px] mb-4 leading-relaxed" style={{ color: muted }}>
                  {isSquareConnected
                    ? primaryVenue!.squareLocationName
                    : "Full bi-directional sync: catalog, orders, inventory, payments."}
                </p>
                {isSquareConnected ? (
                  <button
                    className="text-[12px] font-medium flex items-center gap-1.5 transition-colors"
                    style={{ color: "#9CA3AF" }}
                    onClick={() => handleDisconnect(primaryVenue!.id)}
                    disabled={deleteVenue.isPending}
                    onMouseEnter={(e) => (e.currentTarget.style.color = destructive)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#9CA3AF")}
                  >
                    {deleteVenue.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="h-9 px-5 rounded-xl text-[12px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20"
                    style={{ backgroundColor: primary }}
                    onClick={handleConnectSquare}
                    disabled={connecting}
                  >
                    {connecting ? <Loader2 className="w-3 h-3 animate-spin mr-2 inline" /> : null}
                    Connect
                  </button>
                )}
              </div>

              {/* Coming-soon providers */}
              {[
                { name: "Toast", desc: "Restaurant POS with kitchen display & tabs." },
                { name: "Clover", desc: "Clover Station, Mini, and Flex (Fiserv)." },
                { name: "Lightspeed", desc: "Lightspeed Retail & Restaurant (K-Series)." },
                { name: "Shopify POS", desc: "In-store and online unified commerce." },
                { name: "GoDaddy", desc: "Poynt-based countertop & mobile." },
                { name: "Revel", desc: "Enterprise iPad POS for QSR & retail." },
              ].map((p) => (
                <div
                  key={p.name}
                  className="rounded-xl p-5 opacity-70"
                  style={{ backgroundColor: bg, boxShadow: neuInset, border: `1px solid ${border}` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: `${border}`, color: muted }}
                      >
                        {p.name.slice(0, 1)}
                      </div>
                      <span className="text-[14px] font-semibold" style={{ color: text }}>{p.name}</span>
                    </div>
                    <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "#D1D5DB" }}>
                      Soon
                    </span>
                  </div>
                  <p className="text-[12px] mb-4 leading-relaxed" style={{ color: muted }}>{p.desc}</p>
                  <button
                    className="h-9 px-5 rounded-xl text-[12px] font-medium cursor-not-allowed opacity-50"
                    style={{ backgroundColor: bg, boxShadow: neuShadow, color: muted }}
                    disabled
                  >
                    Join waitlist
                  </button>
                </div>
              ))}
            </div>

            {isSquareConnected && primaryVenue?.connectedAt && (
              <p className="text-[11px] mt-6" style={{ color: "#D1D5DB" }}>
                Square connected {new Date(primaryVenue.connectedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Voice Assistant */}
          <div
            className="rounded-2xl p-8 transition-all"
            style={{
              backgroundColor: card,
              boxShadow: neuShadow,
              opacity: canUseAgent ? 1 : 0.6,
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: bg, boxShadow: neuInset }}
              >
                <ShoppingCart className="w-4 h-4" style={{ color: primary }} />
              </div>
              <p className="text-[11px] font-bold tracking-[0.15em] uppercase" style={{ color: "#9CA3AF" }}>
                Voice Assistant
              </p>
            </div>
            <p className="text-[14px] mb-8 leading-relaxed" style={{ color: muted }}>
              {!canUseAgent
                ? (trialExpired ? "Trial expired. Subscribe to continue." : "Subscribe to enable your voice assistant.")
                : isSquareConnected
                  ? "Voice-powered POS and inventory management. Take orders, check stock, adjust counts — all hands-free."
                  : "Connect Square first to enable your voice assistant."}
            </p>

            <button
              className="h-11 px-8 rounded-xl text-[13px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              style={{ backgroundColor: primary }}
              disabled={!isSquareConnected || !canUseAgent}
              onClick={async () => {
                if (!isSquareConnected || !primaryVenue) return;
                try {
                  const token = localStorage.getItem("voycelab_token") || "";
                  const res = await fetch("/api/auth/exchange/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ venueId: primaryVenue.id }),
                  });
                  if (!res.ok) throw new Error("Failed to create exchange code");
                  const { code } = await res.json();
                  const url = `${voiceAgentBaseUrl}?code=${encodeURIComponent(code)}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (e) {
                  console.error("Failed to launch assistant:", e);
                }
              }}
            >
              {canUseAgent ? "Launch your Assistant" : "Upgrade to unlock"}
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Subscription & Billing */}
          <div
            className="rounded-2xl p-8"
            style={{ backgroundColor: card, boxShadow: neuShadow }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: bg, boxShadow: neuInset }}
              >
                <CreditCard className="w-4 h-4" style={{ color: "#F59E0B" }} />
              </div>
              <p className="text-[11px] font-bold tracking-[0.15em] uppercase" style={{ color: "#9CA3AF" }}>
                Subscription
              </p>
            </div>
            <p className="text-[14px] mb-6 leading-relaxed" style={{ color: muted }}>
              {subStatus === "trialing" && !trialExpired && (
                <>Free trial &middot; {getTrialDaysLeft()} days remaining</>
              )}
              {trialExpired && "Trial expired — subscribe to continue"}
              {subStatus === "active" && (
                <>{plan === "complete" ? "Complete" : plan} plan &middot; Active</>
              )}
              {subStatus === "canceled" && "Subscription canceled"}
            </p>

            {auth.subscription?.status === "active" ? (
              <button
                className="h-11 px-8 rounded-xl text-[13px] font-semibold inline-flex items-center gap-2 transition-all hover:-translate-y-0.5"
                style={{ backgroundColor: bg, boxShadow: neuShadow, color: text }}
                onClick={handleManageSubscription}
              >
                <Settings className="w-3.5 h-3.5" />
                Manage billing
              </button>
            ) : (
              <button
                className="h-11 px-8 rounded-xl text-[13px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5"
                style={{ backgroundColor: primary }}
                onClick={() => window.location.href = "/#pricing"}
              >
                View plans
              </button>
            )}
          </div>

          {/* Add to Home Screen — spans full width */}
          <div
            className="lg:col-span-2 rounded-2xl p-8"
            style={{ backgroundColor: card, boxShadow: neuShadow }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: bg, boxShadow: neuInset }}
              >
                <Smartphone className="w-4 h-4" style={{ color: "#8B5CF6" }} />
              </div>
              <div>
                <p className="text-[11px] font-bold tracking-[0.15em] uppercase" style={{ color: "#9CA3AF" }}>
                  Install App
                </p>
                <p className="text-[14px] mt-0.5" style={{ color: muted }}>
                  Add the voice agent to your home screen for instant access.
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-xl p-6" style={{ backgroundColor: bg, boxShadow: neuInset }}>
                <p className="text-[12px] font-bold tracking-[0.1em] uppercase mb-4" style={{ color: "#9CA3AF" }}>
                  iPhone &amp; iPad (Safari)
                </p>
                <ol className="space-y-3 text-[13px]" style={{ color: muted }}>
                  {[
                    "Launch your assistant above",
                    <>Tap the <Share className="inline w-3.5 h-3.5 -mt-0.5" /> Share button in Safari</>,
                    <>Tap <strong style={{ color: text }}>Add to Home Screen</strong> <PlusSquare className="inline w-3.5 h-3.5 -mt-0.5" /></>,
                    "Open the app from your home screen — it runs fullscreen",
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                        style={{ backgroundColor: `${primary}10`, color: primary }}
                      >
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl p-6" style={{ backgroundColor: bg, boxShadow: neuInset }}>
                <p className="text-[12px] font-bold tracking-[0.1em] uppercase mb-4" style={{ color: "#9CA3AF" }}>
                  Android (Chrome)
                </p>
                <ol className="space-y-3 text-[13px]" style={{ color: muted }}>
                  {[
                    <>Launch the agent, then tap the <strong style={{ color: text }}>&#8942;</strong> menu in Chrome</>,
                    <>Tap <strong style={{ color: text }}>Add to Home screen</strong> or <strong style={{ color: text }}>Install app</strong></>,
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                        style={{ backgroundColor: `${primary}10`, color: primary }}
                      >
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${border}` }}>
                  <p className="text-[12px] leading-relaxed" style={{ color: "#9CA3AF" }}>
                    If the connection to Square expires, open the app and tap the menu &rarr; Settings &rarr; <strong style={{ color: muted }}>Reconnect Square</strong>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
