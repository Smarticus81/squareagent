/**
 * Durable Square OAuth pending token claims — PostgreSQL-backed.
 *
 * The OAuth callback lands server-to-server with no user session, so the
 * exchanged tokens are parked here (encrypted) under a short-lived claim id
 * that the authenticated client then redeems from the dashboard/PWA.
 */

import crypto from "crypto";
import { db, squareOAuthPendingTokensTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { decrypt, encrypt } from "./secrets";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface PendingSquareTokens {
  token: string;
  refreshToken: string | null;
  /** RFC3339 access-token expiry, when Square reported one. */
  expiresAt: string | null;
  merchantId: string;
}

export async function purgeExpiredSquareOAuthTokens(): Promise<void> {
  await db.delete(squareOAuthPendingTokensTable)
    .where(lt(squareOAuthPendingTokensTable.expiresAt, new Date()))
    .catch(() => {});
}

export async function storePendingSquareOAuthToken(params: {
  token: string;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
  merchantId: string;
  userId: number;
  organizationId: string | null;
}): Promise<string> {
  await purgeExpiredSquareOAuthTokens();
  const claimId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const tokenExpiresAt = params.tokenExpiresAt ? new Date(params.tokenExpiresAt) : null;
  await db.insert(squareOAuthPendingTokensTable).values({
    claimId,
    userId: params.userId,
    organizationId: params.organizationId,
    encryptedToken: encrypt(params.token),
    encryptedRefreshToken: params.refreshToken ? encrypt(params.refreshToken) : null,
    tokenExpiresAt: tokenExpiresAt && !Number.isNaN(tokenExpiresAt.getTime()) ? tokenExpiresAt : null,
    merchantId: params.merchantId,
    expiresAt,
  });
  return claimId;
}

async function authorizePendingToken(
  claimId: string,
  userId: number,
  organizationId: string | null,
) {
  await purgeExpiredSquareOAuthTokens();
  const [row] = await db
    .select()
    .from(squareOAuthPendingTokensTable)
    .where(
      and(
        eq(squareOAuthPendingTokensTable.claimId, claimId),
        eq(squareOAuthPendingTokensTable.userId, userId),
      ),
    )
    .limit(1);
  if (!row || row.expiresAt < new Date()) return null;
  if (row.organizationId !== organizationId) return null;
  return row;
}

function toPendingTokens(row: typeof squareOAuthPendingTokensTable.$inferSelect): PendingSquareTokens {
  return {
    token: decrypt(row.encryptedToken),
    refreshToken: row.encryptedRefreshToken ? decrypt(row.encryptedRefreshToken) : null,
    expiresAt: row.tokenExpiresAt ? row.tokenExpiresAt.toISOString() : null,
    merchantId: row.merchantId,
  };
}

export async function peekPendingSquareOAuthToken(params: {
  claimId: string;
  userId: number;
  organizationId: string | null;
}): Promise<PendingSquareTokens | null> {
  const pending = await authorizePendingToken(params.claimId, params.userId, params.organizationId);
  if (!pending) return null;
  return toPendingTokens(pending);
}

export async function claimPendingSquareOAuthToken(params: {
  claimId: string;
  userId: number;
  organizationId: string | null;
}): Promise<PendingSquareTokens | null> {
  const pending = await authorizePendingToken(params.claimId, params.userId, params.organizationId);
  if (!pending) return null;
  await db.delete(squareOAuthPendingTokensTable)
    .where(eq(squareOAuthPendingTokensTable.claimId, params.claimId));
  return toPendingTokens(pending);
}
