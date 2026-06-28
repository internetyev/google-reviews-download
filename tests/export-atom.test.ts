// Regression guard for lib/export/atom.ts (Phase 42).
// The Atom writer emits a standards-compliant Atom 1.0 (RFC 4287) syndication
// feed. These tests pin the XML scaffolding (declaration + `<feed>` with the Atom
// `xmlns`), the feed header (typed title, a stable `<id>` URN derived from the
// place id — never a timestamp, the authoritative rating subtitle — never the
// walk length, the safeUrl-gated alternate `<link>`, and the feed `<updated>` =
// the NEWEST review timestamp in RFC-3339), the per-entry structure (typed
// star+author title, a stable `<id>` URN = the review id, an RFC-3339
// `<updated>`, an `<author><name>`, the review text + appended owner response as
// a typed `<content>`), the load-bearing XML-escaping + safe-URL injection
// contract, the deterministic/non-mutating guarantee, the single-`<feed>` batch
// with place-prefixed entry titles + a batch `<id>` URN, the empty-reviews edge,
// and the filename/content-type conventions.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsAtom,
  formatBatchAsAtom,
  atomFilename,
  ATOM_CONTENT_TYPE,
  __testing,
} from "@/lib/export/atom";
import { __testing as clientTesting } from "@/lib/semanticforce/client";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type { GetReviewsResponse } from "@/lib/semanticforce/types";

const { escapeXml, safeUrl, inline, toRfc3339, feedUpdated, STAR, EMPTY_FEED_UPDATED } =
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

describe("toRfc3339", () => {
  it("formats an ISO timestamp as RFC-3339 UTC (Zulu)", () => {
    expect(toRfc3339("2002-10-02T13:00:00.000Z")).toBe("2002-10-02T13:00:00Z");
  });

  it("zero-pads month/day/hour/minute/second", () => {
    expect(toRfc3339("2026-01-05T03:07:09.000Z")).toBe("2026-01-05T03:07:09Z");
  });

  it("treats a date-only value as UTC midnight", () => {
    expect(toRfc3339("2026-05-03")).toBe("2026-05-03T00:00:00Z");
  });

  it("returns '' for an unparseable input", () => {
    expect(toRfc3339("not-a-date")).toBe("");
  });
});

describe("feedUpdated", () => {
  it("returns the NEWEST review timestamp in RFC-3339", () => {
    expect(feedUpdated(payload().reviews)).toBe("2026-05-03T00:00:00Z");
  });

  it("falls back to the empty-feed sentinel with no reviews", () => {
    expect(feedUpdated([])).toBe(EMPTY_FEED_UPDATED);
  });

  it("ignores unparseable timestamps when picking the newest", () => {
    const reviews = payload().reviews.map((r) => ({ ...r }));
    reviews[1].published_at = "not-a-date";
    // r2 (the newest) is now unparseable, so r1 wins.
    expect(feedUpdated(reviews)).toBe("2002-10-02T13:00:00Z");
  });
});

describe("formatReviewsAsAtom", () => {
  it("emits the XML declaration and a single Atom feed scaffold with xmlns", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect((atom.match(/<feed /g) ?? []).length).toBe(1);
    expect(atom.endsWith("</feed>\n")).toBe(true);
  });

  it("ends with exactly one trailing newline", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom.endsWith("\n")).toBe(true);
    expect(atom.endsWith("\n\n")).toBe(false);
  });

  it("uses the place name in the typed feed title (escaped)", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain(
      `<title type="text">Reviews for ${inline('Café "Niño" — Łódź')}</title>`,
    );
  });

  it("derives the feed <id> URN from the place id, not a timestamp", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain("<id>urn:google-reviews:place:ChIJTest</id>");
  });

  it("sets feed <updated> to the newest review timestamp in RFC-3339", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain("<updated>2026-05-03T00:00:00Z</updated>");
  });

  it("emits the safe place URL as a rel=alternate link", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain(
      '<link rel="alternate" href="https://maps.example/x"/>',
    );
  });

  it("builds the subtitle from authoritative rating stats, not the walk count", () => {
    const p = payload();
    p.place.rating_count = 873;
    const atom = formatReviewsAsAtom(p);
    expect(atom).toContain(
      `<subtitle type="text">${escapeXml("4.5 ★ average from 873 reviews")}</subtitle>`,
    );
    // The rendered entry count (2) must not be what the headline reports.
    expect(atom).not.toContain("average from 2 reviews");
  });

  it("emits one <entry> per review", () => {
    const atom = formatReviewsAsAtom(payload());
    expect((atom.match(/<entry>/g) ?? []).length).toBe(2);
  });

  it("renders the entry title as <rating>★ — <author> (typed, escaped)", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain(
      `<title type="text">5${STAR} — ${inline("Anaïs <script>")}</title>`,
    );
    // The raw <script> must never appear unescaped.
    expect(atom).not.toContain("<script>");
  });

  it("emits a stable per-entry <id> URN = the review id", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain("<id>urn:google-reviews:review:r1</id>");
    expect(atom).toContain("<id>urn:google-reviews:review:r2</id>");
  });

  it("emits an RFC-3339 <updated> per entry", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain("<updated>2002-10-02T13:00:00Z</updated>");
    expect(atom).toContain("<updated>2026-05-03T00:00:00Z</updated>");
  });

  it("emits an <author><name> per entry (escaped)", () => {
    const atom = formatReviewsAsAtom(payload());
    expect(atom).toContain(
      `<author><name>${inline("Anaïs <script>")}</name></author>`,
    );
    expect(atom).toContain("<author><name>Bob</name></author>");
  });

  it("XML-escapes the review text in the typed content", () => {
    const atom = formatReviewsAsAtom(payload());
    // r1's content opens with the escaped review text (owner response follows
    // before the closing tag), r2 is a bare escaped value.
    expect(atom).toContain(
      `<content type="text">${escapeXml("Loved it & <great>!")}`,
    );
    expect(atom).toContain(`<content type="text">ok</content>`);
    expect(atom).not.toContain("Loved it & <great>!");
  });

  it("appends an Owner response block to the content only when present", () => {
    const atom = formatReviewsAsAtom(payload());
    // r1 has an owner response, r2 does not.
    expect(atom).toContain("Owner response: Thank you!");
    expect((atom.match(/Owner response:/g) ?? []).length).toBe(1);
  });

  it("drops a javascript: place URL — no <link> emitted", () => {
    const p = payload();
    p.place.url = "javascript:alert(1)";
    const atom = formatReviewsAsAtom(p);
    expect(atom).not.toContain("<link");
    expect(atom).not.toContain("javascript:");
  });

  it("is deterministic (byte-for-byte) and does not mutate the payload", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    const a = formatReviewsAsAtom(p);
    const b = formatReviewsAsAtom(p);
    expect(a).toBe(b);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("handles an empty reviews array (valid feed, sentinel updated, no entries)", () => {
    const p = payload();
    p.reviews = [];
    const atom = formatReviewsAsAtom(p);
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(atom).toContain(`<updated>${EMPTY_FEED_UPDATED}</updated>`);
    expect(atom).not.toContain("<entry>");
    expect(atom.endsWith("</feed>\n")).toBe(true);
  });
});

describe("formatBatchAsAtom", () => {
  function batch(): CachedReviewsPayload[] {
    const a = payload();
    const b = payload();
    b.place.place_id = "ChIJSecond";
    b.place.name = "Second Place";
    b.reviews = [b.reviews[0]];
    return [a, b];
  }

  it("emits exactly one <feed> for the whole batch", () => {
    const atom = formatBatchAsAtom(batch());
    expect((atom.match(/<feed /g) ?? []).length).toBe(1);
  });

  it("titles the feed with the place count and a cross-place subtitle", () => {
    const atom = formatBatchAsAtom(batch());
    expect(atom).toContain('<title type="text">Reviews for 2 places</title>');
    expect(atom).toContain(
      `<subtitle type="text">${escapeXml("3 reviews across 2 places")}</subtitle>`,
    );
  });

  it("derives a batch-level <id> URN from the constituent place ids", () => {
    const atom = formatBatchAsAtom(batch());
    expect(atom).toContain("<id>urn:google-reviews:batch:ChIJTest+ChIJSecond</id>");
  });

  it("prefixes each entry title with its place name", () => {
    const atom = formatBatchAsAtom(batch());
    expect(atom).toContain(
      `<title type="text">${inline('Café "Niño" — Łódź')} — 5${STAR} — ${inline("Anaïs <script>")}</title>`,
    );
    expect(atom).toContain(
      `<title type="text">${inline("Second Place")} — 5${STAR} — ${inline("Anaïs <script>")}</title>`,
    );
  });

  it("aggregates all entries across places (2 + 1 = 3)", () => {
    const atom = formatBatchAsAtom(batch());
    expect((atom.match(/<entry>/g) ?? []).length).toBe(3);
  });

  it("sets the batch <updated> to the newest review across all places", () => {
    const atom = formatBatchAsAtom(batch());
    expect(atom).toContain("<updated>2026-05-03T00:00:00Z</updated>");
  });
});

describe("formatReviewsAsAtom — over the committed SMALL fixture", () => {
  const fx = clientTesting.FIXTURES.MOCK_SMALL_001 as GetReviewsResponse;
  const p: CachedReviewsPayload = {
    place: fx.place,
    reviews: fx.reviews,
    fetched_at: "2026-05-16T00:00:00.000Z",
  };

  it("produces a well-formed feed with one entry per fixture review", () => {
    const atom = formatReviewsAsAtom(p);
    expect(atom.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((atom.match(/<entry>/g) ?? []).length).toBe(fx.reviews.length);
    expect(atom).toContain(
      `<subtitle type="text">${escapeXml(`${fx.place.rating_avg} ${STAR} average from ${fx.place.rating_count} reviews`)}</subtitle>`,
    );
    expect(atom).toContain(
      `<id>urn:google-reviews:place:${escapeXml(fx.place.place_id)}</id>`,
    );
    expect(atom.endsWith("</feed>\n")).toBe(true);
  });
});

describe("atomFilename + ATOM_CONTENT_TYPE", () => {
  it("builds google-reviews-<slug>-<YYYYMMDD>.atom from the data vintage date", () => {
    expect(atomFilename("cafe-nino", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-cafe-nino-20260516.atom",
    );
  });

  it("pins the Atom content type", () => {
    expect(ATOM_CONTENT_TYPE).toBe("application/atom+xml; charset=utf-8");
  });
});
