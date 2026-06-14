// Coverage for the optional `?summary=1` JSON digest on /api/reviews (L32.2).
//
// This is net-new feature code: a truthy `summary` flag attaches an aggregate
// `summary` object (backed by lib/reviews/summary.ts `summariseReviews`) to the
// JSON response, derived from the SAME trimmed view the caller receives. The
// load-bearing contracts a consumer depends on:
//   - the field is ABSENT without the flag (additive, non-breaking);
//   - it is present and well-shaped WITH the flag, with `total_reviews` the
//     whole-place headline and `sampled_reviews` == the returned `reviews.length`
//     (the D-041/D-031 total-not-walk-count invariant carried into the digest);
//   - `limit` trims the digest with the array (summary describes the trimmed view);
//   - the flag is ignored on csv/xlsx (no crash, still a file download);
//   - the histogram + sentiment reconcile to the sampled denominator.
//
// Same offline posture as tests/api-reviews.test.ts: GET is driven with a real
// NextRequest, SF_API_KEY/KV_* unset so the committed MOCK_SMALL_001 fixture and
// a fresh memory cache serve every request. Committed, not run in-routine
// (no node_modules; `npm install` is a human step — D-039/D-040).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, __testing } from "@/app/api/reviews/route";

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

describe("GET /api/reviews — ?summary flag on JSON", () => {
  it("omits `summary` entirely when the flag is absent", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001")).json();
    expect(body.summary).toBeUndefined();
    expect("summary" in body).toBe(false);
  });

  it("omits `summary` when the flag is a falsy/unrecognised value", async () => {
    for (const v of ["0", "false", "no", "banana", ""]) {
      const body = await (
        await call(`?placeId=MOCK_SMALL_001&summary=${v}`)
      ).json();
      expect(body.summary, `summary=${v}`).toBeUndefined();
    }
  });

  it("attaches a well-shaped `summary` when ?summary=1", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001&summary=1")).json();
    expect(body.summary).toBeDefined();
    // Whole-place headline mirrors the place meta verbatim…
    expect(body.summary.place_id).toBe(body.place.place_id);
    expect(body.summary.place_name).toBe(body.place.name);
    expect(body.summary.total_reviews).toBe(body.place.rating_count);
    expect(body.summary.overall_rating).toBe(body.place.rating_avg);
    // …while the sampled denominator equals exactly what we returned.
    expect(body.summary.sampled_reviews).toBe(body.reviews.length);
    // Full shape present.
    expect(Object.keys(body.summary).sort()).toEqual([
      "languages",
      "overall_rating",
      "place_id",
      "place_name",
      "rating_distribution",
      "sampled_average_rating",
      "sampled_reviews",
      "sentiment",
      "total_reviews",
      "with_owner_response",
      "with_photos",
    ]);
  });

  it("accepts true/yes as truthy and 1 alike", async () => {
    for (const v of ["true", "yes", "1", "TRUE", " Yes "]) {
      const body = await (
        await call(`?placeId=MOCK_SMALL_001&summary=${encodeURIComponent(v)}`)
      ).json();
      expect(body.summary, `summary=${v}`).toBeDefined();
    }
  });

  it("summarises the TRIMMED view — limit trims both reviews and the digest", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&summary=1&limit=3")
    ).json();
    expect(body.reviews.length).toBe(3);
    expect(body.summary.sampled_reviews).toBe(3);
    // The whole-place headline is unaffected by the limit.
    expect(body.summary.total_reviews).toBe(body.place.rating_count);
    // Distribution + sentiment reconcile to the sampled denominator (3).
    const dist = body.summary.rating_distribution;
    const distSum = (Object.values(dist) as number[]).reduce((a, b) => a + b, 0);
    expect(distSum).toBe(3);
    const s = body.summary.sentiment;
    expect(s.positive + s.neutral + s.negative).toBe(3);
  });

  it("ignores the flag on csv (still a csv download, no crash)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&summary=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/\.csv"$/);
  });

  it("ignores the flag on xlsx (still an xlsx download, no crash)", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=xlsx&summary=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/\.xlsx"$/);
  });
});

describe("parseSummaryFlag unit (the truthy-token contract)", () => {
  const { parseSummaryFlag } = __testing;

  it("treats 1/true/yes (case- and whitespace-insensitive) as true", () => {
    for (const v of ["1", "true", "yes", "TRUE", "Yes", "  1  ", "\tyes\n"]) {
      expect(parseSummaryFlag(v), v).toBe(true);
    }
  });

  it("treats absent and every other value as false", () => {
    for (const v of [null, "0", "false", "no", "", "  ", "on", "2", "banana"]) {
      expect(parseSummaryFlag(v), String(v)).toBe(false);
    }
  });
});
