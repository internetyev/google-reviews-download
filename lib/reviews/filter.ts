// Review filtering (Phase 33, L33.1) — the pure, offline, deterministic layer.
//
// A user pasting a busy place gets back the most recent N reviews, but often
// wants a *slice*: "only the 1–2★ complaints", "only English reviews with a
// photo", "anything mentioning 'refund' since January". This module is the
// single source of truth for that slicing — a pure `Review[] → Review[]`
// transform with NO I/O, NO env, NO LLM, applied AFTER the provider fetch and
// BEFORE the exporters/summary so every delivery surface (web preview, JSON /
// CSV / XLSX export, MCP) filters identically.
//
// Scope note: this leaf is the layer only. Wiring it into `/api/reviews` query
// params (L33.2) and the web form + preview (L33.3) are separate follow-up
// leaves, mirroring the Phase 31/32 pure-layer-first cadence.
//
// Design choices:
//  - Every criterion is optional and additive (logical AND). An empty / all-
//    undefined filter is the identity transform — `filterReviews(rs, {})` deep-
//    equals `rs` and preserves input order (stable).
//  - `language` and `keyword` match case-insensitively. `keyword` is a substring
//    of `text`; a whitespace-only keyword is treated as "no constraint" so a
//    blank form field never silently empties the result.
//  - `withPhotos` / `withOwnerResponse` constrain ONLY when explicitly `true`.
//    Passing `false` means "I don't care", not "exclude reviews that have them"
//    — the form's unchecked box and the absent param must behave identically.
//  - `since` / `until` bound `published_at` inclusively. A bound that doesn't
//    parse to a real date is ignored (lenient) rather than emptying the result —
//    a malformed query param degrades to "no date filter", not "no reviews".

import type { Review } from "@/lib/semanticforce/types";

export type Rating = 1 | 2 | 3 | 4 | 5;

export type ReviewFilter = {
  /** Keep reviews whose star rating is >= this (inclusive). */
  minRating?: Rating;
  /** Keep reviews whose star rating is <= this (inclusive). */
  maxRating?: Rating;
  /** Keep reviews whose `language` equals this (case-insensitive, trimmed). */
  language?: string;
  /** When `true`, keep only reviews carrying at least one photo. */
  withPhotos?: boolean;
  /** When `true`, keep only reviews that received an owner response. */
  withOwnerResponse?: boolean;
  /** Keep reviews whose `text` contains this substring (case-insensitive). */
  keyword?: string;
  /** Keep reviews published on/after this date (ISO-8601; inclusive). */
  since?: string;
  /** Keep reviews published on/before this date (ISO-8601; inclusive). */
  until?: string;
};

/** Parse an ISO date to epoch ms, or `null` if it isn't a real date. */
function parseDate(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

/** Normalise a string for case-insensitive comparison. */
function norm(value: string): string {
  return value.trim().toLowerCase();
}

function matchesRating(review: Review, filter: ReviewFilter): boolean {
  if (filter.minRating != null && review.rating < filter.minRating) return false;
  if (filter.maxRating != null && review.rating > filter.maxRating) return false;
  return true;
}

function matchesLanguage(review: Review, filter: ReviewFilter): boolean {
  if (filter.language == null) return true;
  const wanted = norm(filter.language);
  if (wanted.length === 0) return true; // blank → no constraint
  return review.language != null && norm(review.language) === wanted;
}

function matchesFlags(review: Review, filter: ReviewFilter): boolean {
  if (filter.withPhotos === true && (review.photos?.length ?? 0) === 0) {
    return false;
  }
  if (filter.withOwnerResponse === true && review.owner_response == null) {
    return false;
  }
  return true;
}

function matchesKeyword(review: Review, filter: ReviewFilter): boolean {
  if (filter.keyword == null) return true;
  const needle = norm(filter.keyword);
  if (needle.length === 0) return true; // whitespace-only → no constraint
  return review.text.toLowerCase().includes(needle);
}

function matchesDateRange(review: Review, filter: ReviewFilter): boolean {
  const since = parseDate(filter.since);
  const until = parseDate(filter.until);
  if (since == null && until == null) return true;
  const published = Date.parse(review.published_at);
  if (Number.isNaN(published)) return false; // can't place it in the window
  if (since != null && published < since) return false;
  if (until != null && published > until) return false;
  return true;
}

/** True when `review` satisfies every set criterion in `filter`. */
function matchesFilter(review: Review, filter: ReviewFilter): boolean {
  return (
    matchesRating(review, filter) &&
    matchesLanguage(review, filter) &&
    matchesFlags(review, filter) &&
    matchesKeyword(review, filter) &&
    matchesDateRange(review, filter)
  );
}

/**
 * Filter `reviews` to those matching every set criterion. Pure: same input →
 * same output, input order preserved (stable), input array never mutated. An
 * empty / all-undefined filter returns a shallow copy equal to the input.
 */
export function filterReviews(
  reviews: Review[],
  filter: ReviewFilter = {},
): Review[] {
  return reviews.filter((review) => matchesFilter(review, filter));
}

// Internal seams exposed for offline unit tests only — not part of the public
// surface other modules import (mirrors the repo-wide `__testing` convention).
export const __testing = {
  parseDate,
  norm,
  matchesRating,
  matchesLanguage,
  matchesFlags,
  matchesKeyword,
  matchesDateRange,
  matchesFilter,
};
