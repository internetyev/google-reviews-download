// Liveness-probe contract guard for app/api/healthcheck/route.ts.
//
// /api/healthcheck is the SF dependency probe a human (or an uptime monitor)
// reads to decide "is the upstream answering?". Three things are a contract a
// silent change would regress: the HTTP status mapping (ok → 200, anything
// else → 503), the `mode` field (fixture vs live, inferred purely from
// SF_API_KEY presence), and the always-`Cache-Control: no-store` header (a
// cached health probe is a lie).
//
// `GET` itself takes no args and calls createSemanticForceClient() with no
// options, so the env-only paths are: ok/200 (fixture), and the misconfig
// SF-throw → down/503 (SF_API_KEY set without SF_API_BASE makes
// createSemanticForceClient() throw a SemanticForceError caught at init,
// which also pins mode: "live"). The `degraded` branch (client answers but
// res.place is falsy) and the getReviews()-throws → `down` branch are NOT
// reachable through env alone — FixtureClient(MOCK_SMALL_001) always returns
// a place and never throws.
//
// L8.5 closed that gap the way the suite family demands (no vi.mock — D-044):
// the route now exposes a real client-injection seam, `__testing.handle`,
// which `GET` calls with no argument (production path unchanged) but which
// accepts an optional pre-built SemanticForceClient. The `degraded` and
// `down`-on-throw branches below drive that seam with a tiny hand-written
// stub client, not a mocking framework — the stub is ordinary code that
// satisfies the SemanticForceClient interface, flowing through the exact
// same status/latency/error-envelope logic as a constructed client.
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, runtime, __testing } from "@/app/api/healthcheck/route";
import { SemanticForceError } from "@/lib/semanticforce/types";

// SF_API_KEY drives BOTH the client path (unset → FixtureClient) and the
// route's `mode` field, so each test pins it explicitly. SF_API_BASE matters
// only when a key is present; we clear it by default and set it per-test.
const ENV_KEYS = [
  "SF_API_KEY",
  "SF_API_BASE",
  "REVIEWS_PROVIDER",
  "SERPAPI_API_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("GET /api/healthcheck — ok path (fixture, no SF_API_KEY)", () => {
  it("returns 200 with status ok and mode fixture", async () => {
    // SF_API_KEY unset → createSemanticForceClient() → FixtureClient, and
    // MOCK_SMALL_001 carries place metadata so status resolves to "ok".
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("fixture");
    expect(body.error).toBeUndefined();
  });

  it("reports the probe place id and a numeric, non-negative latency_ms", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.place_id).toBe("MOCK_SMALL_001");
    expect(typeof body.latency_ms).toBe("number");
    expect(Number.isFinite(body.latency_ms)).toBe(true);
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("checked_at is a parseable ISO-8601 timestamp", async () => {
    const res = await GET();
    const body = await res.json();
    expect(typeof body.checked_at).toBe("string");
    expect(Number.isNaN(Date.parse(body.checked_at))).toBe(false);
    // round-trips back to the same instant (true ISO, not a loose date string)
    expect(new Date(body.checked_at).toISOString()).toBe(body.checked_at);
  });

  it("always sets Cache-Control: no-store (a cached health probe is a lie)", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports provider:mock when REVIEWS_PROVIDER is unset", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.provider).toBe("mock");
  });
});

describe("GET /api/healthcheck — provider-aware (L29.1)", () => {
  it("serpapi with a key → ok/live WITHOUT a live fetch (quota guard)", async () => {
    // A real getReviews(MOCK_SMALL_001) through the SerpApi client would make a
    // live call and fail on this fake key → down. Getting ok PROVES the probe
    // did not fetch: a constructed (creds-present) live client is reported ok.
    process.env.REVIEWS_PROVIDER = "serpapi";
    process.env.SERPAPI_API_KEY = "fake-but-present";
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.provider).toBe("serpapi");
    expect(body.mode).toBe("live");
    expect(body.error).toBeUndefined();
  });

  it("serpapi with NO key → down (provider can't construct)", async () => {
    process.env.REVIEWS_PROVIDER = "serpapi";
    delete process.env.SERPAPI_API_KEY;
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.provider).toBe("serpapi");
    expect(body.mode).toBe("live");
    expect(body.error?.code).toBe("unauthorized");
  });
});

describe("GET /api/healthcheck — down path (misconfig: semanticforce key set, base missing)", () => {
  // REVIEWS_PROVIDER=semanticforce + SF_API_KEY present + SF_API_BASE absent →
  // createReviewsProvider() → createSemanticForceClient() throws
  // SemanticForceError("bad_request", ...), caught at init → down/live.
  beforeEach(() => {
    process.env.REVIEWS_PROVIDER = "semanticforce";
    process.env.SF_API_KEY = "test-key-not-real";
    delete process.env.SF_API_BASE;
  });

  it("returns 503 with status down and the SemanticForce error code", async () => {
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.error?.code).toBe("bad_request");
    expect(typeof body.error?.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("infers mode: live purely from SF_API_KEY presence (even on the failure path)", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.mode).toBe("live");
  });

  it("still reports place_id, numeric latency_ms, and no-store on the failure path", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.place_id).toBe("MOCK_SMALL_001");
    expect(typeof body.latency_ms).toBe("number");
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/healthcheck — injected-client seam (L8.5, no mocks)", () => {
  // The seam is `__testing.handle(client?)`. A hand-written stub satisfying
  // the SemanticForceClient interface (a `getReviews` method) is passed
  // through it; no vi.mock anywhere. SF_API_KEY stays unset so `mode` is
  // "fixture" — proving the injected client flows through the same logic the
  // constructed one would, with mode still inferred purely from env.

  it("returns 503 status:degraded when the client answers without place metadata", async () => {
    // res.place falsy → degraded (the dependency answered but not usefully).
    // FixtureClient can never produce this; only the seam can reach it.
    const stub = {
      async getReviews() {
        return { place: undefined, reviews: [] } as never;
      },
    };
    const res = await __testing.handle(stub);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.mode).toBe("fixture");
    expect(body.error).toBeUndefined();
    expect(body.place_id).toBe("MOCK_SMALL_001");
    expect(typeof body.latency_ms).toBe("number");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 status:down with the SemanticForce code when getReviews() throws", async () => {
    const stub = {
      async getReviews(): Promise<never> {
        throw new SemanticForceError("upstream_error", "SF exploded");
      },
    };
    const res = await __testing.handle(stub);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.error?.code).toBe("upstream_error");
    expect(body.error?.message).toBe("SF exploded");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("maps a non-SemanticForce throw to error code unknown (still down/503)", async () => {
    const stub = {
      async getReviews(): Promise<never> {
        throw new Error("boom");
      },
    };
    const res = await __testing.handle(stub);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.error?.code).toBe("unknown");
    expect(body.error?.message).toBe("boom");
  });

  it("an injected client that returns place metadata still resolves ok/200", async () => {
    // Guards that the seam is a transparent pass-through, not a degraded-only
    // shortcut: a healthy injected client gets the identical ok mapping.
    const stub = {
      async getReviews() {
        return {
          place: { place_id: "X", name: "X", rating_avg: 5, rating_count: 1 },
          reviews: [],
        } as never;
      },
    };
    const res = await __testing.handle(stub);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.error).toBeUndefined();
  });
});

describe("GET /api/healthcheck — __testing surface", () => {
  it("exposes the stable probe place id used by the route", () => {
    // The route hard-codes this fixture id; the assertion locks it so a swap
    // (e.g. L4.1 picking a real well-known place) is a conscious, reviewed
    // change rather than a silent one.
    expect(__testing.PROBE_PLACE_ID).toBe("MOCK_SMALL_001");
  });

  it("exposes the client-injection handle seam (L8.5)", () => {
    expect(typeof __testing.handle).toBe("function");
  });
});

// L13.2 deepening (D-070): the existing suite drives `GET()` and the L8.5
// seam, but four cross-cutting load-bearing concerns the route's HTTP-contract
// guard never reached are pinned here — the Phase 13 pattern (D-069) of
// closing the gap between an internals-only suite and the public default
// export the Next runtime actually invokes.

describe("/api/healthcheck — runtime export freeze", () => {
  // Route-level config analogue of the L13.1/D-069 middleware `config.matcher`
  // pin: the route is documented as edge-runtime, and a refactor that dropped
  // `export const runtime = "edge"` silently moves the probe to the Node.js
  // runtime — different cold-start, different fetch semantics, different KV
  // wiring. None of the helper or seam tests can catch this; the named export
  // is the contract.
  it("ships as edge runtime", () => {
    expect(runtime).toBe("edge");
  });
});

describe("/api/healthcheck — response envelope structural shape", () => {
  // L13.1/D-069 pattern: pin the body shape via Object.keys, not just the
  // presence of specific fields, so a refactor that added a surplus key
  // (e.g. `details`, `hint`) or renamed `error.code` → `error_code` fails
  // loudly. Symmetric with the SemanticForceError envelope D-027 — the UI
  // and any uptime monitor parsing this body depends on the structural shape.
  it("ok body keys are exactly the documented set (no surplus, no missing)", async () => {
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "checked_at",
      "latency_ms",
      "mode",
      "place_id",
      "provider",
      "status",
    ]);
    expect("error" in body).toBe(false);
  });

  it("down body keys are exactly the documented set including the error wrapper", async () => {
    process.env.REVIEWS_PROVIDER = "semanticforce";
    process.env.SF_API_KEY = "test-key-not-real";
    delete process.env.SF_API_BASE;
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "checked_at",
      "error",
      "latency_ms",
      "mode",
      "place_id",
      "provider",
      "status",
    ]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });
});

describe("/api/healthcheck — Content-Type response header freeze", () => {
  // Uptime monitors and the in-house dashboard parse the JSON body; a
  // refactor that switched from NextResponse.json to NextResponse text or
  // dropped the content-type would still pass every status/envelope test
  // today but break every consumer that does `await res.json()`. Pin both
  // the ok and down paths so a regression on one is loud, not silent.
  it("ok path returns application/json", async () => {
    const res = await GET();
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  });

  it("down path also returns application/json", async () => {
    process.env.REVIEWS_PROVIDER = "semanticforce";
    process.env.SF_API_KEY = "test-key-not-real";
    delete process.env.SF_API_BASE;
    const res = await GET();
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  });
});

describe("/api/healthcheck — latency_ms is a real measurement", () => {
  // The existing suite asserts `latency_ms` is finite + `>= 0`. That passes
  // on a hard-coded `latency_ms: 0` and on a sign-flipped `startedAt -
  // Date.now()` regression (negative values still satisfy `>= 0` is false,
  // but a `Math.abs` wrapper would silence it). The monotonic-positive
  // contract D-069 named: `latency_ms === Date.now() - startedAt`, both the
  // arithmetic direction and the fact that it is a *measurement* (advances
  // with wall time between the two reads) — pinned via `vi.spyOn(Date,
  // "now")` returning a controlled two-value sequence so the assertion is on
  // an exact integer instead of a flaky real-time window.

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ok path: latency_ms equals (later Date.now() - earlier Date.now())", async () => {
    // Two Date.now() calls in handle(): startedAt then latencyMs. new Date()
    // for checked_at uses a separate internal time source and does not pass
    // through Date.now, so the spy intercepts exactly those two calls.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000_000); // startedAt
    nowSpy.mockReturnValueOnce(1_000_500); // post-getReviews
    const stub = {
      async getReviews() {
        return {
          place: { place_id: "X", name: "X", rating_avg: 5, rating_count: 1 },
          reviews: [],
        } as never;
      },
    };
    const res = await __testing.handle(stub);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latency_ms).toBe(500);
  });

  it("down path (throw): latency_ms is still measured against the start tick", async () => {
    // Distinct values from the ok test (500 vs 750) so a refactor that
    // hard-coded `latency_ms: 500` would pass the ok spy assertion but fail
    // here — pinning that the field is *computed*, not a constant.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(2_000_000); // startedAt
    nowSpy.mockReturnValueOnce(2_000_750); // post-throw
    const stub = {
      async getReviews(): Promise<never> {
        throw new SemanticForceError("upstream_error", "boom");
      },
    };
    const res = await __testing.handle(stub);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.latency_ms).toBe(750);
  });
});
