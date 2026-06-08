// Token-bucket core (L28.4) — shared by the in-process limiter (middleware.ts)
// and the KV-backed limiter (kv-bucket.ts) so the refill/spend arithmetic has
// one source of truth. Pure + storage-agnostic: callers own the read/write.
//
// 10 tokens, refill 10/min (one every 6s), burst 10, per (IP, route).

export const BUCKET_CAPACITY = 10;
export const REFILL_PER_SECOND = 10 / 60; // 10 tokens/min → ~0.1667 tokens/s
export const RETRY_AFTER_SECONDS = 6; // one token's worth (1 / REFILL_PER_SECOND)
export const EVICTION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export type Bucket = { tokens: number; updated_at: number };

export interface RateLimiter {
  /** Returns true if a token was available (request allowed), false if limited. */
  consume(key: string, now: number): Promise<boolean>;
}

/**
 * Pure token-bucket step: refill the bucket for the elapsed time since its last
 * touch (clamped to capacity), then spend one token if available. Returns the
 * decision plus the next bucket state to persist (in BOTH the allowed and the
 * denied case — a denial still records the refilled `updated_at` so the next
 * retry computes off it, not the original empty timestamp).
 */
export function applyConsume(
  prior: Bucket | null,
  now: number,
): { allowed: boolean; next: Bucket } {
  const tokens = prior
    ? Math.min(
        BUCKET_CAPACITY,
        prior.tokens + ((now - prior.updated_at) / 1000) * REFILL_PER_SECOND,
      )
    : BUCKET_CAPACITY;

  if (tokens < 1) {
    return { allowed: false, next: { tokens, updated_at: now } };
  }
  return { allowed: true, next: { tokens: tokens - 1, updated_at: now } };
}
