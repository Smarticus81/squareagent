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

interface AgentProfileLaunchInfo {
  id: string;
  venueId?: number | null;
  displayName: string;
  wakePhrase: string;
  wakeMode?: "ambient" | "tap";
  voicePipelineProvider?: string;
  voicePipelineConfig?: Record<string, unknown>;
  noiseMode?: string;
}

interface VenueInfo {
  id: number;
  name: string;
  squareLocationId?: string | null;
  squareLocationName?: string | null;
  serviceConnectionStatus?: string | null;
}

interface SquareLocationOption {
  id: string;
  name: string;
  address?: string;
}

interface SquareContextType {
  locationId: string | null;
  venueId: string | null;
  authToken: string | null;
  catalogItems: SquareCatalogItem[];
  isConfigured: boolean;
  isLoadingCatalog: boolean;
  catalogError: string | null;
  connectionError: string | null;
  isConnectingSquare: boolean;
  isReconnecting: boolean;
  /** VoyceLab account info after login */
  userInfo: { id: number; email: string; name: string } | null;
  /** Venues available to the logged-in user */
  venues: VenueInfo[];
  /** Square locations awaiting selection after OAuth. */
  pendingSquareLocations: SquareLocationOption[];
  /** Assistant settings loaded with the selected venue. */
  agentProfile: AgentProfileLaunchInfo | null;
  agentProfileId: string | null;
  wakePhrase: string;
  wakeMode: "ambient" | "tap";
  updateWakeSettings: (wakePhrase: string, wakeMode: "ambient" | "tap") => Promise<string | null>;
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
  /** Start Square OAuth from the PWA. */
  connectSquare: () => Promise<string | null>;
  /** Save a Square location returned by OAuth as a venue. */
  selectSquareLocation: (location: SquareLocationOption) => Promise<string | null>;
  /** Select a venue and load its Square credentials */
  selectVenue: (venueId: number) => Promise<string | null>;
  clearCredentials: () => void;
  refreshCredentials: () => Promise<boolean>;
  loadCatalog: () => Promise<number>;
  searchCatalog: (query: string) => SquareCatalogItem[];
}

const SquareContext = createContext<SquareContextType | null>(null);

const TOKEN_KEY = "square_access_token";
const LOC_KEY = "square_location_id";
const AUTH_TOKEN_KEY = "voycelab_token";
const VENUE_ID_KEY = "voycelab_venue_id";
const WAKE_PHRASE_KEY = "voycelab_wake_phrase";
const WAKE_MODE_KEY = "voycelab_wake_mode";
const AGENT_PROFILE_KEY = "voycelab_agent_profile";
const AGENT_PROFILE_ID_KEY = "voycelab_agent_profile_id";
const DEFAULT_WAKE_PHRASE = "Hey Voyce";

function normalizeWakePhrase(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_WAKE_PHRASE;
}

function normalizeWakeMode(value: unknown): "ambient" | "tap" {
  return value === "tap" ? "tap" : "ambient";
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
  const [locationId, setLocationId] = useState<string | null>(null);
  const [catalogItems, setCatalogItems] = useState<SquareCatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnectingSquare, setIsConnectingSquare] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(localStorage.getItem(VENUE_ID_KEY));
  const [authToken, setAuthToken] = useState<string | null>(localStorage.getItem(AUTH_TOKEN_KEY));
  const [userInfo, setUserInfo] = useState<{ id: number; email: string; name: string } | null>(null);
  const [venues, setVenues] = useState<VenueInfo[]>([]);
  const [pendingSquareLocations, setPendingSquareLocations] = useState<SquareLocationOption[]>([]);
  const [squareOAuthClaim, setSquareOAuthClaim] = useState<string | null>(null);
  const [oauthMerchantId, setOauthMerchantId] = useState<string | null>(null);
  const [agentProfile, setAgentProfile] = useState<AgentProfileLaunchInfo | null>(null);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(localStorage.getItem(AGENT_PROFILE_ID_KEY));
  const [wakePhrase, setWakePhrase] = useState(DEFAULT_WAKE_PHRASE);
  const [wakeMode, setWakeMode] = useState<"ambient" | "tap">("ambient");
  const initialHasExchangeCodeRef = useRef(new URLSearchParams(window.location.search).has("code"));

  function applyVenueConnection(data: any, nextVenueId: string) {
    setLocationId(data.locationId ?? null);
    localStorage.removeItem(TOKEN_KEY);
    if (data.locationId) localStorage.setItem(LOC_KEY, data.locationId);
    localStorage.setItem(VENUE_ID_KEY, nextVenueId);
    applyAgentLaunchInfo(data);
    setVenueId(nextVenueId);
    setConnectionError(null);
  }

  function applyAgentLaunchInfo(data: any) {
    const profile = data.agentProfile as AgentProfileLaunchInfo | null | undefined;
    const storedWakePhrase = localStorage.getItem(WAKE_PHRASE_KEY);
    const storedWakeMode = localStorage.getItem(WAKE_MODE_KEY);
    const nextWakePhrase =
      typeof profile?.wakePhrase === "string" && profile.wakePhrase.trim()
        ? profile.wakePhrase.trim()
        : typeof data.wakePhrase === "string" && data.wakePhrase.trim()
          ? data.wakePhrase.trim()
          : storedWakePhrase?.trim()
            ? storedWakePhrase.trim()
            : DEFAULT_WAKE_PHRASE;
    const nextWakeMode = normalizeWakeMode(profile?.wakeMode ?? data.wakeMode ?? storedWakeMode);

    setAgentProfile(profile ?? null);
    setAgentProfileId(profile?.id ?? null);
    setWakePhrase(nextWakePhrase);
    setWakeMode(nextWakeMode);
    localStorage.setItem(WAKE_PHRASE_KEY, nextWakePhrase);
    localStorage.setItem(WAKE_MODE_KEY, nextWakeMode);
    if (profile?.id) localStorage.setItem(AGENT_PROFILE_ID_KEY, profile.id);
    else localStorage.removeItem(AGENT_PROFILE_ID_KEY);
    if (profile) localStorage.setItem(AGENT_PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(AGENT_PROFILE_KEY);
  }

  async function updateWakeSettings(nextPhrase: string, nextMode: "ambient" | "tap"): Promise<string | null> {
    const normalizedPhrase = normalizeWakePhrase(nextPhrase);
    const normalizedMode = normalizeWakeMode(nextMode);
    const previousProfile = agentProfile;
    const nextProfile = previousProfile
      ? { ...previousProfile, wakePhrase: normalizedPhrase, wakeMode: normalizedMode }
      : null;

    setWakePhrase(normalizedPhrase);
    setWakeMode(normalizedMode);
    if (nextProfile) setAgentProfile(nextProfile);
    localStorage.setItem(WAKE_PHRASE_KEY, normalizedPhrase);
    localStorage.setItem(WAKE_MODE_KEY, normalizedMode);
    if (nextProfile) localStorage.setItem(AGENT_PROFILE_KEY, JSON.stringify(nextProfile));

    const profileId = nextProfile?.id ?? agentProfileId ?? localStorage.getItem(AGENT_PROFILE_ID_KEY);
    const tok = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    if (!profileId || !tok) return null;

    try {
      const res = await fetch(`${getBaseUrl()}api/v1/agent-profiles/${encodeURIComponent(profileId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({ wakePhrase: normalizedPhrase, wakeMode: normalizedMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return (data as any).error?.message || (data as any).error || "Saved on this device, but could not update the assistant.";
      }
      applyAgentLaunchInfo({ agentProfile: (data as any).profile ?? data });
      return null;
    } catch (e: any) {
      return e?.message || "Saved on this device, but could not update the assistant.";
    }
  }

  async function loadAgentProfile(tok: string, profileId: string): Promise<boolean> {
    try {
      const res = await fetch(`${getBaseUrl()}api/v1/agent-profiles/${encodeURIComponent(profileId)}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) return false;
      const profile = (await res.json()) as AgentProfileLaunchInfo;
      applyAgentLaunchInfo({ agentProfile: profile });
      return true;
    } catch (e) {
      console.warn("Failed to refresh assistant profile", e);
      return false;
    }
  }

  function clearStoredLaunchSession(message?: string) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(VENUE_ID_KEY);
    localStorage.removeItem(WAKE_PHRASE_KEY);
    localStorage.removeItem(WAKE_MODE_KEY);
    localStorage.removeItem(AGENT_PROFILE_KEY);
    localStorage.removeItem(AGENT_PROFILE_ID_KEY);
    clearCredentials();
    setVenueId(null);
    setAuthToken(null);
    setUserInfo(null);
    setVenues([]);
    setAgentProfile(null);
    setAgentProfileId(null);
    setWakePhrase(DEFAULT_WAKE_PHRASE);
    setWakeMode("ambient");
    if (message) setConnectionError(message);
  }

  function clearStoredAssistantLaunchState() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(VENUE_ID_KEY);
    localStorage.removeItem(WAKE_PHRASE_KEY);
    localStorage.removeItem(WAKE_MODE_KEY);
    localStorage.removeItem(AGENT_PROFILE_KEY);
    localStorage.removeItem(AGENT_PROFILE_ID_KEY);
    localStorage.removeItem(LOC_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setVenueId(null);
    setAuthToken(null);
    setAgentProfile(null);
    setAgentProfileId(null);
    setWakePhrase(DEFAULT_WAKE_PHRASE);
    setWakeMode("ambient");
    setLocationId(null);
  }

  async function claimSquareOAuth(oauthTs: string, tok: string): Promise<{
    tokenState: string;
    merchantId: string | null;
    locations: SquareLocationOption[];
  }> {
    const tokenRes = await fetch(`${getBaseUrl()}api/square/oauth/token?ts=${encodeURIComponent(oauthTs)}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      throw new Error((tokenData as any).error || "Failed to verify Square connection");
    }

    const tokenState = String((tokenData as any).tokenState || oauthTs);
    const merchantId = typeof (tokenData as any).merchantId === "string" ? (tokenData as any).merchantId : null;
    setSquareOAuthClaim(tokenState);
    setOauthMerchantId(merchantId);

    const locationsRes = await fetch(`${getBaseUrl()}api/square/locations?oauth_ts=${encodeURIComponent(tokenState)}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const locationsData = await locationsRes.json().catch(() => ({}));
    if (!locationsRes.ok) {
      throw new Error((locationsData as any).error || "Failed to load Square locations");
    }
    return {
      tokenState,
      merchantId,
      locations: Array.isArray((locationsData as any).locations) ? (locationsData as any).locations : [],
    };
  }

  async function saveSquareVenue(
    tok: string,
    squareOAuthClaimValue: string,
    merchantId: string | null,
    location: SquareLocationOption,
  ): Promise<string | null> {
    const res = await fetch(`${getBaseUrl()}api/venues`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({
        squareOAuthClaim: squareOAuthClaimValue,
        merchantId: merchantId || undefined,
        locationId: location.id,
        locationName: location.name,
        name: location.name,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data as any).error || "Failed to save Square location";

    localStorage.setItem(AUTH_TOKEN_KEY, tok);
    setAuthToken(tok);
    await loadVenues(tok);
    const savedVenueId = (data as any).venue?.id;
    if (savedVenueId) {
      const selectError = await selectVenue(Number(savedVenueId));
      if (selectError) return selectError;
    }
    setSquareOAuthClaim(null);
    setOauthMerchantId(null);
    setPendingSquareLocations([]);
    setConnectionError(null);
    return null;
  }

  // Load credentials once on mount:
  // 1. If launched with ?code=EXCHANGE_CODE, redeem it first
  // 2. Otherwise fall back to localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const exchangeCode = params.get("code");
      const oauthTs = params.get("oauth_ts");
      const oauthError = params.get("oauth_error");
      const urlAgentProfileId = params.get("agentProfileId") ?? undefined;

      let launch: { venueId?: string; authToken: string; agentProfileId?: string } | null = null;

      if (oauthTs || oauthError) {
        const url = new URL(window.location.href);
        url.searchParams.delete("oauth_ts");
        url.searchParams.delete("oauth_error");
        window.history.replaceState({}, "", url.toString());

        if (oauthError) {
          setConnectionError(`Square authorization failed: ${oauthError}`);
        } else if (oauthTs) {
          const tok = localStorage.getItem(AUTH_TOKEN_KEY);
          if (!tok) {
            setConnectionError("Sign in before connecting Square.");
          } else {
            setIsConnectingSquare(true);
            try {
              const { tokenState, merchantId, locations } = await claimSquareOAuth(oauthTs, tok);
              if (!cancelled) {
                if (locations.length === 1) {
                  const err = await saveSquareVenue(tok, tokenState, merchantId, locations[0]);
                  if (err) setConnectionError(err);
                } else {
                  setPendingSquareLocations(locations);
                  if (locations.length === 0) setConnectionError("No Square locations were found for this account.");
                }
              }
            } catch (e: any) {
              if (!cancelled) setConnectionError(e?.message || "Failed to connect Square");
            } finally {
              if (!cancelled) setIsConnectingSquare(false);
            }
          }
        }
      }

      if (exchangeCode) {
        clearStoredAssistantLaunchState();
        launch = await redeemExchangeCode(exchangeCode);
        if (launch && urlAgentProfileId && !launch.agentProfileId) {
          launch = { ...launch, agentProfileId: urlAgentProfileId };
        }
        // Always clean the code from URL to prevent stale re-use attempts
        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("agentProfileId");
        window.history.replaceState({}, "", url.toString());
        if (!launch) {
          if (!cancelled) {
            setConnectionError("Launch link expired. Open the assistant from the dashboard.");
            setCredentialsReady(true);
          }
          return;
        }
      }

      if (!exchangeCode && (params.has("token") || params.has("venue"))) {
        const url = new URL(window.location.href);
        url.searchParams.delete("token");
        url.searchParams.delete("venue");
        window.history.replaceState({}, "", url.toString());
        if (!localStorage.getItem(AUTH_TOKEN_KEY)) {
          setConnectionError("Launch link expired. Open the assistant from the dashboard.");
        }
      }

      let launchedProfile: AgentProfileLaunchInfo | null = null;
      if (launch?.agentProfileId) {
        try {
          const res = await fetch(`${getBaseUrl()}api/v1/agent-profiles/${encodeURIComponent(launch.agentProfileId)}`, {
            headers: { Authorization: `Bearer ${launch.authToken}` },
          });
          if (!cancelled && res.ok) {
            const profile = await res.json() as AgentProfileLaunchInfo;
            launchedProfile = profile;
            setAuthToken(launch.authToken);
            localStorage.setItem(AUTH_TOKEN_KEY, launch.authToken);
            applyAgentLaunchInfo({ agentProfile: profile });
            if (!launch.venueId && profile.venueId) {
              launch = { ...launch, venueId: String(profile.venueId) };
            }
          } else if (!cancelled) {
            setConnectionError("Assistant profile not found. Relaunch it from the dashboard.");
          }
        } catch (e) {
          console.warn("Failed to load assistant profile", e);
          if (!cancelled) setConnectionError("Failed to load assistant profile. Relaunch it from the dashboard.");
        }
        if (!launch.venueId) {
          if (!cancelled) {
            localStorage.removeItem(VENUE_ID_KEY);
            setVenueId(null);
            setCredentialsReady(true);
          }
          return;
        }
        if (!launchedProfile) {
          if (!cancelled) {
            localStorage.removeItem(VENUE_ID_KEY);
            setVenueId(null);
            setCredentialsReady(true);
          }
          return;
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
            if (data.locationId) {
              // Store auth params for voice agent session auth
              localStorage.setItem(AUTH_TOKEN_KEY, launch.authToken);
              applyVenueConnection(
                launchedProfile && !data.agentProfile
                  ? { ...data, agentProfile: launchedProfile }
                  : data,
                launch.venueId,
              );
              setAuthToken(launch.authToken);
              setCredentialsReady(true);
              return;
            }
          }
        } catch (e) {
          console.warn("Failed to load venue credentials", e);
        }
        if (launchedProfile) {
          localStorage.removeItem(VENUE_ID_KEY);
          setVenueId(null);
          setCredentialsReady(true);
          setConnectionError("Square is not connected for this assistant. The assistant is loaded without POS access.");
          return;
        }
        if (exchangeCode) {
          setConnectionError("Failed to load assistant launch. Open it again from the dashboard.");
          setCredentialsReady(true);
          return;
        }
      }
      // Fallback to localStorage
      if (!cancelled) {
        const locId = localStorage.getItem(LOC_KEY);
        if (locId) setLocationId(locId);
        localStorage.removeItem(TOKEN_KEY);
        const storedWakePhrase = localStorage.getItem(WAKE_PHRASE_KEY);
        const storedWakeMode = localStorage.getItem(WAKE_MODE_KEY);
        const storedAgentProfileId = localStorage.getItem(AGENT_PROFILE_ID_KEY);
        if (storedWakePhrase) setWakePhrase(storedWakePhrase);
        if (storedWakeMode) setWakeMode(normalizeWakeMode(storedWakeMode));
        if (storedAgentProfileId) setAgentProfileId(storedAgentProfileId);
        const storedProfile = localStorage.getItem(AGENT_PROFILE_KEY);
        if (storedProfile) {
          try {
            const parsedProfile = JSON.parse(storedProfile) as AgentProfileLaunchInfo;
            setAgentProfile(parsedProfile);
            setWakePhrase(parsedProfile.wakePhrase?.trim() || storedWakePhrase || DEFAULT_WAKE_PHRASE);
            setWakeMode(normalizeWakeMode(parsedProfile.wakeMode ?? storedWakeMode));
          } catch {
            localStorage.removeItem(AGENT_PROFILE_KEY);
          }
        }
        setCredentialsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // On mount, restore user session if we have a stored auth token
  useEffect(() => {
    if (initialHasExchangeCodeRef.current) return;
    const tok = localStorage.getItem(AUTH_TOKEN_KEY);
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
          const storedAgentProfileId = localStorage.getItem(AGENT_PROFILE_ID_KEY);
          if (storedAgentProfileId) await loadAgentProfile(tok, storedAgentProfileId);
        } else if (res.status === 401) {
          clearStoredLaunchSession("Session expired. Sign in or relaunch from the dashboard.");
        }
      } catch {}
    })();
  }, []);

  // Load catalog when credentials are available
  useEffect(() => {
    if (!credentialsReady) return;
    if (venueId && authToken) loadCatalog();
  }, [credentialsReady, locationId, venueId, authToken]);

  useEffect(() => {
    if (!credentialsReady || !authToken || venueId || pendingSquareLocations.length > 0) return;
    const connectedVenues = venues.filter((v) => v.squareLocationId);
    if (connectedVenues.length === 1) {
      void selectVenue(connectedVenues[0].id);
    }
  }, [credentialsReady, authToken, venueId, venues, pendingSquareLocations.length]);

  // ── VoyceLab Account Auth ────────────────────────────────────────────────────

  async function loadVenues(tok: string): Promise<VenueInfo[]> {
    try {
      const res = await fetch(`${getBaseUrl()}api/venues`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        const nextVenues = Array.isArray(data.venues) ? data.venues as VenueInfo[] : [];
        setVenues(nextVenues);
        return nextVenues;
      }
    } catch (e) {
      console.warn("Failed to load venues", e);
    }
    return [];
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

      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
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

      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      setAuthToken(data.token);
      setUserInfo(data.user);
      setVenues([]);
      return null;
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  async function logout(): Promise<void> {
    const tok = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    if (tok) {
      try {
        await fetch(`${getBaseUrl()}api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}` },
        });
      } catch {}
    }
    clearCredentials();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(VENUE_ID_KEY);
    localStorage.removeItem(WAKE_PHRASE_KEY);
    localStorage.removeItem(WAKE_MODE_KEY);
    localStorage.removeItem(AGENT_PROFILE_KEY);
    localStorage.removeItem(AGENT_PROFILE_ID_KEY);
    setAuthToken(null);
    setUserInfo(null);
    setVenues([]);
    setAgentProfile(null);
    setAgentProfileId(null);
    setWakePhrase(DEFAULT_WAKE_PHRASE);
    setWakeMode("ambient");
  }

  async function connectSquare(): Promise<string | null> {
    const tok = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    if (!tok) return "Sign in before connecting Square.";

    setIsConnectingSquare(true);
    setConnectionError(null);
    try {
      const returnUrl = window.location.pathname || "/";
      const params = new URLSearchParams({
        mode: "redirect",
        handoff: "json",
        return_url: returnUrl,
      });
      const res = await fetch(`${getBaseUrl()}api/square/oauth/authorize?${params}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const data = await res.json().catch(() => ({}));
      const url = typeof (data as any).url === "string" ? (data as any).url : "";
      if (!res.ok || !url) return (data as any).error || "Could not start Square authorization";
      window.location.href = url;
      return null;
    } catch (e: any) {
      return e?.message || "Could not start Square authorization";
    } finally {
      setIsConnectingSquare(false);
    }
  }

  async function selectSquareLocation(location: SquareLocationOption): Promise<string | null> {
    const tok = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    const claim = squareOAuthClaim;
    if (!tok) return "Sign in before connecting Square.";
    if (!claim) return "Square connection expired. Please connect again.";

    setIsConnectingSquare(true);
    setConnectionError(null);
    try {
      return await saveSquareVenue(tok, claim, oauthMerchantId, location);
    } finally {
      setIsConnectingSquare(false);
    }
  }

  async function selectVenue(vid: number): Promise<string | null> {
    const tok = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    if (!tok) return "Not logged in";

    try {
      const storedAgentProfileId = localStorage.getItem(AGENT_PROFILE_ID_KEY);
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
      if (data.locationId) {
        applyVenueConnection(data, String(vid));
        localStorage.setItem(VENUE_ID_KEY, String(vid));
        return null;
      }
      return "Venue not connected to Square";
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  function clearCredentials() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOC_KEY);
    setLocationId(null);
    setCatalogItems([]);
    setConnectionError(null);
  }

  /** Re-fetch Square credentials from the server using stored venueId + authToken. */
  async function refreshCredentials(): Promise<boolean> {
    const vid = venueId || localStorage.getItem(VENUE_ID_KEY);
    const tok = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    if (!vid || !tok) {
      setConnectionError("No saved session. Open the dashboard to reconnect Square.");
      return false;
    }

    setIsReconnecting(true);
    setConnectionError(null);

    try {
      const storedAgentProfileId = localStorage.getItem(AGENT_PROFILE_ID_KEY);
      const profileQuery = storedAgentProfileId
        ? `?agentProfileId=${encodeURIComponent(storedAgentProfileId)}`
        : "";
      const res = await fetch(`${getBaseUrl()}api/venues/${vid}/credentials${profileQuery}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (res.status === 401) {
        clearStoredLaunchSession("Session expired. Sign in or relaunch from the dashboard.");
        return false;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setConnectionError((errData as any).error || `Reconnection failed (${res.status})`);
        return false;
      }

      const data = await res.json();
      if (data.locationId) {
        applyVenueConnection(data, vid);
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

  async function loadCatalog(): Promise<number> {
    const vid = venueId || localStorage.getItem(VENUE_ID_KEY);
    const jwt = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
    if (!vid || !jwt) return 0;
    // Prevent overlapping fetches — but allow retries after failure
    if (loadingRef.current) return 0;
    loadingRef.current = true;
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await fetch(`${getBaseUrl()}api/venues/${encodeURIComponent(vid)}/catalog`, {
        headers: { Authorization: `Bearer ${jwt}` },
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
          throw new Error("Session expired. Sign in or relaunch from the dashboard.");
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

  const isConfigured = !!(venueId && authToken && locationId);
  // Default to the general business assistant unless we have an explicit
  // venue-bound assistant profile AND Square credentials. This means a
  // signed-in user who opens the PWA directly (no venue selected) gets the
  // general assistant ready to go — no setup required.
  const assistantKind: "venue" | "general" =
    isConfigured && (!agentProfile || (agentProfile as any).venueId != null)
      ? "venue"
      : "general";

  return (
    <SquareContext.Provider value={{
      locationId, venueId, authToken, catalogItems, isConfigured,
      isLoadingCatalog, catalogError, connectionError, isConnectingSquare, isReconnecting,
      userInfo, venues, pendingSquareLocations, agentProfile, agentProfileId, wakePhrase, wakeMode, assistantKind,
      updateWakeSettings,
      login, signup, logout, connectSquare, selectSquareLocation, selectVenue,
      clearCredentials, refreshCredentials,
      loadCatalog, searchCatalog,
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
