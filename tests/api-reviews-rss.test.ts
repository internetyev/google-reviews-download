// Coverage for L41.2 — the RSS 2.0 (`rss`) delivery format on /api/reviews. A
// `format=rss` request dispatches to the pure RSS writer (lib/export/rss.ts,
// L41.1) with the `application/rss+xml` content type and a `.rss` attachment
// filename, applying the same filter→sort→limit→anonymise pipeline as the other
// formats before serialisation. Field projection is intentionally NOT honoured
// (a syndication feed is not a column subset — the L41.1 design call, mirroring
// Markdown's L37.1 / HTML's L38.1 / text's L39.1 / JSON-LD's L40.1).
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

// Count the <item> elements in an RSS document — one per review.
function itemCount(xml: string): number {
  return (xml.match(/<item>/g) ?? []).length;
}

describe("GET /api/reviews — rss format (L41.2, single place)", () => {
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

  it("format=rss → 200 application/rss+xml with a .rss attachment filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=rss");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="google-reviews-mock-small-001-\d{8}\.rss"$/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("body is a valid RSS 2.0 document with one <item> per review", async () => {
    const xml = await body("?placeId=MOCK_SMALL_001&format=rss");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<title>Reviews for Joe&#39;s Coffee</title>");
    // One item per review; the committed small fixture carries 12 reviews.
    expect(itemCount(xml)).toBe(12);
  });

  it("format token is case-insensitive (RSS / Rss behave as rss)", async () => {
    for (const f of ["RSS", "Rss", "rSs"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&format=${f}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/rss+xml; charset=utf-8",
      );
    }
  });

  it("limit slices the feed BEFORE serialisation (limit=3 → 3 items)", async () => {
    const xml = await body("?placeId=MOCK_SMALL_001&format=rss&limit=3");
    expect(itemCount(xml)).toBe(3);
  });

  it("filtering applies to the rss surface (min_rating=5 → 7 items)", async () => {
    const xml = await body("?placeId=MOCK_SMALL_001&format=rss&min_rating=5");
    expect(itemCount(xml)).toBe(7);
    // Every surviving item is a 5★ review (the title carries the star rating).
    expect(xml).not.toMatch(/<title>[1-4]★/);
  });

  it("anonymisation redacts the rss surface (mask_author hides full names)", async () => {
    const plain = await body("?placeId=MOCK_SMALL_001&format=rss");
    expect(plain).toContain("— Maria S.</title>");
    const masked = await body(
      "?placeId=MOCK_SMALL_001&format=rss&mask_author=1",
    );
    // Masking collapses "Maria S." → spaced initials "M. S.".
    expect(masked).not.toContain("— Maria S.</title>");
    expect(masked).toContain("— M. S.</title>");
  });

  it("field projection is intentionally ignored — rss is always the full feed", async () => {
    // `fields` narrows the JSON/CSV/XLSX columns, but a syndication feed is not a
    // column subset (L41.1), so the rss output is byte-identical with and without
    // a `fields` selection.
    const full = await body("?placeId=MOCK_SMALL_001&format=rss");
    const projected = await body(
      "?placeId=MOCK_SMALL_001&format=rss&fields=rating",
    );
    expect(projected).toBe(full);
  });

  it("rss is listed among the supported formats in the unsupported-format 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /json, csv, xlsx, md, html, txt, jsonld, rss/,
    );
  });
});

describe("GET /api/reviews — rss format (L41.2, batch)", () => {
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

  it("combines several places into one feed (.rss batch filename)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=rss`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.rss/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const xml = await res.text();
    // RSS 2.0 allows only one <channel>; the batch is a single batch-titled feed.
    expect(xml).toContain("<title>Reviews for 2 places</title>");
    // 12 small + 80 mid review items across the combined feed.
    expect(itemCount(xml)).toBe(12 + 80);
  });
});
