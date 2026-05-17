// Param-validation + response-contract guard for app/api/reviews/route.ts.
//
// This is the public HTTP surface: the order of the 400 checks and the exact
// error envelope (`{ error: { code, message } }`) are a contract the form
// (app/_components/review-tool-form.tsx) and any API consumer depend on, and
// the success-path Content-Type / Content-Disposition headers decide whether
// a browser downloads a file with the right name and MIME. A silent change to
// any of these is a user-visible regression.
//
// The handler is exercised by importing GET directly and handing it a real
// `NextRequest` (the route reads `req.nextUrl.searchParams`, which a plain
// `Request` does not expose). No network and no KV: with SF_API_KEY unset the
// SF client serves the committed `MOCK_SMALL_001` fixture, and with KV_* unset
// createReviewsCache() falls back to a fresh process-local Map (every request
// is a MISS). Committed, not run in-routine (no node_modules; `npm install`
// is a human step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reviews/route";

// Pin a known-empty env so "no key → fixture" and "no KV → memory" hold on any
// host (mirrors tests/sf-client.test.ts). KV_* is cleared too so the success
// path never reaches for a real Vercel KV REST endpoint.
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

describe("GET /api/reviews — param validation (400 bad_request envelope)", () => {
  it("missing placeId → 400 with code bad_request naming the param", async () => {
    const res = await call("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/placeId/);
  });

  it("unsupported format → 400 listing the supported formats", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/json, csv, xlsx/);
  });

  it("non-numeric limit → 400 bad_request", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&limit=abc");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("zero / negative limit → 400 bad_request", async () => {
    for (const bad of ["0", "-5"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&limit=${bad}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
  });

  it("unparseable placeId (goo.gl short link, D-018) → 400 bad_request", async () => {
    const res = await call(
      "?placeId=" + encodeURIComponent("https://maps.app.goo.gl/abc123"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("placeId presence is checked before format validity", async () => {
    // Both are invalid; the missing-placeId message must win (check order is
    // the contract — the form surfaces the first error).
    const res = await call("?format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/placeId/);
  });
});

describe("GET /api/reviews — success-path response contract", () => {
  it("default (no format) → 200 JSON envelope with place/reviews/fetched_at", async () => {
    const res = await call("?placeId=MOCK_SMALL_001");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS"); // fresh memory cache
    const body = await res.json();
    expect(body.place.place_id).toBe("MOCK_SMALL_001");
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(body.reviews.length).toBeGreaterThan(0);
    expect(typeof body.fetched_at).toBe("string");
  });

  it("format=csv → text/csv with an attachment .csv filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename=".+\.csv"$/,
    );
  });

  it("format=xlsx → spreadsheet MIME with an attachment .xlsx filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename=".+\.xlsx"$/,
    );
  });

  it("format is case-insensitive (CSV behaves as csv)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=CSV");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  });
});

describe("GET /api/reviews — __testing surface", () => {
  it("statusForCode maps SF error codes to HTTP status, upstream wins", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    expect(__testing.statusForCode("not_found")).toBe(404);
    expect(__testing.statusForCode("unauthorized")).toBe(401);
    expect(__testing.statusForCode("rate_limited")).toBe(429);
    expect(__testing.statusForCode("bad_request")).toBe(400);
    expect(__testing.statusForCode("upstream_error")).toBe(502);
    // An explicit upstream status in the 4xx/5xx band overrides the map.
    expect(__testing.statusForCode("not_found", 503)).toBe(503);
  });

  it("inferRetryAfter parses a hint from the message, else defaults to 30", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    const { SemanticForceError } = await import(
      "@/lib/semanticforce/types"
    );
    expect(
      __testing.inferRetryAfter(
        new SemanticForceError("rate_limited", "retry-after 12s", 429),
      ),
    ).toBe(12);
    expect(
      __testing.inferRetryAfter(
        new SemanticForceError("rate_limited", "slow down", 429),
      ),
    ).toBe(30);
  });
});
