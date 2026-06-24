// Plain-text writer for the reviews export (Phase 39).
//
// The unstyled sibling of the Phase 37 Markdown (`lib/export/markdown.ts`) and
// Phase 38 HTML (`lib/export/html.ts`) writers: it emits the same *narrative*
// testimonials document — place header (name + headline rating), then one block
// per review (star bar, author, date · language, the review prose, and the
// owner's response if present) — but with absolutely NO markup. No `#`/`**`/`>`
// Markdown syntax, no HTML tags: just literal text a destination that strips or
// rejects markup can paste verbatim — a plaintext email body or signature, an
// SMS, a CMS/ATS/CRM note field, a `<textarea>`, a README, anywhere a paste must
// survive markup-stripping. (The ★/☆ glyphs and the `─` rule are Unicode
// characters, not markup, so they are kept.)
//
// Deterministic and offline: the same payload always yields byte-identical
// output. Field projection (L35.x) is intentionally NOT honoured here — a
// narrative document is not a column subset, mirroring md/html (D-123/D-126).
// The route maps `format=txt` to this writer.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review, PlaceMeta } from "@/lib/semanticforce/types";

const LF = "\n";
const RATING_MAX = 5;
const STAR_FULL = "★";
const STAR_EMPTY = "☆";
// A plain horizontal rule between the header and each review block. Uses the
// box-drawing glyph (U+2500) rather than `---` so it can never be read as a
// Markdown thematic break / setext heading underline.
const RULE = "─".repeat(40);

// Five-glyph star bar, e.g. rating 4 → "★★★★☆". Clamped defensively so a
// malformed out-of-range rating can never produce a negative `repeat` count
// (which throws) or a bar of the wrong width.
function stars(rating: number): string {
  const full = Math.max(0, Math.min(RATING_MAX, Math.round(rating)));
  return STAR_FULL.repeat(full) + STAR_EMPTY.repeat(RATING_MAX - full);
}

// Collapse all whitespace (including embedded newlines) to single spaces for
// values rendered on a single line (heading, author, metadata).
function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Reflow prose into plain paragraphs: blank-line-separated paragraphs are
// preserved (joined by a blank line), but soft line breaks *within* a paragraph
// are collapsed to single spaces. Empty paragraphs are dropped. This yields a
// clean text block with no hard-wrapping artefacts from the source data.
function reflow(value: string): string {
  return value
    .split(/(?:\r\n|\r|\n){2,}/)
    .map(inline)
    .filter((p) => p.length > 0)
    .join(`${LF}${LF}`);
}

function placeHeader(place: PlaceMeta): string[] {
  const lines: string[] = [];
  lines.push(`Reviews for ${inline(place.name)}`);
  lines.push(`${place.rating_avg} ${STAR_FULL} from ${place.rating_count} reviews`);
  if (place.address) {
    lines.push(inline(place.address));
  }
  if (place.url) {
    lines.push(inline(place.url));
  }
  return lines;
}

function reviewBlock(review: Review): string[] {
  const lines: string[] = [];
  lines.push(`${stars(review.rating)} (${review.rating}/5)`);
  lines.push(inline(review.author_name));

  const meta = [review.published_at, review.language]
    .filter((v): v is string => Boolean(v))
    .map(inline)
    .join(" · ");
  if (meta) {
    lines.push(meta);
  }

  lines.push("");
  lines.push(reflow(review.text));

  if (review.owner_response) {
    lines.push("");
    lines.push("Owner response:");
    lines.push(reflow(review.owner_response.text));
    lines.push(`Responded ${inline(review.owner_response.responded_at)}`);
  }
  return lines;
}

export function formatReviewsAsText(payload: CachedReviewsPayload): string {
  const blocks: string[][] = [placeHeader(payload.place)];
  for (const review of payload.reviews) {
    blocks.push(reviewBlock(review));
  }
  return blocks.map((b) => b.join(LF)).join(`${LF}${LF}${RULE}${LF}${LF}`) + LF;
}

// Multi-place batch export (parity with `formatBatchAsCsv`/`Xlsx`/`Markdown`/
// `Html`): one document with a top-level title, then each place's full block
// (its own `Reviews for …` header + reviews) separated by rules.
export function formatBatchAsText(payloads: CachedReviewsPayload[]): string {
  const blocks = payloads.map((p) => formatReviewsAsText(p).replace(/\n+$/, ""));
  const total = payloads.reduce((n, p) => n + p.reviews.length, 0);
  const header = [
    `Reviews for ${payloads.length} places`,
    `${total} reviews across ${payloads.length} places`,
  ].join(LF);
  return [header, ...blocks].join(`${LF}${LF}${RULE}${LF}${LF}`) + LF;
}

// Filename convention mirrors ADR-003 (`google-reviews-<slug>-<YYYYMMDD>.txt`).
// `dateIso` is the payload's `fetched_at` so the name matches the data vintage,
// not the wall clock at download time.
export function textFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.txt`;
}

export const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

export const __testing = {
  LF,
  RATING_MAX,
  STAR_FULL,
  STAR_EMPTY,
  RULE,
  stars,
  inline,
  reflow,
  placeHeader,
  reviewBlock,
};
