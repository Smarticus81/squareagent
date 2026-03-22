import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

// Schemas
export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
});

export const SubscriptionSchema = z.object({
  id: z.number(),
  userId: z.number(),
  plan: z.string(),
  status: z.string(),
  trialEndsAt: z.string().nullable(),
});

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: UserSchema,
  subscription: SubscriptionSchema.nullable().optional(),
  trialEndsAt: z.string().nullable().optional(),
});

export const MeResponseSchema = z.object({
  user: UserSchema,
  subscription: SubscriptionSchema.nullable().optional(),
});

export type User = z.infer<typeof UserSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;

// Helpers
const getToken = () => localStorage.getItem("bevpro_token");
const setToken = (token: string) => localStorage.setItem("bevpro_token", token);
const clearToken = () => localStorage.removeItem("bevpro_token");

const getHeaders = () => {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

// Hooks
export function useAuth() {
  return useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const token = getToken();
      if (!token) return null;

      const res = await fetch("/api/auth/me", { headers: getHeaders() });
      if (!res.ok) {
        let errorMessage = "Failed to load current user";

        try {
          const data = await res.json();
          if (typeof data?.error === "string" && data.error) {
            errorMessage = data.error;
          }
        } catch {
          // Ignore JSON parse failures and fall back to the default message.
        }

        if (res.status === 401) {
          clearToken();
          throw new Error("Not authenticated");
        }

        throw new Error(errorMessage);
      }
      const data = await res.json();
      return MeResponseSchema.parse(data);
    },
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      
      const validated = AuthResponseSchema.parse(data);
      setToken(validated.token);
      return validated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (userData: { email: string; password: string; name: string }) => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      
      const validated = AuthResponseSchema.parse(data);
      setToken(validated.token);
      return validated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: getHeaders(),
      });
      clearToken();
      if (!res.ok) console.warn("Logout endpoint failed, but token cleared locally");
    },
    onSettled: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.invalidateQueries();
      window.location.href = "/";
    },
  });
}
