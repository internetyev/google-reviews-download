// Review summary / aggregate stats (Phase 32, L32.1) — promoted from the
// parking-lot "Sentiment analysis / summarisation" item.
//
// This is the deterministic, offline half of "summarisation": every figure here
// is derived purely from the `Review[]` we already fetched plus the `PlaceMeta`
// headline numbers — NO LLM, NO network, NO env. (An LLM-backed prose summary
// would be a separate, human-gated leaf; it is deliberately out of scope here so
// the routine stays mock-first and zero-cost — see ROUTINE.md "Mock-first".)
//
// The value: a user pasting a business gets an at-a-glance digest — how the
// sampled reviews split across the 1–5 stars, a positive/neutral/negative
// sentiment breakdown derived from the star rating, and the operational signals
// (how many carry photos, how many got an owner response, which languages
// appear) — without reading every row. It backs a future preview-page summary
// card and an optional `summary` field on the JSON API (separate follow-up
// leaves L32.2/L32.3), and is reusable by the MCP surface.
//
// Authoritative vs sampled: Google's headline total (`rating_count`) and average
// (`rating_avg`) describe the WHOLE place and are surfaced verbatim as
// `total_reviews`/`overall_rating`. Everything else (`sampled_*`,
// `rating_distribution`, `sentiment`, `with_*`, `languages`) describes only the
// reviews actually fetched this run — `sampled_reviews` is the honest denominator
// for those, kept separate so a caller never mistakes a 8-review sample for the
// place's full 891-review reality (the D-041/D-031 total-not-walk-count invariant).

import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import type { PlaceMeta, Review } from "@/lib/semanticforce/types";

export type Rating = 1 | 2 | 3 | 4 | 5;

/** Count of sampled reviews at each star level. */
export type RatingDistribution = Record<Rating, number>;

/**
 * Sentiment buckets derived deterministically from the star rating — the only
 * defensible offline signal we have. 4–5★ = positive, 3★ = neutral, 1–2★ =
 * negative. (This mirrors the common "top-2-box / bottom-2-box" CSAT split.)
 */
export type SentimentBreakdown = {
  positive: number;
  neutral: number;
  negative: number;
};

export type ReviewSummary = {
  place_id: string;
  place_name: string;
  /** Google's headline total for the WHOLE place (PlaceMeta.rating_count). */
  total_reviews: number;
  /** Reviews actually fetched + analysed this run (reviews.length). */
  sampled_reviews: number;
  /** Google's headline average for the whole place (PlaceMeta.rating_avg). */
  overall_rating: number;
  /** Mean of the SAMPLED reviews' stars, 2dp; 0 when nothing was sampled. */
  sampled_average_rating: number;
  /** Histogram of sampled reviews across the five star levels. */
  rating_distribution: RatingDistribution;
  /** Positive/neutral/negative split of the sampled reviews. */
  sentiment: SentimentBreakdown;
  /** How many sampled reviews carry at least one photo. */
  with_photos: number;
  /** How many sampled reviews got an owner response. */
  with_owner_response: number;
  /** Distinct languages present in the sample, sorted ascending. */
  languages: string[];
};

const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5];

/** Star → sentiment bucket. Single source of truth for the split. */
function sentimentOf(rating: Rating): keyof SentimentBreakdown {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

/** Round to 2 decimal places deterministically (no FP drift in the contract). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the aggregate summary from a fetched payload. Pure: same input → same
 * output, no I/O. Accepts the cached payload shape so any surface that already
 * holds `{ place, reviews }` can call it directly.
 */
export function summariseReviews(
  payload: Pick<CachedReviewsPayload, "place" | "reviews">,
): ReviewSummary {
  const { place, reviews } = payload;
  return {
    place_id: place.place_id,
    place_name: place.name,
    total_reviews: place.rating_count,
    sampled_reviews: reviews.length,
    overall_rating: place.rating_avg,
    sampled_average_rating: averageRating(reviews),
    rating_distribution: ratingDistribution(reviews),
    sentiment: sentimentBreakdown(reviews),
    with_photos: reviews.filter((r) => (r.photos?.length ?? 0) > 0).length,
    with_owner_response: reviews.filter((r) => r.owner_response != null).length,
    languages: distinctLanguages(reviews),
  };
}

function averageRating(reviews: Review[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return round2(sum / reviews.length);
}

function ratingDistribution(reviews: Review[]): RatingDistribution {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as RatingDistribution;
  for (const r of reviews) dist[r.rating] += 1;
  return dist;
}

function sentimentBreakdown(reviews: Review[]): SentimentBreakdown {
  const out: SentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
  for (const r of reviews) out[sentimentOf(r.rating)] += 1;
  return out;
}

function distinctLanguages(reviews: Review[]): string[] {
  const seen = new Set<string>();
  for (const r of reviews) {
    if (r.language && r.language.trim().length > 0) seen.add(r.language);
  }
  return [...seen].sort();
}

// Internal seams exposed for offline unit tests only — not part of the public
// surface other modules import (mirrors the repo-wide `__testing` convention).
export const __testing = {
  RATINGS,
  sentimentOf,
  round2,
  averageRating,
  ratingDistribution,
  sentimentBreakdown,
  distinctLanguages,
};

export type { PlaceMeta };
