// Regression guard for lib/cache/reviews-cache.ts (L2.3, methodology §3).
// Pins three contracts that the route and KV depend on:
//   1. the versioned key shape (`gr:reviews:v1:<slug>`),
//   2. MemoryCache TTL expiry driven by an injected clock (no real timers),
//   3. the KV REST pipeline body/headers so a wire-format drift is caught
//      without a live KV (a stub `fetchImpl` records every call).

import { describe, it, expect } from "vitest";
import {
  cacheKey,
  createReviewsCache,
  CACHE_KEY_PREFIX,
  CACHE_TTL_SECONDS,
  __testing,
  type CachedReviewsPayload,
} from "@/lib/cache/reviews-cache";

const { MemoryCache, KvRestCache } = __testing;

function payload(): CachedReviewsPayload {
  return {
    place: {
      place_id: "ChIJTest",
      name: "Test Place",
      rating_avg: 4.2,
      rating_count: 1,
    },
    fetched_at: "2026-05-16T00:00:00.000Z",
    reviews: [
      {
        review_id: "r1",
        author_name: "A",
        rating: 5,
        text: "ok",
        published_at: "2026-05-01T00:00:00.000Z",
      },
    ],
  };
}

describe("cacheKey", () => {
  it("prefixes the slug with the versioned namespace", () => {
    expect(cacheKey("mock-small-001")).toBe(
      `${CACHE_KEY_PREFIX}mock-small-001`,
    );
    expect(CACHE_KEY_PREFIX).toBe("gr:reviews:v1:");
  });
});

describe("MemoryCache — TTL expiry via injected clock", () => {
  it("returns the payload before TTL and null once expired", async () => {
    let t = 1_000_000;
    const cache = new MemoryCache(() => t);
    await cache.set("slug", payload());

    // Just before expiry: hit.
    t += CACHE_TTL_SECONDS * 1000 - 1;
    expect(await cache.get("slug")).toEqual(payload());

    // One ms past TTL: miss, and the stale entry is evicted (a second get
    // is still a miss — proves delete, not just a comparison).
    t += 2;
    expect(await cache.get("slug")).toBeNull();
    t = 0;
    expect(await cache.get("slug")).toBeNull();
  });

  it("isolates entries per slug", async () => {
    const cache = new MemoryCache(() => 0);
    await cache.set("a", payload());
    expect(await cache.get("b")).toBeNull();
  });

  it("createReviewsCache falls back to MemoryCache when KV envs absent", async () => {
    const cache = createReviewsCache({ now: () => 0 });
    expect(cache).toBeInstanceOf(MemoryCache);
    await cache.set("s", payload());
    expect(await cache.get("s")).toEqual(payload());
  });
});

type RecordedCall = { url: string; init: RequestInit };

function stubFetch(result: string | null) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("KvRestCache — REST pipeline contract", () => {
  it("createReviewsCache builds a KvRestCache when both envs are passed", () => {
    const { fetchImpl } = stubFetch(null);
    const cache = createReviewsCache({
      kvRestApiUrl: "https://kv.example/",
      kvRestApiToken: "tok",
      fetchImpl,
    });
    expect(cache).toBeInstanceOf(KvRestCache);
  });

  it("set posts a SET pipeline with EX TTL and bearer auth", async () => {
    const { calls, fetchImpl } = stubFetch(null);
    // Trailing slash on the URL must be stripped.
    const cache = new KvRestCache({
      url: "https://kv.example/",
      token: "tok",
      fetchImpl,
    });
    const p = payload();
    await cache.set("slug", p);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://kv.example");
    const init = calls[0].init;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual([
      "SET",
      cacheKey("slug"),
      JSON.stringify(p),
      "EX",
      String(CACHE_TTL_SECONDS),
    ]);
  });

  it("get posts a GET pipeline and parses body.result JSON", async () => {
    const p = payload();
    const { calls, fetchImpl } = stubFetch(JSON.stringify(p));
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl,
    });

    const got = await cache.get("slug");
    expect(got).toEqual(p);
    expect(JSON.parse(calls[0].init.body as string)).toEqual([
      "GET",
      cacheKey("slug"),
    ]);
  });

  it("get returns null on a KV miss (result: null)", async () => {
    const { fetchImpl } = stubFetch(null);
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl,
    });
    expect(await cache.get("slug")).toBeNull();
  });

  it("get swallows a fetch throw and reports a miss", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl,
    });
    expect(await cache.get("slug")).toBeNull();
  });
});
