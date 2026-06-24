// Regression guard for lib/export/text.ts (Phase 39).
// The plain-text writer emits the same narrative testimonials document as the
// Markdown/HTML writers but with NO markup. These tests pin the document
// structure (header, star bars, reflowed prose, owner-response block), the
// markup-free contract, the deterministic/non-mutating contract, the batch
// concatenation, and the filename/content-type conventions.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsText,
  formatBatchAsText,
  textFilename,
  TEXT_CONTENT_TYPE,
  __testing,
} from "@/lib/export/text";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type { GetReviewsResponse } from "@/lib/semanticforce/types";

const { stars, inline, reflow, RATING_MAX, STAR_FULL, STAR_EMPTY, RULE } =
  __testing;

function payload(): CachedReviewsPayload {
  return {
    place: {
      place_id: "ChIJTest",
      name: 'Café "Niño" — Łódź',
      address: "12 Main St",
      rating_avg: 4.5,
      rating_count: 2,
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
        published_at: "2026-05-01",
        photos: [{ url: "https://p/1.jpg" }],
        owner_response: {
          text: "Thank you!",
          responded_at: "2026-05-02",
        },
      },
      {
        review_id: "r2",
        author_name: "Bob",
        rating: 3,
        text: "ok",
        published_at: "2026-05-03",
      },
    ],
  };
}

describe("__testing.stars", () => {
  it("renders a five-glyph bar with the rating's worth of full stars", () => {
    expect(stars(5)).toBe(STAR_FULL.repeat(5));
    expect(stars(3)).toBe(STAR_FULL.repeat(3) + STAR_EMPTY.repeat(2));
    expect(stars(1)).toBe(STAR_FULL + STAR_EMPTY.repeat(4));
    expect([...stars(4)]).toHaveLength(RATING_MAX);
  });

  it("clamps a malformed out-of-range rating instead of throwing", () => {
    expect(stars(0)).toBe(STAR_EMPTY.repeat(5));
    expect(stars(-2)).toBe(STAR_EMPTY.repeat(5));
    expect(stars(9)).toBe(STAR_FULL.repeat(5));
  });
});

describe("__testing.inline / reflow", () => {
  it("inline collapses all whitespace (incl. newlines) to single spaces", () => {
    expect(inline("a\n  b\tc")).toBe("a b c");
    expect(inline("  padded  ")).toBe("padded");
  });

  it("reflow joins soft line breaks but preserves paragraph breaks", () => {
    expect(reflow("one\ntwo")).toBe("one two");
    expect(reflow("a\n\nb")).toBe("a\n\nb");
    expect(reflow("x\ny\n\nz\nw")).toBe("x y\n\nz w");
    expect(reflow("  solo  ")).toBe("solo");
  });
});

describe("formatReviewsAsText — document structure", () => {
  const out = formatReviewsAsText(payload());

  it("opens with the place name and headline rating from PlaceMeta", () => {
    expect(out.startsWith('Reviews for Café "Niño" — Łódź')).toBe(true);
    expect(out).toContain(`4.5 ${STAR_FULL} from 2 reviews`);
  });

  it("includes the address and the place url when present", () => {
    expect(out).toContain("12 Main St");
    expect(out).toContain("https://maps.example/x");
  });

  it("renders the star bar and numeric rating per review", () => {
    expect(out).toContain(`${STAR_FULL.repeat(5)} (5/5)`);
    expect(out).toContain(`${STAR_FULL.repeat(3)}${STAR_EMPTY.repeat(2)} (3/5)`);
  });

  it("renders the author line and date · language metadata line", () => {
    expect(out).toContain("Anaïs 🌟");
    expect(out).toContain("2026-05-01 · en");
    // no language → just the date, no trailing separator
    expect(out).toContain("2026-05-03");
    expect(out).not.toContain("2026-05-03 · ");
  });

  it("reflows multi-line review text into a single plain paragraph", () => {
    expect(out).toContain("Loved it. Great service!");
    expect(out).toContain("ok");
  });

  it("renders an owner-response block only when present", () => {
    expect(out).toContain("Owner response:");
    expect(out).toContain("Thank you!");
    expect(out).toContain("Responded 2026-05-02");
    // Bob has no owner response — exactly one response block in the doc
    expect((out.match(/^Owner response:$/gm) ?? []).length).toBe(1);
  });

  it("separates the header and each block with a plain (non-Markdown) rule", () => {
    expect((out.match(new RegExp(`^${RULE}$`, "gm")) ?? []).length).toBe(2);
  });

  it("contains no Markdown/HTML markup characters", () => {
    expect(out).not.toMatch(/[#*<>]/);
    expect(out).not.toMatch(/^---$/m);
  });

  it("ends with a single trailing newline", () => {
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatReviewsAsText — purity & edge cases", () => {
  it("is deterministic (byte-identical across calls) and non-mutating", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    const a = formatReviewsAsText(p);
    const b = formatReviewsAsText(p);
    expect(a).toBe(b);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("omits optional address/url/owner-response when absent", () => {
    const lean: CachedReviewsPayload = {
      place: { place_id: "ChIJX", name: "X", rating_avg: 4, rating_count: 1 },
      fetched_at: "2026-05-16T00:00:00.000Z",
      reviews: [
        { review_id: "r", author_name: "A", rating: 4, text: "hi", published_at: "2026-05-01" },
      ],
    };
    const out = formatReviewsAsText(lean);
    expect(out).not.toContain("Owner response");
    expect(out).toContain("Reviews for X");
    expect(out).toContain("A");
  });

  it("renders an empty-reviews payload as just the header (no blocks/rules)", () => {
    const empty: CachedReviewsPayload = {
      place: { place_id: "ChIJX", name: "X", rating_avg: 0, rating_count: 0 },
      fetched_at: "2026-05-16T00:00:00.000Z",
      reviews: [],
    };
    const out = formatReviewsAsText(empty);
    expect(out).toContain("Reviews for X");
    expect(out.match(new RegExp(`^${RULE}$`, "gm"))).toBe(null);
  });
});

describe("formatBatchAsText", () => {
  it("concatenates each place's block under one batch title", () => {
    const a = payload();
    const b = payload();
    b.place.name = "Second Place";
    b.place.place_id = "ChIJSecond";
    const out = formatBatchAsText([a, b]);
    expect(out.startsWith("Reviews for 2 places")).toBe(true);
    expect(out).toContain("4 reviews across 2 places");
    expect(out).toContain('Reviews for Café "Niño" — Łódź');
    expect(out).toContain("Reviews for Second Place");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("textFilename & content type", () => {
  it("uses the data vintage date, not the wall clock", () => {
    expect(textFilename("mock-small-001", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-mock-small-001-20260516.txt",
    );
  });

  it("declares text/plain utf-8", () => {
    expect(TEXT_CONTENT_TYPE).toBe("text/plain; charset=utf-8");
  });
});

describe("formatReviewsAsText — over the committed SMALL fixture", () => {
  const fx = clientTesting.FIXTURES.MOCK_SMALL_001 as GetReviewsResponse;
  const out = formatReviewsAsText({
    place: fx.place,
    reviews: fx.reviews,
    fetched_at: "2026-05-16T00:00:00.000Z",
  });

  it("renders exactly one block-separating rule per gap (reviews + header)", () => {
    expect((out.match(new RegExp(`^${RULE}$`, "gm")) ?? []).length).toBe(
      fx.reviews.length,
    );
  });

  it("reports the place's authoritative rating_count, not the walk length", () => {
    expect(out).toContain(`from ${fx.place.rating_count} reviews`);
  });
});
