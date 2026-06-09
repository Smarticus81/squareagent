/**
 * Clerk Billing server-side helpers.
 *
 * Integrates @clerk/express middleware so that routes can verify Clerk
 * sessions and read organization plan/feature claims from JWTs. This
 * runs alongside (not instead of) VoyceLab's own JWT auth — Clerk
 * handles billing identity, VoyceLab handles app sessions.
 */

import { clerkMiddleware, getAuth, clerkClient as defaultClerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

/**
 * Express middleware that silently attaches Clerk auth to requests.
 * Does NOT reject unauthenticated requests — VoyceLab's own JWT auth
 * remains the primary gate. Clerk auth is used for billing checks only.
 */
export function clerkBillingMiddleware() {
  if (!CLERK_SECRET_KEY || !CLERK_PUBLISHABLE_KEY) {
    // Clerk not configured — pass through silently
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const middleware = clerkMiddleware({
    secretKey: CLERK_SECRET_KEY,
    publishableKey: CLERK_PUBLISHABLE_KEY,
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const voyceLabAuthorization = req.headers.authorization;
    const clerkSessionToken = req.headers["x-clerk-session-token"];
    const clerkToken = Array.isArray(clerkSessionToken) ? clerkSessionToken[0] : clerkSessionToken;

    if (!clerkToken) {
      middleware(req, res, next);
      return;
    }

    req.headers.authorization = `Bearer ${clerkToken}`;
    middleware(req, res, (err?: unknown) => {
      if (voyceLabAuthorization === undefined) delete req.headers.authorization;
      else req.headers.authorization = voyceLabAuthorization;
      next(err);
    });
  };
}

/**
 * Read Clerk org billing claims from a request that has passed through
 * clerkBillingMiddleware. Returns null if Clerk auth is not present.
 */
export function getClerkBillingAuth(req: Request): {
  userId: string | null;
  orgId: string | null;
  orgRole: string | null;
  /** Check if the org has a specific plan, feature, or permission. */
  has: (params: { plan?: string; feature?: string; permission?: string }) => boolean;
} | null {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return null;

    return {
      userId: auth.userId,
      orgId: auth.orgId ?? null,
      orgRole: auth.orgRole ?? null,
      has: (params) => {
        if (typeof auth.has !== "function") return false;
        // Clerk's has() uses discriminated unions — call with the correct shape
        if (params.plan) return auth.has({ plan: params.plan });
        if (params.feature) return auth.has({ feature: params.feature });
        if (params.permission) return auth.has({ permission: params.permission });
        return false;
      },
    };
  } catch {
    return null;
  }
}

/**
 * Map Clerk plan slugs to VoyceLab plan IDs.
 * Configure plan slugs in the Clerk Dashboard to match these values.
 */
const CLERK_TO_VOYCELAB_PLAN: Record<string, string> = {
  pro: "pro",
  professional: "pro",
  business: "business",
  premium: "business",
  trial: "trial",
  free: "trial",
};

/**
 * Check if a Clerk-authenticated org has an active paid plan.
 * Falls through to null if Clerk is not authenticated (so the caller
 * can fall back to the local DB subscription check).
 */
export function checkClerkOrgPlan(req: Request): { plan: string; active: boolean } | null {
  const billing = getClerkBillingAuth(req);
  if (!billing?.orgId) return null;

  // Check each known plan
  for (const [clerkSlug, voycePlan] of Object.entries(CLERK_TO_VOYCELAB_PLAN)) {
    if (billing.has({ plan: clerkSlug })) {
      return { plan: voycePlan, active: true };
    }
  }

  return { plan: "trial", active: false };
}

/**
 * Check if a Clerk-authenticated org has a specific feature.
 * Used for feature-gated access (e.g., inventory, team-labor skills).
 */
export function checkClerkOrgFeature(req: Request, feature: string): boolean {
  const billing = getClerkBillingAuth(req);
  if (!billing?.orgId) return false;
  return billing.has({ feature });
}

export { defaultClerkClient as clerkClient };
