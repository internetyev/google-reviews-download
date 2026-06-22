// Coverage for L38.2 — the HTML delivery format on /api/reviews. A
// `format=html` request dispatches to the pure HTML writer
// (lib/export/html.ts, L38.1) with the `text/html` content type and a `.html`
// attachment filename, applying the same filter→sort→limit→anonymise pipeline
// as the other formats before serialisation. Field projection is intentionally
// NOT honoured (a self-contained testimonials page is not a column subset — the
// L38.1 design call, mirroring Markdown's L37.1).
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

// Count the per-review `<article class="review">` sections in a rendered
// document. The place header is a `<header class="place">`, so this never
// miscounts the header (single or batch).
function articleCount(html: string): number {
  return (html.match(/<article class="review">/g) ?? []).length;
}

describe("GET /api/reviews — HTML format (L38.2, single place)", () => {
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

  it("format=html → 200 text/html with a .html attachment filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=html");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="google-reviews-mock-small-001-\d{8}\.html"$/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("body is a valid HTML5 testimonials page — doctype, place H1, one article per review", async () => {
    const html = await (
      await call("?placeId=MOCK_SMALL_001&format=html")
    ).text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // The place name is HTML-escaped inline, so the apostrophe surfaces as &#39;.
    expect(html).toContain("<h1>Reviews for Joe&#39;s Coffee</h1>");
    // The committed small fixture is 12 reviews (tests/fixtures-contract.test.ts).
    expect(articleCount(html)).toBe(12);
  });

  it("format token is case-insensitive (HTML / Html behave as html)", async () => {
    for (const f of ["HTML", "Html", "hTmL"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&format=${f}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    }
  });

  it("limit slices the document BEFORE serialisation (limit=3 → 3 articles)", async () => {
    const html = await (
      await call("?placeId=MOCK_SMALL_001&format=html&limit=3")
    ).text();
    expect(articleCount(html)).toBe(3);
  });

  it("filtering applies to the HTML surface (min_rating=5 → 7 articles)", async () => {
    const html = await (
      await call("?placeId=MOCK_SMALL_001&format=html&min_rating=5")
    ).text();
    expect(articleCount(html)).toBe(7);
  });

  it("anonymisation redacts the HTML surface (mask_author hides full names)", async () => {
    const plain = await (
      await call("?placeId=MOCK_SMALL_001&format=html")
    ).text();
    // The un-redacted document carries the fixture's full author display name in
    // an author <h2>. Assert at the heading level (not whole-document) because a
    // given name can legitimately recur inside an un-masked review body.
    expect(plain).toContain('<h2 class="author">Maria S.</h2>');
    const masked = await (
      await call("?placeId=MOCK_SMALL_001&format=html&mask_author=1")
    ).text();
    // Masking collapses "Maria S." → spaced initials "M. S.", so the full-name
    // heading is gone and the initials heading takes its place.
    expect(masked).not.toContain('<h2 class="author">Maria S.</h2>');
    expect(masked).toContain('<h2 class="author">M. S.</h2>');
  });

  it("field projection is intentionally ignored — html is always the full document", async () => {
    // `fields` narrows the JSON/CSV/XLSX columns, but a publishable page is not a
    // column subset (L38.1), so the HTML output is byte-identical with and
    // without a `fields` selection.
    const full = await (
      await call("?placeId=MOCK_SMALL_001&format=html")
    ).text();
    const projected = await (
      await call("?placeId=MOCK_SMALL_001&format=html&fields=rating")
    ).text();
    expect(projected).toBe(full);
  });

  it("html is listed among the supported formats in the unsupported-format 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/json, csv, xlsx, md, html/);
  });
});

describe("GET /api/reviews — HTML format (L38.2, batch)", () => {
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

  it("combines several places into one HTML document (.html batch filename)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=html`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.html/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const html = await res.text();
    // The batch header names the place count, and each place's own H1 follows.
    expect(html).toContain("<h1>Reviews for 2 places</h1>");
    expect(html).toContain("<h1>Reviews for Joe&#39;s Coffee</h1>");
    expect(html).toContain("<h1>Reviews for Bistro La Plaza</h1>");
    // 12 small + 80 mid review sections across the combined document.
    expect(articleCount(html)).toBe(12 + 80);
  });
});
