// Regression guard for lib/export/rss.ts (Phase 41).
// The RSS writer emits a standards-compliant RSS 2.0 syndication feed. These
// tests pin the XML scaffolding (declaration + `<rss version="2.0">` + single
// `<channel>`), the channel header (title, safeUrl-gated link, authoritative
// rating headline — never the walk length), the per-item structure (star+author
// title, review text + appended owner response as the description, RFC-822
// `<pubDate>`, `isPermaLink="false"` guid), the load-bearing XML-escaping +
// safe-URL injection contract, the deterministic/non-mutating guarantee, the
// single-`<channel>` batch with place-prefixed item titles, the empty-reviews
// edge, and the filename/content-type conventions.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsRss,
  formatBatchAsRss,
  rssFilename,
  RSS_CONTENT_TYPE,
  __testing,
} from "@/lib/export/rss";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type { GetReviewsResponse } from "@/lib/semanticforce/types";

const { escapeXml, safeUrl, inline, toRfc822, STAR } = __testing;

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
        author_name: "Anaïs <script>",
        author_url: "https://u/anais",
        rating: 5,
        text: "Loved it & <great>!",
        language: "en",
        published_at: "2002-10-02T13:00:00.000Z",
        owner_response: {
          text: "Thank you!",
          responded_at: "2002-10-03T09:00:00.000Z",
        },
      },
      {
        review_id: "r2",
        author_name: "Bob",
        rating: 3,
        text: "ok",
        published_at: "2026-05-03T00:00:00.000Z",
      },
    ],
  };
}

describe("escapeXml", () => {
  it("escapes all five XML-significant characters, & first", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("does not double-escape (the & inserted by later passes survives once)", () => {
    expect(escapeXml("<a>")).toBe("&lt;a&gt;");
    expect(escapeXml("a & b < c")).toBe("a &amp; b &lt; c");
  });
});

describe("safeUrl", () => {
  it("admits http(s) URLs", () => {
    expect(safeUrl("https://x.test/p")).toBe("https://x.test/p");
    expect(safeUrl("  http://x.test  ")).toBe("http://x.test");
  });

  it("drops javascript:/data:/relative/garbage to empty string", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,x")).toBe("");
    expect(safeUrl("/relative")).toBe("");
    expect(safeUrl("ftp://x")).toBe("");
  });
});

describe("toRfc822", () => {
  it("formats an ISO timestamp as RFC-822 in GMT", () => {
    expect(toRfc822("2002-10-02T13:00:00.000Z")).toBe(
      "Wed, 02 Oct 2002 13:00:00 GMT",
    );
  });

  it("zero-pads day/hour/minute/second", () => {
    expect(toRfc822("2026-01-05T03:07:09.000Z")).toBe(
      "Mon, 05 Jan 2026 03:07:09 GMT",
    );
  });

  it("treats a date-only value as UTC midnight", () => {
    expect(toRfc822("2026-05-03")).toBe("Sun, 03 May 2026 00:00:00 GMT");
  });

  it("returns '' for an unparseable input", () => {
    expect(toRfc822("not-a-date")).toBe("");
  });
});

describe("formatReviewsAsRss", () => {
  it("emits the XML declaration and a single rss/channel scaffold", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(rss).toContain('<rss version="2.0">');
    expect((rss.match(/<channel>/g) ?? []).length).toBe(1);
    expect((rss.match(/<\/channel>/g) ?? []).length).toBe(1);
    expect(rss.endsWith("</rss>\n")).toBe(true);
  });

  it("ends with exactly one trailing newline", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss.endsWith("\n")).toBe(true);
    expect(rss.endsWith("\n\n")).toBe(false);
  });

  it("uses the place name in the channel title (escaped)", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss).toContain(
      `<title>Reviews for ${inline('Café "Niño" — Łódź')}</title>`,
    );
  });

  it("emits the safe place URL as the channel link", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss).toContain("<link>https://maps.example/x</link>");
  });

  it("builds the channel description from authoritative rating stats, not the walk count", () => {
    const p = payload();
    p.place.rating_count = 2; // walk length is 2 reviews here; bump the authority apart
    p.place.rating_count = 873;
    const rss = formatReviewsAsRss(p);
    expect(rss).toContain(
      `<description>${escapeXml("4.5 ★ average from 873 reviews")}</description>`,
    );
    // The rendered item count (2) must not be what the headline reports.
    expect(rss).not.toContain("average from 2 reviews");
  });

  it("emits one <item> per review", () => {
    const rss = formatReviewsAsRss(payload());
    expect((rss.match(/<item>/g) ?? []).length).toBe(2);
  });

  it("renders the item title as <rating>★ — <author> (escaped)", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss).toContain(
      `<title>5${STAR} — ${inline("Anaïs <script>")}</title>`,
    );
    // The raw <script> must never appear unescaped.
    expect(rss).not.toContain("<script>");
  });

  it("XML-escapes the review text in the description", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss).toContain(escapeXml("Loved it & <great>!"));
    expect(rss).not.toContain("Loved it & <great>!");
  });

  it("appends an Owner response block to the description only when present", () => {
    const rss = formatReviewsAsRss(payload());
    // r1 has an owner response, r2 does not.
    expect(rss).toContain("Owner response: Thank you!");
    expect((rss.match(/Owner response:/g) ?? []).length).toBe(1);
  });

  it("emits an RFC-822 <pubDate> per review", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss).toContain("<pubDate>Wed, 02 Oct 2002 13:00:00 GMT</pubDate>");
    expect(rss).toContain("<pubDate>Sun, 03 May 2026 00:00:00 GMT</pubDate>");
  });

  it("emits a non-permalink guid = the review id", () => {
    const rss = formatReviewsAsRss(payload());
    expect(rss).toContain('<guid isPermaLink="false">r1</guid>');
    expect(rss).toContain('<guid isPermaLink="false">r2</guid>');
  });

  it("drops a javascript: place URL — no <link> emitted", () => {
    const p = payload();
    p.place.url = "javascript:alert(1)";
    const rss = formatReviewsAsRss(p);
    expect(rss).not.toContain("<link>");
    expect(rss).not.toContain("javascript:");
  });

  it("is deterministic (byte-for-byte) and does not mutate the payload", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    const a = formatReviewsAsRss(p);
    const b = formatReviewsAsRss(p);
    expect(a).toBe(b);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("handles an empty reviews array (valid channel, no items)", () => {
    const p = payload();
    p.reviews = [];
    const rss = formatReviewsAsRss(p);
    expect(rss).toContain("<channel>");
    expect(rss).toContain("</channel>");
    expect(rss).not.toContain("<item>");
    expect(rss.endsWith("</rss>\n")).toBe(true);
  });
});

describe("formatBatchAsRss", () => {
  function batch(): CachedReviewsPayload[] {
    const a = payload();
    const b = payload();
    b.place.name = "Second Place";
    b.reviews = [b.reviews[0]];
    return [a, b];
  }

  it("emits exactly one <channel> for the whole batch", () => {
    const rss = formatBatchAsRss(batch());
    expect((rss.match(/<channel>/g) ?? []).length).toBe(1);
  });

  it("titles the channel with the place count and a cross-place headline", () => {
    const rss = formatBatchAsRss(batch());
    expect(rss).toContain("<title>Reviews for 2 places</title>");
    expect(rss).toContain(
      `<description>${escapeXml("3 reviews across 2 places")}</description>`,
    );
  });

  it("prefixes each item title with its place name", () => {
    const rss = formatBatchAsRss(batch());
    expect(rss).toContain(
      `<title>${inline('Café "Niño" — Łódź')} — 5${STAR} — ${inline("Anaïs <script>")}</title>`,
    );
    expect(rss).toContain(
      `<title>${inline("Second Place")} — 5${STAR} — ${inline("Anaïs <script>")}</title>`,
    );
  });

  it("aggregates all items across places (2 + 1 = 3)", () => {
    const rss = formatBatchAsRss(batch());
    expect((rss.match(/<item>/g) ?? []).length).toBe(3);
  });
});

describe("formatReviewsAsRss — over the committed SMALL fixture", () => {
  const fx = clientTesting.FIXTURES.MOCK_SMALL_001 as GetReviewsResponse;
  const p: CachedReviewsPayload = {
    place: fx.place,
    reviews: fx.reviews,
    fetched_at: "2026-05-16T00:00:00.000Z",
  };

  it("produces a well-formed feed with one item per fixture review", () => {
    const rss = formatReviewsAsRss(p);
    expect(rss.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((rss.match(/<item>/g) ?? []).length).toBe(fx.reviews.length);
    expect(rss).toContain(
      `<description>${escapeXml(`${fx.place.rating_avg} ${STAR} average from ${fx.place.rating_count} reviews`)}</description>`,
    );
    expect(rss.endsWith("</rss>\n")).toBe(true);
  });
});

describe("rssFilename + RSS_CONTENT_TYPE", () => {
  it("builds google-reviews-<slug>-<YYYYMMDD>.rss from the data vintage date", () => {
    expect(rssFilename("cafe-nino", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-cafe-nino-20260516.rss",
    );
  });

  it("pins the RSS content type", () => {
    expect(RSS_CONTENT_TYPE).toBe("application/rss+xml; charset=utf-8");
  });
});
