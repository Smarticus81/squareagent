import crypto from "crypto";
import { decrypt, encrypt } from "./secrets";

interface PendingSquareOAuthToken {
  token: string;
  merchantId: string;
  timestamp: number;
  userId: number;
  organizationId: string | null;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;
const pendingTokens = new Map<string, PendingSquareOAuthToken>();

export function storePendingSquareOAuthToken(params: {
  token: string;
  merchantId: string;
  userId: number;
  organizationId: string | null;
}): string {
  const claimId = crypto.randomUUID();
  pendingTokens.set(claimId, {
    token: encrypt(params.token),
    merchantId: params.merchantId,
    timestamp: Date.now(),
    userId: params.userId,
    organizationId: params.organizationId,
  });
  return claimId;
}

export function purgeExpiredSquareOAuthTokens(): void {
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [key, value] of pendingTokens) {
    if (value.timestamp < cutoff) pendingTokens.delete(key);
  }
}

function authorizePendingToken(
  claimId: string,
  userId: number,
  organizationId: string | null,
): PendingSquareOAuthToken | null {
  purgeExpiredSquareOAuthTokens();
  const pending = pendingTokens.get(claimId);
  if (!pending) return null;
  if (pending.userId !== userId || pending.organizationId !== organizationId) return null;
  return pending;
}

export function peekPendingSquareOAuthToken(params: {
  claimId: string;
  userId: number;
  organizationId: string | null;
}): { token: string; merchantId: string } | null {
  const pending = authorizePendingToken(params.claimId, params.userId, params.organizationId);
  if (!pending) return null;
  return {
    token: decrypt(pending.token),
    merchantId: pending.merchantId,
  };
}

export function claimPendingSquareOAuthToken(params: {
  claimId: string;
  userId: number;
  organizationId: string | null;
}): { token: string; merchantId: string } | null {
  const pending = authorizePendingToken(params.claimId, params.userId, params.organizationId);
  if (!pending) return null;
  pendingTokens.delete(params.claimId);
  return {
    token: decrypt(pending.token),
    merchantId: pending.merchantId,
  };
}
