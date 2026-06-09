import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const getToken = () => localStorage.getItem("voycelab_token");

const getHeaders = () => {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export interface Venue {
  id: number;
  serviceConnectionId: string | null;
  serviceConnectionStatus: string | null;
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load venues (${res.status})`);
      }
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
      squareOAuthClaim: string;
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
    mutationFn: async (squareOAuthClaim: string) => {
      const res = await fetch(`/api/square/locations?oauth_ts=${encodeURIComponent(squareOAuthClaim)}`, {
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load locations");
      return data.locations as SquareLocation[];
    },
  });
}
