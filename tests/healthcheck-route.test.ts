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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET, __testing } from "@/app/api/healthcheck/route";
import { SemanticForceError } from "@/lib/semanticforce/types";

// SF_API_KEY drives BOTH the client path (unset → FixtureClient) and the
// route's `mode` field, so each test pins it explicitly. SF_API_BASE matters
// only when a key is present; we clear it by default and set it per-test.
const ENV_KEYS = ["SF_API_KEY", "SF_API_BASE"] as const;
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
});

describe("GET /api/healthcheck — down path (misconfig: key set, base missing)", () => {
  // SF_API_KEY present + SF_API_BASE absent → createSemanticForceClient()
  // throws SemanticForceError("bad_request", ...), caught at init. This is the
  // only env-reachable SF-throw → down branch; it also pins mode: "live".
  beforeEach(() => {
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
