// Review-anonymisation query-param parsing (Phase 36, L36.2) — the single source
// of truth for turning request query params into an `AnonymiseOptions` bag.
//
// Mirrors `lib/reviews/filter-params.ts` / `lib/reviews/project-params.ts`: the
// HTTP API route AND (in L36.3) the web preview page parse the same redaction
// params identically — the L28.2/D-095 de-drift move. The matching SEMANTICS
// (how each flag transforms a review) live in the pure layer
// `lib/reviews/anonymise.ts`; this module only maps raw string params onto that
// layer's `AnonymiseOptions` shape, leniently (a bad/blank/absent value degrades
// to "no redaction" = the identity transform, never an error).
//
// Two ways to ask for redaction:
//   - the `anonymize` umbrella (US spelling, with the `anonymise` alias) turns
//     ON ALL THREE redactions at once — the "just anonymise everything" switch;
//   - the granular `mask_author` / `drop_author_url` / `drop_photos` flags each
//     enable exactly their one redaction, for callers who want (say) names
//     masked but profile links kept.
// The umbrella and the granular flags OR together, so `anonymize=1` is
// equivalent to setting all three granular flags.

import { parseBooleanFlag } from "@/lib/reviews/filter-params";
import type { AnonymiseOptions } from "@/lib/reviews/anonymise";

// The query-param keys the redaction controls understand, in a stable order.
// Both the route and (L36.3) the preview's download-CTA href iterate this list
// so a new control is added in exactly one place and can never be wired into one
// surface only.
export const ANONYMISE_PARAM_KEYS = [
  "anonymize",
  "anonymise",
  "mask_author",
  "drop_author_url",
  "drop_photos",
] as const;

export type AnonymiseParamKey = (typeof ANONYMISE_PARAM_KEYS)[number];

/**
 * Build an `AnonymiseOptions` from the request's query params. Every flag is
 * opt-in; an absent/blank/unrecognised value omits it, so an all-absent query
 * yields `{}` (the identity — `anonymiseReviews(rs, {})` returns whole copies of
 * `rs`). The `anonymize` umbrella (US spelling preferred, `anonymise` alias)
 * turns on all three redactions; the granular flags OR with it. Lenient by
 * design (matches the summary/filter/sort/fields params): only the structural
 * params (placeId/format/limit) ever 400.
 */
export function parseAnonymiseOptions(
  params: URLSearchParams,
): AnonymiseOptions {
  // Umbrella: `anonymize` takes precedence over the `anonymise` alias (matching
  // the route's `?? alias` precedence convention).
  const umbrella =
    parseBooleanFlag(params.get("anonymize") ?? params.get("anonymise")) === true;

  const options: AnonymiseOptions = {};
  if (umbrella || parseBooleanFlag(params.get("mask_author"))) {
    options.maskAuthorName = true;
  }
  if (umbrella || parseBooleanFlag(params.get("drop_author_url"))) {
    options.dropAuthorUrl = true;
  }
  if (umbrella || parseBooleanFlag(params.get("drop_photos"))) {
    options.dropPhotos = true;
  }
  return options;
}

// True when at least one redaction is actually requested — used (L36.3) by the
// preview to decide whether to surface "redaction active" affordances.
export function hasActiveAnonymise(options: AnonymiseOptions): boolean {
  return Boolean(
    options.maskAuthorName || options.dropAuthorUrl || options.dropPhotos,
  );
}
