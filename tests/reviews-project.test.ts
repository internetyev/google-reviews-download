// Coverage for lib/reviews/project.ts (Phase 35, L35.1) — the deterministic,
// offline review field-projection / column-selection layer. Legitimate
// new-feature coverage (D-084 allows tests written for net-new code), not
// suite-deepening.
//
// Two angles: hand-built reviews for exact, controllable projection, and the
// committed SMALL fixture (the runtime-served object) to prove projection
// survives real data, never adds/drops a review, and never mutates the input.

import { describe, it, expect } from "vitest";

import { projectReviews, parseReviewFields, __testing } from "@/lib/reviews/project";
import type { ReviewField } from "@/lib/reviews/project";
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
    rating,
    text: `Review ${id}`,
    published_at: "2026-06-01T00:00:00.000Z",
    ...extra,
  };
}

const SMALL: Review[] = clientTesting.FIXTURES.MOCK_SMALL_001.reviews;

describe("parseReviewFields", () => {
  it("parses a comma-separated string into ordered fields", () => {
    expect(parseReviewFields("rating,text")).toEqual(["rating", "text"]);
  });

  it("accepts an array of field names", () => {
    expect(parseReviewFields(["author_name", "rating"])).toEqual([
      "author_name",
      "rating",
    ]);
  });

  it("is case-insensitive, trims, and drops blank tokens", () => {
    expect(parseReviewFields("  RATING , , Text ")).toEqual(["rating", "text"]);
  });

  it("de-duplicates, keeping first-requested order", () => {
    expect(parseReviewFields("text,rating,text")).toEqual(["text", "rating"]);
  });

  it("drops unrecognised field names", () => {
    expect(parseReviewFields("rating,bogus,sentiment")).toEqual(["rating"]);
  });

  it("returns null when nothing valid remains", () => {
    expect(parseReviewFields("")).toBeNull();
    expect(parseReviewFields("nope,also_nope")).toBeNull();
    expect(parseReviewFields([])).toBeNull();
    expect(parseReviewFields(undefined)).toBeNull();
    expect(parseReviewFields(null)).toBeNull();
    expect(parseReviewFields(5)).toBeNull();
  });
});

describe("projectReviews — identity / purity", () => {
  it("empty / null / absent fields returns whole shallow copies (identity)", () => {
    const rs = [review("a"), review("b")];
    for (const fields of [undefined, null, [] as ReviewField[]]) {
      const out = projectReviews(rs, fields);
      expect(out).toEqual(rs);
      expect(out).not.toBe(rs);
      out.forEach((row, i) => expect(row).not.toBe(rs[i]));
    }
  });

  it("an all-unrecognised field set degrades to identity", () => {
    const rs = [review("a")];
    // parseReviewFields would null these out, but a caller passing raw junk
    // (e.g. casted) must still not get empty `{}` rows.
    const out = projectReviews(rs, ["bogus" as ReviewField]);
    expect(out).toEqual(rs);
  });

  it("does not mutate the input reviews", () => {
    const rs = [review("a", 3, { language: "en" })];
    const snapshot = JSON.parse(JSON.stringify(rs));
    projectReviews(rs, ["rating"]);
    expect(rs).toEqual(snapshot);
  });

  it("preserves review order and count", () => {
    const rs = [review("a"), review("b"), review("c")];
    const out = projectReviews(rs, ["review_id"]);
    expect(out.map((r) => r.review_id)).toEqual(["a", "b", "c"]);
  });
});

describe("projectReviews — column selection", () => {
  it("keeps only the requested present fields", () => {
    const out = projectReviews([review("a", 4)], ["rating", "text"]);
    expect(out[0]).toEqual({ rating: 4, text: "Review a" });
    expect(Object.keys(out[0])).toEqual(["rating", "text"]);
  });

  it("omits an absent optional field rather than setting undefined", () => {
    const out = projectReviews([review("a")], ["language", "rating"]);
    // no `language` key on this review → omitted entirely
    expect(Object.prototype.hasOwnProperty.call(out[0], "language")).toBe(false);
    expect(out[0]).toEqual({ rating: 5 });
  });

  it("includes a present optional field", () => {
    const out = projectReviews([review("a", 5, { language: "fr" })], ["language"]);
    expect(out[0]).toEqual({ language: "fr" });
  });

  it("de-dupes duplicate requested fields into one column each", () => {
    const out = projectReviews([review("a", 2)], [
      "rating",
      "rating" as ReviewField,
    ]);
    expect(Object.keys(out[0])).toEqual(["rating"]);
  });

  it("carries nested values (photos / owner_response) by reference-free copy", () => {
    const r = review("a", 5, {
      photos: [{ url: "https://x/p.jpg" }],
      owner_response: { text: "thanks", responded_at: "2026-06-02T00:00:00.000Z" },
    });
    const out = projectReviews([r], ["photos", "owner_response"]);
    expect(out[0].photos).toEqual([{ url: "https://x/p.jpg" }]);
    expect(out[0].owner_response).toEqual({
      text: "thanks",
      responded_at: "2026-06-02T00:00:00.000Z",
    });
  });
});

describe("projectReviews — SMALL fixture survival", () => {
  it("never adds or drops a review", () => {
    const out = projectReviews(SMALL, ["rating", "text"]);
    expect(out).toHaveLength(SMALL.length);
  });

  it("every row carries exactly the requested present columns", () => {
    const fields: ReviewField[] = ["author_name", "rating", "published_at"];
    const out = projectReviews(SMALL, fields);
    for (const row of out) {
      for (const key of Object.keys(row)) {
        expect(fields).toContain(key as ReviewField);
      }
      // these three are always present on the fixture rows
      expect(Object.keys(row).sort()).toEqual([...fields].sort());
    }
  });

  it("does not mutate the fixture", () => {
    const snapshot = JSON.parse(JSON.stringify(SMALL));
    projectReviews(SMALL, ["rating"]);
    expect(SMALL).toEqual(snapshot);
  });
});

describe("__testing seams", () => {
  it("exposes the canonical field set in declaration order", () => {
    expect(__testing.FIELDS[0]).toBe("review_id");
    expect(__testing.FIELDS).toContain("owner_response");
    expect(__testing.isReviewField("Rating")).toBe(true);
    expect(__testing.isReviewField("bogus")).toBe(false);
  });
});
