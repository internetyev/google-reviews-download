// Coverage for lib/reviews/anonymise.ts (Phase 36, L36.1) — the deterministic,
// offline review anonymisation / PII-redaction layer. Legitimate new-feature
// coverage (D-084 allows tests written for net-new code), not suite-deepening.
//
// Two angles: hand-built reviews for exact, controllable redaction, and the
// committed SMALL fixture (the runtime-served object) to prove anonymisation
// survives real data, never adds/drops a review, and never mutates the input.

import { describe, it, expect } from "vitest";

import {
  anonymiseReviews,
  maskAuthorName,
  ANONYMOUS_LABEL,
  __testing,
} from "@/lib/reviews/anonymise";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { Review } from "@/lib/semanticforce/types";

type Rating = 1 | 2 | 3 | 4 | 5;

function review(
  id: string,
  rating: Rating = 5,
  extra: Partial<Review> = {},
): Review {
  return {
    review_id: id,
    author_name: `Author ${id}`,
    author_url: `https://maps.google.com/profile/${id}`,
    rating,
    text: `Review ${id}`,
    published_at: "2026-06-01T00:00:00.000Z",
    photos: [{ url: `https://img.example/${id}.jpg` }],
    ...extra,
  };
}

const SMALL: Review[] = clientTesting.FIXTURES.MOCK_SMALL_001.reviews;

describe("maskAuthorName", () => {
  it("reduces a two-word name to spaced initials", () => {
    expect(maskAuthorName("John Smith")).toBe("J. S.");
  });

  it("masks a single-word name to one initial", () => {
    expect(maskAuthorName("Madonna")).toBe("M.");
  });

  it("collapses runs of whitespace and trims edges", () => {
    expect(maskAuthorName("  john   paul  ")).toBe("J. P.");
  });

  it("upper-cases each initial", () => {
    expect(maskAuthorName("jane doe")).toBe("J. D.");
  });

  it("falls back to the sentinel for a blank / whitespace name", () => {
    expect(maskAuthorName("")).toBe(ANONYMOUS_LABEL);
    expect(maskAuthorName("   ")).toBe(ANONYMOUS_LABEL);
    expect(maskAuthorName("\t \n")).toBe(ANONYMOUS_LABEL);
  });

  it("falls back to the sentinel for a punctuation-only name", () => {
    expect(maskAuthorName("...")).toBe(ANONYMOUS_LABEL);
  });

  it("is code-point safe for accented / non-Latin initials", () => {
    expect(maskAuthorName("søren kierkegaard")).toBe("S. K.");
    expect(maskAuthorName("олег петренко")).toBe("О. П.");
  });
});

describe("anonymiseReviews — identity / purity", () => {
  it("returns whole copies when no options are given", () => {
    const input = [review("a"), review("b", 3)];
    expect(anonymiseReviews(input)).toEqual(input);
  });

  it("returns whole copies when every flag is false", () => {
    const input = [review("a")];
    expect(
      anonymiseReviews(input, {
        maskAuthorName: false,
        dropAuthorUrl: false,
        dropPhotos: false,
      }),
    ).toEqual(input);
  });

  it("never mutates the input reviews or array", () => {
    const input = [review("a"), review("b")];
    const snapshot = JSON.parse(JSON.stringify(input));
    anonymiseReviews(input, {
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
    expect(input).toEqual(snapshot);
  });

  it("returns a new array of new objects (per-call freshness)", () => {
    const input = [review("a")];
    const first = anonymiseReviews(input, { maskAuthorName: true });
    const second = anonymiseReviews(input, { maskAuthorName: true });
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).not.toBe(input[0]);
    expect(first).toEqual(second);
  });

  it("preserves review order and count", () => {
    const input = [review("a"), review("b"), review("c")];
    const out = anonymiseReviews(input, { maskAuthorName: true });
    expect(out.map((r) => r.review_id)).toEqual(["a", "b", "c"]);
  });
});

describe("anonymiseReviews — maskAuthorName", () => {
  it("masks the display name to initials and leaves nothing else touched", () => {
    const r = review("x", 4, { author_name: "John Smith" });
    const [out] = anonymiseReviews([r], { maskAuthorName: true });
    expect(out.author_name).toBe("J. S.");
    expect(out.author_url).toBe(r.author_url);
    expect(out.photos).toEqual(r.photos);
    expect(out.rating).toBe(4);
    expect(out.text).toBe(r.text);
    expect(out.published_at).toBe(r.published_at);
  });

  it("collapses a blank author to the sentinel", () => {
    const [out] = anonymiseReviews([review("x", 5, { author_name: "" })], {
      maskAuthorName: true,
    });
    expect(out.author_name).toBe(ANONYMOUS_LABEL);
  });
});

describe("anonymiseReviews — dropAuthorUrl / dropPhotos", () => {
  it("drops author_url when present", () => {
    const [out] = anonymiseReviews([review("x")], { dropAuthorUrl: true });
    expect("author_url" in out).toBe(false);
  });

  it("is a no-op when author_url is already absent (key omitted, not undefined)", () => {
    const r = review("x");
    delete r.author_url;
    const [out] = anonymiseReviews([r], { dropAuthorUrl: true });
    expect("author_url" in out).toBe(false);
    expect(out.author_url).toBeUndefined();
  });

  it("drops photos when present", () => {
    const [out] = anonymiseReviews([review("x")], { dropPhotos: true });
    expect("photos" in out).toBe(false);
  });

  it("is a no-op when photos are already absent", () => {
    const r = review("x");
    delete r.photos;
    const [out] = anonymiseReviews([r], { dropPhotos: true });
    expect("photos" in out).toBe(false);
  });

  it("leaves author_url / photos intact when only masking the name", () => {
    const r = review("x");
    const [out] = anonymiseReviews([r], { maskAuthorName: true });
    expect(out.author_url).toBe(r.author_url);
    expect(out.photos).toEqual(r.photos);
  });

  it("applies all three redactions together", () => {
    const r = review("x", 2, { author_name: "Grace Hopper" });
    const [out] = anonymiseReviews([r], {
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
    expect(out.author_name).toBe("G. H.");
    expect("author_url" in out).toBe(false);
    expect("photos" in out).toBe(false);
    expect(out.rating).toBe(2);
    expect(out.text).toBe(r.text);
  });
});

describe("anonymiseReviews — SMALL fixture", () => {
  it("never adds or drops a review", () => {
    const out = anonymiseReviews(SMALL, {
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
    expect(out).toHaveLength(SMALL.length);
    expect(out.map((r) => r.review_id)).toEqual(SMALL.map((r) => r.review_id));
  });

  it("masks every author to an initials form and never throws", () => {
    const out = anonymiseReviews(SMALL, { maskAuthorName: true });
    for (const r of out) {
      // Either spaced initials (e.g. "J. S.") or the sentinel — never the
      // original full name, never empty.
      expect(r.author_name.length).toBeGreaterThan(0);
      expect(/^([^\s.]\. ?)+$|^Anonymous$/u.test(r.author_name)).toBe(true);
    }
  });

  it("strips every author_url and every photos array when dropped", () => {
    const out = anonymiseReviews(SMALL, {
      dropAuthorUrl: true,
      dropPhotos: true,
    });
    expect(out.some((r) => "author_url" in r)).toBe(false);
    expect(out.some((r) => "photos" in r)).toBe(false);
  });

  it("does not mutate the shared fixture", () => {
    const snapshot = JSON.parse(JSON.stringify(SMALL));
    anonymiseReviews(SMALL, {
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
    expect(SMALL).toEqual(snapshot);
  });
});

describe("__testing.isActive", () => {
  it("is false for an empty / all-false options bag", () => {
    expect(__testing.isActive({})).toBe(false);
    expect(
      __testing.isActive({
        maskAuthorName: false,
        dropAuthorUrl: false,
        dropPhotos: false,
      }),
    ).toBe(false);
  });

  it("is true when any single flag is set", () => {
    expect(__testing.isActive({ maskAuthorName: true })).toBe(true);
    expect(__testing.isActive({ dropAuthorUrl: true })).toBe(true);
    expect(__testing.isActive({ dropPhotos: true })).toBe(true);
  });
});
