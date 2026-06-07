// Coverage for the L27.4 preview cache namespace (lib/cache/reviews-cache.ts).
// The whole point of a separate preview cache is correctness: a partial
// preview payload must NEVER be visible to a full-walk download request, and
// vice-versa. These tests pin that isolation plus the shared TTL behaviour.

import { describe, it, expect } from "vitest";
import {
  createReviewsCache,
  createPreviewCache,
  cacheKey,
  CACHE_KEY_PREFIX,
  PREVIEW_KEY_PREFIX,
  CACHE_TTL_SECONDS,
  type CachedReviewsPayload,
} from "@/lib/cache/reviews-cache";

const SLUG = "0x1-0x2";

function payload(n: number): CachedReviewsPayload {
  return {
    place: {
      place_id: SLUG,
      name: "Test",
      rating_avg: 4.5,
      rating_count: 100,
    },
    reviews: Array.from({ length: n }, (_, i) => ({
      review_id: `r${i}`,
      author_name: "A",
      rating: 5 as const,
      text: "ok",
      published_at: "2025-01-01T00:00:00Z",
    })),
    fetched_at: "2025-01-01T00:00:00Z",
  };
}

describe("preview vs reviews cache namespace isolation", () => {
  it("uses distinct key prefixes", () => {
    expect(PREVIEW_KEY_PREFIX).not.toBe(CACHE_KEY_PREFIX);
    expect(cacheKey(SLUG, PREVIEW_KEY_PREFIX)).not.toBe(cacheKey(SLUG));
  });

  it("a preview-cached partial payload is NOT visible to the reviews cache", async () => {
    // Force MemoryCache (no KV env) with a shared clock; but each create* call
    // makes its own MemoryCache instance, so isolation must come from the KEY,
    // not the store — drive both through one KV store to prove the key space.
    const store = new Map<string, string>();
    const fetchImpl = makeKvStore(store);
    const opts = {
      kvRestApiUrl: "https://kv.example",
      kvRestApiToken: "t",
      fetchImpl,
    };
    const reviews = createReviewsCache(opts);
    const preview = createPreviewCache(opts);

    await preview.set(SLUG, payload(5)); // a 5-review preview
    const fromReviews = await reviews.get(SLUG); // a download would read here
    expect(fromReviews).toBeNull(); // must NOT see the partial preview

    const fromPreview = await preview.get(SLUG);
    expect(fromPreview?.reviews).toHaveLength(5);
  });

  it("a full-walk payload is NOT served to the preview cache key", async () => {
    const store = new Map<string, string>();
    const opts = {
      kvRestApiUrl: "https://kv.example",
      kvRestApiToken: "t",
      fetchImpl: makeKvStore(store),
    };
    const reviews = createReviewsCache(opts);
    const preview = createPreviewCache(opts);

    await reviews.set(SLUG, payload(500));
    expect(await preview.get(SLUG)).toBeNull();
    expect((await reviews.get(SLUG))?.reviews).toHaveLength(500);
  });

  it("preview cache honours the 24h TTL via an injected clock", async () => {
    let t = 0;
    const preview = createPreviewCache({ now: () => t });
    await preview.set(SLUG, payload(5));
    t = CACHE_TTL_SECONDS * 1000; // exactly at expiry → still a hit
    expect(await preview.get(SLUG)).not.toBeNull();
    t = CACHE_TTL_SECONDS * 1000 + 1; // one ms past → miss
    expect(await preview.get(SLUG)).toBeNull();
  });
});

// Minimal Upstash/Vercel-KV REST stub backed by an in-test Map, so both caches
// share one real key space and isolation can only come from the key prefix.
function makeKvStore(store: Map<string, string>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const cmd = JSON.parse(String(init?.body)) as string[];
    const [op, key, value] = cmd;
    if (op === "SET") {
      store.set(key, value);
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    }
    // GET
    const result = store.has(key) ? store.get(key)! : null;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;
}
