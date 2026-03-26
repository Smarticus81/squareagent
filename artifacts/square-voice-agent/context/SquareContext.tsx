import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

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

interface SquareContextType {
  accessToken: string | null;
  locationId: string | null;
  venueId: string | null;
  authToken: string | null;
  locations: SquareLocation[];
  catalogItems: SquareCatalogItem[];
  isConfigured: boolean;
  isLoadingCatalog: boolean;
  isLoadingLocations: boolean;
  catalogError: string | null;
  locationsError: string | null;
  connectionError: string | null;
  isReconnecting: boolean;
  /** BevPro account info (email/name) after login */
  userInfo: { id: number; email: string; name: string } | null;
  /** List of venues for the logged-in user */
  venues: { id: number; name: string; squareLocationName?: string; connectedAt?: string }[];
  setCredentials: (token: string, locationId: string) => Promise<void>;
  clearCredentials: () => Promise<void>;
  refreshCredentials: () => Promise<boolean>;
  loadCatalog: (overrideToken?: string, overrideLocationId?: string) => Promise<number>;
  fetchLocations: (token: string) => Promise<SquareLocation[]>;
  searchCatalog: (query: string) => SquareCatalogItem[];
  /** Login with BevPro email + password. Returns error string or null on success. */
  login: (email: string, password: string) => Promise<string | null>;
  /** Signup with BevPro name + email + password. Returns error string or null on success. */
  signup: (name: string, email: string, password: string) => Promise<string | null>;
  /** Logout and clear all stored credentials */
  logout: () => Promise<void>;
  /** Select a venue from the user's list — loads Square credentials from server */
  selectVenue: (venueId: number) => Promise<string | null>;
}

const SquareContext = createContext<SquareContextType | null>(null);

const STORAGE_KEYS = {
  ACCESS_TOKEN: "square_access_token",
  LOCATION_ID: "square_location_id",
  VENUE_ID: "bevpro_venue_id",
  AUTH_TOKEN: "bevpro_token",
};

function getBaseUrl() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "http://localhost:8080/";
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}/`;
}

/** Parse URL query params on web to detect launch params from dashboard */
function getWebLaunchParams(): { venueId: string; authToken: string; code?: string } | null {
  if (Platform.OS !== "web") return null;
  try {
    const params = new URLSearchParams(window.location.search);

    // Exchange code flow (highest priority)
    const code = params.get("code");
    if (code) return { venueId: "", authToken: "", code };

    // Direct venue + token flow
    const venueId = params.get("venue");
    const authToken = params.get("token");
    if (venueId && authToken) return { venueId, authToken };
  } catch {}
  return null;
}

export function SquareProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [catalogItems, setCatalogItems] = useState<SquareCatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const loadingRef = useRef(false);
  const [userInfo, setUserInfo] = useState<{ id: number; email: string; name: string } | null>(null);
  const [venues, setVenues] = useState<{ id: number; name: string; squareLocationName?: string; connectedAt?: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const baseUrl = getBaseUrl();
      let launch = getWebLaunchParams();

      // Exchange code flow — redeem the one-time code for venue + token
      if (launch?.code) {
        try {
          const res = await fetch(`${baseUrl}api/auth/exchange/redeem`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: launch.code }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.venueId && data.token) {
              launch = { venueId: data.venueId, authToken: data.token };
            }
          }
        } catch (e) {
          console.warn("Exchange code redemption failed", e);
        }
        // Clean the URL
        if (Platform.OS === "web") {
          const url = new URL(window.location.href);
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.toString());
        }
      }

      // Venue + token flow — fetch real Square credentials from server
      if (launch && launch.venueId && launch.authToken) {
        // Clean the URL
        if (Platform.OS === "web") {
          const url = new URL(window.location.href);
          url.searchParams.delete("venue");
          url.searchParams.delete("token");
          window.history.replaceState({}, "", url.toString());
        }

        try {
          const res = await fetch(`${baseUrl}api/venues/${launch.venueId}/credentials`, {
            headers: { Authorization: `Bearer ${launch.authToken}` },
          });
          if (!cancelled && res.ok) {
            const data = await res.json();
            if (data.accessToken && data.locationId) {
              setAccessToken(data.accessToken);
              setLocationId(data.locationId);
              await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.accessToken);
              await AsyncStorage.setItem(STORAGE_KEYS.LOCATION_ID, data.locationId);
              await AsyncStorage.setItem(STORAGE_KEYS.VENUE_ID, launch.venueId);
              await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, launch.authToken);
              setVenueId(launch.venueId);
              setAuthToken(launch.authToken);
              setCredentialsReady(true);
              return;
            }
          }
        } catch (e) {
          console.warn("Failed to load venue credentials from API", e);
        }
      }

      // Fallback: load from local AsyncStorage
      if (!cancelled) {
        try {
          const [token, locId, vid, tok] = await Promise.all([
            AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
            AsyncStorage.getItem(STORAGE_KEYS.LOCATION_ID),
            AsyncStorage.getItem(STORAGE_KEYS.VENUE_ID),
            AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN),
          ]);
          if (token) setAccessToken(token);
          if (locId) setLocationId(locId);
          if (vid) setVenueId(vid);
          if (tok) setAuthToken(tok);
        } catch (e) {
          console.error("Failed to load credentials", e);
        }
        setCredentialsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!credentialsReady || !accessToken || !locationId) return;
    loadCatalog();
  }, [credentialsReady, accessToken, locationId]);

  async function fetchLocations(token: string): Promise<SquareLocation[]> {
    setIsLoadingLocations(true);
    setLocationsError(null);
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}api/square/locations`, {
        headers: { "x-square-token": token },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to fetch locations" }));
        throw new Error(err.error || "Failed to fetch locations — check your access token");
      }
      const data = await response.json();
      const locs: SquareLocation[] = (data.locations || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        address: [l.address?.address_line_1, l.address?.locality, l.address?.administrative_district_level_1]
          .filter(Boolean)
          .join(", "),
      }));
      setLocations(locs);
      return locs;
    } catch (e: any) {
      const msg = e.message || "Failed to fetch locations";
      setLocationsError(msg);
      throw new Error(msg);
    } finally {
      setIsLoadingLocations(false);
    }
  }

  async function setCredentials(token: string, locId: string) {
    await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
    await AsyncStorage.setItem(STORAGE_KEYS.LOCATION_ID, locId);
    setAccessToken(token);
    setLocationId(locId);
  }

  async function clearCredentials() {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN),
      AsyncStorage.removeItem(STORAGE_KEYS.LOCATION_ID),
      AsyncStorage.removeItem(STORAGE_KEYS.VENUE_ID),
      AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN),
    ]);
    setAccessToken(null);
    setLocationId(null);
    setVenueId(null);
    setAuthToken(null);
    setCatalogItems([]);
    setLocations([]);
    setConnectionError(null);
  }

  /** Re-fetch Square credentials from the server using stored venueId + authToken. */
  async function refreshCredentials(): Promise<boolean> {
    const vid = venueId || (await AsyncStorage.getItem(STORAGE_KEYS.VENUE_ID));
    const tok = authToken || (await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN));
    if (!vid || !tok) {
      setConnectionError("No saved session. Open the dashboard to reconnect Square.");
      return false;
    }

    setIsReconnecting(true);
    setConnectionError(null);

    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/venues/${vid}/credentials`, {
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
        await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.accessToken);
        await AsyncStorage.setItem(STORAGE_KEYS.LOCATION_ID, data.locationId);
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

  async function loadCatalog(overrideToken?: string, overrideLocationId?: string): Promise<number> {
    const tok = overrideToken ?? accessToken;
    const loc = overrideLocationId ?? locationId;
    if (!tok || !loc) return 0;
    if (loadingRef.current) return 0;
    loadingRef.current = true;
    setIsLoadingCatalog(true);
    setCatalogError(null);

    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}api/square/catalog`, {
        headers: {
          "x-square-token": tok,
          "x-square-location": loc,
        },
      });

      if (!response.ok) {
        // Auto-retry with refreshed credentials on auth failure
        if (response.status === 401 || response.status === 403) {
          loadingRef.current = false;
          const refreshed = await refreshCredentials();
          if (refreshed) return loadCatalog();
          throw new Error("Square connection expired. Tap reconnect to fix.");
        }
        const err = await response.json().catch(() => ({ error: "Failed to load catalog" }));
        throw new Error(err.error || "Failed to load catalog");
      }

      const data = await response.json();
      const items = data.items || [];
      setCatalogItems(items);
      setConnectionError(null);
      return items.length;
    } catch (e: any) {
      console.error("[Square] Catalog load error:", e.message);
      setCatalogError(e.message || "Failed to load catalog");
      return 0;
    } finally {
      loadingRef.current = false;
      setIsLoadingCatalog(false);
    }
  }

  function searchCatalog(query: string): SquareCatalogItem[] {
    if (!query.trim()) return catalogItems;
    const lower = query.toLowerCase();
    return catalogItems.filter(
      (item) =>
        item.name.toLowerCase().includes(lower) ||
        item.category?.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower)
    );
  }

  const isConfigured = !!(accessToken && locationId);

  // ── BevPro Account Auth (native login/signup) ──────────────────────────────

  /** Fetch the user's venues list from the API */
  async function loadVenues(tok: string): Promise<void> {
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/venues`, {
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
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Login failed";

      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
      setAuthToken(data.token);
      setUserInfo(data.user);

      // Load venues for this user
      await loadVenues(data.token);

      return null;
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  async function signup(name: string, email: string, password: string): Promise<string | null> {
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Signup failed";

      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
      setAuthToken(data.token);
      setUserInfo(data.user);

      // New user has no venues yet
      setVenues([]);

      return null;
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  async function logout(): Promise<void> {
    const tok = authToken || (await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN));
    if (tok) {
      try {
        const baseUrl = getBaseUrl();
        await fetch(`${baseUrl}api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}` },
        });
      } catch {}
    }
    await clearCredentials();
    setUserInfo(null);
    setVenues([]);
  }

  /** Select a venue → load Square credentials from server and store locally */
  async function selectVenue(vid: number): Promise<string | null> {
    const tok = authToken || (await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN));
    if (!tok) return "Not logged in";

    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/venues/${vid}/credentials`, {
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
        await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.accessToken);
        await AsyncStorage.setItem(STORAGE_KEYS.LOCATION_ID, data.locationId);
        await AsyncStorage.setItem(STORAGE_KEYS.VENUE_ID, String(vid));
        setConnectionError(null);
        return null;
      }
      return "Venue not connected to Square";
    } catch (e: any) {
      return e.message || "Network error";
    }
  }

  // On mount, also try to restore user session and load venues
  useEffect(() => {
    (async () => {
      const tok = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (!tok) return;
      try {
        const baseUrl = getBaseUrl();
        const res = await fetch(`${baseUrl}api/auth/me`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUserInfo(data.user);
          await loadVenues(tok);
        }
      } catch {}
    })();
  }, []);

  return (
    <SquareContext.Provider
      value={{
        accessToken,
        locationId,
        venueId,
        authToken,
        locations,
        catalogItems,
        isConfigured,
        isLoadingCatalog,
        isLoadingLocations,
        catalogError,
        locationsError,
        connectionError,
        isReconnecting,
        userInfo,
        venues,
        setCredentials,
        clearCredentials,
        refreshCredentials,
        loadCatalog,
        fetchLocations,
        searchCatalog,
        login,
        signup,
        logout,
        selectVenue,
      }}
    >
      {children}
    </SquareContext.Provider>
  );
}

export function useSquare() {
  const ctx = useContext(SquareContext);
  if (!ctx) throw new Error("useSquare must be used within SquareProvider");
  return ctx;
}
