// Atom 1.0 (RFC 4287) feed writer for the reviews export (Phase 42).
//
// The IETF-standard syndication sibling of the Phase 41 RSS 2.0 writer: it emits
// a standards-compliant Atom 1.0 document so a business can publish its reviews
// as a feed many modern readers and aggregators prefer (or require) over RSS.
// Atom carries structure RSS 2.0 lacks — a mandatory globally-unique feed `<id>`
// and per-`<entry>` `<id>`, a required `<updated>` timestamp on both feed and
// entries, explicit typed `<title type="text">`/`<content type="text">`, and
// `<link rel="alternate">` relation semantics. One `<feed>` carries the place
// header (title + authoritative rating subtitle + `<id>` URN + newest-review
// `<updated>` + optional source link) and one `<entry>` per review (star+author
// title, a stable per-entry `<id>` URN = the review id, the review's RFC-3339
// `<updated>`, an `<author><name>`, and the review text as `<content>` with the
// owner response appended).
//
// SECURITY: every provider-sourced value is XML-escaped via `escapeXml` (same
// `&`-first ordering as the RSS/HTML writers, so entities aren't double-escaped),
// and the only emitted URL (the place's Google link) is passed through `safeUrl`,
// which admits http/https only — so a `javascript:`/`data:` URL or an angle
// bracket in a review can never inject markup. Mirrors the RSS injection guard
// (D-126/D-137).
//
// Deterministic and offline: the same payload always yields byte-identical
// output. The feed `<id>` is derived from the place id (NOT a timestamp), so the
// same place yields a byte-stable id. The RFC-3339 date helper formats in UTC
// (Zulu) from UTC fields only — no `Date.now()`, no locale dependence; an
// unparseable timestamp collapses to the fixed empty-feed sentinel so `<updated>`
// is always well-formed. Field projection (L35.x) is intentionally NOT honoured
// — a syndication feed is not a column subset, same call as md/html/txt/jsonld/
// rss (D-123/D-126/D-129/D-133/D-136). The route maps `format=atom` to this
// writer.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review, PlaceMeta } from "@/lib/semanticforce/types";

const LF = "\n";
const STAR = "★";

// Atom requires a well-formed `<updated>` on the feed even when it carries no
// entries. With no (parseable) review timestamp to draw from, fall back to this
// fixed sentinel — deterministic, never `Date.now()`.
const EMPTY_FEED_UPDATED = "1970-01-01T00:00:00Z";

// Escape the five XML-significant characters. `&` MUST be replaced first so the
// entities introduced by the later replacements aren't double-escaped. `<`/`>`
// guard element content, `"`/`'` guard attribute values.
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
// to "" so the link is dropped rather than becoming a vector. The returned URL is
// still `escapeXml`-d by the caller before going into the attribute.
function safeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

// Collapse all whitespace (including embedded newlines) to single spaces for
// values rendered on a single line (a title, an author name), then escape. A
// stray newline in an author or place name can't break the one-line `<title>`.
function inline(value: string): string {
  return escapeXml(value.replace(/\s+/g, " ").trim());
}

// Reformat an ISO timestamp to an RFC-3339 UTC (Zulu) string, e.g.
// `2002-10-02T13:00:00Z`. Built from UTC fields only so it is deterministic and
// locale-independent. An unparseable input yields "" so the caller can fall back
// to the empty-feed sentinel rather than emitting a malformed `<updated>`.
function toRfc3339(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${date}T${time}Z`;
}

// The feed `<updated>` is the most-recent review `published_at` reformatted to
// RFC-3339 — deterministic from the data, never `Date.now()`. Reviews with an
// unparseable timestamp are ignored when picking the newest; if NONE are
// parseable (or the feed is empty) the fixed empty-feed sentinel is returned so
// `<updated>` is always well-formed.
function feedUpdated(reviews: Review[]): string {
  let newest = Number.NEGATIVE_INFINITY;
  for (const review of reviews) {
    const t = new Date(review.published_at).getTime();
    if (!Number.isNaN(t) && t > newest) {
      newest = t;
    }
  }
  if (newest === Number.NEGATIVE_INFINITY) {
    return EMPTY_FEED_UPDATED;
  }
  return toRfc3339(new Date(newest).toISOString());
}

// The authoritative subtitle headline — built from the provider's `rating_avg`/
// `rating_count` on `PlaceMeta`, NEVER the walk length (D-041/D-031). Numbers are
// escaped defensively for consistency.
function placeHeadline(place: PlaceMeta): string {
  return escapeXml(
    `${place.rating_avg} ${STAR} average from ${place.rating_count} reviews`,
  );
}

// One `<entry>` per review. `placePrefix` is the (already-inlined-and-escaped)
// place name + separator used by the batch feed to keep entries distinguishable
// under a single `<feed>`; empty for the single-place feed. A review's
// `<updated>` falls back to the empty-feed sentinel if its `published_at` is
// unparseable, so every entry has a well-formed timestamp.
function reviewEntry(review: Review, placePrefix: string): string[] {
  const lines: string[] = [];
  lines.push(`  <entry>`);
  lines.push(
    `    <title type="text">${placePrefix}${escapeXml(String(review.rating))}${STAR} — ${inline(review.author_name)}</title>`,
  );
  lines.push(
    `    <id>urn:google-reviews:review:${escapeXml(review.review_id)}</id>`,
  );
  lines.push(
    `    <updated>${toRfc3339(review.published_at) || EMPTY_FEED_UPDATED}</updated>`,
  );
  lines.push(`    <author><name>${inline(review.author_name)}</name></author>`);

  let content = review.text;
  if (review.owner_response) {
    content += `${LF}${LF}Owner response: ${review.owner_response.text}`;
  }
  lines.push(`    <content type="text">${escapeXml(content)}</content>`);
  lines.push(`  </entry>`);
  return lines;
}

// Assemble a complete Atom 1.0 document from a feed header + already-rendered
// entry lines. `id` and `updated` are required by RFC 4287; `link` is the safe,
// escaped alternate URL or "" (the `<link>` is omitted when blank).
function buildDocument(
  title: string,
  id: string,
  updated: string,
  link: string,
  subtitle: string,
  entryLines: string[],
): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  <title type="text">${title}</title>`,
    `  <id>${id}</id>`,
    `  <updated>${updated}</updated>`,
  ];
  if (link) {
    lines.push(`  <link rel="alternate" href="${link}"/>`);
  }
  lines.push(`  <subtitle type="text">${subtitle}</subtitle>`);
  lines.push(...entryLines);
  lines.push(`</feed>`);
  return lines.join(LF) + LF;
}

export function formatReviewsAsAtom(payload: CachedReviewsPayload): string {
  const place = payload.place;
  const link = place.url ? escapeXml(safeUrl(place.url)) : "";
  const entries: string[] = [];
  for (const review of payload.reviews) {
    entries.push(...reviewEntry(review, ""));
  }
  return buildDocument(
    `Reviews for ${inline(place.name)}`,
    `urn:google-reviews:place:${escapeXml(place.place_id)}`,
    feedUpdated(payload.reviews),
    link,
    placeHeadline(place),
    entries,
  );
}

// Multi-place batch export (parity with `formatBatchAsRss`/`Html`/`Text`/etc.).
// One Atom `<feed>` carries all entries (an Atom feed may hold any number of
// entries from any source), batch-titled, with a batch-level `<id>` URN derived
// deterministically from the constituent place ids and each `<entry>` title
// prefixed with the place name. No alternate `<link>` (there is no single source
// place for a batch feed); `<updated>` is the newest review across all places.
export function formatBatchAsAtom(payloads: CachedReviewsPayload[]): string {
  const total = payloads.reduce((n, p) => n + p.reviews.length, 0);
  const allReviews: Review[] = [];
  const entries: string[] = [];
  for (const p of payloads) {
    const prefix = `${inline(p.place.name)} — `;
    for (const review of p.reviews) {
      entries.push(...reviewEntry(review, prefix));
      allReviews.push(review);
    }
  }
  const batchId = payloads.map((p) => escapeXml(p.place.place_id)).join("+");
  return buildDocument(
    `Reviews for ${escapeXml(String(payloads.length))} places`,
    `urn:google-reviews:batch:${batchId}`,
    feedUpdated(allReviews),
    "",
    escapeXml(`${total} reviews across ${payloads.length} places`),
    entries,
  );
}

// Filename convention mirrors ADR-003 (`google-reviews-<slug>-<YYYYMMDD>.atom`).
// `dateIso` is the payload's `fetched_at` so the name matches the data vintage,
// not the wall clock at download time.
export function atomFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.atom`;
}

export const ATOM_CONTENT_TYPE = "application/atom+xml; charset=utf-8";

export const __testing = {
  LF,
  STAR,
  EMPTY_FEED_UPDATED,
  escapeXml,
  safeUrl,
  inline,
  toRfc3339,
  feedUpdated,
  placeHeadline,
  reviewEntry,
  buildDocument,
};
