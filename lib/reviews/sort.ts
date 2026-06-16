// Review ordering (Phase 34, L34.1) — the pure, offline, deterministic layer.
//
// After fetching and filtering a place's reviews, a user usually wants them in
// a particular ORDER before previewing/exporting: "newest first" to skim recent
// sentiment, "oldest first" for a timeline, "highest rated" to lead with praise,
// "lowest rated" to triage complaints (this last pairs directly with the Phase
// 33 "only 1–2★" slice — sort lowest after filtering to surface the freshest
// worst reviews first). This module is the single source of truth for that
// ordering — a pure `Review[] → Review[]` transform with NO I/O, NO env, NO LLM,
// applied AFTER the provider fetch and AFTER `filterReviews`, BEFORE the
// `userLimit` slice + exporters/summary so every delivery surface (web preview,
// JSON / CSV / XLSX export, MCP) orders identically.
//
// Scope note: this leaf is the layer only. Wiring it into `/api/reviews` query
// params (L34.2) and the web form + preview (L34.3) are separate follow-up
// leaves, mirroring the Phase 31/32/33 pure-layer-first cadence.
//
// Design choices:
//  - Stable + non-mutating: returns a NEW array; the input is never reordered in
//    place. Equal keys keep their input order (so a stable filter → stable sort
//    chain is fully deterministic). An absent / unrecognised order is the
//    identity (a shallow copy in input order) — a bad query param degrades to
//    "no sort", never throws, never empties.
//  - `"newest"` / `"oldest"` order by `published_at`; `"highest"` / `"lowest"`
//    order by `rating`. Rating ties break by recency (newest first) for BOTH
//    rating orders, so "lowest" surfaces the freshest complaints among equally-
//    bad reviews (and "highest" the freshest praise) rather than an arbitrary
//    tie order.
//  - Lenient on malformed/missing `published_at`: such reviews sort to the END
//    for every order (they can't be placed on the timeline, so they trail rather
//    than poison the comparison), and parsing never throws.

import type { Review } from "@/lib/semanticforce/types";

export type ReviewOrder = "newest" | "oldest" | "highest" | "lowest";

const ORDERS: readonly ReviewOrder[] = ["newest", "oldest", "highest", "lowest"];

/** Narrow an arbitrary value to a `ReviewOrder`, or `null` if unrecognised. */
export function parseReviewOrder(value: unknown): ReviewOrder | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (ORDERS as readonly string[]).includes(normalised)
    ? (normalised as ReviewOrder)
    : null;
}

/** Parse `published_at` to epoch ms, or `null` if it isn't a real date. */
function publishedMs(review: Review): number | null {
  const ms = Date.parse(review.published_at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Compare two values where `null` (unplaceable) always sorts LAST regardless of
 * direction. Returns a negative/zero/positive number, or `null` to signal "fall
 * through to the tie-breaker" (both placeable and equal).
 */
function compareWithNullsLast(
  a: number | null,
  b: number | null,
  descending: boolean,
): number | null {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // a trails
  if (b === null) return -1; // b trails
  if (a === b) return null; // defer to tie-breaker
  const delta = a - b;
  return descending ? -delta : delta;
}

/** Recency tie-breaker: newer first, unplaceable dates last. */
function byRecency(a: Review, b: Review): number {
  return compareWithNullsLast(publishedMs(a), publishedMs(b), true) ?? 0;
}

function comparator(order: ReviewOrder): (a: Review, b: Review) => number {
  switch (order) {
    case "newest":
      return (a, b) => compareWithNullsLast(publishedMs(a), publishedMs(b), true) ?? 0;
    case "oldest":
      return (a, b) => compareWithNullsLast(publishedMs(a), publishedMs(b), false) ?? 0;
    case "highest":
      return (a, b) => (b.rating - a.rating) || byRecency(a, b);
    case "lowest":
      return (a, b) => (a.rating - b.rating) || byRecency(a, b);
  }
}

/**
 * Return `reviews` ordered by `order`. Pure: same input → same output, input
 * array never mutated, equal keys keep input order (stable). An absent /
 * unrecognised `order` returns a shallow copy in input order (identity).
 */
export function sortReviews(
  reviews: Review[],
  order?: ReviewOrder | string | null,
): Review[] {
  const parsed = parseReviewOrder(order);
  if (parsed === null) return [...reviews]; // identity (still a fresh array)
  const compare = comparator(parsed);
  // `Array.prototype.sort` is stable in modern JS/V8, so equal-key reviews keep
  // their input order without an explicit index decorate-sort-undecorate.
  return [...reviews].sort(compare);
}

// Internal seams exposed for offline unit tests only — not part of the public
// surface other modules import (mirrors the repo-wide `__testing` convention).
export const __testing = {
  ORDERS,
  parseReviewOrder,
  publishedMs,
  compareWithNullsLast,
  byRecency,
  comparator,
};
