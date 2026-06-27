// RSS 2.0 feed writer for the reviews export (Phase 41).
//
// The syndication sibling of the Markdown (L37), HTML (L38), plain-text (L39)
// and JSON-LD (L40) writers: it emits a standards-compliant RSS 2.0 document so
// a business can publish its reviews as a subscribable feed — drop the `.rss`
// into a feed reader, a website's `<link rel="alternate" type="application/rss+xml">`,
// or any syndication pipeline that ingests RSS. One `<channel>` carries the
// place header (title + authoritative rating headline + source link) and one
// `<item>` per review (star+author title, the review text as the description
// with the owner response appended, an RFC-822 `<pubDate>`, and a stable
// non-permalink `<guid>` = the review id).
//
// SECURITY: every value that originates from the upstream review provider is
// XML-escaped via `escapeXml` before it reaches the document (same `&`-first
// ordering as the HTML writer's `escapeHtml`, so entities aren't double-escaped),
// and the only emitted URL (the place's Google link) is passed through
// `safeUrl`, which admits http/https only — so a `javascript:`/`data:` URL or an
// angle-bracket in a review can never inject markup into the feed. Mirrors the
// HTML writer's injection guard (D-126).
//
// Deterministic and offline: the same payload always yields byte-identical
// output. The RFC-822 date helper formats in GMT from UTC fields only — no
// `Date.now()`, no locale dependence. Field projection (L35.x) is intentionally
// NOT honoured here — a syndication feed is not a column subset, same call as
// md/html/txt/jsonld (D-123/D-126/D-129/D-133). The route maps `format=rss` to
// this writer.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review, PlaceMeta } from "@/lib/semanticforce/types";

const LF = "\n";
const STAR = "★";

const RFC822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC822_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Escape the five XML-significant characters. `&` MUST be replaced first so the
// entities introduced by the later replacements aren't double-escaped. `<`/`>`
// guard element content, `"`/`'` guard the one attribute value (`isPermaLink` is
// a constant, but escaping consistently keeps the helper reusable).
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Admit only http(s) URLs for the one emitted `<link>`; anything else (a
// `javascript:`/`data:`/`vbscript:` URI, a relative scheme, garbage) collapses
// to "" so the link is dropped rather than becoming a vector. The returned URL
// is still `escapeXml`-d by the caller before going into the element.
function safeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

// Collapse all whitespace (including embedded newlines) to single spaces for
// values rendered on a single line (a title), then escape. A stray newline in an
// author or place name can't break the one-line `<title>`.
function inline(value: string): string {
  return escapeXml(value.replace(/\s+/g, " ").trim());
}

// Reformat an ISO timestamp to an RFC-822 date string in GMT, e.g.
// `Wed, 02 Oct 2002 13:00:00 GMT`. Built from UTC fields only so it is
// deterministic and locale-independent. An unparseable input yields "" so the
// caller omits the `<pubDate>` rather than emitting a malformed one.
function toRfc822(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = RFC822_DAYS[d.getUTCDay()];
  const date = pad(d.getUTCDate());
  const month = RFC822_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${day}, ${date} ${month} ${year} ${time} GMT`;
}

// The authoritative headline for the channel `<description>` — built from the
// provider's `rating_avg`/`rating_count` on `PlaceMeta`, NEVER the walk length
// (D-041/D-031). Numbers are escaped defensively for consistency.
function placeHeadline(place: PlaceMeta): string {
  return escapeXml(
    `${place.rating_avg} ${STAR} average from ${place.rating_count} reviews`,
  );
}

// One `<item>` per review. `placePrefix` is the (already-inlined-and-escaped)
// place name + separator used by the batch feed to keep items distinguishable
// under a single `<channel>`; empty for the single-place feed.
function reviewItem(review: Review, placePrefix: string): string[] {
  const lines: string[] = [];
  lines.push(`    <item>`);
  lines.push(
    `      <title>${placePrefix}${escapeXml(String(review.rating))}${STAR} — ${inline(review.author_name)}</title>`,
  );

  let description = review.text;
  if (review.owner_response) {
    description += `${LF}${LF}Owner response: ${review.owner_response.text}`;
  }
  lines.push(`      <description>${escapeXml(description)}</description>`);

  const pubDate = toRfc822(review.published_at);
  if (pubDate) {
    lines.push(`      <pubDate>${pubDate}</pubDate>`);
  }

  lines.push(
    `      <guid isPermaLink="false">${escapeXml(review.review_id)}</guid>`,
  );
  lines.push(`    </item>`);
  return lines;
}

// Assemble a complete RSS 2.0 document from a channel header + already-rendered
// item lines. `link` is the safe, escaped channel URL or "" (omitted when blank).
function buildDocument(
  title: string,
  link: string,
  description: string,
  itemLines: string[],
): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0">`,
    `  <channel>`,
    `    <title>${title}</title>`,
  ];
  if (link) {
    lines.push(`    <link>${link}</link>`);
  }
  lines.push(`    <description>${description}</description>`);
  lines.push(...itemLines);
  lines.push(`  </channel>`);
  lines.push(`</rss>`);
  return lines.join(LF) + LF;
}

export function formatReviewsAsRss(payload: CachedReviewsPayload): string {
  const place = payload.place;
  const link = place.url ? escapeXml(safeUrl(place.url)) : "";
  const items: string[] = [];
  for (const review of payload.reviews) {
    items.push(...reviewItem(review, ""));
  }
  return buildDocument(
    `Reviews for ${inline(place.name)}`,
    link,
    placeHeadline(place),
    items,
  );
}

// Multi-place batch export (parity with `formatBatchAsCsv`/`Xlsx`/`Markdown`/
// `Html`/`Text`). RSS 2.0 permits only ONE `<channel>` per feed, so the batch is
// a single batch-titled channel whose `<item>` titles are prefixed with the
// place name to keep the places distinguishable. No channel `<link>` (there is
// no single source place for a batch feed).
export function formatBatchAsRss(payloads: CachedReviewsPayload[]): string {
  const total = payloads.reduce((n, p) => n + p.reviews.length, 0);
  const items: string[] = [];
  for (const p of payloads) {
    const prefix = `${inline(p.place.name)} — `;
    for (const review of p.reviews) {
      items.push(...reviewItem(review, prefix));
    }
  }
  return buildDocument(
    `Reviews for ${escapeXml(String(payloads.length))} places`,
    "",
    escapeXml(`${total} reviews across ${payloads.length} places`),
    items,
  );
}

// Filename convention mirrors ADR-003 (`google-reviews-<slug>-<YYYYMMDD>.rss`).
// `dateIso` is the payload's `fetched_at` so the name matches the data vintage,
// not the wall clock at download time.
export function rssFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.rss`;
}

export const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

export const __testing = {
  LF,
  STAR,
  escapeXml,
  safeUrl,
  inline,
  toRfc822,
  placeHeadline,
  reviewItem,
  buildDocument,
};
