// Review anonymisation / PII redaction (Phase 36, L36.1) — the pure, offline,
// deterministic layer.
//
// A business that exports its Google reviews to share publicly, paste into a
// report, or hand to a third party often must NOT leak the individual
// reviewers' identities (a GDPR / privacy-by-default need). The personally
// identifying surfaces on a `Review` are: the reviewer's display name
// (`author_name`), the link to their Google profile (`author_url`), and the
// reviewer-uploaded `photos` (which can carry faces / locations). This module
// is the single source of truth for redacting those — a pure
// `Review[] → Review[]` transform with NO I/O, NO env, NO LLM, applied AFTER
// fetch/filter/sort/project and BEFORE the exporters/summary so every delivery
// surface (web preview, JSON / CSV / XLSX export, MCP) anonymises identically.
//
// Scope note: this leaf is the layer only. Wiring it into `/api/reviews` query
// params (L36.2) and the web form + preview (L36.3) are separate follow-up
// leaves, mirroring the Phase 31/32/33/34/35 pure-layer-first cadence.
//
// Design choices:
//  - Stable + non-mutating: returns a NEW array of NEW shallow objects; the
//    input reviews are never touched. The relative order of reviews is
//    preserved (anonymisation is per-review, never reorders/drops).
//  - Every option is OPT-IN and additive (AND): an empty / absent options bag,
//    or one where every flag is false, is the IDENTITY — every review is
//    shallow-copied whole. A privacy toggle that is off must reproduce today's
//    full export byte-for-byte.
//  - `maskAuthorName` replaces the display name with its INITIALS ("John Smith"
//    → "J. S."); a name that is blank / whitespace-only collapses to the
//    `ANONYMOUS_LABEL` sentinel rather than an empty string, so a redacted row
//    never ships an empty author cell. Code-point safe (Array.from) so a
//    leading emoji / accented initial survives.
//  - `dropAuthorUrl` / `dropPhotos` DELETE the key when present rather than
//    setting it to `undefined`, so the redacted object stays a faithful
//    `Review` (an absent optional field is omitted, never a sparse skeleton);
//    on a review that already lacks the field they are a no-op.

import type { Review } from "@/lib/semanticforce/types";

export type AnonymiseOptions = {
  /** Replace `author_name` with its initials ("John Smith" → "J. S."). */
  maskAuthorName?: boolean;
  /** Remove `author_url` (the link to the reviewer's Google profile). */
  dropAuthorUrl?: boolean;
  /** Remove reviewer-uploaded `photos` (can carry identifying imagery). */
  dropPhotos?: boolean;
};

/** Shown in place of a name that is blank / whitespace-only after masking. */
export const ANONYMOUS_LABEL = "Anonymous";

/**
 * Reduce a display name to space-separated initials: the first code point of
 * each whitespace-separated word, upper-cased, each followed by a dot
 * ("john  smith" → "J. S."; "Madonna" → "M."). A blank / whitespace-only name
 * returns `ANONYMOUS_LABEL` so a masked row never carries an empty author.
 */
export function maskAuthorName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ANONYMOUS_LABEL;
  const initials = words
    .map((word) => {
      const first = Array.from(word)[0] ?? "";
      return `${first.toUpperCase()}.`;
    })
    .join(" ");
  // A name made only of punctuation/symbols yields empty initials — fall back
  // to the sentinel rather than ship a stray "." cell.
  return initials.replace(/[\s.]/g, "").length > 0 ? initials : ANONYMOUS_LABEL;
}

/** True when at least one redaction flag is set (else the transform is identity). */
function isActive(options: AnonymiseOptions): boolean {
  return Boolean(
    options.maskAuthorName || options.dropAuthorUrl || options.dropPhotos,
  );
}

/**
 * Anonymise each review per `options`. Pure: same input → same output, input
 * reviews never mutated, review order preserved, review count unchanged. An
 * empty / absent options bag (or one with every flag false) returns whole
 * shallow copies (identity).
 */
export function anonymiseReviews(
  reviews: Review[],
  options: AnonymiseOptions = {},
): Review[] {
  if (!isActive(options)) {
    return reviews.map((review) => ({ ...review })); // identity (fresh objects)
  }
  return reviews.map((review) => {
    const next: Review = { ...review };
    if (options.maskAuthorName) {
      next.author_name = maskAuthorName(review.author_name);
    }
    if (options.dropAuthorUrl && "author_url" in next) {
      delete next.author_url;
    }
    if (options.dropPhotos && "photos" in next) {
      delete next.photos;
    }
    return next;
  });
}

// Internal seams exposed for offline unit tests only — not part of the public
// surface other modules import (mirrors the repo-wide `__testing` convention).
export const __testing = {
  maskAuthorName,
  isActive,
  ANONYMOUS_LABEL,
};
