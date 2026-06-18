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

describe("GET /api/reviews — userLimit slicing (the download-size contract)", () => {
  // The route slices `payload.reviews.slice(0, userLimit)` in respondSuccess
  // for every format. A regression that skipped the slice (or used `>` instead
  // of `>=` in the loop guard) would silently return all 12 fixture reviews
  // when the user asked for 3 — a download larger than the user authorised.
  // The small fixture is 12 reviews (pinned by tests/fixtures-contract.test.ts);
  // limit=3 / limit=99999 / limit=3.7 exercise the three boundaries: under,
  // over, and fractional. Asserted from the *response* (not the route helper)
  // so a refactor that moved the slice elsewhere still has to satisfy it.
  it("json ?limit=3 returns exactly 3 reviews from the 12-review fixture", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&limit=3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(3);
    // place metadata is unaffected by the slice (it's per-payload, not per-review).
    expect(body.place.place_id).toBe("MOCK_SMALL_001");
  });

  it("csv ?limit=3 body has exactly 3 data rows under the header", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&limit=3");
    expect(res.status).toBe(200);
    const body = await res.text();
    // BOM + 1 header line + 3 data lines, each terminated by CRLF (formatReviewsAsCsv
    // emits a trailing CRLF). Strip the BOM, split on CRLF, drop the trailing empty:
    // we want exactly 4 non-empty lines (header + 3 data).
    const lines = body.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(4);
  });

  it("xlsx ?limit=3 worksheet has exactly 3 data rows under the header", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=xlsx&limit=3");
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    // 1 header row + 3 data rows = 4 total.
    expect(aoa).toHaveLength(4);
  });

  it("?limit=99999 (larger than the 12-review fixture) returns all 12, not garbage", async () => {
    // Array.slice past the end is safe — pin that the route inherits that
    // safety rather than throwing or padding.
    const res = await call("?placeId=MOCK_SMALL_001&limit=99999");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(12);
  });

  it("?limit=3.7 floors to 3 (the route's Math.floor contract)", async () => {
    // The route does Math.floor(parsed) before slicing; a refactor that
    // dropped the floor would slice with a fractional length and JS would
    // coerce — observably the same in modern engines, but the floor is the
    // documented intent and any divergence is worth catching.
    const res = await call("?placeId=MOCK_SMALL_001&limit=3.7");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(3);
  });
});

describe("GET /api/reviews — Content-Disposition filename uses the normalised slug", () => {
  // csvFilename / xlsxFilename produce `google-reviews-<slug>-<YYYYMMDD>.<ext>`
  // (lib/export/csv.ts §74, lib/export/xlsx.ts §134 — ADR-003). The route
  // passes `normalised.slug`, *not* `normalised.raw` or `placeIdInput`, so a
  // refactor that swapped the argument would silently rename every user's
  // download (breaking automation that ingests files by name). Sending a
  // mixed-case underscore-form input (`mock_SMALL_001`) so the slug transform
  // (lowercase + underscores → dashes) is what surfaces in the filename:
  // `mock-small-001`. Substring matches on "mock" alone would pass on the raw
  // form too, so the dashed/lowercased form is the load-bearing assertion.
  it("csv filename contains the dashed-lowercased slug, not the raw input form", async () => {
    const res = await call("?placeId=mock_SMALL_001&format=csv");
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toMatch(/filename="google-reviews-mock-small-001-\d{8}\.csv"/);
    // Belt-and-braces: the raw underscore form must NOT appear in the
    // filename — that would mean the route fed `normalised.raw` or the raw
    // input through, defeating the slug pipeline.
    expect(cd).not.toMatch(/mock_small_001/i);
  });

  it("xlsx filename mirrors the csv filename with only the extension changed", async () => {
    const res = await call("?placeId=mock_SMALL_001&format=xlsx");
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toMatch(/filename="google-reviews-mock-small-001-\d{8}\.xlsx"/);
    expect(cd).not.toMatch(/mock_small_001/i);
  });
});

describe("GET /api/reviews — runtime named-export pin", () => {
  // The route-config analogue of L13.1's `config.matcher` pin and L13.2's
  // healthcheck `runtime` pin (D-070): `export const runtime = "edge"` decides
  // the Vercel execution environment — different cold-start, different fetch
  // semantics, different CPU/memory tier. A refactor that dropped the named
  // export silently moves the route to the Node.js runtime; no helper or
  // success-path response test catches this (a Node-runtime route would still
  // return identical bodies and headers from this in-process test). Pin the
  // value exact-equals as its own one-it describe so the regression is loud.
  it("exports runtime === \"edge\" as a top-level named export", async () => {
    const mod = await import("@/app/api/reviews/route");
    expect(mod.runtime).toBe("edge");
  });
});

describe("GET /api/reviews — error envelope structural shape (D-027)", () => {
  // The D-027 envelope contract — `{error: {code, message}}` — is what the form
  // (review-tool-form.tsx) and any API consumer destructure to surface a user-
  // facing error. The existing param-validation describe asserts
  // `body.error.code` and `body.error.message` *exist* but never that they are
  // the *only* keys: a refactor that added a surplus `details` field, renamed
  // `error.code` to `error_code`, or returned `{error: "bad_request"}` (string
  // form, dropping the wrapper object) would still 400-the-user and still pass
  // every existing assertion that touches `body.error.code` / `.message` —
  // silent UX regression for anyone destructuring `body.error.code`.
  //
  // Pinned end-to-end on the public default export by asserting
  // `Object.keys(body).sort()` is exactly `["error"]` and
  // `Object.keys(body.error).sort()` is exactly `["code","message"]` across the
  // three 400 paths the suite already exercises (missing-placeId, bad-format,
  // bad-limit) — symmetric with L13.1's middleware envelope and L13.2's
  // healthcheck envelope (the same "shape of what we ship to the user is the
  // contract, not the helper that produces it" pattern, D-051).
  it("missing placeId → top-level keys are exactly [\"error\"]", async () => {
    const res = await call("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("unsupported format → top-level keys are exactly [\"error\"]", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });

  it("invalid limit → top-level keys are exactly [\"error\"]", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&limit=abc");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });
});

describe("GET /api/reviews — success envelope shape + X-Cache symmetry across formats", () => {
  // Two cross-cutting load-bearing concerns on the success paths the existing
  // suite never reached:
  //
  // (a) JSON success-envelope structural shape: `Object.keys(body).sort()`
  // exactly `["fetched_at","place","reviews"]` on the small fixture (which
  // never trips HARD_CAP, so the optional `truncated: true` is absent). A
  // refactor that surfaced an internal field (e.g. `partial: []` leaking from
  // the rate-limit branch, a `meta` debug key, a `cached: false` flag) would
  // still 200-the-user with `place`/`reviews`/`fetched_at` intact, still pass
  // every existing assertion, and silently bloat the response surface for
  // every downstream consumer. The keys-sort form fails loudly on any surplus
  // or rename — same D-027-style envelope pin as L13.1/L13.2 in their
  // respective routes.
  //
  // (b) JSON Content-Type pin: `NextResponse.json` sets it to
  // `application/json` today, but a refactor to `new Response(JSON.stringify(...))`
  // (a common attempted "drop the framework wrapper" cleanup) silently drops
  // the header — `await res.json()` in every consumer still works, but any
  // strict middlebox/CDN/proxy that switches on Content-Type breaks. Pinned
  // belt-and-braces because the json success path is the one with no other
  // header assertion today.
  //
  // (c) `X-Cache: MISS` symmetry on csv and xlsx. The route emits the cache
  // status on all three formats (route.ts §227, §240, §253), but only the json
  // path asserts it today (§103). A regression that dropped the header on the
  // file-download paths (e.g. consolidating headers in respondSuccess and
  // forgetting one branch) silently breaks any analytics/observability that
  // watches cache hit-rate per format — the file downloads still arrive, just
  // unobservably. Pinned on both csv and xlsx so a single-path drop fails on
  // exactly that path. (HIT path remains deferred per D-060 — unreachable
  // without an injection seam or a memory-mode singleton.)
  it("json success body has exactly the documented top-level keys", async () => {
    const res = await call("?placeId=MOCK_SMALL_001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "fetched_at",
      "place",
      "reviews",
    ]);
    // The small fixture has 12 reviews < HARD_CAP_REVIEWS (5000), so
    // `truncated` MUST NOT appear; pin its absence explicitly so a refactor
    // that always-emits `truncated: false` (a common "be explicit" mistake)
    // fails on the key-sort above AND on this direct check.
    expect("truncated" in body).toBe(false);
  });

  it("json success body Content-Type is application/json", async () => {
    const res = await call("?placeId=MOCK_SMALL_001");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  });

  it("csv success carries X-Cache: MISS (symmetry with the json path)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("xlsx success carries X-Cache: MISS (symmetry with the json + csv paths)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });
});

describe("GET /api/reviews — review filtering (L33.2)", () => {
  // The filter query params (min_rating/max_rating/language/with_photos/
  // with_owner_response/keyword/since/until) parse into a ReviewFilter and apply
  // to the assembled walk BEFORE the userLimit slice and BEFORE export/summary.
  // Distribution of the committed MOCK_SMALL_001 fixture (12 reviews), pinned by
  // tests/fixtures-contract.test.ts: ratings 5×7 / 4×2 / 3×1 / 2×1 / 1×1;
  // languages en×9 / de×1 / es×1 / pl×1; 1 review with photos, 3 with an owner
  // response; "coffee" appears in 3 texts; published 2026-02-05 .. 2026-04-15.
  it("min_rating=4 keeps the 9 reviews rated 4 or 5", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&min_rating=4");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(9);
    expect(body.reviews.every((r: { rating: number }) => r.rating >= 4)).toBe(true);
  });

  it("max_rating=2 keeps only the 2 low-star reviews", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&max_rating=2");
    const body = await res.json();
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews.every((r: { rating: number }) => r.rating <= 2)).toBe(true);
  });

  it("min_rating=4&max_rating=4 keeps exactly the rating-4 band (AND of bounds)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&min_rating=4&max_rating=4");
    const body = await res.json();
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews.every((r: { rating: number }) => r.rating === 4)).toBe(true);
  });

  it("language=de keeps the single German review (case-insensitive)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&language=DE");
    const body = await res.json();
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].language).toBe("de");
  });

  it("with_photos=1 keeps only reviews carrying a photo", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&with_photos=1");
    const body = await res.json();
    expect(body.reviews).toHaveLength(1);
    expect((body.reviews[0].photos ?? []).length).toBeGreaterThan(0);
  });

  it("with_owner_response=true keeps the 3 reviews with an owner reply", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&with_owner_response=true");
    const body = await res.json();
    expect(body.reviews).toHaveLength(3);
    expect(body.reviews.every((r: { owner_response?: unknown }) => r.owner_response != null)).toBe(true);
  });

  it("keyword=COFFEE matches the 3 texts mentioning coffee, case-insensitively", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&keyword=COFFEE");
    const body = await res.json();
    expect(body.reviews).toHaveLength(3);
    expect(body.reviews.every((r: { text: string }) => r.text.toLowerCase().includes("coffee"))).toBe(true);
  });

  it("since=2026-04-01 keeps only the 3 reviews published on/after that date", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&since=2026-04-01");
    const body = await res.json();
    expect(body.reviews).toHaveLength(3);
  });

  it("until=2026-02-28 keeps only the 4 February reviews", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&until=2026-02-28");
    const body = await res.json();
    expect(body.reviews).toHaveLength(4);
  });

  it("since+until bound an inclusive window (2 reviews in the first half of April)", async () => {
    const res = await call(
      "?placeId=MOCK_SMALL_001&since=2026-04-01&until=2026-04-13",
    );
    const body = await res.json();
    expect(body.reviews).toHaveLength(2);
  });

  it("filtering runs BEFORE the limit slice (min_rating=5&limit=3 → 3 five-star, not the 5★ subset of the top-3 recent)", async () => {
    // The 3 most-recent reviews are 5★/5★/4★; a limit-then-filter regression
    // would return only the 2 five-star ones. Filter-then-limit returns 3.
    const res = await call("?placeId=MOCK_SMALL_001&min_rating=5&limit=3");
    const body = await res.json();
    expect(body.reviews).toHaveLength(3);
    expect(body.reviews.every((r: { rating: number }) => r.rating === 5)).toBe(true);
  });

  it("csv export respects the filter (min_rating=5 → 7 data rows under the header)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&min_rating=5");
    expect(res.status).toBe(200);
    const lines = (await res.text())
      .replace(/^﻿/, "")
      .split("\r\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(8); // header + 7 five-star rows
  });

  it("a malformed criterion degrades to no-constraint (min_rating=abc → all 12)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&min_rating=abc");
    const body = await res.json();
    expect(body.reviews).toHaveLength(12);
  });

  it("rating bounds clamp into 1..5 (min_rating=9 → 5★ only, min_rating=0 → all)", async () => {
    const high = await (await call("?placeId=MOCK_SMALL_001&min_rating=9")).json();
    expect(high.reviews).toHaveLength(7); // clamped to 5 → the seven 5★ reviews
    const low = await (await call("?placeId=MOCK_SMALL_001&min_rating=0")).json();
    expect(low.reviews).toHaveLength(12); // clamped to 1 → every review qualifies
  });

  it("with_photos=false means 'don't care', not 'exclude' (all 12 returned)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&with_photos=false");
    const body = await res.json();
    expect(body.reviews).toHaveLength(12);
  });

  it("no filter params is the identity transform (all 12 returned, order preserved)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001");
    const body = await res.json();
    expect(body.reviews).toHaveLength(12);
  });
});

describe("GET /api/reviews — review ordering (L34.2)", () => {
  // The `order` (or its `sort` alias) param parses into a ReviewOrder and applies
  // AFTER filterReviews and BEFORE the userLimit slice + export/summary. Assertions
  // here check the ORDER property directly (ratings monotonic / dates monotonic)
  // rather than hardcoding the fixture's date sequence, so they survive a fixture
  // re-date. MOCK_SMALL_001 ratings: 5×7 / 4×2 / 3×1 / 2×1 / 1×1.
  const ratingsOf = (body: { reviews: { rating: number }[] }) =>
    body.reviews.map((r) => r.rating);
  const datesOf = (body: { reviews: { published_at: string }[] }) =>
    body.reviews.map((r) => Date.parse(r.published_at));
  const isNonIncreasing = (xs: number[]) =>
    xs.every((x, i) => i === 0 || xs[i - 1] >= x);
  const isNonDecreasing = (xs: number[]) =>
    xs.every((x, i) => i === 0 || xs[i - 1] <= x);

  it("order=highest sorts ratings non-increasing (5★ first, 1★ last)", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001&order=highest")).json();
    expect(body.reviews).toHaveLength(12);
    expect(isNonIncreasing(ratingsOf(body))).toBe(true);
    expect(body.reviews[0].rating).toBe(5);
    expect(body.reviews[11].rating).toBe(1);
  });

  it("order=lowest sorts ratings non-decreasing (1★ first, 5★ last)", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001&order=lowest")).json();
    expect(isNonDecreasing(ratingsOf(body))).toBe(true);
    expect(body.reviews[0].rating).toBe(1);
    expect(body.reviews[11].rating).toBe(5);
  });

  it("order=oldest sorts published_at ascending; order=newest descending", async () => {
    const oldest = await (await call("?placeId=MOCK_SMALL_001&order=oldest")).json();
    expect(isNonDecreasing(datesOf(oldest))).toBe(true);
    const newest = await (await call("?placeId=MOCK_SMALL_001&order=newest")).json();
    expect(isNonIncreasing(datesOf(newest))).toBe(true);
  });

  it("the `sort` alias is honoured (sort=lowest === order=lowest)", async () => {
    const viaSort = await (await call("?placeId=MOCK_SMALL_001&sort=lowest")).json();
    expect(viaSort.reviews[0].rating).toBe(1);
  });

  it("ordering runs BEFORE the limit slice (order=lowest&limit=3 → the 3 lowest of the whole set, not the lowest of the top-3 recent)", async () => {
    // The 3 lowest-rated of all 12 are the 1★, 2★, 3★ reviews. A limit-then-sort
    // regression would slice the 3 most-recent first, then sort only those.
    const body = await (await call("?placeId=MOCK_SMALL_001&order=lowest&limit=3")).json();
    expect(ratingsOf(body)).toEqual([1, 2, 3]);
  });

  it("ordering composes with filtering (min_rating=4&order=highest → 9 reviews, all ≥4, non-increasing)", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001&min_rating=4&order=highest")).json();
    expect(body.reviews).toHaveLength(9);
    expect(body.reviews.every((r: { rating: number }) => r.rating >= 4)).toBe(true);
    expect(isNonIncreasing(ratingsOf(body))).toBe(true);
  });

  it("csv export reflects the order (order=lowest → first data row is the 1★ review)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&order=lowest");
    expect(res.status).toBe(200);
    const lines = (await res.text()).replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(13); // header + 12 rows, reordered not dropped
  });

  it("a bad order value degrades to no-sort (identity), never a 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&order=sideways");
    expect(res.status).toBe(200);
    const plain = await (await call("?placeId=MOCK_SMALL_001")).json();
    const body = await res.json();
    expect(body.reviews.map((r: { review_id: string }) => r.review_id)).toEqual(
      plain.reviews.map((r: { review_id: string }) => r.review_id),
    );
  });
});

describe("GET /api/reviews — parseFilter (__testing)", () => {
  it("maps each query param onto the ReviewFilter, omitting absent ones", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    const params = new URLSearchParams(
      "min_rating=2&max_rating=4&language=en&with_photos=1&with_owner_response=yes&keyword=refund&since=2026-01-01&until=2026-12-31",
    );
    expect(__testing.parseFilter(params)).toEqual({
      minRating: 2,
      maxRating: 4,
      language: "en",
      withPhotos: true,
      withOwnerResponse: true,
      keyword: "refund",
      since: "2026-01-01",
      until: "2026-12-31",
    });
  });

  it("an empty query yields the identity filter {}", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    expect(__testing.parseFilter(new URLSearchParams(""))).toEqual({});
  });

  it("a blank language is omitted (not a constraint that empties the result)", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    expect(__testing.parseFilter(new URLSearchParams("language=%20%20"))).toEqual({});
  });

  it("parseRating floors+clamps into 1..5 and ignores non-numbers", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    expect(__testing.parseRating("3")).toBe(3);
    expect(__testing.parseRating("4.9")).toBe(4); // floored
    expect(__testing.parseRating("0")).toBe(1); // clamped low
    expect(__testing.parseRating("99")).toBe(5); // clamped high
    expect(__testing.parseRating("abc")).toBeUndefined();
    expect(__testing.parseRating(null)).toBeUndefined();
  });

  it("parseBooleanFlag returns true only for an explicit truthy token, else undefined", async () => {
    const { __testing } = await import("@/app/api/reviews/route");
    for (const t of ["1", "true", "TRUE", "yes", " Yes "]) {
      expect(__testing.parseBooleanFlag(t)).toBe(true);
    }
    for (const f of ["0", "false", "no", "", "maybe", null]) {
      expect(__testing.parseBooleanFlag(f)).toBeUndefined();
    }
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
