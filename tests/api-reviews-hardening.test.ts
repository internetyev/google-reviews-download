// Input-hardening guard for app/api/reviews/route.ts (L30.5).
//
// The `/api/reviews` route accepts a free-text `placeId` that doubles as a
// business-name on the serpapi provider, and an optional `limit`. Both are
// attacker/typo reachable on the public HTTP surface, so the route must reject
// malformed input with a typed 400 envelope BEFORE it reaches the quota-metered
// SerpApi name resolver (a blank/over-long/control-char string would otherwise
// burn a search on garbage) and must clamp an absurd `limit` rather than try to
// assemble millions of rows.
//
// Two layers, both offline (no network, no KV):
//  - the pure `validateInput` / `parseLimit` helpers via `__testing`, where the
//    clamp ceiling is directly observable (a 12-review fixture can't show it);
//  - the public GET handler with a real NextRequest, proving each malformed
//    branch surfaces the D-027 `{ error: { code, message } }` envelope and a
//    400, and that the blank-after-trim case is distinct from missing-param.
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the sibling api-reviews suite).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, __testing } from "@/app/api/reviews/route";

const { validateInput, parseLimit, MAX_INPUT_LENGTH, MAX_LIMIT } = __testing;

// Neutralise env so the route is deterministic on any host (mirrors the sibling
// api-reviews suite): no SF key → fixture client, no KV → fresh memory cache.
const ENV_KEYS = [
  "SF_API_KEY",
  "SF_API_BASE",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
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

function call(query: string) {
  return GET(new NextRequest(`https://grd.test/api/reviews${query}`));
}

describe("validateInput — free-text placeId hardening (pure)", () => {
  it("accepts a normal id and returns it unchanged", () => {
    expect(validateInput("MOCK_SMALL_001")).toEqual({
      ok: true,
      value: "MOCK_SMALL_001",
    });
  });

  it("accepts a business name and a Google Maps URL", () => {
    expect(validateInput("Joe's Coffee Shop")).toEqual({
      ok: true,
      value: "Joe's Coffee Shop",
    });
    const url = "https://www.google.com/maps/place/?q=place_id:ChIJxxxxxxxxxxxxxxxxxxxxxxx";
    expect(validateInput(url)).toEqual({ ok: true, value: url });
  });

  it("trims surrounding whitespace from a valid input", () => {
    expect(validateInput("  ChIJ_value  ")).toEqual({
      ok: true,
      value: "ChIJ_value",
    });
  });

  it("rejects blank / whitespace-only input (distinct from missing param)", () => {
    for (const blank of ["", "   ", "\t\n  "]) {
      const r = validateInput(blank);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/blank/i);
    }
  });

  it("rejects input longer than MAX_INPUT_LENGTH, accepts at the boundary", () => {
    const atCap = "a".repeat(MAX_INPUT_LENGTH);
    expect(validateInput(atCap)).toEqual({ ok: true, value: atCap });

    const overCap = "a".repeat(MAX_INPUT_LENGTH + 1);
    const r = validateInput(overCap);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/too long/i);
  });

  it("rejects raw control characters (NUL, newline, tab, DEL)", () => {
    for (const ctrl of ["\u0000", "\n", "\t", "\u007f", "\u001f"]) {
      const r = validateInput(`ChIJ${ctrl}value`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/control character/i);
    }
  });

  it("MAX_INPUT_LENGTH is a sane bound that fits ids/URLs/names but not multi-KB", () => {
    // Pin the order of magnitude so a refactor can't loosen it to, say, 1e9
    // (no bound) or tighten it below a legitimate long Maps URL.
    expect(MAX_INPUT_LENGTH).toBeGreaterThanOrEqual(256);
    expect(MAX_INPUT_LENGTH).toBeLessThanOrEqual(8_192);
  });
});

describe("parseLimit — limit parse + clamp (pure)", () => {
  it("absent limit → undefined (no slice)", () => {
    expect(parseLimit(null)).toEqual({ ok: true, value: undefined });
  });

  it("floors a fractional limit", () => {
    expect(parseLimit("3.7")).toEqual({ ok: true, value: 3 });
  });

  it("passes a normal in-range limit through unchanged", () => {
    expect(parseLimit("50")).toEqual({ ok: true, value: 50 });
  });

  it("clamps an absurd limit down to MAX_LIMIT (does not reject it)", () => {
    expect(parseLimit("9999999")).toEqual({ ok: true, value: MAX_LIMIT });
    // Exactly at the ceiling stays at the ceiling.
    expect(parseLimit(String(MAX_LIMIT))).toEqual({ ok: true, value: MAX_LIMIT });
    // One past the ceiling is clamped, not passed through.
    expect(parseLimit(String(MAX_LIMIT + 1))).toEqual({
      ok: true,
      value: MAX_LIMIT,
    });
  });

  it("rejects non-numeric / NaN / Infinity / non-positive", () => {
    for (const bad of ["abc", "0", "-5", "Infinity", "1e999", "NaN"]) {
      const r = parseLimit(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/limit/i);
    }
  });
});

describe("GET /api/reviews — hardening branches surface a 400 envelope", () => {
  it("whitespace-only placeId → 400 blank (not the missing-param message)", async () => {
    const res = await call("?placeId=%20%20%20");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/blank/i);
  });

  it("over-long placeId → 400 too-long", async () => {
    const huge = "a".repeat(MAX_INPUT_LENGTH + 100);
    const res = await call(`?placeId=${huge}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/too long/i);
  });

  it("placeId carrying a control character (decoded %0A newline) → 400", async () => {
    const res = await call(`?placeId=${encodeURIComponent("ChIJ\nvalue")}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/control character/i);
  });

  it("absurd limit on an otherwise-valid request is clamped, not rejected", async () => {
    // The 12-review fixture can't show the clamp value, but it MUST NOT 400:
    // over-asking is benign and the user gets everything we have.
    const res = await call("?placeId=MOCK_SMALL_001&limit=9999999");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(12);
  });
});
