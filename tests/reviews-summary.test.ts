// Coverage for lib/reviews/summary.ts (Phase 32, L32.1) — the deterministic,
// offline review-summary layer. These tests are legitimate new-feature coverage
// (D-084 allows tests written for net-new code), not suite-deepening.
//
// Two angles: hand-built payloads for exact, controllable arithmetic, and the
// committed SMALL fixture (the runtime-served object) to prove the summary
// survives real data with the L1.3-promised coverage (full 1–5 spread,
// languages, photos, owner responses).

import { describe, it, expect } from "vitest";

import { summariseReviews, __testing } from "@/lib/reviews/summary";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type {
  GetReviewsResponse,
  PlaceMeta,
  Review,
} from "@/lib/semanticforce/types";

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

function payload(
  reviews: Review[],
  place: Partial<PlaceMeta> = {},
): Pick<CachedReviewsPayload, "place" | "reviews"> {
  return {
    place: {
      place_id: "ChIJtest",
      name: "Test Cafe",
      rating_avg: 4.5,
      rating_count: 1234,
      ...place,
    },
    reviews,
  };
}

describe("summariseReviews — headline vs sampled", () => {
  it("surfaces the place's authoritative total + average verbatim", () => {
    const s = summariseReviews(
      payload([review("a", 5)], { rating_count: 891, rating_avg: 4.6 }),
    );
    // The whole-place headline numbers come straight off PlaceMeta — they are
    // NOT recomputed from the sample (D-041/D-031 total-not-walk-count).
    expect(s.total_reviews).toBe(891);
    expect(s.overall_rating).toBe(4.6);
    // ...and the sample is reported separately so the two can never be confused.
    expect(s.sampled_reviews).toBe(1);
    expect(s.place_id).toBe("ChIJtest");
    expect(s.place_name).toBe("Test Cafe");
  });

  it("computes the sampled average independently of the headline average", () => {
    // headline rating_avg 4.5, but the sample is all 1★ → sampled avg must be 1.
    const s = summariseReviews(
      payload([review("a", 1), review("b", 1)], { rating_avg: 4.5 }),
    );
    expect(s.overall_rating).toBe(4.5);
    expect(s.sampled_average_rating).toBe(1);
  });

  it("rounds the sampled average to 2dp", () => {
    // (5+4+4) / 3 = 4.3333… → 4.33
    const s = summariseReviews(
      payload([review("a", 5), review("b", 4), review("c", 4)]),
    );
    expect(s.sampled_average_rating).toBe(4.33);
  });
});

describe("summariseReviews — rating distribution", () => {
  it("histograms every star level, including the zeros", () => {
    const s = summariseReviews(
      payload([
        review("a", 5),
        review("b", 5),
        review("c", 4),
        review("d", 1),
      ]),
    );
    expect(s.rating_distribution).toEqual({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 });
    // the distribution sums to the sample size
    const total = Object.values(s.rating_distribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(s.sampled_reviews);
  });
});

describe("summariseReviews — sentiment buckets", () => {
  it("splits 4–5★ positive, 3★ neutral, 1–2★ negative", () => {
    const s = summariseReviews(
      payload([
        review("a", 5), // +
        review("b", 4), // +
        review("c", 3), // 0
        review("d", 2), // -
        review("e", 1), // -
      ]),
    );
    expect(s.sentiment).toEqual({ positive: 2, neutral: 1, negative: 2 });
    const total =
      s.sentiment.positive + s.sentiment.neutral + s.sentiment.negative;
    expect(total).toBe(s.sampled_reviews);
  });

  it("classifies each star at the bucket boundaries", () => {
    expect(__testing.sentimentOf(1)).toBe("negative");
    expect(__testing.sentimentOf(2)).toBe("negative");
    expect(__testing.sentimentOf(3)).toBe("neutral");
    expect(__testing.sentimentOf(4)).toBe("positive");
    expect(__testing.sentimentOf(5)).toBe("positive");
  });
});

describe("summariseReviews — operational signals", () => {
  it("counts photos, owner responses, and distinct sorted languages", () => {
    const s = summariseReviews(
      payload([
        review("a", 5, { photos: [{ url: "p1" }], language: "en" }),
        review("b", 4, { language: "uk" }),
        review("c", 3, {
          owner_response: { text: "thanks", responded_at: "2026-06-02T00:00:00.000Z" },
          language: "en",
        }),
        review("d", 2, { photos: [] }), // empty photos array → not counted
      ]),
    );
    expect(s.with_photos).toBe(1);
    expect(s.with_owner_response).toBe(1);
    expect(s.languages).toEqual(["en", "uk"]); // distinct + sorted
  });

  it("ignores blank/whitespace languages", () => {
    const s = summariseReviews(
      payload([review("a", 5, { language: "  " }), review("b", 4, { language: "fr" })]),
    );
    expect(s.languages).toEqual(["fr"]);
  });
});

describe("summariseReviews — empty sample", () => {
  it("is a valid, zeroed summary (no divide-by-zero)", () => {
    const s = summariseReviews(payload([], { rating_count: 50, rating_avg: 3.9 }));
    expect(s.sampled_reviews).toBe(0);
    expect(s.sampled_average_rating).toBe(0); // not NaN
    expect(s.rating_distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(s.sentiment).toEqual({ positive: 0, neutral: 0, negative: 0 });
    expect(s.with_photos).toBe(0);
    expect(s.with_owner_response).toBe(0);
    expect(s.languages).toEqual([]);
    // the headline still reports the whole place
    expect(s.total_reviews).toBe(50);
    expect(s.overall_rating).toBe(3.9);
  });
});

describe("summariseReviews — over the committed SMALL fixture", () => {
  const fx = clientTesting.FIXTURES.MOCK_SMALL_001 as GetReviewsResponse;
  const s = summariseReviews({ place: fx.place, reviews: fx.reviews });

  it("samples exactly the committed 12 reviews and matches the place id", () => {
    expect(s.sampled_reviews).toBe(12);
    expect(s.place_id).toBe(fx.place.place_id);
    expect(s.total_reviews).toBe(fx.place.rating_count);
  });

  it("the bucket totals reconcile to the sample size", () => {
    const distTotal = Object.values(s.rating_distribution).reduce(
      (a, b) => a + b,
      0,
    );
    const sentTotal =
      s.sentiment.positive + s.sentiment.neutral + s.sentiment.negative;
    expect(distTotal).toBe(12);
    expect(sentTotal).toBe(12);
  });

  it("surfaces the L1.3-promised real-data coverage", () => {
    // full 1–5 spread in the fixture
    for (const star of __testing.RATINGS) {
      expect(s.rating_distribution[star]).toBeGreaterThan(0);
    }
    // multiple languages, at least one photo, at least one owner response
    expect(s.languages.length).toBeGreaterThanOrEqual(2);
    expect(s.with_photos).toBeGreaterThanOrEqual(1);
    expect(s.with_owner_response).toBeGreaterThanOrEqual(1);
  });
});

describe("summariseReviews — freshness", () => {
  it("returns a fresh object (+ fresh nested objects) per call", () => {
    const p = payload([review("a", 5)]);
    const a = summariseReviews(p);
    const b = summariseReviews(p);
    expect(a).not.toBe(b);
    expect(a.rating_distribution).not.toBe(b.rating_distribution);
    expect(a.sentiment).not.toBe(b.sentiment);
    expect(a).toEqual(b);
  });
});
