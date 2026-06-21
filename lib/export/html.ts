// HTML writer for the reviews export (Phase 38).
//
// Like the Markdown writer (L37), this emits a *narrative*, publishable
// testimonials document rather than a columnar data dump — but as a
// self-contained, ready-to-publish HTML page: a place header (name + headline
// rating), then one `<article>` per review (author, star glyphs, date, the
// review text, and the owner's response if present), wrapped in a minimal
// inline-styled HTML5 shell with NO external assets (no CDN, no web fonts, no
// JS) so a business can drop the file straight onto a testimonials page or into
// an email. It is the natural HTML companion to the Markdown export and the
// Phase 36 anonymisation layer (mask names / drop profile links before
// publishing).
//
// SECURITY: every value that originates from the upstream review provider is
// HTML-escaped via `escapeHtml` before it reaches the document, and the only
// emitted URL (the place's Google link) is passed through `safeUrl`, which
// admits http/https only — so a `javascript:`/`data:` URL or an angle-bracket
// in a review can never inject markup or script into the published page.
//
// Deterministic and offline: the same payload always yields byte-identical
// output. Field projection (L35.x) is intentionally NOT honoured here — a
// narrative document is not a column subset, so `formatReviewsAsHtml` always
// renders the full review. The route maps `format=html` to this writer.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review, PlaceMeta } from "@/lib/semanticforce/types";

const LF = "\n";
const RATING_MAX = 5;
const STAR_FULL = "★";
const STAR_EMPTY = "☆";

// Escape the five HTML-significant characters. `&` MUST be replaced first so
// the entities introduced by the later replacements aren't double-escaped.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Admit only http(s) URLs for the one emitted href; anything else (a
// `javascript:`/`data:`/`vbscript:` URI, a relative scheme, garbage) collapses
// to "" so the link is dropped rather than becoming a script vector. The
// returned URL is still `escapeHtml`-d by the caller before going into the
// attribute.
function safeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

// Five-glyph star bar, e.g. rating 4 → "★★★★☆". Clamped defensively so a
// malformed out-of-range rating can never produce a negative `repeat` count
// (which throws) or a bar of the wrong width.
function stars(rating: number): string {
  const full = Math.max(0, Math.min(RATING_MAX, Math.round(rating)));
  return STAR_FULL.repeat(full) + STAR_EMPTY.repeat(RATING_MAX - full);
}

// Collapse all whitespace (including embedded newlines) to single spaces for
// values rendered inline (a heading, a metadata line), then escape. A stray
// newline in an author name can't break the layout and markup can't survive.
function inline(value: string): string {
  return escapeHtml(value.replace(/\s+/g, " ").trim());
}

// Render multi-line review/response prose as one `<blockquote>` whose non-blank
// lines each become a `<p>` (so internal line breaks read as paragraphs), with
// every line escaped. An all-blank value still yields a valid empty blockquote.
function blockquote(value: string, className: string): string {
  const paras = value
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `    <p>${escapeHtml(line)}</p>`);
  const inner = paras.length > 0 ? LF + paras.join(LF) + LF + "  " : "";
  return `  <blockquote class="${className}">${inner}</blockquote>`;
}

function placeHeader(place: PlaceMeta): string[] {
  const lines: string[] = [];
  lines.push(`<header class="place">`);
  lines.push(`  <h1>Reviews for ${inline(place.name)}</h1>`);
  lines.push(
    `  <p class="headline"><strong>${escapeHtml(String(place.rating_avg))} ★</strong> from ${escapeHtml(String(place.rating_count))} reviews</p>`,
  );
  if (place.address) {
    lines.push(`  <p class="address">${inline(place.address)}</p>`);
  }
  const href = place.url ? safeUrl(place.url) : "";
  if (href) {
    lines.push(
      `  <p class="source"><a href="${escapeHtml(href)}" rel="nofollow noopener" target="_blank">View on Google</a></p>`,
    );
  }
  lines.push(`</header>`);
  return lines;
}

function reviewSection(review: Review): string[] {
  const lines: string[] = [];
  lines.push(`<article class="review">`);
  lines.push(`  <h2 class="author">${inline(review.author_name)}</h2>`);
  lines.push(
    `  <p class="rating"><span class="stars" aria-label="${escapeHtml(String(review.rating))} out of 5 stars">${stars(review.rating)}</span> <span class="rating-num">(${escapeHtml(String(review.rating))}/5)</span></p>`,
  );

  const meta = [review.published_at, review.language]
    .filter((v): v is string => Boolean(v))
    .map(inline)
    .join(" · ");
  if (meta) {
    lines.push(`  <p class="meta">${meta}</p>`);
  }

  lines.push(blockquote(review.text, "text"));

  if (review.owner_response) {
    lines.push(`  <div class="owner-response">`);
    lines.push(`    <p class="owner-response-label"><strong>Owner response:</strong></p>`);
    lines.push(
      blockquote(review.owner_response.text, "owner-response-text")
        .split(LF)
        .map((l) => `  ${l}`)
        .join(LF),
    );
    lines.push(
      `    <p class="owner-response-date">Responded ${inline(review.owner_response.responded_at)}</p>`,
    );
    lines.push(`  </div>`);
  }
  lines.push(`</article>`);
  return lines;
}

// The minimal inline stylesheet — self-contained, no external assets, so the
// published file renders identically anywhere with no network. Kept as a
// constant (not interpolated) so it can never carry user data.
const STYLE = [
  `    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.5; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }`,
  `    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }`,
  `    h2.author { font-size: 1.1rem; margin: 0 0 0.25rem; }`,
  `    .headline { font-size: 1.1rem; color: #444; }`,
  `    .stars { color: #e7a400; letter-spacing: 0.1em; }`,
  `    .meta { color: #666; font-size: 0.9rem; margin: 0.25rem 0; }`,
  `    blockquote { margin: 0.5rem 0; padding: 0.25rem 0 0.25rem 1rem; border-left: 3px solid #ddd; }`,
  `    blockquote p { margin: 0.25rem 0; }`,
  `    article.review { padding: 1rem 0; border-top: 1px solid #eee; }`,
  `    .owner-response { margin-top: 0.75rem; padding-left: 1rem; }`,
  `    .owner-response-label { margin: 0; color: #444; }`,
].join(LF);

// Wrap rendered body lines in a complete, valid HTML5 document. `title` is
// already-escaped inline text.
function documentShell(title: string, bodyLines: string[]): string {
  const body = bodyLines.map((l) => `    ${l}`).join(LF);
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="utf-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1">`,
    `  <title>${title}</title>`,
    `  <style>`,
    STYLE,
    `  </style>`,
    `</head>`,
    `<body>`,
    `  <main class="reviews">`,
    body,
    `  </main>`,
    `</body>`,
    `</html>`,
    ``,
  ].join(LF);
}

export function formatReviewsAsHtml(payload: CachedReviewsPayload): string {
  const body: string[] = [...placeHeader(payload.place)];
  for (const review of payload.reviews) {
    body.push(...reviewSection(review));
  }
  return documentShell(`Reviews for ${inline(payload.place.name)}`, body);
}

// Multi-place batch export (parity with `formatBatchAsCsv`/`formatBatchAsXlsx`/
// `formatBatchAsMarkdown`): one document with a top-level title, then each
// place's full block (its own `<header class="place">` + reviews) wrapped in a
// `<section>` so the places stay distinguishable.
export function formatBatchAsHtml(payloads: CachedReviewsPayload[]): string {
  const total = payloads.reduce((n, p) => n + p.reviews.length, 0);
  const body: string[] = [
    `<header class="batch">`,
    `  <h1>Reviews for ${escapeHtml(String(payloads.length))} places</h1>`,
    `  <p class="headline">${escapeHtml(String(total))} reviews across ${escapeHtml(String(payloads.length))} places</p>`,
    `</header>`,
  ];
  for (const p of payloads) {
    body.push(`<section class="place-block">`);
    for (const line of placeHeader(p.place)) {
      body.push(`  ${line}`);
    }
    for (const review of p.reviews) {
      for (const line of reviewSection(review)) {
        body.push(`  ${line}`);
      }
    }
    body.push(`</section>`);
  }
  return documentShell(`Reviews for ${escapeHtml(String(payloads.length))} places`, body);
}

// Filename convention mirrors ADR-003 (`google-reviews-<slug>-<YYYYMMDD>.html`).
// `dateIso` is the payload's `fetched_at` so the name matches the data vintage,
// not the wall clock at download time.
export function htmlFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.html`;
}

export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

export const __testing = {
  LF,
  RATING_MAX,
  STAR_FULL,
  STAR_EMPTY,
  escapeHtml,
  safeUrl,
  stars,
  inline,
  blockquote,
  placeHeader,
  reviewSection,
  documentShell,
};
