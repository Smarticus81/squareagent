import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { getBaseUrl } from "@/lib/api";

export interface SquareCatalogItem {
  id: string;
  name: string;
  price: number;
  category?: string;
  description?: string;
  imageUrl?: string;
  variationId?: string;
}

export interface SquareLocation {
  id: string;
  name: string;
  address?: string;
}

interface AgentProfileLaunchInfo {
  id: string;
  displayName: string;
  wakePhrase: string;
  voicePipelineProvider?: string;
  voicePipelineConfig?: Record<string, unknown>;
}


interface SquareContextType {
  accessToken: string | null;
  locationId: string | null;
  venueId: string | null;
  authToken: string | null;
  locations: SquareLocation[];
  catalogItems: SquareCatalogItem[];
  isConfigured: boolean;
  isLoadingCatalog: boolean;
  catalogError: string | null;
  connectionError: string | null;
  isReconnecting: boolean;
  /** VoyceLab account info after login */
  userInfo: { id: number; email: string; name: string } | null;
  /** Venues available to the logged-in user */
  venues: { id: number; name: string; squareLocationName?: string }[];
  /** Assistant settings loaded with the selected venue. */
  agentProfile: AgentProfileLaunchInfo | null;
  agentProfileId: string | null;
  wakePhrase: string;
  /**
   * 'venue' = POS-attached assistant (Square credentials loaded, order/menu UI active).
   * 'general' = no POS connection (web/email/knowledge tools only).
   */
  assistantKind: "venue" | "general";
  /** Login with email + password. Returns error string or null on success. */
  login: (email: string, password: string) => Promise<string | null>;
  /** Signup with name + email + password. Returns error string or null on success. */
  signup: (name: string, email: string, password: string) => Promise<string | null>;
  /** Logout and clear all stored credentials */
  logout: () => Promise<void>;
  /** Select a venue and load its Square credentials */
  selectVenue: (venueId: number) => Promise<string | null>;
  setCredentials: (token: string, locationId: string) => void;
  clearCredentials: () => void;
  refreshCredentials: () => Promise<boolean>;
  loadCatalog: (overrideToken?: string, overrideLocationId?: string) => Promise<number>;
  fetchLocations: (token: string) => Promise<SquareLocation[]>;
  searchCatalog: (query: string) => SquareCatalogItem[];
}

const SquareContext = createContext<SquareContextType | null>(null);

const TOKEN_KEY = "square_access_token";
const LOC_KEY = "square_location_id";

function getWebLaunchParams(): { venueId?: string; authToken: string; agentProfileId?: string } | null {
  const params = new URLSearchParams(window.location.search);
  // Support both exchange code (new) and direct token (legacy/dev)
  const venueId = params.get("venue");
  const authToken = params.get("token");
  const agentProfileId = params.get("agentProfileId") ?? undefined;
  if (authToken && (venueId || agentProfileId)) return { venueId: venueId ?? undefined, authToken, agentProfileId };
  return null;
}

/** Redeem a one-time exchange code to get token + venueId. */
async function redeemExchangeCode(code: string): Promise<{ venueId?: string; authToken: string; agentProfileId?: string } | null> {
  try {
    const res = await fetch(`${getBaseUrl()}api/auth/exchange/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token && (data.venueId || data.agentProfileId)
      ? { venueId: data.venueId || undefined, authToken: data.token, agentProfileId: data.agentProfileId ?? undefined }
      : null;
  } catch {
    return null;
  }
}

export function SquareProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [catalogItems, setCatalogItems] = useState<SquareCatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(localStorage.getItem("voycelab_venue_id"));
  const [authToken, setAuthToken] = useState<string | null>(localStorage.getItem("voycelab_token"));
  const [userInfo, setUserInfo] = useState<{ id: number; email: string; name: string } | null>(null);
  const [venues, setVenues] = useState<{ id: number; name: string; squareLocationName?: string }[]>([]);
  const [agentProfile, setAgentProfile] = useState<AgentProfileLaunchInfo | null>(null);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(localStorage.getItem("voycelab_agent_profile_id"));
  const [wakePhrase, setWakePhrase] = useState("Hey Bar");

  function applyAgentLaunchInfo(data: any) {
    const profile = data.agentProfile as AgentProfileLaunchInfo | null | undefined;
    const nextWakePhrase =
      typeof profile?.wakePhrase === "string" && profile.wakePhrase.trim()
        ? profile.wakePhrase.trim()
        : typeof data.wakePhrase === "string" && data.wakePhrase.trim()
          ? data.wakePhrase.trim()
          : "Hey Bar";

    setAgentProfile(profile ?? null);
    setAgentProfileId(profile?.id ?? null);
    setWakePhrase(nextWakePhrase);
    localStorage.setItem("voycelab_wake_phrase", nextWakePhrase);
    if (profile?.id) localStorage.setItem("voycelab_agent_profile_id", profile.id);
    else localStorage.removeItem("voycelab_agent_profile_id");
    if (profile) localStorage.setItem("voycelab_agent_profile", JSON.stringify(profile));
    else localStorage.removeItem("voycelab_agent_profile");
  }

  // Load credentials once on mount:
  // 1. If launched with ?code=EXCHANGE_CODE, redeem it first
  // 2. If launched with ?venue=ID&token=JWT (legacy/dev), use directly
  // 3. Otherwise fall back to localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const exchangeCode = params.get("code");
      const urlAgentProfileId = params.get("agentProfileId") ?? undefined;

      let launch: { venueId?: string; authToken: string; agentProfileId?: string } | null = null;

      if (exchangeCode) {
        launch = await redeemExchangeCode(exchangeCode);
        if (launch && urlAgentProfileId && !launch.agentProfileId) {
          launch = { ...launch, agentProfileId: urlAgentProfileId };
        }
        // Always clean the code from URL to prevent stale re-use attempts
        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("agentProfileId");
        window.history.replaceState({}, "", url.toString());
      }

      if (!launch) launch = getWebLaunchParams();

      if (launch?.agentProfileId && !launch.venueId) {
        try {
          const res = await fetch(`${getBaseUrl()}api/v1/agent-profiles/${encodeURIComponent(launch.agentProfileId)}`, {
            headers: { Authorization: `Bearer ${launch.authToken}` },
          });
          if (!cancelled && res.ok) {
            const profile = await res.json();
            setAuthToken(launch.authToken);
            setAgentProfile(profile);
            setAgentProfileId(profile.id);
            setWakePhrase(profile.wakePhrase || "Hey Bar");
            localStorage.setItem("voycelab_token", launch.authToken);
            localStorage.setItem("voycelab_agent_profile_id", profile.id);
            localStorage.setItem("voycelab_agent_profile", JSON.stringify(profile));
            localStorage.setItem("voycelab_wake_phrase", profile.wakePhrase || "Hey Bar");
            localStorage.removeItem("voycelab_venue_id");
            setVenueId(null);
            setCredentialsReady(true);
            return;
          }
        } catch (e) {
          console.warn("Failed to load assistant profile", e);
        }
      }

      if (launch?.venueId) {
        try {
          const profileQuery = launch.agentProfileId
            ? `?agentProfileId=${encodeURIComponent(launch.agentProfileId)}`
            : "";
          const res = await fetch(`${getBaseUrl()}api/venues/${launch.venueId}/credentials${profileQuery}`, {
            headers: { Authorization: `Bearer ${launch.authToken}` },
          });
          if (!cancelled && res.ok) {
            const data = await res.json();
            if (data.accessToken && data.locationId) {
              setAccessToken(data.accessToken);
              setLocationId(data.locationId);
              localStorage.setItem(TOKEN_KEY, data.accessToken);
              localStorage.setItem(LOC_KEY, data.locationId);
              // Store auth params for voice agent session auth
              localStorage.setItem("voycelab_venue_id", launch.venueId);
              localStorage.setItem("voycelab_token", launch.authToken);
              if (launch.agentProfileId) localStorage.setItem("voycelab_agent_profile_id", launch.agentProfileId);
              applyAgentLaunchInfo(data);
              setVenueId(launch.venueId);
              setAuthToken(launch.authToken);
              setCredentialsReady(true);
              return;
            }
          }
        } catch (e) {
          console.warn("Failed to load venue credentials", e);
        }
      }
      // Fallback to localStorage
      if (!cancelled) {
        const token = localStorage.getItem(TOKEN_KEY);
        const locId = localStorage.getItem(LOC_KEY);
        if (token) setAccessToken(token);
        if (locId) setLocationId(locId);
        const storedWakePhrase = localStorage.getItem("voycelab_wake_phrase");
        const storedAgentProfileId = localStorage.getItem("voycelab_agent_profile_id");
        if (storedWakePhrase) setWakePhrase(storedWakePhrase);
        if (storedAgentProfileId) setAgentProfileId(storedAgentProfileId);
        const storedProfile = localStorage.getItem("voycelab_agent_profile");
        if (storedProfile) {
          try {
            setAgentProfile(JSON.parse(storedProfile));
          } catch {
            localStorage.removeItem("voycelab_agent_profile");
          }
        }
        setCredentialsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // On mount, restore user session if we have a stored auth token
  useEffect(() => {
    const tok = localStorage.getItem("voycelab_token");
    if (!tok) return;
    (async () => {
      try {
        const res = await fetch(`${getBaseUrl()}api/auth/me`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAuthToken(tok);
          setUserInfo(data.user);
          await loadVenues(tok);
        }
      } catch {}
    })();
  }, []);

  // Load catalog when credentials are available
  useEffect(() => {
    if (!credentialsReady || !accessToken || !locationId) return;
    loadCatalog();
  }, [credentialsReady, accessToken, locationId]);

  // ── VoyceLab Account Auth ────────────────────────────────────────────────────

  async function loadVenues(tok: string): Promise<void> {
    try {
      const res = await fetch(`${getBaseUrl()}api/venues`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        setVenues(data.venues ?? []);
      }
    } catch (e) {
      console.warn("Failed to load venues", e);
    }
  }

  async function login(email: string, password: string): Promise<string | null> {
    try {
      const res = await fetch(`${getBaseUrl()}api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Login failed";

      localStorage.setItem("voycelab_token", data.token);
      setAuthToken(data.token);
      setUserInfo(data.user);
      await loadVenues(data.token);
      return null;
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  async function signup(name: string, email: string, password: string): Promise<string | null> {
    try {
      const res = await fetch(`${getBaseUrl()}api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Signup failed";

      localStorage.setItem("voycelab_token", data.token);
      setAuthToken(data.token);
      setUserInfo(data.user);
      setVenues([]);
      return null;
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  async function logout(): Promise<void> {
    const tok = authToken || localStorage.getItem("voycelab_token");
    if (tok) {
      try {
        await fetch(`${getBaseUrl()}api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}` },
        });
      } catch {}
    }
    clearCredentials();
    localStorage.removeItem("voycelab_token");
    localStorage.removeItem("voycelab_venue_id");
    localStorage.removeItem("voycelab_wake_phrase");
    localStorage.removeItem("voycelab_agent_profile");
      localStorage.removeItem("voycelab_agent_profile_id");
    setAuthToken(null);
    setUserInfo(null);
    setVenues([]);
    setAgentProfile(null);
    setAgentProfileId(null);
    setWakePhrase("Hey Bar");
  }

  async function selectVenue(vid: number): Promise<string | null> {
    const tok = authToken || localStorage.getItem("voycelab_token");
    if (!tok) return "Not logged in";

    try {
      const storedAgentProfileId = localStorage.getItem("voycelab_agent_profile_id");
      const profileQuery = storedAgentProfileId
        ? `?agentProfileId=${encodeURIComponent(storedAgentProfileId)}`
        : "";
      const res = await fetch(`${getBaseUrl()}api/venues/${vid}/credentials${profileQuery}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return (data as any).error || "Failed to load venue";
      }
      const data = await res.json();
      if (data.accessToken && data.locationId) {
        setAccessToken(data.accessToken);
        setLocationId(data.locationId);
        setVenueId(String(vid));
        applyAgentLaunchInfo(data);
        localStorage.setItem(TOKEN_KEY, data.accessToken);
        localStorage.setItem(LOC_KEY, data.locationId);
        localStorage.setItem("voycelab_venue_id", String(vid));
        setConnectionError(null);
        return null;
      }
      return "Venue not connected to Square";
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  async function fetchLocations(token: string): Promise<SquareLocation[]> {
    const res = await fetch(`${getBaseUrl()}api/square/locations`, { headers: { "x-square-token": token } });
    if (!res.ok) throw new Error("Failed to fetch locations");
    const data = await res.json();
    const locs: SquareLocation[] = (data.locations || []).map((l: any) => ({
      id: l.id, name: l.name,
      address: [l.address?.address_line_1, l.address?.locality, l.address?.administrative_district_level_1].filter(Boolean).join(", "),
    }));
    setLocations(locs);
    return locs;
  }

  function setCredentials(token: string, locId: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LOC_KEY, locId);
    setAccessToken(token);
    setLocationId(locId);
  }

  function clearCredentials() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOC_KEY);
    setAccessToken(null);
    setLocationId(null);
    setCatalogItems([]);
    setConnectionError(null);
  }

  /** Re-fetch Square credentials from the server using stored venueId + authToken. */
  async function refreshCredentials(): Promise<boolean> {
    const vid = venueId || localStorage.getItem("voycelab_venue_id");
    const tok = authToken || localStorage.getItem("voycelab_token");
    if (!vid || !tok) {
      setConnectionError("No saved session. Open the dashboard to reconnect Square.");
      return false;
    }

    setIsReconnecting(true);
    setConnectionError(null);

    try {
      const res = await fetch(`${getBaseUrl()}api/venues/${vid}/credentials`, {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (res.status === 401) {
        setConnectionError("Session expired. Open the dashboard and relaunch the agent.");
        return false;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setConnectionError((errData as any).error || `Reconnection failed (${res.status})`);
        return false;
      }

      const data = await res.json();
      if (data.accessToken && data.locationId) {
        setAccessToken(data.accessToken);
        setLocationId(data.locationId);
        localStorage.setItem(TOKEN_KEY, data.accessToken);
        localStorage.setItem(LOC_KEY, data.locationId);
        setCatalogError(null);
        setConnectionError(null);
        return true;
      }

      setConnectionError("Square connection not found. Reconnect from the dashboard.");
      return false;
    } catch (e: any) {
      setConnectionError("Network error. Check your connection and try again.");
      return false;
    } finally {
      setIsReconnecting(false);
    }
  }

  const loadingRef = useRef(false);

  async function loadCatalog(overrideToken?: string, overrideLocationId?: string): Promise<number> {
    const tok = overrideToken ?? accessToken;
    const loc = overrideLocationId ?? locationId;
    if (!tok || !loc) return 0;
    // Prevent overlapping fetches — but allow retries after failure
    if (loadingRef.current) return 0;
    loadingRef.current = true;
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await fetch(`${getBaseUrl()}api/square/catalog`, {
        headers: { "x-square-token": tok, "x-square-location": loc },
      });
      if (!res.ok) {
        // If Square token expired, try refreshing credentials automatically
        if (res.status === 401 || res.status === 403) {
          loadingRef.current = false;
          const refreshed = await refreshCredentials();
          if (refreshed) {
            // Retry with new credentials
            return loadCatalog();
          }
          throw new Error("Square connection expired. Tap reconnect to fix.");
        }
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as any).error || `Catalog load failed (${res.status})`);
      }
      const data = await res.json();
      const items = data.items || [];
      setCatalogItems(items);
      setConnectionError(null);
      return items.length;
    } catch (e: any) {
      console.error("[Square] Catalog load error:", e.message);
      setCatalogError(e.message);
      return 0;
    } finally {
      loadingRef.current = false;
      setIsLoadingCatalog(false);
    }
  }

  function searchCatalog(query: string): SquareCatalogItem[] {
    if (!query.trim()) return catalogItems;
    const q = query.toLowerCase();
    return catalogItems.filter((i) => i.name.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q));
  }

  const isConfigured = !!(accessToken && locationId);
  // 'general' assistants either have an explicit profile.venueId == null, or
  // simply launched without Square credentials.
  const assistantKind: "venue" | "general" =
    agentProfile && (agentProfile as any).venueId == null && !isConfigured
      ? "general"
      : isConfigured
        ? "venue"
        : agentProfile
          ? "general"
          : "venue";

  return (
    <SquareContext.Provider value={{
      accessToken, locationId, venueId, authToken, locations, catalogItems, isConfigured,
      isLoadingCatalog, catalogError, connectionError, isReconnecting,
      userInfo, venues, agentProfile, agentProfileId, wakePhrase, assistantKind, login, signup, logout, selectVenue,
      setCredentials, clearCredentials, refreshCredentials,
      loadCatalog, fetchLocations, searchCatalog,
    }}>
      {children}
    </SquareContext.Provider>
  );
}

export function useSquare() {
  const ctx = useContext(SquareContext);
  if (!ctx) throw new Error("useSquare must be used within SquareProvider");
  return ctx;
}
