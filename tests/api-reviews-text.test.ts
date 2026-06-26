// Coverage for L39.2 — the plain-text (`txt`) delivery format on /api/reviews. A
// `format=txt` request dispatches to the pure plain-text writer
// (lib/export/text.ts, L39.1) with the `text/plain; charset=utf-8` content type
// and a `.txt` attachment filename, applying the same filter→sort→limit→
// anonymise pipeline as the other formats before serialisation. Field projection
// is intentionally NOT honoured (a narrative testimonials document is not a
// column subset — the L39.1 design call, mirroring Markdown's L37.1 / HTML's
// L38.1).
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

// Count per-review blocks by their headline rating marker, e.g. "★★★★☆ (4/5)".
// The place header carries no `(n/5)` token, so this never miscounts the header
// (single or batch).
function reviewCount(txt: string): number {
  return (txt.match(/\(\d(?:\.\d)?\/5\)/g) ?? []).length;
}

describe("GET /api/reviews — text format (L39.2, single place)", () => {
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

  it("format=txt → 200 text/plain with a .txt attachment filename", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="google-reviews-mock-small-001-\d{8}\.txt"$/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("body is an unstyled testimonials document — literal place header, one block per review, NO markup", async () => {
    const txt = await (await call("?placeId=MOCK_SMALL_001&format=txt")).text();
    // The place name is literal text (no HTML escaping, no Markdown), so the
    // apostrophe survives verbatim.
    expect(txt).toContain("Reviews for Joe's Coffee");
    // No Markdown heading/emphasis/blockquote syntax and no HTML tags leak in.
    expect(txt).not.toMatch(/^#/m);
    expect(txt).not.toContain("**");
    expect(txt).not.toContain("<h1>");
    // The committed small fixture is 12 reviews (tests/fixtures-contract.test.ts).
    expect(reviewCount(txt)).toBe(12);
  });

  it("format token is case-insensitive (TXT / Txt behave as txt)", async () => {
    for (const f of ["TXT", "Txt", "tXt"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&format=${f}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    }
  });

  it("limit slices the document BEFORE serialisation (limit=3 → 3 blocks)", async () => {
    const txt = await (
      await call("?placeId=MOCK_SMALL_001&format=txt&limit=3")
    ).text();
    expect(reviewCount(txt)).toBe(3);
  });

  it("filtering applies to the text surface (min_rating=5 → 7 blocks)", async () => {
    const txt = await (
      await call("?placeId=MOCK_SMALL_001&format=txt&min_rating=5")
    ).text();
    expect(reviewCount(txt)).toBe(7);
  });

  it("anonymisation redacts the text surface (mask_author hides full names)", async () => {
    const plain = await (
      await call("?placeId=MOCK_SMALL_001&format=txt")
    ).text();
    // The un-redacted document carries the fixture's full author display name on
    // its own author line.
    expect(plain).toContain("\nMaria S.\n");
    const masked = await (
      await call("?placeId=MOCK_SMALL_001&format=txt&mask_author=1")
    ).text();
    // Masking collapses "Maria S." → spaced initials "M. S.", so the full-name
    // author line is gone and the initials line takes its place.
    expect(masked).not.toContain("\nMaria S.\n");
    expect(masked).toContain("\nM. S.\n");
  });

  it("field projection is intentionally ignored — txt is always the full document", async () => {
    // `fields` narrows the JSON/CSV/XLSX columns, but a narrative document is not
    // a column subset (L39.1), so the text output is byte-identical with and
    // without a `fields` selection.
    const full = await (await call("?placeId=MOCK_SMALL_001&format=txt")).text();
    const projected = await (
      await call("?placeId=MOCK_SMALL_001&format=txt&fields=rating")
    ).text();
    expect(projected).toBe(full);
  });

  it("txt is listed among the supported formats in the unsupported-format 400", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /json, csv, xlsx, md, html, txt/,
    );
  });
});

describe("GET /api/reviews — text format (L39.2, batch)", () => {
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

  it("combines several places into one text document (.txt batch filename)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=txt`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.txt/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const txt = await res.text();
    // The batch header names the place count, and each place's own header follows.
    expect(txt).toContain("Reviews for 2 places");
    expect(txt).toContain("Reviews for Joe's Coffee");
    expect(txt).toContain("Reviews for Bistro La Plaza");
    // 12 small + 80 mid review blocks across the combined document.
    expect(reviewCount(txt)).toBe(12 + 80);
  });
});
