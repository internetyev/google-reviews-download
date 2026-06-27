// schema.org JSON-LD writer for the reviews export (Phase 40).
//
// The structured-data sibling of the human-readable Phase 37 Markdown
// (`lib/export/markdown.ts`), Phase 38 HTML (`lib/export/html.ts`) and Phase 39
// plain-text (`lib/export/text.ts`) writers: those documents are for people, this
// one is for crawlers. It emits a schema.org JSON-LD document — a `LocalBusiness`
// node carrying an `aggregateRating` (the place's authoritative headline rating)
// and a `review` array of `Review` nodes — so a business can paste the markup
// onto its own testimonials page and win review-star rich-snippet SERP
// enhancements. This is the most on-mission export the tool ships: a "Google
// Reviews download" tool whose users want their reviews back on their own site as
// structured data. It is the natural consumer of the Phase 36 anonymisation layer
// (mask reviewer PII before publishing markup). Mirrors the repo's existing
// JSON-LD style (`lib/blog/jsonld.ts`, `faqJsonLd()` in `app/_components/faq.tsx`).
//
// The output is **valid, parseable JSON** (round-trips through `JSON.parse`) — no
// HTML-escaping is needed because JSON-LD is data, not markup; every value is
// carried verbatim from the payload (the consumer embeds it inside a
// `<script type="application/ld+json">` block, where JSON, not HTML, is the
// grammar). The aggregateRating reports the place's *authoritative* `rating_avg`/
// `rating_count`, never the walk length (D-041/D-031).
//
// Deterministic and offline: the same payload always yields byte-identical
// output. Field projection (L35.x) is intentionally NOT honoured here — a
// structured-data document is not a column subset, mirroring md/html/txt
// (D-123/D-126/D-129). Owner-response has no first-class schema.org `Review`
// field, so it is omitted from the markup (a future leaf could map it to a
// `Comment`/`reply`). The route maps `format=jsonld` to this writer.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review, PlaceMeta } from "@/lib/semanticforce/types";

const LF = "\n";
const SCHEMA_CONTEXT = "https://schema.org";
const RATING_BEST = 5;
const RATING_WORST = 1;
// Pretty-print with two-space indentation so the emitted document is readable
// when a human inspects it, and stable byte-for-byte across calls.
const INDENT = 2;

// One schema.org `Review` node. `reviewRating` is a `Rating` carrying the 1–5
// bounds so a consumer knows the scale; `author` is a `Person` (name only —
// profile URLs are deliberately not surfaced as structured data, in keeping with
// the anonymisation posture); `datePublished` is the ISO `published_at` verbatim;
// `reviewBody` is the review prose verbatim. `inLanguage` is emitted only when the
// review declares a language.
function reviewNode(review: Review): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "Review",
    reviewRating: {
      "@type": "Rating",
      ratingValue: review.rating,
      bestRating: RATING_BEST,
      worstRating: RATING_WORST,
    },
    author: { "@type": "Person", name: review.author_name },
    datePublished: review.published_at,
    reviewBody: review.text,
  };
  if (review.language) {
    node.inLanguage = review.language;
  }
  return node;
}

// One schema.org `LocalBusiness` node for a place: name, optional address/url,
// the authoritative `aggregateRating`, and the `review` array. `withContext`
// controls whether this node carries the top-level `@context` — true for a
// single-place document (the node IS the document root), false inside a batch
// `ItemList` (where the list root carries the one `@context`).
function localBusinessNode(
  payload: CachedReviewsPayload,
  withContext: boolean,
): Record<string, unknown> {
  const place: PlaceMeta = payload.place;
  const node: Record<string, unknown> = {};
  if (withContext) {
    node["@context"] = SCHEMA_CONTEXT;
  }
  node["@type"] = "LocalBusiness";
  node.name = place.name;
  if (place.address) {
    node.address = place.address;
  }
  if (place.url) {
    node.url = place.url;
  }
  node.aggregateRating = {
    "@type": "AggregateRating",
    ratingValue: place.rating_avg,
    reviewCount: place.rating_count,
    bestRating: RATING_BEST,
    worstRating: RATING_WORST,
  };
  node.review = payload.reviews.map(reviewNode);
  return node;
}

export function formatReviewsAsJsonLd(payload: CachedReviewsPayload): string {
  return JSON.stringify(localBusinessNode(payload, true), null, INDENT) + LF;
}

// Multi-place batch export (parity with `formatBatchAsCsv`/`Xlsx`/`Markdown`/
// `Html`/`Text`): a schema.org `ItemList` whose `itemListElement` carries one
// `LocalBusiness` node per place (each without its own `@context`; the list root
// carries the single `@context`).
export function formatBatchAsJsonLd(payloads: CachedReviewsPayload[]): string {
  const itemList: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    itemListElement: payloads.map((p) => localBusinessNode(p, false)),
  };
  return JSON.stringify(itemList, null, INDENT) + LF;
}

// Filename convention mirrors ADR-003 (`google-reviews-<slug>-<YYYYMMDD>.jsonld`).
// `dateIso` is the payload's `fetched_at` so the name matches the data vintage,
// not the wall clock at download time.
export function jsonldFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.jsonld`;
}

export const JSONLD_CONTENT_TYPE = "application/ld+json";

export const __testing = {
  LF,
  SCHEMA_CONTEXT,
  RATING_BEST,
  RATING_WORST,
  INDENT,
  reviewNode,
  localBusinessNode,
};
