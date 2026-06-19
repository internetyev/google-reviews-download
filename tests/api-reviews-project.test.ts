// Coverage for the optional `fields`/`columns` column selection on
// /api/reviews (L35.2). Net-new feature code: a `fields` (or `columns` alias)
// query param is parsed via `parseReviewFields` and applied as the LAST
// transform before serialisation, so the exported columns match the request —
// JSON objects narrow to the requested keys, CSV/XLSX headers narrow to the
// requested columns. The load-bearing contracts a consumer depends on:
//   - absent `fields` → full objects / full 14-column CSV (additive, unchanged);
//   - a recognised set narrows JSON objects to exactly their present requested
//     keys, in first-requested order;
//   - the `columns` alias behaves identically to `fields`;
//   - a bad/blank/all-unrecognised value degrades to "all columns" (identity),
//     never a 400 — like the lenient summary/filter/sort params;
//   - CSV header reflects the selection (place_* context columns dropped);
//   - selection composes with `limit` (applied after the trim).
//
// Same offline posture as tests/api-reviews-summary.test.ts: GET is driven with
// a real NextRequest, SF_API_KEY/KV_* unset so the committed MOCK_SMALL_001
// fixture and a fresh memory cache serve every request.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reviews/route";

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

// First non-BOM CSV line = the header row.
function csvHeader(text: string): string {
  return text.replace(/^﻿/, "").split("\r\n")[0];
}

describe("GET /api/reviews — JSON column selection (?fields)", () => {
  it("returns full objects when `fields` is absent", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001")).json();
    const r0 = body.reviews[0];
    // The fixture's review #0 carries the required fields + language + owner_response.
    expect(r0.review_id).toBeDefined();
    expect(r0.author_name).toBeDefined();
    expect(r0.rating).toBeDefined();
    expect(r0.text).toBeDefined();
    expect(r0.published_at).toBeDefined();
  });

  it("narrows each object to exactly the requested present keys", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&fields=rating,text")
    ).json();
    for (const r of body.reviews) {
      expect(Object.keys(r).sort()).toEqual(["rating", "text"]);
    }
  });

  it("preserves first-requested field order in the JSON keys", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&fields=text,rating")
    ).json();
    expect(Object.keys(body.reviews[0])).toEqual(["text", "rating"]);
  });

  it("omits a requested-but-absent optional field rather than null-ing it", async () => {
    // No fixture review has `author_url`, so each projected row is an empty {}.
    const body = await (
      await call("?placeId=MOCK_SMALL_001&fields=author_url")
    ).json();
    for (const r of body.reviews) {
      expect("author_url" in r).toBe(false);
      expect(Object.keys(r)).toEqual([]);
    }
  });

  it("carries a present optional only on the rows that have it", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&fields=owner_response")
    ).json();
    const withResponse = body.reviews.filter(
      (r: Record<string, unknown>) => "owner_response" in r,
    );
    // Fixture rows 0,4,6 have an owner_response; the rest project to {}.
    expect(withResponse.length).toBe(3);
  });

  it("treats the `columns` alias identically to `fields`", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&columns=rating")
    ).json();
    for (const r of body.reviews) {
      expect(Object.keys(r)).toEqual(["rating"]);
    }
  });

  it("degrades a bad/blank/all-unrecognised value to full objects (no 400)", async () => {
    for (const v of ["", "banana", "place_id,nope"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&fields=${v}`);
      expect(res.status, `fields=${v}`).toBe(200);
      const body = await res.json();
      // Identity → required keys still present.
      expect(body.reviews[0].review_id, `fields=${v}`).toBeDefined();
      expect(body.reviews[0].text, `fields=${v}`).toBeDefined();
    }
  });

  it("composes with limit (selection applied after the trim)", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&fields=rating&limit=2")
    ).json();
    expect(body.reviews.length).toBe(2);
    for (const r of body.reviews) expect(Object.keys(r)).toEqual(["rating"]);
  });
});

describe("GET /api/reviews — CSV/XLSX column selection (?fields)", () => {
  it("narrows the CSV header to the requested columns, dropping place_* context", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&fields=rating,text");
    expect(res.status).toBe(200);
    const header = csvHeader(await res.text());
    expect(header).toBe('"rating","text"');
  });

  it("fans `photos` out to photo_count + photo_urls in the CSV header", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&fields=photos");
    const header = csvHeader(await res.text());
    expect(header).toBe('"photo_count","photo_urls"');
  });

  it("keeps the full 14-column CSV header when `fields` is absent", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv");
    const header = csvHeader(await res.text());
    expect(header.split(",").length).toBe(14);
    expect(header.startsWith('"place_name"')).toBe(true);
  });

  it("still returns a well-formed XLSX download with `fields` set", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=xlsx&fields=rating,text");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
