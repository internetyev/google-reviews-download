// Coverage for L40.2 — the schema.org JSON-LD (`jsonld`) delivery format on
// /api/reviews. A `format=jsonld` request dispatches to the pure JSON-LD writer
// (lib/export/jsonld.ts, L40.1) with the `application/ld+json` content type and a
// `.jsonld` attachment filename, applying the same filter→sort→limit→anonymise
// pipeline as the other formats before serialisation. Field projection is
// intentionally NOT honoured (a structured-data document is not a column subset —
// the L40.1 design call, mirroring Markdown's L37.1 / HTML's L38.1 / text's L39.1).
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

type ReviewNode = {
  "@type": string;
  author: { "@type": string; name: string };
  reviewBody: string;
  reviewRating: { ratingValue: number };
};
type LocalBusinessNode = {
  "@type": string;
  name: string;
  aggregateRating: { reviewCount: number; ratingValue: number };
  review: ReviewNode[];
};

describe("GET /api/reviews — jsonld format (L40.2, single place)", () => {
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

  async function doc(query: string): Promise<LocalBusinessNode> {
    return JSON.parse(await (await call(query)).text());
  }

  it("format=jsonld → 200 application/ld+json with a .jsonld attachment filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=jsonld");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/ld+json");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="google-reviews-mock-small-001-\d{8}\.jsonld"$/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("body is a valid schema.org LocalBusiness document with a Review array", async () => {
    const d = await doc("?placeId=MOCK_SMALL_001&format=jsonld");
    expect(d["@type"]).toBe("LocalBusiness");
    expect(d.name).toBe("Joe's Coffee");
    // The aggregateRating reports the AUTHORITATIVE rating_count, not the walk
    // length (D-041/D-031): the committed small fixture carries 12 reviews.
    expect(d.review).toHaveLength(12);
    expect(d.review.every((r) => r["@type"] === "Review")).toBe(true);
  });

  it("format token is case-insensitive (JSONLD / JsonLd behave as jsonld)", async () => {
    for (const f of ["JSONLD", "JsonLd", "jSoNlD"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&format=${f}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/ld+json");
    }
  });

  it("limit slices the document BEFORE serialisation (limit=3 → 3 Review nodes)", async () => {
    const d = await doc("?placeId=MOCK_SMALL_001&format=jsonld&limit=3");
    expect(d.review).toHaveLength(3);
  });

  it("filtering applies to the jsonld surface (min_rating=5 → 7 Review nodes)", async () => {
    const d = await doc("?placeId=MOCK_SMALL_001&format=jsonld&min_rating=5");
    expect(d.review).toHaveLength(7);
    expect(d.review.every((r) => r.reviewRating.ratingValue === 5)).toBe(true);
  });

  it("anonymisation redacts the jsonld surface (mask_author hides full names)", async () => {
    const plain = await doc("?placeId=MOCK_SMALL_001&format=jsonld");
    expect(plain.review.some((r) => r.author.name === "Maria S.")).toBe(true);
    const masked = await doc(
      "?placeId=MOCK_SMALL_001&format=jsonld&mask_author=1",
    );
    // Masking collapses "Maria S." → spaced initials "M. S.".
    expect(masked.review.some((r) => r.author.name === "Maria S.")).toBe(false);
    expect(masked.review.some((r) => r.author.name === "M. S.")).toBe(true);
  });

  it("field projection is intentionally ignored — jsonld is always the full document", async () => {
    // `fields` narrows the JSON/CSV/XLSX columns, but a structured-data document
    // is not a column subset (L40.1), so the jsonld output is byte-identical with
    // and without a `fields` selection.
    const full = await (await call("?placeId=MOCK_SMALL_001&format=jsonld")).text();
    const projected = await (
      await call("?placeId=MOCK_SMALL_001&format=jsonld&fields=rating")
    ).text();
    expect(projected).toBe(full);
  });

  it("jsonld is listed among the supported formats in the unsupported-format 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /json, csv, xlsx, md, html, txt, jsonld/,
    );
  });
});

describe("GET /api/reviews — jsonld format (L40.2, batch)", () => {
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

  it("combines several places into one ItemList document (.jsonld batch filename)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=jsonld`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/ld+json");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.jsonld/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const d = JSON.parse(await res.text()) as {
      "@type": string;
      itemListElement: LocalBusinessNode[];
    };
    expect(d["@type"]).toBe("ItemList");
    expect(d.itemListElement).toHaveLength(2);
    expect(d.itemListElement[0].name).toBe("Joe's Coffee");
    expect(d.itemListElement[1].name).toBe("Bistro La Plaza");
    // 12 small + 80 mid review nodes across the combined document.
    const total = d.itemListElement.reduce((n, p) => n + p.review.length, 0);
    expect(total).toBe(12 + 80);
  });
});
