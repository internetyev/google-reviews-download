// Coverage for lib/reviews/sort.ts (Phase 34, L34.1) — the deterministic,
// offline review-ordering layer. Legitimate new-feature coverage (D-084 allows
// tests written for net-new code), not suite-deepening.
//
// Two angles: hand-built reviews for exact, controllable ordering, and the
// committed SMALL fixture (the runtime-served object) to prove the sort survives
// real data, never adds/drops a review, and never mutates the input.

import { describe, it, expect } from "vitest";

import { sortReviews, parseReviewOrder, __testing } from "@/lib/reviews/sort";
import type { ReviewOrder } from "@/lib/reviews/sort";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { Review } from "@/lib/semanticforce/types";

type Rating = 1 | 2 | 3 | 4 | 5;

function review(
  id: string,
  rating: Rating,
  published_at = "2026-06-01T00:00:00.000Z",
  extra: Partial<Review> = {},
): Review {
  return {
    review_id: id,
    author_name: `Author ${id}`,
    rating,
    text: `Review ${id}`,
    published_at,
    ...extra,
  };
}

const SMALL: Review[] = clientTesting.FIXTURES.MOCK_SMALL_001.reviews;

describe("parseReviewOrder", () => {
  it("accepts each canonical order", () => {
    for (const o of ["newest", "oldest", "highest", "lowest"] as const) {
      expect(parseReviewOrder(o)).toBe(o);
    }
  });

  it("is case-insensitive and trims", () => {
    expect(parseReviewOrder("  NEWEST ")).toBe("newest");
    expect(parseReviewOrder("Highest")).toBe("highest");
  });

  it("returns null for unrecognised / non-string values", () => {
    expect(parseReviewOrder("rating")).toBeNull();
    expect(parseReviewOrder("")).toBeNull();
    expect(parseReviewOrder(undefined)).toBeNull();
    expect(parseReviewOrder(null)).toBeNull();
    expect(parseReviewOrder(5)).toBeNull();
  });
});

describe("sortReviews — identity / purity", () => {
  it("absent order returns input order (identity)", () => {
    const rs = [review("a", 5), review("b", 1), review("c", 3)];
    expect(sortReviews(rs).map((r) => r.review_id)).toEqual(["a", "b", "c"]);
  });

  it("unrecognised order degrades to identity (never throws/empties)", () => {
    const rs = [review("a", 5), review("b", 1)];
    expect(sortReviews(rs, "bogus").map((r) => r.review_id)).toEqual(["a", "b"]);
    expect(sortReviews(rs, "").map((r) => r.review_id)).toEqual(["a", "b"]);
  });

  it("returns a fresh array and never mutates the input", () => {
    const rs = [review("a", 1), review("b", 5)];
    const snapshot = [...rs];
    const out = sortReviews(rs, "highest");
    expect(out).not.toBe(rs);
    expect(rs).toEqual(snapshot);
    expect(rs.map((r) => r.review_id)).toEqual(["a", "b"]);
  });

  it("never adds or drops reviews (same multiset)", () => {
    const rs = [review("a", 3), review("b", 1), review("c", 5)];
    for (const o of ["newest", "oldest", "highest", "lowest"] as const) {
      const out = sortReviews(rs, o);
      expect(out.length).toBe(rs.length);
      expect([...out].map((r) => r.review_id).sort()).toEqual(["a", "b", "c"]);
    }
  });
});

describe("sortReviews — by date", () => {
  const older = review("old", 3, "2025-01-01T00:00:00.000Z");
  const mid = review("mid", 3, "2025-06-01T00:00:00.000Z");
  const newer = review("new", 3, "2026-01-01T00:00:00.000Z");
  const rs = [mid, newer, older];

  it("newest → descending by published_at", () => {
    expect(sortReviews(rs, "newest").map((r) => r.review_id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("oldest → ascending by published_at", () => {
    expect(sortReviews(rs, "oldest").map((r) => r.review_id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });
});

describe("sortReviews — by rating with recency tie-break", () => {
  // Same date-spread across ratings so ties are exercised deterministically.
  const a = review("a", 5, "2025-01-01T00:00:00.000Z");
  const b = review("b", 1, "2026-01-01T00:00:00.000Z");
  const c = review("c", 5, "2026-06-01T00:00:00.000Z"); // ties with `a` on rating
  const d = review("d", 1, "2025-06-01T00:00:00.000Z"); // ties with `b` on rating
  const rs = [a, b, c, d];

  it("highest → 5★ first, freshest within a tie", () => {
    // 5★: c (2026-06) before a (2025-01); 1★: b (2026-01) before d (2025-06)
    expect(sortReviews(rs, "highest").map((r) => r.review_id)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("lowest → 1★ first, freshest within a tie (freshest complaints up top)", () => {
    expect(sortReviews(rs, "lowest").map((r) => r.review_id)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });
});

describe("sortReviews — stability on equal keys", () => {
  it("keeps input order for reviews equal on rating AND date", () => {
    const rs = [
      review("a", 4, "2026-01-01T00:00:00.000Z"),
      review("b", 4, "2026-01-01T00:00:00.000Z"),
      review("c", 4, "2026-01-01T00:00:00.000Z"),
    ];
    expect(sortReviews(rs, "highest").map((r) => r.review_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortReviews(rs, "newest").map((r) => r.review_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("sortReviews — lenient on malformed/missing published_at", () => {
  const good = review("good", 3, "2026-01-01T00:00:00.000Z");
  const bad = review("bad", 3, "not-a-date");
  const empty = review("empty", 3, "");

  it("unplaceable dates sort to the end, never throw, for date orders", () => {
    for (const o of ["newest", "oldest"] as const) {
      const out = sortReviews([bad, good, empty], o);
      expect(out[0].review_id).toBe("good");
      expect(out.slice(1).map((r) => r.review_id).sort()).toEqual([
        "bad",
        "empty",
      ]);
    }
  });

  it("rating order pushes unplaceable-date ties to the end of their band", () => {
    const fresh = review("fresh", 5, "2026-06-01T00:00:00.000Z");
    const stale = review("stale", 5, "bad-date");
    const out = sortReviews([stale, fresh], "highest");
    expect(out.map((r) => r.review_id)).toEqual(["fresh", "stale"]);
  });
});

describe("sortReviews — committed SMALL fixture (never adds/drops/mutates)", () => {
  it("preserves the review set under every order", () => {
    const ids = SMALL.map((r) => r.review_id).sort();
    for (const o of ["newest", "oldest", "highest", "lowest"] as const) {
      const out = sortReviews(SMALL, o);
      expect(out.length).toBe(SMALL.length);
      expect(out.map((r) => r.review_id).sort()).toEqual(ids);
      expect(out.every((r) => SMALL.includes(r))).toBe(true);
    }
  });

  it("does not reorder the fixture in place", () => {
    const before = SMALL.map((r) => r.review_id);
    sortReviews(SMALL, "lowest");
    expect(SMALL.map((r) => r.review_id)).toEqual(before);
  });

  it("newest fixture order is non-increasing by published_at", () => {
    const out = sortReviews(SMALL, "newest");
    const times = out.map((r) => Date.parse(r.published_at));
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });
});

describe("compareWithNullsLast — internal seam", () => {
  const { compareWithNullsLast } = __testing;

  it("nulls always trail regardless of direction", () => {
    expect(compareWithNullsLast(null, 5, true)).toBe(1);
    expect(compareWithNullsLast(5, null, true)).toBe(-1);
    expect(compareWithNullsLast(null, 5, false)).toBe(1);
    expect(compareWithNullsLast(5, null, false)).toBe(-1);
  });

  it("two nulls are equal; equal placeables defer to tie-breaker", () => {
    expect(compareWithNullsLast(null, null, true)).toBe(0);
    expect(compareWithNullsLast(3, 3, true)).toBeNull();
  });
});
