// Coverage for L37.2 — the Markdown delivery format on /api/reviews. A
// `format=md` (or its `markdown` long-form alias) request dispatches to the
// pure Markdown writer (lib/export/markdown.ts, L37.1) with the
// `text/markdown` content type and a `.md` attachment filename, applying the
// same filter→sort→limit→anonymise pipeline as the other formats before
// serialisation. Field projection is intentionally NOT honoured (a narrative
// testimonials document is not a column subset — the L37.1 design call).
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

// Count the per-review H2 sections in a rendered document. Each review section
// opens with `## <author>` at the start of a line; the place header is an H1
// (`# Reviews for …`), so this never miscounts the header.
function h2Count(md: string): number {
  return md.split("\n").filter((l) => /^## /.test(l)).length;
}

describe("GET /api/reviews — Markdown format (L37.2, single place)", () => {
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

  it("format=md → 200 text/markdown with a .md attachment filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=md");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="google-reviews-mock-small-001-\d{8}\.md"$/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("body is the narrative document — place H1 + one H2 per review", async () => {
    const md = await (await call("?placeId=MOCK_SMALL_001&format=md")).text();
    expect(md.startsWith("# Reviews for Joe's Coffee")).toBe(true);
    // The committed small fixture is 12 reviews (tests/fixtures-contract.test.ts).
    expect(h2Count(md)).toBe(12);
    // A blockquoted review body is present (the testimonial prose), proving the
    // writer rendered review sections, not just the header.
    expect(md).toMatch(/^> /m);
  });

  it("the `markdown` long-form alias behaves exactly as `md`", async () => {
    const viaMd = await (await call("?placeId=MOCK_SMALL_001&format=md")).text();
    const viaLong = await (
      await call("?placeId=MOCK_SMALL_001&format=markdown")
    ).text();
    expect(viaLong).toBe(viaMd);
    const res = await call("?placeId=MOCK_SMALL_001&format=markdown");
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
  });

  it("format token is case-insensitive (MD / Markdown behave as md)", async () => {
    for (const f of ["MD", "Markdown", "MARKDOWN"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&format=${f}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "text/markdown; charset=utf-8",
      );
    }
  });

  it("limit slices the document BEFORE serialisation (limit=3 → 3 sections)", async () => {
    const md = await (
      await call("?placeId=MOCK_SMALL_001&format=md&limit=3")
    ).text();
    expect(h2Count(md)).toBe(3);
  });

  it("filtering applies to the Markdown surface (min_rating=5 → 7 sections)", async () => {
    const md = await (
      await call("?placeId=MOCK_SMALL_001&format=md&min_rating=5")
    ).text();
    expect(h2Count(md)).toBe(7);
  });

  it("anonymisation redacts the Markdown surface (mask_author hides full names)", async () => {
    const plain = await (
      await call("?placeId=MOCK_SMALL_001&format=md")
    ).text();
    // The un-redacted document carries the fixture's full author display name as
    // an H2 heading. Assert at the heading level (not whole-document) because a
    // given name can legitimately recur inside an un-masked review body.
    expect(plain).toMatch(/^## Maria S\.$/m);
    const masked = await (
      await call("?placeId=MOCK_SMALL_001&format=md&mask_author=1")
    ).text();
    // Masking collapses "Maria S." → spaced initials "M. S.", so the full-name
    // heading is gone and the initials heading takes its place.
    expect(masked).not.toMatch(/^## Maria S\.$/m);
    expect(masked).toMatch(/^## M\. S\.$/m);
  });

  it("field projection is intentionally ignored — md is always the full document", async () => {
    // `fields` narrows the JSON/CSV/XLSX columns, but a narrative document is
    // not a column subset (L37.1), so the Markdown output is byte-identical
    // with and without a `fields` selection.
    const full = await (await call("?placeId=MOCK_SMALL_001&format=md")).text();
    const projected = await (
      await call("?placeId=MOCK_SMALL_001&format=md&fields=rating")
    ).text();
    expect(projected).toBe(full);
  });

  it("md is listed among the supported formats in the unsupported-format 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/json, csv, xlsx, md/);
  });
});

describe("GET /api/reviews — Markdown format (L37.2, batch)", () => {
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

  it("combines several places into one Markdown document (.md batch filename)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=md`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.md/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const md = await res.text();
    // The batch header names the place count, and each place's own H1 follows.
    expect(md).toContain("# Reviews for 2 places");
    expect(md).toContain("# Reviews for Joe's Coffee");
    expect(md).toContain("# Reviews for Bistro La Plaza");
    // 12 small + 80 mid review sections across the combined document.
    expect(h2Count(md)).toBe(12 + 80);
  });

  it("the `markdown` alias works on the batch path too", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=markdown`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(/\.md"/);
  });
});
