import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const getToken = () => localStorage.getItem("bevpro_token");

const getHeaders = () => {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export interface Venue {
  id: number;
  name: string;
  squareMerchantId: string | null;
  squareLocationId: string | null;
  squareLocationName: string | null;
  connectedAt: string | null;
}

export interface SquareLocation {
  id: string;
  name: string;
  address?: string;
}

export function useVenues() {
  return useQuery({
    queryKey: ["/api/venues"],
    queryFn: async () => {
      const res = await fetch("/api/venues", { headers: getHeaders() });
      if (!res.ok) throw new Error("Failed to load venues");
      const data = await res.json();
      return data.venues as Venue[];
    },
    enabled: !!getToken(),
  });
}

export function useSaveVenue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      accessToken: string;
      merchantId?: string;
      locationId: string;
      locationName?: string;
      name?: string;
    }) => {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save venue");
      return data.venue as Venue;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/venues"] });
    },
  });
}

export function useDeleteVenue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (venueId: number) => {
      const res = await fetch(`/api/venues/${venueId}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove venue");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/venues"] });
    },
  });
}

export function useSquareLocations() {
  return useMutation({
    mutationFn: async (accessToken: string) => {
      const res = await fetch("/api/square/locations", {
        headers: { ...getHeaders(), "x-square-token": accessToken },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load locations");
      return data.locations as SquareLocation[];
    },
  });
}
