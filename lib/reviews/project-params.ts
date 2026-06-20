// Column-selection query-param parsing (Phase 35, L35.3) — the single source of
// truth for turning request query params into a `ReviewField[]` projection.
//
// Mirrors `lib/reviews/filter-params.ts`: the HTTP API route AND the web preview
// page parse the `fields`/`columns` params identically (the L28.2/D-095 de-drift
// move). The matching SEMANTICS still live in the pure layer
// `lib/reviews/project.ts`; this module only collects the raw params and feeds
// them to `parseReviewFields`, leniently (a bad/blank/absent value degrades to
// "all columns" = the identity projection, never an error).

import { parseReviewFields, type ReviewField } from "@/lib/reviews/project";

// The query-param keys the column picker understands. The route reads `fields`
// first, then the `columns` alias; the web form (L35.3) submits `fields`.
export const FIELD_PARAM_KEYS = ["fields", "columns"] as const;

/**
 * Parse the column selection from request query params. Handles BOTH wire forms
 * the two surfaces emit:
 *   - the HTTP API's comma-separated single value (`?fields=rating,text`), and
 *   - the web form's repeated checkbox params (`?fields=rating&fields=text`,
 *     which is what a no-JS multi-checkbox GET submit produces).
 * Both are reduced to one flat token list and narrowed by the pure layer.
 * `fields` takes precedence over the `columns` alias (matching the route's
 * original `params.get("fields") ?? params.get("columns")`). Absent / blank /
 * all-unrecognised → `null` (identity: all columns), never an error.
 */
export function parseFieldsParam(
  params: URLSearchParams,
): ReviewField[] | null {
  const fields = params.getAll("fields");
  const raw = fields.length > 0 ? fields : params.getAll("columns");
  if (raw.length === 0) return null;
  // Each entry may itself be comma-separated (API) or a single token (one form
  // checkbox), so split every value on commas before narrowing.
  return parseReviewFields(raw.flatMap((v) => v.split(",")));
}
