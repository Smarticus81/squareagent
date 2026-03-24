import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues, useSaveVenue, useDeleteVenue, useSquareLocations, type SquareLocation } from "@/hooks/use-venues";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  AlertCircle,
  Trash2,
  MapPin,
  Loader2,
  ShoppingCart,
  Package,
  Settings,
  CreditCard,
} from "lucide-react";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading, error, isFetching } = useAuth();
  const { data: venues, isLoading: venuesLoading } = useVenues();
  const saveVenue = useSaveVenue();
  const deleteVenue = useDeleteVenue();
  const fetchLocations = useSquareLocations();

  // OAuth + location selection state
  const [oauthToken, setOauthToken] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Only redirect if the query has fully settled (not loading AND not refetching)
    // This prevents a race where stale cached null data triggers a premature redirect
    if (!isLoading && !isFetching && !auth?.user) {
      setLocation("/login");
    }
  }, [isLoading, isFetching, auth, setLocation]);

  // ── Handle OAuth redirect return (standalone PWA or redirect flow) ──────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthTs = params.get("oauth_ts");
    const oauthError = params.get("oauth_error");

    if (!oauthTs && !oauthError) return;

    // Clean URL params
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

  // ── Square OAuth popup flow ───────────────────────────────────────────────

  const handleConnectSquare = useCallback(async () => {
    // Detect standalone/homescreen PWA — popup flow won't work there
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as any).standalone;

    if (isStandalone) {
      // Full-page redirect flow — callback will redirect back with oauth_ts param
      window.location.href = "/api/square/oauth/authorize?mode=redirect&return_url=/";
      return;
    }

    setConnecting(true);
    try {
      // 1. Get the OAuth URL from our API
      const res = await fetch("/api/square/oauth/authorize");
      const { url, state } = await res.json();
      if (!url) throw new Error("Failed to get OAuth URL");

      // 2. Open popup
      const w = 500, h = 700;
      const left = window.screenX + (window.innerWidth - w) / 2;
      const top = window.screenY + (window.innerHeight - h) / 2;
      const popup = window.open(url, "square-oauth", `width=${w},height=${h},left=${left},top=${top}`);

      if (!popup) throw new Error("Popup was blocked. Please allow popups for this site and try again.");

      // Clear any stale OAuth result from a previous attempt
      localStorage.removeItem("bevpro_oauth_result");

      // 3. Wait for the popup to signal completion via localStorage or postMessage.
      //    Modern browsers sever window.opener on cross-origin navigation (Square OAuth),
      //    so localStorage is the primary channel; postMessage is a fallback.
      const tokenState = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("OAuth timed out"));
        }, 5 * 60 * 1000);

        function cleanup() {
          clearTimeout(timeout);
          clearInterval(pollInterval);
          window.removeEventListener("message", handler);
        }

        function handleResult(data: { type: string; tokenState?: string; error?: string }) {
          if (settled) return;
          if (data.type === "square-oauth-success" && data.tokenState) {
            settled = true;
            cleanup();
            localStorage.removeItem("bevpro_oauth_result");
            resolve(data.tokenState);
          } else if (data.type === "square-oauth-error") {
            settled = true;
            cleanup();
            localStorage.removeItem("bevpro_oauth_result");
            reject(new Error(data.error || "OAuth failed"));
          }
        }

        // Channel 1: postMessage (works if window.opener survived)
        function handler(event: MessageEvent) {
          if (event.data?.type?.startsWith("square-oauth-")) {
            handleResult(event.data);
          }
        }
        window.addEventListener("message", handler);

        // Channel 2: poll localStorage (primary — always works for same-origin callback)
        // Also detect popup close, but give it a grace period to write localStorage first
        let popupClosedAt: number | null = null;
        const pollInterval = setInterval(() => {
          if (settled) return;

          // Check localStorage for the OAuth result
          const stored = localStorage.getItem("bevpro_oauth_result");
          if (stored) {
            try {
              handleResult(JSON.parse(stored));
              return;
            } catch {}
          }

          // If popup is closed, wait up to 2s for localStorage to be written
          // (the callback page writes localStorage then closes after 1.5s)
          if (popup.closed) {
            if (!popupClosedAt) {
              popupClosedAt = Date.now();
            } else if (Date.now() - popupClosedAt > 2000) {
              // Popup closed and no result appeared — user likely closed it manually
              settled = true;
              cleanup();
              localStorage.removeItem("bevpro_oauth_result");
              reject(new Error("Popup closed without completing authorization"));
            }
          }
        }, 300);
      });

      // 4. Exchange tokenState for access token
      const tokenRes = await fetch(`/api/square/oauth/token?ts=${encodeURIComponent(tokenState)}`);
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error || "Failed to get token");

      setOauthToken(tokenData.token);
      setOauthMerchantId(tokenData.merchantId || null);

      // 5. Fetch locations for the user to pick from
      const locs = await fetchLocations.mutateAsync(tokenData.token);
      setLocations(locs);
      setShowLocationPicker(true);
    } catch (e: any) {
      console.error("Square OAuth error:", e);
      alert(e.message || "Failed to connect Square");
    } finally {
      setConnecting(false);
    }
  }, [fetchLocations]);

  // ── Save selected location ────────────────────────────────────────────────

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
        // Reset OAuth state
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

  // ── Disconnect venue ──────────────────────────────────────────────────────

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

  // ── Helpers ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="w-5 h-5 border border-foreground/20 border-t-foreground/60 rounded-full animate-spin"></div>
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
  // Voice agent is served at /agent/ by the same Express server in production.
  // Only use a separate port for local development (localhost/127.0.0.1).
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
  const canUsePOS = !trialExpired && (plan === "trial" || plan === "pos_only" || plan === "complete") && (subStatus === "trialing" || subStatus === "active");
  const canUseInventory = !trialExpired && (plan === "trial" || plan === "inventory_only" || plan === "complete") && (subStatus === "trialing" || subStatus === "active");

  const handleManageSubscription = async () => {
    try {
      const token = localStorage.getItem("bevpro_token") || "";
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
    <div className="flex-1 bg-background text-foreground">
      <div className="max-w-3xl w-full mx-auto px-6 py-12 pt-28">
        {/* Header */}
        <div className="mb-14">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-display font-medium tracking-tight text-foreground">
              {auth.user.name.split(" ")[0]}
            </h1>
            <button
              onClick={() => setLocation("/account")}
              className="text-[13px] text-foreground/35 hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <Settings className="w-3.5 h-3.5" />
              Account
            </button>
          </div>
          <p className="text-foreground/40 font-light text-[14px] mt-1">Manage your venue and voice agent</p>

          {auth.subscription?.status === "trialing" && (
            <p className="text-[12px] text-foreground/35 mt-3 tracking-wide">
              Trial &middot; {getTrialDaysLeft()} days remaining
            </p>
          )}
        </div>

        {/* ── Location Picker Modal ──────────────────────────────────── */}
        {showLocationPicker && locations.length > 0 && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-background border border-foreground/10 max-w-md w-full p-8">
              <h2 className="text-lg font-display font-medium mb-1">Select a location</h2>
              <p className="text-[13px] text-foreground/40 font-light mb-6">
                Choose the Square location to connect.
              </p>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {locations.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => handleSelectLocation(loc)}
                    disabled={saveVenue.isPending}
                    className="w-full text-left p-4 border border-foreground/8 hover:border-foreground/20 transition-colors flex items-start gap-3 disabled:opacity-50"
                  >
                    <MapPin className="w-4 h-4 mt-0.5 text-foreground/30 shrink-0" />
                    <div>
                      <div className="text-[14px] font-medium">{loc.name}</div>
                      {loc.address && <div className="text-[12px] text-foreground/40 mt-0.5">{loc.address}</div>}
                    </div>
                  </button>
                ))}
              </div>
              <button
                className="w-full mt-4 text-[13px] text-foreground/40 hover:text-foreground transition-colors py-2"
                onClick={() => {
                  setShowLocationPicker(false);
                  setOauthToken(null);
                  setLocations([]);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Cards ──────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Square Integration */}
          <div className="border border-foreground/8 p-8">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30 mb-2">Square POS</p>
                <p className="text-[14px] font-light text-foreground/50">
                  {isSquareConnected ? (
                    <>Connected &mdash; {primaryVenue!.squareLocationName}</>
                  ) : (
                    "Not connected"
                  )}
                </p>
              </div>
              {isSquareConnected && (
                <span className="w-2 h-2 bg-foreground/60 rounded-full mt-1"></span>
              )}
            </div>

            <div className="space-y-2.5 mb-8">
              <div className="flex items-center gap-2.5 text-[13px] text-foreground/50 font-light">
                <span className={`w-1 h-1 rounded-full ${isSquareConnected ? "bg-foreground/50" : "bg-foreground/15"}`}></span>
                Menu catalog sync
              </div>
              <div className="flex items-center gap-2.5 text-[13px] text-foreground/50 font-light">
                <span className={`w-1 h-1 rounded-full ${isSquareConnected ? "bg-foreground/50" : "bg-foreground/15"}`}></span>
                Order creation &amp; payments
              </div>
              {isSquareConnected && primaryVenue?.connectedAt && (
                <p className="text-[11px] text-foreground/25 mt-2">
                  Connected {new Date(primaryVenue.connectedAt).toLocaleDateString()}
                </p>
              )}
            </div>

            {isSquareConnected ? (
              <button
                className="text-[13px] text-foreground/35 hover:text-destructive transition-colors flex items-center gap-1.5"
                onClick={() => handleDisconnect(primaryVenue!.id)}
                disabled={deleteVenue.isPending}
              >
                {deleteVenue.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Disconnect
              </button>
            ) : (
              <Button
                className="h-10 px-7 text-[13px]"
                onClick={handleConnectSquare}
                disabled={connecting}
              >
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
                Connect Square
              </Button>
            )}
          </div>

          {/* POS Voice Agent */}
          <div className={`border p-8 ${canUsePOS ? "border-foreground/8" : "border-foreground/5 opacity-60"}`}>
            <div className="flex items-start gap-3 mb-2">
              <ShoppingCart className="w-4 h-4 mt-0.5 text-foreground/30 shrink-0" />
              <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30">POS Agent</p>
            </div>
            <p className="text-[14px] text-foreground/50 font-light mb-8 leading-relaxed max-w-lg">
              {!canUsePOS
                ? (trialExpired ? "Trial expired. Subscribe to use voice ordering." : "Your plan doesn't include POS. Upgrade to enable it.")
                : isSquareConnected
                  ? "Bartender-facing voice ordering. Take orders, check stock, and process payments hands-free."
                  : "Connect Square first to enable voice ordering."}
            </p>

            <Button
              className="h-10 px-7 text-[13px] group"
              disabled={!isSquareConnected || !canUsePOS}
              onClick={async () => {
                if (!isSquareConnected || !primaryVenue) return;
                try {
                  const token = localStorage.getItem("bevpro_token") || "";
                  const res = await fetch("/api/auth/exchange/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ venueId: primaryVenue.id }),
                  });
                  if (!res.ok) throw new Error("Failed to create exchange code");
                  const { code } = await res.json();
                  const url = `${voiceAgentBaseUrl}pos?code=${encodeURIComponent(code)}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (e) {
                  console.error("Failed to launch POS agent:", e);
                }
              }}
            >
              {canUsePOS ? "Launch POS Agent" : "Upgrade to unlock"}
              <ExternalLink className="ml-2 w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Inventory Agent */}
          <div className={`border p-8 ${canUseInventory ? "border-foreground/8" : "border-foreground/5 opacity-60"}`}>
            <div className="flex items-start gap-3 mb-2">
              <Package className="w-4 h-4 mt-0.5 text-foreground/30 shrink-0" />
              <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30">Inventory Agent</p>
            </div>
            <p className="text-[14px] text-foreground/50 font-light mb-8 leading-relaxed max-w-lg">
              {!canUseInventory
                ? (trialExpired ? "Trial expired. Subscribe to manage inventory." : "Your plan doesn't include Inventory. Upgrade to enable it.")
                : isSquareConnected
                  ? "Staff inventory management. Check stock levels, adjust counts, and get low-stock alerts by voice."
                  : "Connect Square first to enable inventory management."}
            </p>

            <Button
              className="h-10 px-7 text-[13px] group"
              disabled={!isSquareConnected || !canUseInventory}
              onClick={async () => {
                if (!isSquareConnected || !primaryVenue) return;
                try {
                  const token = localStorage.getItem("bevpro_token") || "";
                  const res = await fetch("/api/auth/exchange/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ venueId: primaryVenue.id }),
                  });
                  if (!res.ok) throw new Error("Failed to create exchange code");
                  const { code } = await res.json();
                  const url = `${voiceAgentBaseUrl}inventory?code=${encodeURIComponent(code)}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (e) {
                  console.error("Failed to launch Inventory agent:", e);
                }
              }}
            >
              {canUseInventory ? "Launch Inventory Agent" : "Upgrade to unlock"}
              <ExternalLink className="ml-2 w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Subscription & Billing */}
          <div className="border border-foreground/8 p-8">
            <div className="flex items-start gap-3 mb-2">
              <CreditCard className="w-4 h-4 mt-0.5 text-foreground/30 shrink-0" />
              <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30">Subscription</p>
            </div>
            <p className="text-[14px] text-foreground/50 font-light mb-4 leading-relaxed">
              {subStatus === "trialing" && !trialExpired && (
                <>Free trial &middot; {getTrialDaysLeft()} days remaining</>
              )}
              {trialExpired && "Trial expired — subscribe to continue"}
              {subStatus === "active" && (
                <>{plan === "complete" ? "Complete" : plan === "pos_only" ? "POS Only" : plan === "inventory_only" ? "Inventory Only" : plan} plan &middot; Active</>
              )}
              {subStatus === "canceled" && "Subscription canceled"}
            </p>

            {auth.subscription?.status === "active" ? (
              <Button variant="outline" className="h-10 px-7 text-[13px]" onClick={handleManageSubscription}>
                <Settings className="w-3.5 h-3.5 mr-2" />
                Manage billing
              </Button>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <Button className="h-10 px-6 text-[13px]" onClick={() => window.location.href = "/#pricing"}>
                  View plans
                </Button>
              </div>
            )}
          </div>

          {/* iOS App */}
          <div className="border border-foreground/8 p-8">
            <p className="text-[12px] tracking-[0.15em] uppercase text-foreground/30 mb-2">iOS App</p>
            <p className="text-[14px] text-foreground/50 font-light mb-6 leading-relaxed max-w-lg">
              Native app for iPad and iPhone. Sign in and your Square connection syncs automatically.
            </p>
            <p className="text-[12px] text-foreground/25 tracking-wide">Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}