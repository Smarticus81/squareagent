import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
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
  const venueId = params.get("venue");
  const authToken = params.get("token");
  return venueId && authToken ? { venueId, authToken } : null;
}

export function SquareProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [catalogItems, setCatalogItems] = useState<SquareCatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => { loadCredentials(); }, []);
  useEffect(() => { if (accessToken && locationId) loadCatalog(); }, [accessToken, locationId]);

  async function loadCredentials() {
    const launch = getWebLaunchParams();
    if (launch) {
      try {
        const res = await fetch(`${getBaseUrl()}api/venues/${launch.venueId}/credentials`, {
          headers: { Authorization: `Bearer ${launch.authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.accessToken && data.locationId) {
            setAccessToken(data.accessToken);
            setLocationId(data.locationId);
            localStorage.setItem(TOKEN_KEY, data.accessToken);
            localStorage.setItem(LOC_KEY, data.locationId);
            return;
          }
        }
      } catch (e) {
        console.warn("Failed to load venue credentials", e);
      }
    }
    const token = localStorage.getItem(TOKEN_KEY);
    const locId = localStorage.getItem(LOC_KEY);
    if (token) setAccessToken(token);
    if (locId) setLocationId(locId);
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
  }

  async function loadCatalog(overrideToken?: string, overrideLocationId?: string): Promise<number> {
    const tok = overrideToken ?? accessToken;
    const loc = overrideLocationId ?? locationId;
    if (!tok || !loc) return 0;
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await fetch(`${getBaseUrl()}api/square/catalog`, { headers: { "x-square-token": tok, "x-square-location": loc } });
      if (!res.ok) throw new Error("Failed to load catalog");
      const data = await res.json();
      const items = data.items || [];
      setCatalogItems(items);
      return items.length;
    } catch (e: any) {
      setCatalogError(e.message);
      return 0;
    } finally {
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
