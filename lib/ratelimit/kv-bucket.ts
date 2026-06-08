// KV-backed rate limiter (L28.4) — the same token bucket as the in-process
// middleware, but bucket state lives in Vercel KV so the 10 req/min/IP limit
// holds ACROSS instances/regions (the in-process Map only limits one instance).
//
// Reuses the KV REST pipeline shape from lib/cache/reviews-cache.ts (POST
// ["GET"|"SET", key, ...]) so there's no extra dependency.
//
// Two deliberate trade-offs (D-097):
//  - NOT atomic: GET→compute→SET over REST races under high concurrency, so the
//    limit can over-allow slightly. Acceptable for a soft abuse limit.
//  - FAIL-OPEN: any KV error is treated as "fresh bucket → allowed", so a KV
//    outage degrades to unmetered rather than blocking all traffic (a limiter
//    that failed closed would DoS the API on a cache hiccup).

import {
  applyConsume,
  EVICTION_WINDOW_MS,
  type Bucket,
  type RateLimiter,
} from "@/lib/ratelimit/token-bucket";

export const RATELIMIT_KEY_PREFIX = "gr:ratelimit:v1:";

export type KvRateLimiterOptions = {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export function createKvRateLimiter(opts: KvRateLimiterOptions): RateLimiter {
  const url = opts.url.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };
  const keyFor = (key: string) => `${RATELIMIT_KEY_PREFIX}${key}`;

  async function get(key: string): Promise<Bucket | null> {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(["GET", keyFor(key)]),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: string | null };
      if (body.result == null) return null;
      return JSON.parse(body.result) as Bucket;
    } catch {
      return null; // fail-open: treat as no bucket → fresh
    }
  }

  async function set(key: string, bucket: Bucket): Promise<void> {
    try {
      const ttl = Math.ceil(EVICTION_WINDOW_MS / 1000);
      await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify([
          "SET",
          keyFor(key),
          JSON.stringify(bucket),
          "EX",
          String(ttl),
        ]),
      });
    } catch {
      // best-effort: a failed write just means the next request sees a fresher
      // (or fresh) bucket — never throws into the request path.
    }
  }

  return {
    async consume(key: string, now: number): Promise<boolean> {
      const prior = await get(key); // null on any KV error → fail-open
      const { allowed, next } = applyConsume(prior, now);
      await set(key, next);
      return allowed;
    },
  };
}
