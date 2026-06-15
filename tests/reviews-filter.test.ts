// Coverage for lib/reviews/filter.ts (Phase 33, L33.1) — the deterministic,
// offline review-filtering layer. Legitimate new-feature coverage (D-084 allows
// tests written for net-new code), not suite-deepening.
//
// Two angles: hand-built reviews for exact, controllable matching, and the
// committed SMALL fixture (the runtime-served object) to prove the filter
// survives real data and never widens the set.

import { describe, it, expect } from "vitest";

import { filterReviews, __testing } from "@/lib/reviews/filter";
import type { ReviewFilter } from "@/lib/reviews/filter";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { Review } from "@/lib/semanticforce/types";

type Rating = 1 | 2 | 3 | 4 | 5;

function review(id: string, rating: Rating, extra: Partial<Review> = {}): Review {
  return {
    review_id: id,
    author_name: `Author ${id}`,
    rating,
    text: `Review ${id}`,
    published_at: "2026-06-01T00:00:00.000Z",
    ...extra,
  };
}

const SMALL: Review[] = clientTesting.FIXTURES.MOCK_SMALL_001.reviews;

describe("filterReviews — identity / purity", () => {
  it("empty filter returns every review in original order", () => {
    const rs = [review("a", 5), review("b", 1), review("c", 3)];
    const out = filterReviews(rs, {});
    expect(out).toEqual(rs);
    expect(out.map((r) => r.review_id)).toEqual(["a", "b", "c"]);
  });

  it("defaults to an empty filter when none is passed", () => {
    const rs = [review("a", 5), review("b", 2)];
    expect(filterReviews(rs)).toEqual(rs);
  });

  it("does not mutate the input array", () => {
    const rs = [review("a", 5), review("b", 1)];
    const snapshot = [...rs];
    filterReviews(rs, { minRating: 4 });
    expect(rs).toEqual(snapshot);
  });

  it("preserves input order for survivors (stable)", () => {
    const rs = [review("a", 5), review("b", 2), review("c", 4), review("d", 1)];
    const out = filterReviews(rs, { minRating: 4 });
    expect(out.map((r) => r.review_id)).toEqual(["a", "c"]);
  });
});

describe("filterReviews — rating bounds (inclusive)", () => {
  const rs = [review("1", 1), review("2", 2), review("3", 3), review("4", 4), review("5", 5)];

  it("minRating keeps the bound itself", () => {
    expect(filterReviews(rs, { minRating: 4 }).map((r) => r.rating)).toEqual([4, 5]);
  });

  it("maxRating keeps the bound itself", () => {
    expect(filterReviews(rs, { maxRating: 2 }).map((r) => r.rating)).toEqual([1, 2]);
  });

  it("min and max combine into a closed band", () => {
    expect(filterReviews(rs, { minRating: 2, maxRating: 4 }).map((r) => r.rating)).toEqual([2, 3, 4]);
  });

  it("an empty band (min>max) yields nothing without throwing", () => {
    expect(filterReviews(rs, { minRating: 5, maxRating: 1 })).toEqual([]);
  });
});

describe("filterReviews — language (case-insensitive exact)", () => {
  const rs = [
    review("en", 5, { language: "en" }),
    review("ES", 4, { language: "ES" }),
    review("none", 3),
  ];

  it("matches case-insensitively", () => {
    expect(filterReviews(rs, { language: "EN" }).map((r) => r.review_id)).toEqual(["en"]);
    expect(filterReviews(rs, { language: "es" }).map((r) => r.review_id)).toEqual(["ES"]);
  });

  it("excludes reviews with no language when a language is required", () => {
    expect(filterReviews(rs, { language: "en" }).some((r) => r.review_id === "none")).toBe(false);
  });

  it("a blank language is treated as no constraint", () => {
    expect(filterReviews(rs, { language: "   " })).toEqual(rs);
  });
});

describe("filterReviews — flags only constrain when explicitly true", () => {
  const withPhoto = review("p", 5, { photos: [{ url: "https://x/y.jpg" }] });
  const withResp = review("r", 4, { owner_response: { text: "thanks", responded_at: "2026-01-01T00:00:00.000Z" } });
  const plain = review("plain", 3);
  const rs = [withPhoto, withResp, plain];

  it("withPhotos:true keeps only photo-carrying reviews", () => {
    expect(filterReviews(rs, { withPhotos: true }).map((r) => r.review_id)).toEqual(["p"]);
  });

  it("withPhotos:false is a no-op (== absent param)", () => {
    expect(filterReviews(rs, { withPhotos: false })).toEqual(rs);
  });

  it("withOwnerResponse:true keeps only responded reviews", () => {
    expect(filterReviews(rs, { withOwnerResponse: true }).map((r) => r.review_id)).toEqual(["r"]);
  });

  it("withOwnerResponse:false is a no-op", () => {
    expect(filterReviews(rs, { withOwnerResponse: false })).toEqual(rs);
  });

  it("treats an empty photos array as no photo", () => {
    const empty = review("e", 2, { photos: [] });
    expect(filterReviews([empty], { withPhotos: true })).toEqual([]);
  });
});

describe("filterReviews — keyword (case-insensitive substring of text)", () => {
  const rs = [
    review("a", 5, { text: "Great REFUND process" }),
    review("b", 1, { text: "slow service" }),
    review("c", 2, { text: "asked for a refund, denied" }),
  ];

  it("matches a substring case-insensitively", () => {
    expect(filterReviews(rs, { keyword: "refund" }).map((r) => r.review_id)).toEqual(["a", "c"]);
  });

  it("a whitespace-only keyword is no constraint (never empties the set)", () => {
    expect(filterReviews(rs, { keyword: "  " })).toEqual(rs);
  });

  it("a non-matching keyword yields nothing", () => {
    expect(filterReviews(rs, { keyword: "zebra" })).toEqual([]);
  });
});

describe("filterReviews — date range (inclusive, lenient on bad input)", () => {
  const rs = [
    review("jan", 5, { published_at: "2026-01-15T00:00:00.000Z" }),
    review("mar", 4, { published_at: "2026-03-15T00:00:00.000Z" }),
    review("jun", 3, { published_at: "2026-06-15T00:00:00.000Z" }),
  ];

  it("since keeps reviews on/after the bound", () => {
    expect(filterReviews(rs, { since: "2026-03-15T00:00:00.000Z" }).map((r) => r.review_id)).toEqual(["mar", "jun"]);
  });

  it("until keeps reviews on/before the bound", () => {
    expect(filterReviews(rs, { until: "2026-03-15T00:00:00.000Z" }).map((r) => r.review_id)).toEqual(["jan", "mar"]);
  });

  it("since+until form a closed window", () => {
    expect(
      filterReviews(rs, { since: "2026-02-01", until: "2026-05-01" }).map((r) => r.review_id),
    ).toEqual(["mar"]);
  });

  it("a malformed bound degrades to no date filter", () => {
    expect(filterReviews(rs, { since: "not-a-date" })).toEqual(rs);
  });
});

describe("filterReviews — criteria combine with AND", () => {
  const rs = [
    review("hit", 5, { language: "en", text: "loved the refund", photos: [{ url: "https://x/1.jpg" }] }),
    review("wrongLang", 5, { language: "es", text: "loved the refund", photos: [{ url: "https://x/2.jpg" }] }),
    review("noPhoto", 5, { language: "en", text: "loved the refund" }),
    review("lowRating", 1, { language: "en", text: "loved the refund", photos: [{ url: "https://x/3.jpg" }] }),
  ];

  it("only the review satisfying every criterion survives", () => {
    const filter: ReviewFilter = { minRating: 4, language: "en", keyword: "refund", withPhotos: true };
    expect(filterReviews(rs, filter).map((r) => r.review_id)).toEqual(["hit"]);
  });
});

describe("filterReviews — committed SMALL fixture (never widens)", () => {
  it("a filter only ever returns a subset of the input", () => {
    const out = filterReviews(SMALL, { minRating: 4 });
    expect(out.length).toBeLessThanOrEqual(SMALL.length);
    expect(out.every((r) => SMALL.includes(r))).toBe(true);
    expect(out.every((r) => r.rating >= 4)).toBe(true);
  });

  it("the rating bands partition the fixture exactly", () => {
    const low = filterReviews(SMALL, { maxRating: 2 }).length;
    const mid = filterReviews(SMALL, { minRating: 3, maxRating: 3 }).length;
    const high = filterReviews(SMALL, { minRating: 4 }).length;
    expect(low + mid + high).toBe(SMALL.length);
  });
});

describe("__testing helpers", () => {
  it("parseDate returns epoch ms for valid input and null otherwise", () => {
    expect(__testing.parseDate("2026-01-01T00:00:00.000Z")).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(__testing.parseDate("garbage")).toBeNull();
    expect(__testing.parseDate("  ")).toBeNull();
    expect(__testing.parseDate(undefined)).toBeNull();
  });

  it("norm trims and lowercases", () => {
    expect(__testing.norm("  EN ")).toBe("en");
  });
});
