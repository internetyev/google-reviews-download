// Data-contract guard for the committed SemanticForce fixtures
// (`mocks/semanticforce/{small,mid,large}-business.json`) — L10.1 / D-058.
//
// The entire mock-first architecture (D-005/D-039) rests on these three
// JSON files: every other suite, the API/preview/healthcheck routes, the
// CSV/XLSX writers and the cache all run against them. But the client
// imports each file with `as unknown as Fixture` (lib/semanticforce/client.ts)
// — TypeScript validates *nothing* about their shape. If a fixture drifts
// from the `Review`/`PlaceMeta` types or from the documented schema
// (docs/semanticforce-api.md), every downstream suite goes on passing
// against malformed data and the human-gated L4.1 live swap is the first
// thing that notices. This suite is the only structural guard on the data
// those suites trust.
//
// It validates the objects the *runtime* actually consumes — `__testing.FIXTURES`,
// the registry the client serves from — not a fresh re-read of the JSON, so
// what is pinned is exactly what production sees through the cast.
//
// Invariants pinned:
//   - registry shape: exactly MOCK_SMALL_001 / MID_001 / LARGE_001, each
//     fixture's `place.place_id` equal to its registry key (pickFixture's
//     exact-match path depends on this — client.ts:125).
//   - committed sizes: 12 / 80 / 500 reviews. NOTE the L1.3 roadmap prose
//     says "small (10 reviews)"; the committed small fixture is 12 (r1–r12,
//     rating_count 12). We pin the committed reality, not the stale prose —
//     the preview suite already hard-codes 12 (D-041), so a silent shrink to
//     10 would desync the two.
//   - rating_count >= reviews.length for every fixture (12==12, 93>80,
//     609>500): the data-source side of the D-041 "total shown is the
//     place's rating_count, never a walk/fetch count" invariant. A fixture
//     edit that set rating_count below the array length would make the
//     preview "total N reviews" silently under-report.
//   - per-review shape: review_id non-empty + unique within its fixture
//     (cursor/slice paging and CSV row identity depend on uniqueness),
//     rating an integer in 1..5, author_name/text non-empty, published_at a
//     round-tripping ISO-8601 UTC string, and the optional photos/
//     owner_response/language sub-shapes well-formed when present.
//   - documented coverage actually present (L1.3 promised unicode, multiple
//     languages, the full 1..5 star spread, photo URLs, owner responses):
//     guarded so a regenerated fixture can't quietly collapse the diversity
//     the export/render suites rely on for real variety (and the non-ASCII
//     check ties to the feedback_csv_ascii_for_excel unicode-survival memory).
//
// Pure data + no I/O — committed-not-run (D-039/D-040/D-042 posture:
// manifest-only, no `node_modules`; runs on `npm install && npm test`).

import { describe, it, expect } from "vitest";
import { __testing } from "@/lib/semanticforce/client";
import type { GetReviewsResponse, Review } from "@/lib/semanticforce/types";

const { FIXTURES } = __testing;

// Committed sizes (the source of truth — see header note on the L1.3 "10").
const EXPECTED_SIZE: Record<string, number> = {
  MOCK_SMALL_001: 12,
  MOCK_MID_001: 80,
  MOCK_LARGE_001: 500,
};

const KEYS = Object.keys(EXPECTED_SIZE);

const isIsoUtc = (s: unknown): boolean => {
  if (typeof s !== "string" || s.trim() === "") return false;
  // Must parse and round-trip as a real instant, and be expressed in UTC (Z).
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  return /\dZ$/.test(s) && new Date(t).toISOString().slice(0, 19) === s.slice(0, 19);
};

// True iff the string carries a code point outside printable ASCII
// (accents, CJK, Cyrillic, Arabic) — used for the unicode-coverage check.
const hasNonAscii = (s: string): boolean => {
  for (const ch of s) {
    if (ch.codePointAt(0)! > 0x7f) return true;
  }
  return false;
};

describe("SemanticForce fixtures — registry & place contract", () => {
  it("registers exactly the three documented fixtures, no more", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...KEYS].sort());
  });

  for (const key of KEYS) {
    const fx = FIXTURES[key] as GetReviewsResponse;

    it(`${key}: place_id matches its registry key (exact-match paging path)`, () => {
      expect(fx.place.place_id).toBe(key);
    });

    it(`${key}: has exactly ${EXPECTED_SIZE[key]} reviews (committed size)`, () => {
      expect(fx.reviews).toHaveLength(EXPECTED_SIZE[key]);
    });

    it(`${key}: place metadata is well-formed`, () => {
      const p = fx.place;
      expect(typeof p.name).toBe("string");
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(typeof p.rating_avg).toBe("number");
      expect(p.rating_avg).toBeGreaterThan(0);
      expect(p.rating_avg).toBeLessThanOrEqual(5);
      expect(Number.isInteger(p.rating_count)).toBe(true);
      expect(p.rating_count).toBeGreaterThanOrEqual(0);
      // Optional fields, when present, are non-empty strings.
      if (p.address !== undefined) expect(p.address.trim().length).toBeGreaterThan(0);
      if (p.url !== undefined) expect(p.url.trim().length).toBeGreaterThan(0);
    });

    it(`${key}: rating_count >= reviews surfaced (D-041 total-not-walk-count, data side)`, () => {
      expect(fx.place.rating_count).toBeGreaterThanOrEqual(fx.reviews.length);
    });

    it(`${key}: every review_id is unique within the fixture`, () => {
      const ids = fx.reviews.map((r) => r.review_id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});

describe("SemanticForce fixtures — per-review contract", () => {
  for (const key of KEYS) {
    const fx = FIXTURES[key] as GetReviewsResponse;

    it(`${key}: every review matches the Review type shape`, () => {
      for (const r of fx.reviews as Review[]) {
        expect(typeof r.review_id).toBe("string");
        expect(r.review_id.trim().length).toBeGreaterThan(0);
        expect(typeof r.author_name).toBe("string");
        expect(r.author_name.trim().length).toBeGreaterThan(0);
        expect(typeof r.text).toBe("string");
        expect(r.text.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(r.rating)).toBe(true);
        expect(r.rating).toBeGreaterThanOrEqual(1);
        expect(r.rating).toBeLessThanOrEqual(5);
        expect(isIsoUtc(r.published_at)).toBe(true);

        if (r.language !== undefined) {
          expect(typeof r.language).toBe("string");
          expect(r.language.trim().length).toBeGreaterThan(0);
        }
        if (r.author_url !== undefined) {
          expect(r.author_url.trim().length).toBeGreaterThan(0);
        }
        if (r.photos !== undefined) {
          expect(Array.isArray(r.photos)).toBe(true);
          for (const photo of r.photos) {
            expect(typeof photo.url).toBe("string");
            expect(photo.url.trim().length).toBeGreaterThan(0);
            if (photo.width !== undefined) expect(photo.width).toBeGreaterThan(0);
            if (photo.height !== undefined) expect(photo.height).toBeGreaterThan(0);
          }
        }
        if (r.owner_response !== undefined) {
          expect(typeof r.owner_response.text).toBe("string");
          expect(r.owner_response.text.trim().length).toBeGreaterThan(0);
          expect(isIsoUtc(r.owner_response.responded_at)).toBe(true);
        }
      }
    });
  }
});

describe("SemanticForce fixtures — documented coverage (L1.3) survives", () => {
  // Flatten the whole corpus once for cross-fixture coverage assertions.
  const allReviews = KEYS.flatMap((k) => (FIXTURES[k] as GetReviewsResponse).reviews);

  it("the full 1..5 star spread appears across the corpus", () => {
    const ratings = new Set(allReviews.map((r) => r.rating));
    expect([...ratings].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("multiple distinct languages are present (multi-language coverage)", () => {
    const langs = new Set(
      allReviews.map((r) => r.language).filter((l): l is string => Boolean(l)),
    );
    // Small alone carries en/de/es/pl; the corpus carries far more.
    expect(langs.size).toBeGreaterThanOrEqual(4);
  });

  it("at least one photo and one owner response exist (rich-field coverage)", () => {
    expect(allReviews.some((r) => r.photos && r.photos.length > 0)).toBe(true);
    expect(allReviews.some((r) => r.owner_response !== undefined)).toBe(true);
  });

  it("non-ASCII review text survives in the fixtures (unicode coverage)", () => {
    expect(allReviews.some((r) => hasNonAscii(r.text))).toBe(true);
  });
});
