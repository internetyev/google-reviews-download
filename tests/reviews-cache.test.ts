// Regression guard for lib/cache/reviews-cache.ts (L2.3, methodology §3).
// Pins three contracts that the route and KV depend on:
//   1. the versioned key shape (`gr:reviews:v1:<slug>`),
//   2. MemoryCache TTL expiry driven by an injected clock (no real timers),
//   3. the KV REST pipeline body/headers so a wire-format drift is caught
//      without a live KV (a stub `fetchImpl` records every call).
//
// L12.2 deepening (D-066): three load-bearing concerns the first-pass suite
// never reached are now pinned:
//   (a) TTL boundary direction (`>` not `>=` at exact `expires_at`) + the
//       absolute `CACHE_TTL_SECONDS === 86400` literal freeze — a "12h" typo
//       is invisible until SF spend doubles next week.
//   (b) `KvRestCache.get` error-class fan-in (non-2xx, malformed JSON, bad
//       `result` JSON, undefined `result`) plus the symmetric `set`
//       best-effort swallow that has no test today — a refactor narrowing
//       any catch would crash `/api/reviews` on a KV outage after the user
//       already paid for the SF API call.
//   (c) `get` REST-pipeline header symmetry with `set` (trailing-slash strip,
//       Bearer auth, Content-Type) — the existing test pins these on `set`
//       only, so a refactor that broke them on `get` would still pass both
//       existing suites and stay silent until L4.1 hit a live KV.

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

describe("CACHE_TTL_SECONDS — absolute literal freeze", () => {
  // Methodology §3 documents a 24h TTL. Pin both the named arithmetic and
  // the literal: the named form catches a swap to `12 * 60 * 60`, the literal
  // catches a swap to `24 * 60` (1440s, "24m") that the named form would
  // also pass. Either drift silently doubles or 60xs our SF API spend until
  // the next deploy notices the bill — pin it at our edge.
  it("is the documented 24h, expressed both ways", () => {
    expect(CACHE_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(CACHE_TTL_SECONDS).toBe(86400);
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

  it("treats the exact expires_at tick as a hit (boundary direction `>` not `>=`)", async () => {
    // `MemoryCache.get` uses `this.now() > entry.expires_at` (strict `>`),
    // so the tick that equals `expires_at` must still be a hit, and
    // `expires_at + 1` must be the first miss. A refactor flipping the
    // operator to `>=` would expire entries one ms early on every call —
    // a fixed 1-ms TTL truncation that is invisible in normal use but
    // surfaces under the rare overlap of `now()` and `expires_at`. Pin
    // both sides of the boundary so either flip fails loudly.
    let t = 0;
    const cache = new MemoryCache(() => t);
    await cache.set("slug", payload());

    // Exactly at expires_at — must still hit.
    t = CACHE_TTL_SECONDS * 1000;
    expect(await cache.get("slug")).toEqual(payload());

    // expires_at + 1 — must be the first miss.
    t = CACHE_TTL_SECONDS * 1000 + 1;
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

  it("get strips the trailing slash, sends Bearer auth + JSON Content-Type (header symmetry with set)", async () => {
    // The existing `set posts a SET pipeline` test pins URL trailing-slash
    // strip, Bearer auth, and Content-Type on the `set` path; the `get`
    // path was only asserted on body shape. A refactor that broke any of
    // these on `get` (e.g. moved `headers()` out of `KvRestCache.get` while
    // keeping it in `set`) would still pass both existing suites and stay
    // silent until L4.1 hit a live KV that rejected the malformed request.
    // Pin the three properties symmetrically.
    const { calls, fetchImpl } = stubFetch(null);
    const cache = new KvRestCache({
      url: "https://kv.example/",
      token: "tok",
      fetchImpl,
    });
    await cache.get("slug");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://kv.example");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("KvRestCache — error-class fan-in (every documented catch path)", () => {
  // The implementation explicitly catches four error-classes inside `get`
  // and fans them all into `null` (a miss). The original suite covered only
  // two of them (`result: null` and a synchronous fetch throw). A refactor
  // narrowing any of the remaining `catch` blocks to a specific error type
  // (or dropping one entirely) would let a transient KV outage crash
  // `/api/reviews` instead of degrading to a miss — silent until production.

  function fixedFetch(response: Response) {
    const fetchImpl = (async () => response) as unknown as typeof fetch;
    return fetchImpl;
  }

  it("get returns null on a non-2xx response (KV REST 5xx)", async () => {
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl: fixedFetch(new Response("", { status: 502 })),
    });
    expect(await cache.get("slug")).toBeNull();
  });

  it("get returns null when the 200 body is not parseable JSON", async () => {
    // Triggers the inner `await res.json()` catch — a `Content-Type:
    // application/json` response whose body is "not json".
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl: fixedFetch(
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });
    expect(await cache.get("slug")).toBeNull();
  });

  it("get returns null when body.result is a non-JSON string", async () => {
    // Triggers the inner `JSON.parse(body.result)` catch — the outer envelope
    // parses fine, but the value KV returned isn't a serialised payload.
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl: fixedFetch(
        new Response(JSON.stringify({ result: "not json" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });
    expect(await cache.get("slug")).toBeNull();
  });

  it("get returns null when body.result is undefined (envelope without a value)", async () => {
    // `body.result == null` covers both explicit `null` (already tested) and
    // `undefined` (the field absent entirely — a future KV REST behaviour
    // for "key not found" that ships an envelope without `result`). The
    // `result: null` path is covered above; this pins the `undefined` half
    // of the loose-equality check separately.
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl: fixedFetch(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });
    expect(await cache.get("slug")).toBeNull();
  });

  it("set resolves even when fetchImpl throws (best-effort write contract)", async () => {
    // The route shape (`route.ts` does `await cache.set(...)` after the SF
    // walk) means an unhandled rejection here would 500 the response after
    // the user already paid for the SF API call. The existing suite has no
    // `set`-throw test at all — pin the swallow.
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const cache = new KvRestCache({
      url: "https://kv.example",
      token: "tok",
      fetchImpl,
    });
    await expect(cache.set("slug", payload())).resolves.toBeUndefined();
  });
});
