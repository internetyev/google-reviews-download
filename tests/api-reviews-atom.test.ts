// Coverage for L42.2 — the Atom 1.0 (RFC 4287) (`atom`) delivery format on
// /api/reviews. A `format=atom` request dispatches to the pure Atom writer
// (lib/export/atom.ts, L42.1) with the `application/atom+xml` content type and a
// `.atom` attachment filename, applying the same filter→sort→limit→anonymise
// pipeline as the other formats before serialisation. Field projection is
// intentionally NOT honoured (a syndication feed is not a column subset — the
// L42.1 design call, mirroring Markdown's L37.1 / HTML's L38.1 / text's L39.1 /
// JSON-LD's L40.1 / RSS's L41.1).
//
// Single-place paths run the public GET directly in fixture mode (SF_API_KEY
// unset → committed MOCK_SMALL_001 fixture, KV_* unset → process-local memory
// cache, every request a MISS). The batch path is driven via the injectable
// __testing.handleGet with a stub resolver + stub client (fully offline).
// Committed, not run in-routine (no node_modules; D-039/D-040 posture).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import smallBusiness from "@/mocks/semanticforce/small-business.json";
import midBusiness from "@/mocks/semanticforce/mid-business.json";
import { GET, __testing } from "@/app/api/reviews/route";
import { type GetReviewsResponse } from "@/lib/semanticforce/types";

const small = smallBusiness as unknown as GetReviewsResponse;
const mid = midBusiness as unknown as GetReviewsResponse;

// Count the <entry> elements in an Atom document — one per review.
function entryCount(xml: string): number {
  return (xml.match(/<entry>/g) ?? []).length;
}

describe("GET /api/reviews — atom format (L42.2, single place)", () => {
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

  async function body(query: string): Promise<string> {
    return (await call(query)).text();
  }

  it("format=atom → 200 application/atom+xml with a .atom attachment filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=atom");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/atom+xml; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="google-reviews-mock-small-001-\d{8}\.atom"$/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("body is a valid Atom 1.0 document with one <entry> per review", async () => {
    const xml = await body("?placeId=MOCK_SMALL_001&format=atom");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    // RFC 4287 mandates feed <id> + <updated>; the <id> is the place URN.
    expect(xml).toContain(
      '<title type="text">Reviews for Joe&#39;s Coffee</title>',
    );
    expect(xml).toContain("<id>urn:google-reviews:place:MOCK_SMALL_001</id>");
    expect(xml).toMatch(/<updated>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/updated>/);
    // One entry per review; the committed small fixture carries 12 reviews.
    expect(entryCount(xml)).toBe(12);
  });

  it("format token is case-insensitive (ATOM / Atom behave as atom)", async () => {
    for (const f of ["ATOM", "Atom", "aToM"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&format=${f}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/atom+xml; charset=utf-8",
      );
    }
  });

  it("limit slices the feed BEFORE serialisation (limit=3 → 3 entries)", async () => {
    const xml = await body("?placeId=MOCK_SMALL_001&format=atom&limit=3");
    expect(entryCount(xml)).toBe(3);
  });

  it("filtering applies to the atom surface (min_rating=5 → 7 entries)", async () => {
    const xml = await body("?placeId=MOCK_SMALL_001&format=atom&min_rating=5");
    expect(entryCount(xml)).toBe(7);
    // Every surviving entry is a 5★ review (the title leads with the star rating).
    expect(xml).not.toMatch(/<title type="text">[1-4]★/);
  });

  it("anonymisation redacts the atom surface (mask_author hides full names)", async () => {
    const plain = await body("?placeId=MOCK_SMALL_001&format=atom");
    expect(plain).toContain("<author><name>Maria S.</name></author>");
    const masked = await body(
      "?placeId=MOCK_SMALL_001&format=atom&mask_author=1",
    );
    // Masking collapses "Maria S." → spaced initials "M. S." everywhere the
    // author surfaces (both the entry <title> and the <author><name>).
    expect(masked).not.toContain("<author><name>Maria S.</name></author>");
    expect(masked).toContain("<author><name>M. S.</name></author>");
    expect(masked).toContain("— M. S.</title>");
  });

  it("field projection is intentionally ignored — atom is always the full feed", async () => {
    // `fields` narrows the JSON/CSV/XLSX columns, but a syndication feed is not a
    // column subset (L42.1), so the atom output is byte-identical with and without
    // a `fields` selection.
    const full = await body("?placeId=MOCK_SMALL_001&format=atom");
    const projected = await body(
      "?placeId=MOCK_SMALL_001&format=atom&fields=rating",
    );
    expect(projected).toBe(full);
  });

  it("atom is listed among the supported formats in the unsupported-format 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /json, csv, xlsx, md, html, txt, jsonld, rss, atom/,
    );
  });
});

describe("GET /api/reviews — atom format (L42.2, batch)", () => {
  const ID_A = "0x1111111111111111:0xaaaaaaaaaaaaaaaa";
  const ID_B = "0x2222222222222222:0xbbbbbbbbbbbbbbbb";

  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = {
      REVIEWS_PROVIDER: process.env.REVIEWS_PROVIDER,
      KV_REST_API_URL: process.env.KV_REST_API_URL,
    };
    process.env.REVIEWS_PROVIDER = "serpapi";
    delete process.env.KV_REST_API_URL; // memory cache
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function req(qs: string) {
    return new NextRequest(`https://x.test/api/reviews?${qs}`);
  }

  function deps() {
    return {
      resolve: async () => {
        throw new Error("resolver should not run for identifier inputs");
      },
      client: {
        getReviews: async ({
          placeId,
          limit,
        }: {
          placeId: string;
          limit?: number;
        }) => {
          const fx = placeId.includes("aaaa") ? small : mid;
          return {
            place: fx.place,
            reviews: limit != null ? fx.reviews.slice(0, limit) : fx.reviews,
          };
        },
      },
    } as Parameters<typeof __testing.handleGet>[1];
  }

  it("combines several places into one feed (.atom batch filename)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=atom`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/atom+xml; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.atom/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const xml = await res.text();
    // An Atom <feed> may hold any number of entries; the batch is one feed.
    expect(xml).toContain('<title type="text">Reviews for 2 places</title>');
    // 12 small + 80 mid review entries across the combined feed.
    expect(entryCount(xml)).toBe(12 + 80);
  });
});
