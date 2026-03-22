import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useVenues, useSaveVenue, useDeleteVenue, useSquareLocations, type SquareLocation } from "@/hooks/use-venues";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  LayoutDashboard,
  Smartphone,
  Trash2,
  MapPin,
  Loader2,
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

  // ── Square OAuth popup flow ───────────────────────────────────────────────

  const handleConnectSquare = useCallback(async () => {
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
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin"></div>
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

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 pt-32">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-16 gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">
              Welcome, {auth.user.name.split(" ")[0]}
            </h1>
            <p className="text-muted-foreground font-light text-lg">Manage your venue and voice agent.</p>
          </div>

          {auth.subscription?.status === "trialing" && (
            <div className="rounded-full border border-border bg-card px-4 py-2 flex items-center gap-3">
              <div className="w-2 h-2 bg-primary"></div>
              <span className="text-sm font-medium text-foreground">
                Trial active &bull; {getTrialDaysLeft()} days left
              </span>
              <Button variant="outline" size="sm" className="ml-2 h-8 rounded-xl border-border">
                Upgrade
              </Button>
            </div>
          )}
        </div>

        {/* ── Location Picker Modal ──────────────────────────────────── */}
        {showLocationPicker && locations.length > 0 && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-card rounded-3xl border border-border max-w-md w-full p-8">
              <h2 className="text-xl font-bold mb-2">Select a Location</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Choose the Square location to connect with Bevpro.
              </p>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {locations.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => handleSelectLocation(loc)}
                    disabled={saveVenue.isPending}
                    className="w-full text-left p-4 rounded-2xl border border-border hover:border-primary hover:bg-primary/5 transition-colors flex items-start gap-3 disabled:opacity-50"
                  >
                    <MapPin className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <div className="font-medium">{loc.name}</div>
                      {loc.address && <div className="text-sm text-muted-foreground mt-0.5">{loc.address}</div>}
                    </div>
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                className="w-full mt-4 rounded-none"
                onClick={() => {
                  setShowLocationPicker(false);
                  setOauthToken(null);
                  setLocations([]);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── Main Cards Grid ────────────────────────────────────────── */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* Square Integration Card */}
          <div className="bg-card rounded-3xl border border-border p-10 flex flex-col">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-12 h-12 bg-foreground rounded-xl flex items-center justify-center">
                <div className="w-5 h-5 bg-foreground relative border-2 border-background rounded-sm">
                  <div className="absolute inset-1 bg-background rounded-[1px]"></div>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Square POS</h2>
                <p className="text-sm text-muted-foreground font-light mt-1">
                  {isSquareConnected ? (
                    <span className="text-primary font-medium">Connected &mdash; {primaryVenue!.squareLocationName}</span>
                  ) : (
                    "Not connected"
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-4 mb-10 flex-1">
              <div className="flex items-center gap-3 text-sm text-foreground font-light">
                {isSquareConnected ? (
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                )}
                Menu catalog sync
              </div>
              <div className="flex items-center gap-3 text-sm text-foreground font-light">
                {isSquareConnected ? (
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                )}
                Order creation &amp; payments
              </div>
              {isSquareConnected && primaryVenue?.connectedAt && (
                <div className="text-xs text-muted-foreground mt-2">
                  Connected {new Date(primaryVenue.connectedAt).toLocaleDateString()}
                </div>
              )}
            </div>

            {isSquareConnected ? (
              <Button
                variant="outline"
                className="w-full rounded-2xl"
                onClick={() => handleDisconnect(primaryVenue!.id)}
                disabled={deleteVenue.isPending}
              >
                {deleteVenue.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Disconnect Square
              </Button>
            ) : (
              <Button
                className="w-full h-12 rounded-2xl"
                onClick={handleConnectSquare}
                disabled={connecting}
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Connect Square Account
              </Button>
            )}
          </div>

          {/* Voice Agent App Card */}
          <div className="bg-card rounded-3xl border border-border p-10 flex flex-col">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
                <LayoutDashboard className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Voice Agent</h2>
                <p className="text-sm text-primary font-medium mt-1">
                  {isSquareConnected ? "Ready to take orders" : "Connect Square first"}
                </p>
              </div>
            </div>

            <p className="text-muted-foreground font-light mb-10 flex-1 leading-relaxed">
              Launch the Voice POS interface. This is what your bartenders will use on their iPads during
              service.
            </p>

            <Button
              variant="default"
              className="w-full h-12 text-base group rounded-2xl"
              disabled={!isSquareConnected}
              onClick={() => {
                if (!isSquareConnected || !primaryVenue) return;
                const token = localStorage.getItem("bevpro_token") || "";
                const url = `${voiceAgentBaseUrl}?venue=${primaryVenue.id}&token=${encodeURIComponent(token)}`;
                // Use a temporary <a> element to open reliably —
                // window.open with features string causes about:blank in some browsers
                const a = document.createElement("a");
                a.href = url;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
            >
              Launch Voice Agent
              <ExternalLink className="ml-2 w-4 h-4 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </div>
        </div>

        {/* ── iOS App Download Card ──────────────────────────────────── */}
        <div className="mt-8">
          <div className="bg-card rounded-3xl border border-border p-10 flex flex-col md:flex-row items-center gap-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-purple-700 rounded-2xl flex items-center justify-center shrink-0">
              <Smartphone className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-xl font-bold text-foreground tracking-tight mb-2">Bevpro for iOS</h2>
              <p className="text-muted-foreground font-light leading-relaxed">
                Download the native app for your iPad or iPhone. Sign in with your Bevpro account and your
                Square connection syncs automatically — no re-setup needed.
              </p>
            </div>
            <div className="flex flex-col gap-3 shrink-0">
              <Button variant="default" className="h-12 px-8 rounded-2xl" disabled>
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                Coming Soon
              </Button>
              <span className="text-xs text-muted-foreground text-center">
                Linked to your Bevpro account
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}