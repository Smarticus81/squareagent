/**
 * Durable Square OAuth pending token claims — PostgreSQL-backed.
 */

import crypto from "crypto";
import { db, squareOAuthPendingTokensTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { decrypt, encrypt } from "./secrets";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export async function purgeExpiredSquareOAuthTokens(): Promise<void> {
  await db.delete(squareOAuthPendingTokensTable)
    .where(lt(squareOAuthPendingTokensTable.expiresAt, new Date()))
    .catch(() => {});
}

export async function storePendingSquareOAuthToken(params: {
  token: string;
  merchantId: string;
  userId: number;
  organizationId: string | null;
}): Promise<string> {
  await purgeExpiredSquareOAuthTokens();
  const claimId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.insert(squareOAuthPendingTokensTable).values({
    claimId,
    userId: params.userId,
    organizationId: params.organizationId,
    encryptedToken: encrypt(params.token),
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

export async function peekPendingSquareOAuthToken(params: {
  claimId: string;
  userId: number;
  organizationId: string | null;
}): Promise<{ token: string; merchantId: string } | null> {
  const pending = await authorizePendingToken(params.claimId, params.userId, params.organizationId);
  if (!pending) return null;
  return {
    token: decrypt(pending.encryptedToken),
    merchantId: pending.merchantId,
  };
}

export async function claimPendingSquareOAuthToken(params: {
  claimId: string;
  userId: number;
  organizationId: string | null;
}): Promise<{ token: string; merchantId: string } | null> {
  const pending = await authorizePendingToken(params.claimId, params.userId, params.organizationId);
  if (!pending) return null;
  await db.delete(squareOAuthPendingTokensTable)
    .where(eq(squareOAuthPendingTokensTable.claimId, params.claimId));
  return {
    token: decrypt(pending.encryptedToken),
    merchantId: pending.merchantId,
  };
}
