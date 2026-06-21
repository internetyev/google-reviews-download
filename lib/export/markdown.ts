// Markdown writer for the reviews export (Phase 37).
//
// Unlike the columnar CSV/XLSX writers, this emits a *narrative*, publishable
// testimonials document: a place header (name + headline rating), then one
// section per review (author, star glyphs, date, the review text as a
// blockquote, and the owner's response if present). The intended use is a
// business pasting its reviews into a report, an internal deck, or a public
// testimonials page — which is exactly why it pairs with the Phase 36
// anonymisation layer (mask names / drop profile links before publishing).
//
// Deterministic and offline: the same payload always yields byte-identical
// output. Field projection (L35.x) is intentionally NOT honoured here — a
// narrative document is not a column subset, so `formatReviewsAsMarkdown`
// always renders the full review. The route maps `format=md` to this writer.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review, PlaceMeta } from "@/lib/semanticforce/types";

const LF = "\n";
const RATING_MAX = 5;
const STAR_FULL = "★";
const STAR_EMPTY = "☆";

// Five-glyph star bar, e.g. rating 4 → "★★★★☆". Clamped defensively so a
// malformed out-of-range rating can never produce a negative `repeat` count
// (which throws) or a bar of the wrong width.
function stars(rating: number): string {
  const full = Math.max(0, Math.min(RATING_MAX, Math.round(rating)));
  return STAR_FULL.repeat(full) + STAR_EMPTY.repeat(RATING_MAX - full);
}

// Collapse all whitespace (including embedded newlines) to single spaces for
// values rendered inline in a heading or a metadata line, so a stray newline
// in an author name can't break out of its Markdown construct.
function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Render multi-line review/response prose as a Markdown blockquote: every line
// is prefixed with "> " (blank lines become a bare ">"), so the whole block
// reads as one quoted testimonial regardless of internal line breaks.
function blockquote(value: string): string {
  return value
    .split(/\r\n|\r|\n/)
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join(LF);
}

function placeHeader(place: PlaceMeta): string[] {
  const lines: string[] = [];
  lines.push(`# Reviews for ${inline(place.name)}`);
  lines.push("");
  lines.push(`**${place.rating_avg} ★** from ${place.rating_count} reviews`);
  if (place.address) {
    lines.push("");
    lines.push(inline(place.address));
  }
  if (place.url) {
    lines.push("");
    lines.push(`[View on Google](${place.url})`);
  }
  return lines;
}

function reviewSection(review: Review): string[] {
  const lines: string[] = [];
  lines.push(`## ${inline(review.author_name)}`);
  lines.push("");
  lines.push(`${stars(review.rating)} (${review.rating}/5)`);
  lines.push("");

  const meta = [review.published_at, review.language]
    .filter((v): v is string => Boolean(v))
    .map(inline)
    .join(" · ");
  lines.push(`*${meta}*`);
  lines.push("");

  lines.push(blockquote(review.text));

  if (review.owner_response) {
    lines.push("");
    lines.push("**Owner response:**");
    lines.push("");
    lines.push(blockquote(review.owner_response.text));
    lines.push("");
    lines.push(`*Responded ${inline(review.owner_response.responded_at)}*`);
  }
  return lines;
}

export function formatReviewsAsMarkdown(payload: CachedReviewsPayload): string {
  const sections: string[][] = [placeHeader(payload.place)];
  for (const review of payload.reviews) {
    sections.push(reviewSection(review));
  }
  // A horizontal rule separates the place header and each review section, so
  // the document has clear visual boundaries when rendered.
  return sections.map((s) => s.join(LF)).join(`${LF}${LF}---${LF}${LF}`) + LF;
}

// Multi-place batch export (parity with `formatBatchAsCsv`/`formatBatchAsXlsx`,
// Phase 31): one document with a top-level title, then each place's full
// section (its own `# Reviews for …` header + reviews) separated by rules.
export function formatBatchAsMarkdown(
  payloads: CachedReviewsPayload[],
): string {
  const blocks = payloads.map((p) => formatReviewsAsMarkdown(p).replace(/\n+$/, ""));
  const total = payloads.reduce((n, p) => n + p.reviews.length, 0);
  const header = [
    `# Reviews for ${payloads.length} places`,
    "",
    `${total} reviews across ${payloads.length} places`,
  ].join(LF);
  return [header, ...blocks].join(`${LF}${LF}---${LF}${LF}`) + LF;
}

// Filename convention mirrors ADR-003 (`google-reviews-<slug>-<YYYYMMDD>.md`).
// `dateIso` is the payload's `fetched_at` so the name matches the data vintage,
// not the wall clock at download time.
export function markdownFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.md`;
}

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export const __testing = {
  LF,
  RATING_MAX,
  STAR_FULL,
  STAR_EMPTY,
  stars,
  inline,
  blockquote,
  placeHeader,
  reviewSection,
};
