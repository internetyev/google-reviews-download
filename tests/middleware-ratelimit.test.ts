// Regression guard for middleware.ts (L2.8, methodology §4 — edge rate-limit).
// Pins the three contracts the abuse surface depends on, all driven by an
// injected store + an explicit `now` (no real timers, no shared module Map):
//   1. `identify` IP resolution — XFF-leftmost › x-real-ip › "unknown",
//      keyed `${ip}:${route}` so two routes never share a bucket.
//   2. token-bucket arithmetic — exactly BUCKET_CAPACITY requests in a
//      burst, the (capacity+1)th denied, one token back after exactly
//      RETRY_AFTER_SECONDS and not a tick before.
//   3. opportunistic eviction — an entry older than EVICTION_WINDOW_MS is
//      deleted and replaced (new object identity), not merely refilled.
//
// Committed, not run in-routine: repo is manifest-only, no node_modules,
// `npm install` is a human step (D-039/D-040/D-042 posture). Runs on
// `npm install && npm test`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { __testing, middleware, config } from "@/middleware";

const {
  consumeToken,
  identify,
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
  RETRY_AFTER_SECONDS,
  EVICTION_WINDOW_MS,
  buckets,
} = __testing;

type Bucket = { tokens: number; updated_at: number };

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://example.com/api/reviews", { headers });
}

describe("middleware constants", () => {
  it("match the documented 10-token / 10-per-min bucket", () => {
    expect(BUCKET_CAPACITY).toBe(10);
    expect(REFILL_PER_SECOND).toBeCloseTo(10 / 60, 10);
    // RETRY_AFTER_SECONDS is one token's worth of refill time.
    expect(RETRY_AFTER_SECONDS).toBe(Math.round(1 / REFILL_PER_SECOND));
    expect(EVICTION_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});

describe("identify — client IP resolution", () => {
  it("takes the leftmost X-Forwarded-For entry and scopes by route", () => {
    const r = req({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(identify(r, "/api/reviews")).toBe("203.0.113.7:/api/reviews");
  });

  it("trims whitespace around the leftmost XFF entry", () => {
    const r = req({ "x-forwarded-for": "  198.51.100.9  , 10.0.0.1" });
    expect(identify(r, "/api/reviews")).toBe("198.51.100.9:/api/reviews");
  });

  it("falls back to x-real-ip when XFF is absent", () => {
    const r = req({ "x-real-ip": "192.0.2.44" });
    expect(identify(r, "/api/reviews")).toBe("192.0.2.44:/api/reviews");
  });

  it("falls back to x-real-ip when XFF is present but empty", () => {
    const r = req({ "x-forwarded-for": "  ", "x-real-ip": "192.0.2.99" });
    expect(identify(r, "/api/reviews")).toBe("192.0.2.99:/api/reviews");
  });

  it("uses 'unknown' when no IP header is present", () => {
    expect(identify(req({}), "/api/reviews")).toBe("unknown:/api/reviews");
  });

  it("scopes the bucket key per route so paths do not share a bucket", () => {
    const r = req({ "x-real-ip": "192.0.2.1" });
    expect(identify(r, "/api/reviews")).not.toBe(identify(r, "/api/other"));
  });
});

describe("consumeToken — token-bucket arithmetic", () => {
  it("allows exactly BUCKET_CAPACITY requests in an instantaneous burst", () => {
    const store = new Map<string, Bucket>();
    const now = 1_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) {
      expect(consumeToken("k", now, store)).toBe(true);
    }
    // The capacity+1th request in the same instant is denied.
    expect(consumeToken("k", now, store)).toBe(false);
  });

  it("starts a never-seen key with a full bucket (no prior → capacity)", () => {
    const store = new Map<string, Bucket>();
    expect(consumeToken("fresh", 0, store)).toBe(true);
    expect(store.get("fresh")?.tokens).toBeCloseTo(BUCKET_CAPACITY - 1, 10);
  });

  it("refills one token after exactly RETRY_AFTER_SECONDS, not a tick before", () => {
    const store = new Map<string, Bucket>();
    const t0 = 5_000_000;
    // Drain the bucket dry.
    for (let i = 0; i < BUCKET_CAPACITY; i++) consumeToken("k", t0, store);
    expect(consumeToken("k", t0, store)).toBe(false);

    // Just under the retry window: still under one whole token → denied.
    const justBefore = t0 + RETRY_AFTER_SECONDS * 1000 - 1;
    expect(consumeToken("k", justBefore, store)).toBe(false);

    // Exactly RETRY_AFTER_SECONDS after the last denial's recorded time.
    // The denied path rewrites updated_at to the denial instant, so the
    // window is measured from `justBefore`, not from `t0`.
    const at = justBefore + RETRY_AFTER_SECONDS * 1000;
    expect(consumeToken("k", at, store)).toBe(true);
  });

  it("caps refill at BUCKET_CAPACITY no matter how long the gap", () => {
    const store = new Map<string, Bucket>();
    consumeToken("k", 0, store); // tokens → capacity-1
    // A gap of an hour would refill far past capacity if unclamped.
    const at = 60 * 60 * 1000;
    expect(consumeToken("k", at, store)).toBe(true);
    expect(store.get("k")?.tokens).toBeCloseTo(BUCKET_CAPACITY - 1, 6);
  });

  it("keeps separate buckets per key", () => {
    const store = new Map<string, Bucket>();
    for (let i = 0; i < BUCKET_CAPACITY; i++) consumeToken("a", 0, store);
    expect(consumeToken("a", 0, store)).toBe(false);
    // A different key is untouched and still has a full bucket.
    expect(consumeToken("b", 0, store)).toBe(true);
  });
});

// Eviction and a long-gap refill are observationally identical through the
// return value alone — both leave a fresh capacity-1 bucket (prior=null →
// capacity, vs prior={0,old} → min(cap, 0 + bigElapsed*refill) = cap), and
// the success path always `store.set`s a new object regardless. The only
// distinguishing signal is whether `store.delete` is invoked, so these
// tests pass a recording store that backs onto a real Map but counts
// delete calls — proving the branch fires strictly past the window edge.
function recordingStore() {
  const map = new Map<string, Bucket>();
  const deleted: string[] = [];
  const store = {
    get: (k: string) => map.get(k),
    set: (k: string, v: Bucket) => map.set(k, v),
    delete: (k: string) => {
      deleted.push(k);
      return map.delete(k);
    },
  } as unknown as Map<string, Bucket>;
  return { store, map, deleted };
}

describe("consumeToken — opportunistic eviction", () => {
  it("deletes an entry strictly older than EVICTION_WINDOW_MS", () => {
    const { store, deleted } = recordingStore();
    store.set("k", { tokens: 0, updated_at: 0 });

    // One ms past the window → the stale empty entry is dropped and the
    // request still succeeds off a rebuilt full bucket.
    const at = EVICTION_WINDOW_MS + 1;
    expect(consumeToken("k", at, store)).toBe(true);
    expect(deleted).toEqual(["k"]);
    expect(store.get("k")?.tokens).toBeCloseTo(BUCKET_CAPACITY - 1, 6);
  });

  it("does NOT evict an entry exactly at the window edge (refills in place)", () => {
    const { store, deleted } = recordingStore();
    store.set("k", { tokens: 0, updated_at: 0 });

    // now - updated_at === EVICTION_WINDOW_MS is not strictly greater, so
    // no delete — the empty bucket refills (10 min caps it back to full)
    // and the request succeeds without the entry ever being evicted.
    expect(consumeToken("k", EVICTION_WINDOW_MS, store)).toBe(true);
    expect(deleted).toEqual([]);
  });

  it("does NOT evict a recently-touched entry", () => {
    const { store, deleted } = recordingStore();
    consumeToken("k", 1_000, store);
    consumeToken("k", 2_000, store);
    expect(deleted).toEqual([]);
  });
});

// L13.1 / D-069: the existing suite above tests only `__testing` internals;
// the public `middleware()` default export the Next runtime actually invokes
// has no end-to-end coverage. The three describes below pin the HTTP-response
// contract — `config.matcher` exact scope, the 429 + Retry-After + envelope
// shape on denial (symmetric with `SemanticForceError` per D-027), and the
// pass-through on allow — driving the real exported function with a real
// `NextRequest` and freezing `Date.now()` so the bucket arithmetic stays
// deterministic across calls. `buckets.clear()` per test isolates the
// module-level Map the public path reads (the internals suite uses injected
// stores and is unaffected).

describe("config.matcher — route scope freeze", () => {
  it("meters /api/reviews only (exact-equals array, no glob, no narrowing)", () => {
    // A widening to ["/api/(.*)"] silently starts metering /api/healthcheck;
    // a narrowing to [] silently leaves the abuse surface unmetered; a swap
    // to a bare string "/api/reviews" is valid Next config but breaks the
    // array shape this suite documents. Exact-equals pins all three.
    expect(config.matcher).toEqual(["/api/reviews"]);
  });
});

function apiReq(ip = "192.0.2.7"): NextRequest {
  return new NextRequest("https://example.com/api/reviews", {
    headers: { "x-real-ip": ip },
  });
}

describe("middleware() — denial response contract (429 envelope, Retry-After)", () => {
  // Freeze Date.now so the (capacity+1)th call lands at exactly the same
  // tick as the first — the bucket-refill arithmetic adds zero tokens
  // back, the boundary is unambiguous, and the test cannot flake on a
  // millisecond of wall-clock drift mid-loop.
  beforeEach(() => {
    buckets.clear();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    buckets.clear();
  });

  it("returns 429 with Retry-After=6 on the (BUCKET_CAPACITY+1)th request from the same IP", async () => {
    for (let i = 0; i < BUCKET_CAPACITY; i++) {
      const r = await middleware(apiReq());
      expect(r.status).not.toBe(429);
    }
    const res = await middleware(apiReq());
    expect(res.status).toBe(429);
    // Both forms: the named-constant catches a typo to the constant's value,
    // the literal "6" catches a refactor that changed RETRY_AFTER_SECONDS
    // while leaving the header serialisation intact.
    expect(res.headers.get("Retry-After")).toBe(String(RETRY_AFTER_SECONDS));
    expect(res.headers.get("Retry-After")).toBe("6");
  });

  it("denial JSON body is structurally `{error:{code,message}}` (D-027 envelope symmetric with SemanticForceError)", async () => {
    for (let i = 0; i < BUCKET_CAPACITY; i++) await middleware(apiReq());
    const res = await middleware(apiReq());
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: { code: string; message: string } };
    // Exactly the documented envelope — no extra top-level keys, no extra
    // error-object keys. A refactor that dropped the wrapper (`{code,message}`),
    // renamed `code` → `error_code`, or returned `{error:"rate_limited"}` (string
    // form) would still 429-the-user, still pass every internals test, and
    // silently break every UI consumer that destructures body.error.code.
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe("rate_limited");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

describe("middleware() — pass-through on allow", () => {
  beforeEach(() => {
    buckets.clear();
  });
  afterEach(() => {
    buckets.clear();
  });

  it("first request from a fresh IP returns a non-429 with no Retry-After header", async () => {
    const res = await middleware(apiReq("203.0.113.99"));
    // The contract under test is "the pass-through path does not look like a
    // denial" — pinning the exact NextResponse.next() sentinel header
    // (x-middleware-next: 1) is a Next-runtime internal that has moved
    // across minor versions (D-043 tolerant-pin precedent), so we assert
    // the load-bearing negatives instead.
    expect(res.status).not.toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});
