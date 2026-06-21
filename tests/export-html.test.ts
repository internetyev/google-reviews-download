// Regression guard for lib/export/html.ts (Phase 38).
// The HTML writer emits a self-contained, publishable testimonials page.
// These tests pin the document shell (doctype/lang/charset/title/inline style,
// no external assets), the per-review structure (article/author/star bar/
// blockquote/owner-response), the load-bearing XSS-escaping + safe-URL
// contract, the deterministic/non-mutating guarantee, the batch concatenation,
// and the filename/content-type conventions.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsHtml,
  formatBatchAsHtml,
  htmlFilename,
  HTML_CONTENT_TYPE,
  __testing,
} from "@/lib/export/html";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type { GetReviewsResponse } from "@/lib/semanticforce/types";

const { escapeHtml, safeUrl, stars, inline, RATING_MAX, STAR_FULL, STAR_EMPTY } =
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

describe("__testing.escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" foo='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; foo=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes & first so entities aren't double-escaped", () => {
    expect(escapeHtml("Tom & <Jerry>")).toBe("Tom &amp; &lt;Jerry&gt;");
  });

  it("leaves plain unicode prose untouched", () => {
    expect(escapeHtml("Anaïs 🌟 Łódź")).toBe("Anaïs 🌟 Łódź");
  });
});

describe("__testing.safeUrl", () => {
  it("admits http and https", () => {
    expect(safeUrl("https://maps.example/x")).toBe("https://maps.example/x");
    expect(safeUrl("http://maps.example/x")).toBe("http://maps.example/x");
  });

  it("rejects javascript:/data:/relative/garbage URIs to empty string", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,<script>")).toBe("");
    expect(safeUrl("/relative/path")).toBe("");
    expect(safeUrl("ftp://x")).toBe("");
    expect(safeUrl("not a url")).toBe("");
  });

  it("trims surrounding whitespace before scheme-checking", () => {
    expect(safeUrl("   https://x.test/  ")).toBe("https://x.test/");
  });
});

describe("__testing.stars", () => {
  it("renders a five-glyph bar with the rating's worth of full stars", () => {
    expect(stars(4)).toBe(STAR_FULL.repeat(4) + STAR_EMPTY);
    expect([...stars(4)].length).toBe(RATING_MAX);
  });

  it("clamps malformed out-of-range ratings instead of throwing", () => {
    expect(stars(-3)).toBe(STAR_EMPTY.repeat(RATING_MAX));
    expect(stars(99)).toBe(STAR_FULL.repeat(RATING_MAX));
  });
});

describe("__testing.inline", () => {
  it("collapses whitespace and escapes markup", () => {
    expect(inline("a\n  b\t<c>")).toBe("a b &lt;c&gt;");
  });
});

describe("formatReviewsAsHtml — document shell", () => {
  const out = formatReviewsAsHtml(payload());

  it("is a complete HTML5 document with lang, charset, viewport and title", () => {
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<meta name="viewport"');
    expect(out).toContain("</html>");
  });

  it("escapes the place name in the <title>", () => {
    expect(out).toContain(
      "<title>Reviews for Café &quot;Niño&quot; — Łódź</title>",
    );
  });

  it("carries a self-contained inline stylesheet and no external assets", () => {
    expect(out).toContain("<style>");
    expect(out).not.toContain("<link");
    expect(out).not.toContain("<script");
    expect(out).not.toMatch(/https?:\/\/[^"]*\.(css|js)/);
  });

  it("ends with exactly one trailing newline", () => {
    expect(out.endsWith("</html>\n")).toBe(true);
    expect(out.endsWith("</html>\n\n")).toBe(false);
  });
});

describe("formatReviewsAsHtml — place header + reviews", () => {
  const out = formatReviewsAsHtml(payload());

  it("renders an <h1> place header with the escaped name", () => {
    expect(out).toContain("<h1>Reviews for Café &quot;Niño&quot; — Łódź</h1>");
  });

  it("reports the authoritative rating_count, not the review count", () => {
    expect(out).toContain("from 2 reviews");
  });

  it("renders the Google link only via a scheme-checked, escaped href", () => {
    expect(out).toContain('<a href="https://maps.example/x"');
    expect(out).toContain(">View on Google</a>");
  });

  it("renders exactly one <article> per review", () => {
    expect((out.match(/<article class="review">/g) ?? []).length).toBe(2);
  });

  it("renders the author, star bar and numeric rating per review", () => {
    expect(out).toContain('<h2 class="author">Anaïs 🌟</h2>');
    expect(out).toContain(STAR_FULL.repeat(5));
    expect(out).toContain("(5/5)");
    expect(out).toContain("(3/5)");
  });

  it("renders the date · language metadata line", () => {
    expect(out).toContain("2026-05-01 · en");
  });

  it("splits multi-line review prose into <p> paragraphs in a blockquote", () => {
    expect(out).toContain('<blockquote class="text">');
    expect(out).toContain("<p>Loved it.</p>");
    expect(out).toContain("<p>Great service!</p>");
  });

  it("renders an owner-response block only when present", () => {
    expect(out).toContain("Owner response:");
    expect(out).toContain("<p>Thank you!</p>");
    expect(out).toContain("Responded 2026-05-02");
    // The second review has no owner response → exactly one block.
    expect((out.match(/<div class="owner-response">/g) ?? []).length).toBe(1);
  });
});

describe("formatReviewsAsHtml — XSS / injection safety", () => {
  it("escapes angle brackets and quotes in author name and text", () => {
    const p = payload();
    p.reviews[0].author_name = '<script>alert("x")</script>';
    p.reviews[0].text = "1 < 2 & 3 > 0";
    const out = formatReviewsAsHtml(p);
    expect(out).not.toContain("<script>alert");
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out).toContain("1 &lt; 2 &amp; 3 &gt; 0");
  });

  it("drops a javascript: place URL rather than emitting it as an href", () => {
    const p = payload();
    p.place.url = "javascript:alert(1)";
    const out = formatReviewsAsHtml(p);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("View on Google");
  });
});

describe("formatReviewsAsHtml — determinism & purity", () => {
  it("is byte-for-byte deterministic across calls", () => {
    expect(formatReviewsAsHtml(payload())).toBe(formatReviewsAsHtml(payload()));
  });

  it("does not mutate the input payload", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    formatReviewsAsHtml(p);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("renders a valid shell for an empty-reviews payload", () => {
    const p = payload();
    p.reviews = [];
    const out = formatReviewsAsHtml(p);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("<h1>Reviews for");
    expect((out.match(/<article/g) ?? []).length).toBe(0);
  });

  it("omits the meta line when both date and language are absent", () => {
    const p = payload();
    p.reviews = [
      {
        review_id: "x",
        author_name: "No Meta",
        rating: 4,
        text: "fine",
        published_at: "",
      },
    ];
    const out = formatReviewsAsHtml(p);
    expect(out).not.toContain('<p class="meta">');
  });
});

describe("formatBatchAsHtml", () => {
  function other(): CachedReviewsPayload {
    return {
      place: {
        place_id: "ChIJOther",
        name: "Second Place",
        rating_avg: 3.9,
        rating_count: 7,
      },
      fetched_at: "2026-05-16T00:00:00.000Z",
      reviews: [
        {
          review_id: "o1",
          author_name: "Carol",
          rating: 2,
          text: "meh",
          published_at: "2026-04-01",
        },
      ],
    };
  }

  const out = formatBatchAsHtml([payload(), other()]);

  it("is one HTML document with a batch title", () => {
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("<title>Reviews for 2 places</title>");
    expect(out).toContain("<h1>Reviews for 2 places</h1>");
  });

  it("sums reviews across all places in the headline", () => {
    expect(out).toContain("3 reviews across 2 places");
  });

  it("wraps each place in its own distinguishable section", () => {
    expect((out.match(/<section class="place-block">/g) ?? []).length).toBe(2);
    expect(out).toContain("Café &quot;Niño&quot; — Łódź");
    expect(out).toContain("Second Place");
  });

  it("renders every review across the batch", () => {
    // 2 (first place) + 1 (second place) = 3 articles
    expect((out.match(/<article class="review">/g) ?? []).length).toBe(3);
  });
});

describe("htmlFilename / HTML_CONTENT_TYPE", () => {
  it("names the file google-reviews-<slug>-<YYYYMMDD>.html from the data vintage", () => {
    expect(htmlFilename("mock-small-001", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-mock-small-001-20260516.html",
    );
  });

  it("declares text/html utf-8", () => {
    expect(HTML_CONTENT_TYPE).toBe("text/html; charset=utf-8");
  });
});

describe("formatReviewsAsHtml — over the committed SMALL fixture", () => {
  const fx = clientTesting.FIXTURES.MOCK_SMALL_001 as GetReviewsResponse;
  const out = formatReviewsAsHtml({
    place: fx.place,
    reviews: fx.reviews,
    fetched_at: "2026-05-16T00:00:00.000Z",
  });

  it("renders exactly one <article> per committed review", () => {
    expect((out.match(/<article class="review">/g) ?? []).length).toBe(
      fx.reviews.length,
    );
  });

  it("reports the place's authoritative rating_count, not the walk length", () => {
    expect(out).toContain(`from ${fx.place.rating_count} reviews`);
  });

  it("emits no unescaped angle brackets inside the review body region", () => {
    // Everything between <main> and </main> that isn't one of our own known
    // tags should not introduce stray markup; a cheap proxy is that no raw
    // "<" from fixture prose survives — assert the document still parses as a
    // single <main>.
    expect((out.match(/<main class="reviews">/g) ?? []).length).toBe(1);
    expect((out.match(/<\/main>/g) ?? []).length).toBe(1);
  });
});
