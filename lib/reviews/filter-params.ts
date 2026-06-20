// Review-filter query-param parsing (Phase 33, L33.3) — the single source of
// truth for turning request query params into a `ReviewFilter`.
//
// Extracted from `app/api/reviews/route.ts` (where L33.2 first added it) so the
// HTTP API route AND the web preview page (`app/preview/page.tsx`) parse the
// same `min_rating`/`max_rating`/`language`/`with_photos`/… params identically —
// the same de-drift move L28.2/D-095 made for name-resolution. The matching
// SEMANTICS still live in the pure layer `lib/reviews/filter.ts`; this module
// only maps raw string params onto that layer's `ReviewFilter` shape, leniently
// (a malformed criterion degrades to "no constraint", never an error).

import type { Rating, ReviewFilter } from "@/lib/reviews/filter";

// The query-param keys the filter understands, in a stable order. Both the
// route and the preview's download-CTA href iterate this list so a new criterion
// is added in exactly one place and can never be wired into one surface only.
export const FILTER_PARAM_KEYS = [
  "min_rating",
  "max_rating",
  "language",
  "with_photos",
  "with_owner_response",
  "keyword",
  "since",
  "until",
] as const;

export type FilterParamKey = (typeof FILTER_PARAM_KEYS)[number];

// Parse a `min_rating`/`max_rating` param into a 1..5 star bound (L33.2).
// Lenient + clamping: an absent/blank value → undefined (no bound); a
// non-numeric value → undefined (no bound); a numeric value is floored and
// clamped into [1, 5] so `?min_rating=0` reads as 1 and `?max_rating=9` as 5
// rather than 400-ing an otherwise-valid download. Returns the value typed as
// `Rating` for the ReviewFilter (the clamp guarantees range).
//
// The blank-is-no-bound case is load-bearing for the web form (L33.3): its
// "Any" option submits `min_rating=`/`max_rating=` (empty string), and
// `Number("")` is `0` — without this guard an "Any" selection would clamp to 1
// and silently filter every download to 1★ reviews. A blank field must mean
// "no constraint", identical to the param being absent.
export function parseRating(raw: string | null): Rating | undefined {
  if (raw == null || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const clamped = Math.min(5, Math.max(1, Math.floor(parsed)));
  return clamped as Rating;
}

// Parse a boolean filter flag (`with_photos`/`with_owner_response`, L33.2).
// Returns `true` only for an explicit truthy token (`1`/`true`/`yes`, case-
// insensitive, trimmed); absent or any other value → undefined. Returning
// undefined (not `false`) is load-bearing: the filter treats `withPhotos === true`
// as the only constraint, so an unchecked box / absent param must mean "don't
// care", never "exclude reviews that have photos" (matches filter.ts's contract).
export function parseBooleanFlag(raw: string | null): boolean | undefined {
  if (raw == null) return undefined;
  return ["1", "true", "yes"].includes(raw.trim().toLowerCase()) ? true : undefined;
}

// Build a `ReviewFilter` from the request's query params (L33.2). Every
// criterion is optional; an unset/blank one is simply omitted so an all-absent
// query yields `{}` (the identity filter — `filterReviews(rs, {})` deep-equals
// `rs`). `language`/`keyword`/`since`/`until` are passed through as-is — the
// pure filter layer already normalises case, treats a whitespace-only keyword
// as "no constraint", and ignores an unparseable date — so we don't re-validate
// here (single source of truth for the matching semantics is filter.ts).
export function parseFilter(params: URLSearchParams): ReviewFilter {
  const filter: ReviewFilter = {};

  const minRating = parseRating(params.get("min_rating"));
  if (minRating != null) filter.minRating = minRating;
  const maxRating = parseRating(params.get("max_rating"));
  if (maxRating != null) filter.maxRating = maxRating;

  const language = params.get("language");
  if (language != null && language.trim().length > 0) filter.language = language;

  if (parseBooleanFlag(params.get("with_photos"))) filter.withPhotos = true;
  if (parseBooleanFlag(params.get("with_owner_response"))) {
    filter.withOwnerResponse = true;
  }

  const keyword = params.get("keyword");
  if (keyword != null) filter.keyword = keyword;

  const since = params.get("since");
  if (since != null) filter.since = since;
  const until = params.get("until");
  if (until != null) filter.until = until;

  return filter;
}

// True when at least one filter criterion is actually set — used by the preview
// to decide whether to surface "filter active" affordances vs. a plain sample.
export function hasActiveFilter(filter: ReviewFilter): boolean {
  return Object.keys(filter).length > 0;
}
