// Reviews cache (L2.3) — Vercel KV via REST, with an in-process Map fallback
// for fixture mode. Contract is defined in docs/methodology.md §3.
//
// Key shape: `gr:reviews:v1:<slug>` where <slug> is the normalised slug from
// lib/semanticforce/place-id.ts. TTL: 24h. Value: the assembled walk payload
// the route returns on a 200 (`{ place, reviews, fetched_at, truncated? }`).
//
// We use Vercel KV's REST API directly (pipeline form: POST $KV_REST_API_URL
// with body ["SET", key, value, "EX", ttl]) rather than @vercel/kv so the
// module is dependency-free and edge-safe — no Node-only globals, no Buffer.
// When the KV envs are unset (the routine's default fixture mode) we fall
// back to a process-local Map so the route still works end-to-end without
// any cache wiring.

import type { PlaceMeta, Review } from "@/lib/semanticforce/types";

export type CachedReviewsPayload = {
  place: PlaceMeta;
  reviews: Review[];
  fetched_at: string;
  truncated?: true;
};

export interface ReviewsCache {
  get(slug: string): Promise<CachedReviewsPayload | null>;
  set(slug: string, payload: CachedReviewsPayload): Promise<void>;
}

export const CACHE_KEY_PREFIX = "gr:reviews:v1:";
// Preview payloads (first N reviews) live under a SEPARATE namespace so a
// partial preview can never be served to a full-walk download request — the
// two key spaces never collide. (L27.4 / D-089)
export const PREVIEW_KEY_PREFIX = "gr:preview:v1:";
export const CACHE_TTL_SECONDS = 24 * 60 * 60;

export function cacheKey(slug: string, prefix: string = CACHE_KEY_PREFIX): string {
  return `${prefix}${slug}`;
}

export type ReviewsCacheOptions = {
  kvRestApiUrl?: string;
  kvRestApiToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export function createReviewsCache(
  options: ReviewsCacheOptions = {},
): ReviewsCache {
  return buildCache(options, CACHE_KEY_PREFIX);
}

// Preview-scoped cache (first N reviews per place) — same store/TTL as the
// reviews cache but a distinct key namespace, so repeat previews of a place
// cost zero upstream calls without ever colliding with the full-walk download
// cache. (L27.4 / D-089)
export function createPreviewCache(
  options: ReviewsCacheOptions = {},
): ReviewsCache {
  return buildCache(options, PREVIEW_KEY_PREFIX);
}

function buildCache(options: ReviewsCacheOptions, keyPrefix: string): ReviewsCache {
  const url = options.kvRestApiUrl ?? process.env.KV_REST_API_URL;
  const token = options.kvRestApiToken ?? process.env.KV_REST_API_TOKEN;

  if (url && token) {
    return new KvRestCache({
      url,
      token,
      fetchImpl: options.fetchImpl ?? fetch,
      keyPrefix,
    });
  }

  return new MemoryCache(options.now ?? Date.now, keyPrefix);
}

class MemoryCache implements ReviewsCache {
  private readonly store = new Map<
    string,
    { value: CachedReviewsPayload; expires_at: number }
  >();
  private readonly now: () => number;
  private readonly keyPrefix: string;

  constructor(now: () => number, keyPrefix: string = CACHE_KEY_PREFIX) {
    this.now = now;
    this.keyPrefix = keyPrefix;
  }

  async get(slug: string): Promise<CachedReviewsPayload | null> {
    const key = cacheKey(slug, this.keyPrefix);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.now() > entry.expires_at) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(slug: string, payload: CachedReviewsPayload): Promise<void> {
    this.store.set(cacheKey(slug, this.keyPrefix), {
      value: payload,
      expires_at: this.now() + CACHE_TTL_SECONDS * 1000,
    });
  }
}

class KvRestCache implements ReviewsCache {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly keyPrefix: string;

  constructor(opts: {
    url: string;
    token: string;
    fetchImpl: typeof fetch;
    keyPrefix?: string;
  }) {
    this.url = opts.url.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl;
    this.keyPrefix = opts.keyPrefix ?? CACHE_KEY_PREFIX;
  }

  async get(slug: string): Promise<CachedReviewsPayload | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(["GET", cacheKey(slug, this.keyPrefix)]),
      });
    } catch {
      return null;
    }

    if (!res.ok) return null;

    let body: { result?: string | null };
    try {
      body = (await res.json()) as { result?: string | null };
    } catch {
      return null;
    }

    if (body.result == null) return null;

    try {
      return JSON.parse(body.result) as CachedReviewsPayload;
    } catch {
      return null;
    }
  }

  async set(slug: string, payload: CachedReviewsPayload): Promise<void> {
    try {
      await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify([
          "SET",
          cacheKey(slug, this.keyPrefix),
          JSON.stringify(payload),
          "EX",
          String(CACHE_TTL_SECONDS),
        ]),
      });
    } catch {
      // Cache writes are best-effort — a KV failure must not break the
      // route. Methodology §3 documents this by saying errors aren't cached;
      // by extension a write that itself errors is just a miss next time.
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }
}

export const __testing = {
  MemoryCache,
  KvRestCache,
};
