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
import { db, usersTable, organizationsTable, type User, type Organization } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("clerk-billing");

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

/** Clerk is usable for billing identity only when both keys are present. */
export function isClerkConfigured(): boolean {
  return Boolean(CLERK_SECRET_KEY && CLERK_PUBLISHABLE_KEY);
}

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

// ── Clerk identity provisioning ───────────────────────────────────────────────
// Clerk Billing (B2B) requires the buyer to be a Clerk user inside an active
// Clerk organization. VoyceLab owns its own login, so we transparently mirror
// each VoyceLab account into Clerk (user + organization) and hand the browser a
// one-time sign-in token so it can establish the Clerk session silently. This
// is what makes "Upgrade" / billing portal / webhook plan-sync actually work
// for a normally-logged-in VoyceLab user.

export interface ClerkIdentity {
  clerkUserId: string;
  clerkOrgId: string;
}

type ClerkApiError = Error & {
  status?: number;
  statusCode?: number;
  clerkTraceId?: string;
  errors?: Array<{
    code?: string;
    message?: string;
    longMessage?: string;
    meta?: { paramName?: string };
  }>;
};

function clerkErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { status, statusCode } = error as ClerkApiError;
  return typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : undefined;
}

function isMissingClerkResource(error: unknown): boolean {
  if (clerkErrorStatus(error) === 404) return true;
  if (!error || typeof error !== "object") return false;
  const clerkErrors = (error as ClerkApiError).errors;
  return Array.isArray(clerkErrors) && clerkErrors.some((item) => item.code?.includes("not_found"));
}

export function formatClerkApiError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const clerkError = error as ClerkApiError;
  const base = clerkError.message || String(error);
  const details = Array.isArray(clerkError.errors)
    ? clerkError.errors
        .map((item) => {
          const message = item.longMessage || item.message;
          const code = item.code ? `[${item.code}]` : "";
          const param = item.meta?.paramName ? ` (${item.meta.paramName})` : "";
          return [code, message ? `${message}${param}` : ""].filter(Boolean).join(" ");
        })
        .filter(Boolean)
        .join("; ")
    : "";
  return details ? `${base}: ${details}` : base;
}

function clerkOrgSlug(org: Organization): string {
  const base = org.name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "voycelab-workspace";

  return `${base}-${org.id.slice(0, 8)}`;
}

function unwrapList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }
  return [];
}

/** Derive a Clerk-safe username from the account email; unique per VoyceLab user id. */
function clerkUsername(user: User): string {
  const localPart = user.email.toLowerCase().trim().split("@")[0] ?? "";
  const base = localPart.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "voycelab-user";
  return `${base}-${user.id}`;
}

/** True when Clerk rejected creation because an identifier (external_id, email, username) is already taken. */
function isIdentifierTaken(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const clerkErrors = (error as ClerkApiError).errors;
  return Array.isArray(clerkErrors) && clerkErrors.some((item) => item.code === "form_identifier_exists");
}

/** Find an existing Clerk user by VoyceLab external id or email. */
async function lookupClerkUser(user: User): Promise<string | null> {
  const email = user.email.toLowerCase().trim();
  try {
    const byExternalId = await defaultClerkClient.users.getUserList({ externalId: [String(user.id)] });
    const externalMatches = unwrapList<{ id: string }>(byExternalId);
    if (externalMatches.length > 0) return externalMatches[0].id;

    const byEmail = await defaultClerkClient.users.getUserList({ emailAddress: [email] });
    const emailMatches = unwrapList<{ id: string }>(byEmail);
    if (emailMatches.length > 0) return emailMatches[0].id;
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, "clerk user lookup failed");
  }
  return null;
}

/** Fields Clerk reported as missing when the instance requires extra sign-up attributes. */
function missingRequiredFields(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const clerkErrors = (error as ClerkApiError).errors;
  if (!Array.isArray(clerkErrors)) return [];
  const fields = new Set<string>();
  for (const item of clerkErrors) {
    if (item.code !== "form_data_missing") continue;
    const source = `${item.longMessage ?? ""} ${item.message ?? ""}`;
    for (const match of source.matchAll(/"([a-z_]+)"/g)) fields.add(match[1]);
  }
  return [...fields];
}

async function findOrCreateClerkUser(user: User): Promise<string> {
  if (user.clerkUserId) {
    try {
      const existing = await defaultClerkClient.users.getUser(user.clerkUserId);
      return existing.id;
    } catch (e) {
      if (!isMissingClerkResource(e)) throw e;
      log.warn({ clerkUserId: user.clerkUserId }, "stored clerk user id was not found; relinking user");
    }
  }

  const email = user.email.toLowerCase().trim();
  let clerkUserId: string | null = await lookupClerkUser(user);

  if (!clerkUserId) {
    const parts = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift();
    const lastName = parts.join(" ");
    const baseParams = {
      emailAddress: [email],
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      skipPasswordRequirement: true,
      skipPasswordChecks: true,
      externalId: String(user.id),
    };
    try {
      const created = await defaultClerkClient.users.createUser(baseParams);
      clerkUserId = created.id;
    } catch (e) {
      // A user with this external id / email already exists in Clerk (e.g. a
      // previous link attempt succeeded but the DB link was never saved).
      // Find and reuse it instead of failing.
      if (isIdentifierTaken(e)) {
        clerkUserId = await lookupClerkUser(user);
        if (!clerkUserId) {
          throw new Error(
            "A Clerk user already exists for this account's external id, but it could not be retrieved. " +
              "In the Clerk Dashboard, find the user whose External ID is " +
              `"${user.id}" and delete it (or contact support), then retry.`,
          );
        }
      } else {
        const missing = missingRequiredFields(e);
        if (missing.length === 0) throw e;
        // Retry supplying a generated username if that's what the instance requires.
        if (missing.every((field) => field === "username")) {
          const created = await defaultClerkClient.users.createUser({
            ...baseParams,
            username: clerkUsername(user),
          });
          clerkUserId = created.id;
        } else {
          const unfixable = missing.filter((field) => field !== "username");
          throw new Error(
            `The Clerk instance requires ${unfixable.map((f) => `"${f}"`).join(", ")} for every user, which VoyceLab cannot provide automatically. ` +
              `In the Clerk Dashboard, go to User & Authentication settings and set ${unfixable.join(", ")} to optional (or off), then retry.`,
          );
        }
      }
    }
  }

  await db
    .update(usersTable)
    .set({ clerkUserId, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  return clerkUserId;
}

async function ensureClerkOrgMembership(clerkOrgId: string, clerkUserId: string): Promise<void> {
  // Check first — the common case is that the user is already a member.
  try {
    const memberships = await defaultClerkClient.organizations.getOrganizationMembershipList({
      organizationId: clerkOrgId,
      limit: 100,
    });
    const list = unwrapList<{ publicUserData?: { userId?: string } }>(memberships);
    if (list.some((m) => m.publicUserData?.userId === clerkUserId)) return;
  } catch (e) {
    log.warn({ err: formatClerkApiError(e) }, "clerk membership lookup failed");
  }

  try {
    await defaultClerkClient.organizations.createOrganizationMembership({
      organizationId: clerkOrgId,
      userId: clerkUserId,
      role: "org:admin",
    });
  } catch (e) {
    const clerkErrors = (e as ClerkApiError).errors;
    const alreadyMember =
      Array.isArray(clerkErrors) &&
      clerkErrors.some((item) => item.code?.includes("already") || item.code?.includes("duplicate"));
    if (alreadyMember) return;
    // Real failures (e.g. org membership limit reached) must surface — a
    // signed-in user without org membership sees an empty billing page.
    throw e;
  }
}

async function findOrCreateClerkOrg(org: Organization, clerkUserId: string): Promise<string> {
  if (org.clerkOrgId) {
    try {
      const existing = await defaultClerkClient.organizations.getOrganization({ organizationId: org.clerkOrgId });
      await ensureClerkOrgMembership(existing.id, clerkUserId);
      return existing.id;
    } catch (e) {
      if (!isMissingClerkResource(e)) throw e;
      log.warn({ clerkOrgId: org.clerkOrgId }, "stored clerk organization id was not found; relinking organization");
    }
  }

  const created = await defaultClerkClient.organizations.createOrganization({
    name: org.name.trim() || "VoyceLab Workspace",
    slug: clerkOrgSlug(org),
    createdBy: clerkUserId,
  });

  await db
    .update(organizationsTable)
    .set({ clerkOrgId: created.id, updatedAt: new Date() })
    .where(eq(organizationsTable.id, org.id));

  return created.id;
}

/**
 * Ensure the VoyceLab user + organization are mirrored into Clerk. Persists the
 * resulting Clerk ids so webhook plan-sync can resolve the org reliably.
 * Returns null when Clerk is not configured.
 */
export async function ensureClerkIdentity(user: User, org: Organization): Promise<ClerkIdentity | null> {
  if (!isClerkConfigured() || !db) return null;
  try {
    const clerkUserId = await findOrCreateClerkUser(user);
    const clerkOrgId = await findOrCreateClerkOrg(org, clerkUserId);
    return { clerkUserId, clerkOrgId };
  } catch (e) {
    log.error({ err: formatClerkApiError(e) }, "ensureClerkIdentity failed");
    throw e;
  }
}

/**
 * Mint a one-time Clerk sign-in token (ticket) so the browser can sign the user
 * into Clerk without a second credential prompt.
 */
export async function createClerkSignInToken(
  clerkUserId: string,
  expiresInSeconds = 600,
): Promise<string | null> {
  if (!isClerkConfigured()) return null;
  try {
    const res = await defaultClerkClient.signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds,
    });
    return res?.token ?? null;
  } catch (e) {
    log.error({ err: formatClerkApiError(e) }, "createSignInToken failed");
    throw e;
  }
}

export { defaultClerkClient as clerkClient };
