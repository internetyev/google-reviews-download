// Edge rate-limit middleware (L2.8) — contract: docs/methodology.md §4.
//
// Token bucket, 10 tokens, refill 10/min (one every 6s, burst 10), per
// (IP, route). Scoped via `config.matcher` to /api/reviews only — the
// static home page and SEO variants stay unmetered. Storage is a
// per-region in-memory Map; entries are evicted on next-touch when their
// `updated_at` is older than the eviction window. KV-backed limiter is
// the documented upgrade path if this becomes insufficient (D-021).
//
// On limit exceeded we return a 429 with `Retry-After: 6` and the same
// `{ error: { code, message } }` envelope shape `SemanticForceError`
// produces (D-027), so the UI handles upstream-rate-limited and
// our-rate-limited identically.

import { NextRequest, NextResponse } from "next/server";
import {
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
  RETRY_AFTER_SECONDS,
  EVICTION_WINDOW_MS,
  applyConsume,
  type Bucket,
  type RateLimiter,
} from "@/lib/ratelimit/token-bucket";
import { createKvRateLimiter } from "@/lib/ratelimit/kv-bucket";

// Re-export the bucket constants so existing importers/tests keep their source.
export {
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
  RETRY_AFTER_SECONDS,
  EVICTION_WINDOW_MS,
};

const buckets = new Map<string, Bucket>();

export function identify(req: NextRequest, route: string): string {
  // Methodology §4: leftmost X-Forwarded-For entry is the original client.
  // Next.js 15 removed `NextRequest.ip` so we fall back to `x-real-ip`
  // (the header Vercel's edge sets when XFF is absent) then `"unknown"`.
  const xff = req.headers.get("x-forwarded-for");
  const xffFirst = xff?.split(",")[0]?.trim();
  const ip =
    (xffFirst && xffFirst.length > 0 ? xffFirst : null) ??
    req.headers.get("x-real-ip")?.trim() ??
    "unknown";
  return `${ip}:${route}`;
}

export function consumeToken(
  key: string,
  now: number,
  store: Map<string, Bucket> = buckets,
): boolean {
  const existing = store.get(key);

  // Evict stale entries opportunistically — they are functionally identical
  // to "fresh bucket" after the refill, but dropping them keeps the Map
  // from growing unbounded for IPs that hit us once and never return.
  if (existing && now - existing.updated_at > EVICTION_WINDOW_MS) {
    store.delete(key);
  }

  const { allowed, next } = applyConsume(store.get(key) ?? null, now);
  store.set(key, next);
  return allowed;
}

// The in-process limiter wraps consumeToken so a single instance keeps working
// with zero config. When Vercel KV is wired, the KV-backed limiter takes over
// so the limit holds across instances (L28.4). Chosen once, lazily.
let limiter: RateLimiter | null = null;
function getLimiter(): RateLimiter {
  if (limiter) return limiter;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  limiter =
    url && token
      ? createKvRateLimiter({ url, token })
      : { consume: async (key, now) => consumeToken(key, now) };
  return limiter;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const route = req.nextUrl.pathname;
  const key = identify(req, route);

  if (await getLimiter().consume(key, Date.now())) return NextResponse.next();

  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: "Too many requests. Try again in a few seconds.",
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(RETRY_AFTER_SECONDS) },
    },
  );
}

export const config = {
  matcher: ["/api/reviews"],
};

export const __testing = {
  buckets,
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
  RETRY_AFTER_SECONDS,
  EVICTION_WINDOW_MS,
  consumeToken,
  identify,
};
