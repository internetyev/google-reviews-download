// Liveness-probe contract guard for app/api/healthcheck/route.ts.
//
// /api/healthcheck is the SF dependency probe a human (or an uptime monitor)
// reads to decide "is the upstream answering?". Three things are a contract a
// silent change would regress: the HTTP status mapping (ok → 200, anything
// else → 503), the `mode` field (fixture vs live, inferred purely from
// SF_API_KEY presence), and the always-`Cache-Control: no-store` header (a
// cached health probe is a lie).
//
// The route's GET takes no args and calls createSemanticForceClient() with no
// options, so there is NO injection seam: the `degraded` branch (client
// answers but res.place is falsy) and the getReviews()-throws → `down` branch
// are not reachable through env alone — FixtureClient(MOCK_SMALL_001) always
// returns a place and never throws. We deliberately do NOT introduce vi.mock
// to force them (the whole suite family is no-mock, env + real NextRequest /
// injected stubs — D-044), and instead exercise the *other* genuine SF-throw →
// `down` path the route exposes: a misconfig where SF_API_KEY is set but
// SF_API_BASE is missing makes createSemanticForceClient() throw a
// SemanticForceError, which the route catches at init and reports as `down`
// with mode `live`. That single case covers the down/503 mapping, the
// error-envelope shape, and the `mode: "live"` inference at once. The
// degraded / getReviews-throw limitation is documented here, not worked
// around — closing it needs a client-injection seam on the route (a future
// leaf), not a test hack.
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET, __testing } from "@/app/api/healthcheck/route";

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

describe("GET /api/healthcheck — __testing surface", () => {
  it("exposes the stable probe place id used by the route", () => {
    // The route hard-codes this fixture id; the assertion locks it so a swap
    // (e.g. L4.1 picking a real well-known place) is a conscious, reviewed
    // change rather than a silent one.
    expect(__testing.PROBE_PLACE_ID).toBe("MOCK_SMALL_001");
  });
});
