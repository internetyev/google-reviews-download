// Friendly error-UX mapping for the web form (L30.2).
//
// Every failure the reviews provider can raise arrives as a `SemanticForceError`
// carrying a machine `code` (and sometimes an HTTP `status`). Those codes are the
// right contract for the API surface, but `err.message` is raw upstream text
// ("SerpApi returned 429", "place_id not found") that should never be shown to a
// person pasting a coffee-shop name. This module is the single place that turns a
// code into human copy: a reassuring title, a plain-language explanation of what
// went wrong, and an actionable retry hint. Keeping it a pure, hookless function
// (no React, no env, no I/O) means it is exhaustively unit-testable offline and
// reusable by any surface that wants the same wording (preview page today; could
// back an /api/reviews JSON error body or the MCP server tomorrow).
//
// Code → cause cross-reference (see lib/serpapi/client.ts `mapStatusToCode`):
//   rate_limited   ← HTTP 429: the per-key SerpApi quota OR a burst rate limit
//                    (the two are indistinguishable at 429, so one message owns
//                    both "quota exceeded" and "rate-limited").
//   not_found      ← HTTP 404: no Google Maps place matched the input.
//   unauthorized   ← HTTP 401/403: an expired/misconfigured provider key — our
//                    fault, not the visitor's.
//   bad_request    ← other 4xx: the provider rejected the request as malformed.
//   upstream_error ← HTTP 5xx OR a network failure OR SerpApi's soft-error body.
//   unknown        ← anything unmapped (defensive default).

import { SemanticForceError, type SemanticForceErrorCode } from "./types";

export interface ErrorUx {
  /** Short, reassuring headline — never leaks a status code or stack. */
  title: string;
  /** One plain-language sentence on what went wrong (no jargon, no blame). */
  detail: string;
  /** What the visitor (or we) can do next — always actionable. */
  retryHint: string;
}

const UX_BY_CODE: Record<SemanticForceErrorCode, ErrorUx> = {
  rate_limited: {
    title: "Too many requests right now",
    detail:
      "We've hit Google's review-fetch limit — either a short burst rate or the daily quota. This is on the fetch side, not a problem with your business.",
    retryHint:
      "Wait about a minute and try again. If it keeps happening, the daily quota may be used up — try again later today.",
  },
  not_found: {
    title: "We couldn't find that business",
    detail: "Google Maps has no place matching what you entered.",
    retryHint:
      "Check the spelling, or paste the full Google Maps URL or the place ID (starts with “ChIJ…”) instead of the name.",
  },
  unauthorized: {
    title: "The reviews service is temporarily unavailable",
    detail:
      "Our connection to the reviews provider was rejected — an expired or misconfigured key on our end, not anything you did.",
    retryHint:
      "Please try again in a little while; we're notified when this happens and will get it sorted.",
  },
  bad_request: {
    title: "That request couldn't be processed",
    detail: "The reviews provider rejected the request as malformed.",
    retryHint:
      "Go back and re-enter the business name, Google Maps URL, or place ID, then try again.",
  },
  upstream_error: {
    title: "The reviews service had a hiccup",
    detail:
      "Google (or our reviews provider) returned an error or couldn't be reached just now.",
    retryHint: "This is usually temporary — wait a moment and try again.",
  },
  unknown: {
    title: "Something went wrong",
    detail: "We hit an unexpected error while loading those reviews.",
    retryHint:
      "Please try again. If it keeps happening, try a different business or come back a little later.",
  },
};

/**
 * Map a `SemanticForceError` to display-ready copy. Defaults to the `unknown`
 * wording if a future code slips through without its own entry, so the caller
 * can render unconditionally and never show a raw upstream message.
 */
export function semanticForceErrorToUx(err: SemanticForceError): ErrorUx {
  return UX_BY_CODE[err.code] ?? UX_BY_CODE.unknown;
}
