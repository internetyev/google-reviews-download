// Regression guard for lib/export/jsonld.ts (Phase 40).
// The JSON-LD writer emits a schema.org structured-data document (LocalBusiness +
// AggregateRating + Review[]) for embedding as <script type="application/ld+json">.
// These tests pin: JSON validity (round-trips through JSON.parse), the @context/
// @type scaffolding, the AUTHORITATIVE aggregateRating (rating_avg/rating_count,
// never the walk length), one Review node per review with rating bounds and ISO
// datePublished, the deterministic/non-mutating contract, the empty-reviews edge,
// the batch ItemList shape, and the filename/content-type conventions.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsJsonLd,
  formatBatchAsJsonLd,
  jsonldFilename,
  JSONLD_CONTENT_TYPE,
  __testing,
} from "@/lib/export/jsonld";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type { GetReviewsResponse } from "@/lib/semanticforce/types";

const { SCHEMA_CONTEXT, RATING_BEST, RATING_WORST } = __testing;

function payload(): CachedReviewsPayload {
  return {
    place: {
      place_id: "ChIJTest",
      name: 'Café "Niño" — Łódź',
      address: "12 Main St",
      rating_avg: 4.5,
      rating_count: 87,
      url: "https://maps.example/x",
    },
    fetched_at: "2026-05-16T08:30:00.000Z",
    reviews: [
      {
        review_id: "r1",
        author_name: "Anaïs 🌟",
        author_url: "https://u/anais",
        rating: 5,
        text: "Loved it.\nGreat service!",
        language: "en",
        published_at: "2026-05-01T09:00:00Z",
        photos: [{ url: "https://p/1.jpg" }],
        owner_response: { text: "Thank you!", responded_at: "2026-05-02" },
      },
      {
        review_id: "r2",
        author_name: "Bob",
        rating: 3,
        text: "ok",
        published_at: "2026-05-03T12:00:00Z",
      },
    ],
  };
}

describe("formatReviewsAsJsonLd — JSON validity & document scaffolding", () => {
  const out = formatReviewsAsJsonLd(payload());
  const doc = JSON.parse(out);

  it("emits valid, parseable JSON", () => {
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("is a LocalBusiness node with the schema.org @context", () => {
    expect(doc["@context"]).toBe(SCHEMA_CONTEXT);
    expect(doc["@type"]).toBe("LocalBusiness");
    expect(doc.name).toBe('Café "Niño" — Łódź');
  });

  it("carries optional address/url from PlaceMeta when present", () => {
    expect(doc.address).toBe("12 Main St");
    expect(doc.url).toBe("https://maps.example/x");
  });

  it("carries the AUTHORITATIVE aggregateRating, not the walk length", () => {
    expect(doc.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 87, // authoritative rating_count, NOT reviews.length (2)
      bestRating: RATING_BEST,
      worstRating: RATING_WORST,
    });
  });
});

describe("formatReviewsAsJsonLd — Review nodes", () => {
  const doc = JSON.parse(formatReviewsAsJsonLd(payload()));

  it("emits one Review node per review", () => {
    expect(Array.isArray(doc.review)).toBe(true);
    expect(doc.review).toHaveLength(2);
    expect(doc.review.every((r: { "@type": string }) => r["@type"] === "Review")).toBe(true);
  });

  it("maps rating to a bounded Rating, author to a Person, text to reviewBody", () => {
    expect(doc.review[0].reviewRating).toEqual({
      "@type": "Rating",
      ratingValue: 5,
      bestRating: RATING_BEST,
      worstRating: RATING_WORST,
    });
    expect(doc.review[0].author).toEqual({ "@type": "Person", name: "Anaïs 🌟" });
    expect(doc.review[0].reviewBody).toBe("Loved it.\nGreat service!");
  });

  it("carries the ISO published_at verbatim as datePublished", () => {
    expect(doc.review[0].datePublished).toBe("2026-05-01T09:00:00Z");
  });

  it("emits inLanguage only when the review declares a language", () => {
    expect(doc.review[0].inLanguage).toBe("en");
    expect(doc.review[1]).not.toHaveProperty("inLanguage");
  });

  it("omits owner-response (no first-class schema.org Review field)", () => {
    expect(JSON.stringify(doc)).not.toContain("Thank you!");
  });
});

describe("formatReviewsAsJsonLd — purity & edge cases", () => {
  it("is deterministic (byte-identical across calls) and non-mutating", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    const a = formatReviewsAsJsonLd(p);
    const b = formatReviewsAsJsonLd(p);
    expect(a).toBe(b);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("omits optional address/url when absent", () => {
    const lean: CachedReviewsPayload = {
      place: { place_id: "ChIJX", name: "X", rating_avg: 4, rating_count: 1 },
      fetched_at: "2026-05-16T00:00:00.000Z",
      reviews: [
        { review_id: "r", author_name: "A", rating: 4, text: "hi", published_at: "2026-05-01" },
      ],
    };
    const doc = JSON.parse(formatReviewsAsJsonLd(lean));
    expect(doc).not.toHaveProperty("address");
    expect(doc).not.toHaveProperty("url");
    expect(doc.name).toBe("X");
  });

  it("renders an empty-reviews payload as a node with an empty review array", () => {
    const empty: CachedReviewsPayload = {
      place: { place_id: "ChIJX", name: "X", rating_avg: 0, rating_count: 0 },
      fetched_at: "2026-05-16T00:00:00.000Z",
      reviews: [],
    };
    const doc = JSON.parse(formatReviewsAsJsonLd(empty));
    expect(doc.review).toEqual([]);
    expect(doc.aggregateRating.reviewCount).toBe(0);
  });
});

describe("formatBatchAsJsonLd", () => {
  it("emits an ItemList whose itemListElement carries one LocalBusiness per place", () => {
    const a = payload();
    const b = payload();
    b.place.name = "Second Place";
    b.place.place_id = "ChIJSecond";
    const doc = JSON.parse(formatBatchAsJsonLd([a, b]));
    expect(doc["@context"]).toBe(SCHEMA_CONTEXT);
    expect(doc["@type"]).toBe("ItemList");
    expect(doc.itemListElement).toHaveLength(2);
    expect(doc.itemListElement.every((n: { "@type": string }) => n["@type"] === "LocalBusiness")).toBe(true);
    expect(doc.itemListElement[0].name).toBe('Café "Niño" — Łódź');
    expect(doc.itemListElement[1].name).toBe("Second Place");
  });

  it("does not repeat @context inside each nested LocalBusiness node", () => {
    const doc = JSON.parse(formatBatchAsJsonLd([payload()]));
    expect(doc.itemListElement[0]).not.toHaveProperty("@context");
  });

  it("is valid parseable JSON and non-mutating", () => {
    const ps = [payload()];
    const snapshot = JSON.stringify(ps);
    expect(() => JSON.parse(formatBatchAsJsonLd(ps))).not.toThrow();
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});

describe("jsonldFilename & content type", () => {
  it("uses the data vintage date, not the wall clock", () => {
    expect(jsonldFilename("mock-small-001", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-mock-small-001-20260516.jsonld",
    );
  });

  it("declares application/ld+json", () => {
    expect(JSONLD_CONTENT_TYPE).toBe("application/ld+json");
  });
});

describe("formatReviewsAsJsonLd — over the committed SMALL fixture", () => {
  const fx = clientTesting.FIXTURES.MOCK_SMALL_001 as GetReviewsResponse;
  const doc = JSON.parse(
    formatReviewsAsJsonLd({
      place: fx.place,
      reviews: fx.reviews,
      fetched_at: "2026-05-16T00:00:00.000Z",
    }),
  );

  it("emits one Review node per fixture review", () => {
    expect(doc.review).toHaveLength(fx.reviews.length);
  });

  it("reports the place's authoritative rating_count, not the walk length", () => {
    expect(doc.aggregateRating.reviewCount).toBe(fx.place.rating_count);
    expect(doc.aggregateRating.ratingValue).toBe(fx.place.rating_avg);
  });
});
