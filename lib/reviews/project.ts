// Review field projection / column selection (Phase 35, L35.1) — the pure,
// offline, deterministic layer.
//
// After fetching, filtering (Phase 33) and ordering (Phase 34) a place's
// reviews, a user often wants only a SUBSET of each review's fields before
// exporting: a lean CSV of just `rating` + `text` + `published_at`, or
// `author_name` + `rating` for a quick scan — not the full object graph with
// photo arrays and owner-response blocks. This module is the single source of
// truth for that column selection — a pure `Review[] → Partial<Review>[]`
// transform with NO I/O, NO env, NO LLM, applied AFTER fetch/filter/sort and
// BEFORE the exporters/summary so every delivery surface (web preview, JSON /
// CSV / XLSX export, MCP) projects identically.
//
// Scope note: this leaf is the layer only. Wiring it into `/api/reviews` query
// params (L35.2) and the web form + preview (L35.3) are separate follow-up
// leaves, mirroring the Phase 31/32/33/34 pure-layer-first cadence.
//
// Design choices:
//  - Stable + non-mutating: returns a NEW array of NEW shallow objects; the
//    input reviews are never touched. The relative order of reviews is
//    preserved (projection is per-review, never reorders).
//  - An empty / absent / all-unrecognised field set is the IDENTITY: every
//    review is shallow-copied whole (a bad / blank query param degrades to "all
//    columns", never throws, never produces empty `{}` rows).
//  - Only requested fields that are actually PRESENT on a given review are
//    copied — an absent optional field (`author_url`, `language`, `photos`,
//    `owner_response`) is omitted from that row rather than set to `undefined`,
//    so the projected object is a faithful subset, not a sparse skeleton.
//  - `parseReviewFields` validates + de-duplicates against the known `Review`
//    keys, preserving each field's FIRST-requested order so callers (CSV header
//    ordering) get a predictable column sequence.

import type { Review } from "@/lib/semanticforce/types";

export type ReviewField =
  | "review_id"
  | "author_name"
  | "author_url"
  | "rating"
  | "text"
  | "language"
  | "published_at"
  | "photos"
  | "owner_response";

// The canonical field set, in the natural `Review` declaration order. Used both
// to validate requested fields and as the default header order when a caller
// asks for "all" columns explicitly.
const FIELDS: readonly ReviewField[] = [
  "review_id",
  "author_name",
  "author_url",
  "rating",
  "text",
  "language",
  "published_at",
  "photos",
  "owner_response",
];

const FIELD_SET: ReadonlySet<string> = new Set(FIELDS);

/** True if `value` names a known `Review` field (case-insensitive, trimmed). */
function isReviewField(value: unknown): value is ReviewField {
  return typeof value === "string" && FIELD_SET.has(value.trim().toLowerCase());
}

/**
 * Narrow an arbitrary value into an ordered, de-duplicated `ReviewField[]`.
 * Accepts either a comma-separated string (`"rating,text"`) or an array of
 * strings; trims + lower-cases each token; drops blanks and unknown names;
 * keeps each field's FIRST occurrence order. Returns `null` when nothing valid
 * remains (so callers can treat "no recognised columns" as the identity rather
 * than an empty projection).
 */
export function parseReviewFields(
  value: unknown,
): ReviewField[] | null {
  const tokens: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out: ReviewField[] = [];
  const seen = new Set<ReviewField>();
  for (const token of tokens) {
    if (!isReviewField(token)) continue;
    const field = (token as string).trim().toLowerCase() as ReviewField;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push(field);
  }
  return out.length > 0 ? out : null;
}

/**
 * Project each review down to `fields`. Pure: same input → same output, input
 * reviews never mutated, review order preserved. An empty / `null` / all-
 * unrecognised `fields` set returns whole shallow copies (identity). For a
 * recognised set, each row carries only the requested fields that are actually
 * present on that review (absent optional fields are omitted, not `undefined`).
 */
export function projectReviews(
  reviews: Review[],
  fields?: ReviewField[] | null,
): Partial<Review>[] {
  if (!fields || fields.length === 0) {
    return reviews.map((review) => ({ ...review })); // identity (fresh objects)
  }
  // De-dupe defensively so a caller passing raw fields still gets one column
  // each; preserve first-requested order.
  const wanted = [...new Set(fields.filter(isReviewField))];
  if (wanted.length === 0) {
    return reviews.map((review) => ({ ...review }));
  }
  return reviews.map((review) => {
    const projected: Partial<Review> = {};
    for (const field of wanted) {
      if (Object.prototype.hasOwnProperty.call(review, field)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (projected as any)[field] = review[field];
      }
    }
    return projected;
  });
}

// Internal seams exposed for offline unit tests only — not part of the public
// surface other modules import (mirrors the repo-wide `__testing` convention).
export const __testing = {
  FIELDS,
  FIELD_SET,
  isReviewField,
  parseReviewFields,
};
