import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
  isLoadingLocations: boolean;
  catalogError: string | null;
  locationsError: string | null;
  setCredentials: (token: string, locationId: string) => Promise<void>;
  clearCredentials: () => Promise<void>;
  loadCatalog: (overrideToken?: string, overrideLocationId?: string) => Promise<number>;
  fetchLocations: (token: string) => Promise<SquareLocation[]>;
  searchCatalog: (query: string) => SquareCatalogItem[];
}

const SquareContext = createContext<SquareContextType | null>(null);

const STORAGE_KEYS = {
  ACCESS_TOKEN: "square_access_token",
  LOCATION_ID: "square_location_id",
};

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/`
    : "http://localhost:3000/";
}

export function SquareProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const [catalogItems, setCatalogItems] = useState<SquareCatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  useEffect(() => {
    loadStoredCredentials();
  }, []);

  useEffect(() => {
    if (accessToken && locationId) {
      loadCatalog();
    }
  }, [accessToken, locationId]);

  async function loadStoredCredentials() {
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const locId = await AsyncStorage.getItem(STORAGE_KEYS.LOCATION_ID);
      if (token) setAccessToken(token);
      if (locId) setLocationId(locId);
    } catch (e) {
      console.error("Failed to load credentials", e);
    }
  }

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
    await AsyncStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.LOCATION_ID);
    setAccessToken(null);
    setLocationId(null);
    setCatalogItems([]);
    setLocations([]);
  }

  async function loadCatalog(overrideToken?: string, overrideLocationId?: string): Promise<number> {
    const tok = overrideToken ?? accessToken;
    const loc = overrideLocationId ?? locationId;
    if (!tok || !loc) return 0;
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
        const err = await response.json().catch(() => ({ error: "Failed to load catalog" }));
        throw new Error(err.error || "Failed to load catalog");
      }

      const data = await response.json();
      const items = data.items || [];
      setCatalogItems(items);
      return items.length;
    } catch (e: any) {
      setCatalogError(e.message || "Failed to load catalog");
      return 0;
    } finally {
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

  return (
    <SquareContext.Provider
      value={{
        accessToken,
        locationId,
        locations,
        catalogItems,
        isConfigured,
        isLoadingCatalog,
        isLoadingLocations,
        catalogError,
        locationsError,
        setCredentials,
        clearCredentials,
        loadCatalog,
        fetchLocations,
        searchCatalog,
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
