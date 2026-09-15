/**
 * PostgreSQL-backed atomic rate limiting for sensitive routes.
 * Works correctly across multiple Railway instances.
 */

import { db, rateLimitBucketsTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export async function checkPostgresRateLimit(
  bucketKey: string,
  maxHits: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(now);
  const expiresAt = new Date(now + windowMs);

  // Clean expired buckets opportunistically (fire-and-forget)
  db.delete(rateLimitBucketsTable)
    .where(lt(rateLimitBucketsTable.expiresAt, new Date()))
    .catch(() => {});

  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets (bucket_key, hit_count, window_start, expires_at)
    VALUES (${bucketKey}, 1, ${windowStart}, ${expiresAt})
    ON CONFLICT (bucket_key) DO UPDATE SET
      hit_count = CASE
        WHEN rate_limit_buckets.expires_at < NOW() THEN 1
        ELSE rate_limit_buckets.hit_count + 1
      END,
      window_start = CASE
        WHEN rate_limit_buckets.expires_at < NOW() THEN ${windowStart}
        ELSE rate_limit_buckets.window_start
      END,
      expires_at = CASE
        WHEN rate_limit_buckets.expires_at < NOW() THEN ${expiresAt}
        ELSE rate_limit_buckets.expires_at
      END
    RETURNING hit_count, expires_at
  `);

  const row = (result.rows?.[0] ?? result[0]) as { hit_count: number; expires_at: Date } | undefined;
  const hitCount = row?.hit_count ?? 1;
  const resetMs = row?.expires_at ? new Date(row.expires_at).getTime() - now : windowMs;

  return {
    allowed: hitCount <= maxHits,
    remaining: Math.max(0, maxHits - hitCount),
    resetMs: Math.max(0, resetMs),
  };
}

export function postgresRateLimitMiddleware(bucketPrefix: string, maxHits: number, windowMs: number) {
  return async (req: any, res: any, next: any) => {
    const ip = req.ip ?? "unknown";
    const bucketKey = `${bucketPrefix}:${ip}`;
    try {
      const result = await checkPostgresRateLimit(bucketKey, maxHits, windowMs);
      res.setHeader("X-RateLimit-Limit", String(maxHits));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      if (!result.allowed) {
        res.status(429).json({ error: "rate_limit_exceeded", code: "rate_limit_exceeded" });
        return;
      }
      next();
    } catch {
      // Fail open on rate limit DB errors to avoid blocking legitimate traffic
      next();
    }
  };
}
