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

interface SquareContextType {
  accessToken: string | null;
  locationId: string | null;
  locations: SquareLocation[];
  catalogItems: SquareCatalogItem[];
  isConfigured: boolean;
  isLoadingCatalog: boolean;
  catalogError: string | null;
  setCredentials: (token: string, locationId: string) => void;
  clearCredentials: () => void;
  loadCatalog: (overrideToken?: string, overrideLocationId?: string) => Promise<number>;
  fetchLocations: (token: string) => Promise<SquareLocation[]>;
  searchCatalog: (query: string) => SquareCatalogItem[];
}

const SquareContext = createContext<SquareContextType | null>(null);

const TOKEN_KEY = "square_access_token";
const LOC_KEY = "square_location_id";

function getWebLaunchParams(): { venueId: string; authToken: string } | null {
  const params = new URLSearchParams(window.location.search);
  // Support both exchange code (new) and direct token (legacy/dev)
  const venueId = params.get("venue");
  const authToken = params.get("token");
  if (venueId && authToken) return { venueId, authToken };
  return null;
}

/** Redeem a one-time exchange code to get token + venueId. */
async function redeemExchangeCode(code: string): Promise<{ venueId: string; authToken: string } | null> {
  try {
    const res = await fetch(`${getBaseUrl()}api/auth/exchange/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token && data.venueId ? { venueId: data.venueId, authToken: data.token } : null;
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
  const [credentialsReady, setCredentialsReady] = useState(false);

  // Load credentials once on mount:
  // 1. If launched with ?code=EXCHANGE_CODE, redeem it first
  // 2. If launched with ?venue=ID&token=JWT (legacy/dev), use directly
  // 3. Otherwise fall back to localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const exchangeCode = params.get("code");

      let launch: { venueId: string; authToken: string } | null = null;

      if (exchangeCode) {
        launch = await redeemExchangeCode(exchangeCode);
        // Clean the code from URL to prevent re-use attempts
        if (launch) {
          const url = new URL(window.location.href);
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.toString());
        }
      }

      if (!launch) launch = getWebLaunchParams();

      if (launch) {
        try {
          const res = await fetch(`${getBaseUrl()}api/venues/${launch.venueId}/credentials`, {
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
              localStorage.setItem("bevpro_venue_id", launch.venueId);
              localStorage.setItem("bevpro_token", launch.authToken);
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
        setCredentialsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load catalog when credentials are available
  useEffect(() => {
    if (!credentialsReady || !accessToken || !locationId) return;
    loadCatalog();
  }, [credentialsReady, accessToken, locationId]);

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
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as any).error || `Catalog load failed (${res.status})`);
      }
      const data = await res.json();
      const items = data.items || [];
      setCatalogItems(items);
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

  return (
    <SquareContext.Provider value={{
      accessToken, locationId, locations, catalogItems, isConfigured,
      isLoadingCatalog, catalogError, setCredentials, clearCredentials,
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
