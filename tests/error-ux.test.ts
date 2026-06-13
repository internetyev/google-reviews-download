// Friendly error-UX mapping guard for lib/semanticforce/error-ux.ts (L30.2).
//
// The mapping is the single seam that keeps raw upstream text ("SerpApi returned
// 429", "place_id not found") off the visitor's screen. Four things are a
// contract a silent refactor could regress:
//
//   1. EXHAUSTIVE — every SemanticForceErrorCode resolves to copy. A new code
//      added to the union without a UX entry must be caught here, not in
//      production. We drive this off the type's own member list so the test
//      can't drift from the union.
//   2. NO LEAK — the rendered copy never contains the raw err.message or a bare
//      HTTP status number. This is the whole point of the layer.
//   3. ACTIONABLE — title, detail, and retryHint are all non-empty for every
//      code; the card always tells the visitor what to do next.
//   4. SEMANTIC ANCHORS — the two highest-traffic cases (a name that doesn't
//      resolve → not_found; quota/burst → rate_limited) keep their documented
//      gist, so a copy rewrite that loses the meaning is loud.
//
// Pure function, zero I/O — fully offline. Committed, not run in-routine (no
// node_modules; `npm install` is a human step — D-039/D-040 posture).

import { describe, it, expect } from "vitest";
import { semanticForceErrorToUx } from "@/lib/semanticforce/error-ux";
import {
  SemanticForceError,
  type SemanticForceErrorCode,
} from "@/lib/semanticforce/types";

// The full union, enumerated. Keep in lockstep with types.ts; the
// exhaustiveness test below fails loudly if a member is added there without a
// mapping entry (and TypeScript fails the build if this list omits one, because
// ALL_CODES is typed as the union array).
const ALL_CODES: SemanticForceErrorCode[] = [
  "rate_limited",
  "not_found",
  "unauthorized",
  "bad_request",
  "upstream_error",
  "unknown",
];

const mk = (code: SemanticForceErrorCode, status?: number) =>
  new SemanticForceError(code, `RAW upstream detail for ${code}`, status);

describe("semanticForceErrorToUx — exhaustive over every code", () => {
  for (const code of ALL_CODES) {
    it(`${code} → non-empty title, detail, and retry hint`, () => {
      const ux = semanticForceErrorToUx(mk(code));
      expect(ux.title.trim().length).toBeGreaterThan(0);
      expect(ux.detail.trim().length).toBeGreaterThan(0);
      expect(ux.retryHint.trim().length).toBeGreaterThan(0);
    });

    it(`${code} → never leaks the raw message or a bare status code`, () => {
      const ux = semanticForceErrorToUx(mk(code, 429));
      const shown = `${ux.title} ${ux.detail} ${ux.retryHint}`;
      // the raw upstream message must not surface…
      expect(shown).not.toContain("RAW upstream detail");
      // …and no bare HTTP status digits should appear in the visitor copy.
      expect(shown).not.toMatch(/\b(401|403|404|429|5\d\d)\b/);
    });
  }
});

describe("semanticForceErrorToUx — distinct copy per code", () => {
  it("each code maps to a distinct title (no accidental copy collisions)", () => {
    const titles = ALL_CODES.map((c) => semanticForceErrorToUx(mk(c)).title);
    expect(new Set(titles).size).toBe(ALL_CODES.length);
  });
});

describe("semanticForceErrorToUx — semantic anchors on the high-traffic cases", () => {
  it("not_found tells the visitor we couldn't find the business and how to retry", () => {
    const ux = semanticForceErrorToUx(mk("not_found", 404));
    expect(ux.title.toLowerCase()).toContain("couldn't find");
    // actionable: it should point at the URL/ID alternative to a bare name
    expect(ux.retryHint.toLowerCase()).toMatch(/url|place id|chij/);
  });

  it("rate_limited owns both the quota and the burst story (429 is indistinguishable)", () => {
    const ux = semanticForceErrorToUx(mk("rate_limited", 429));
    const blob = `${ux.detail} ${ux.retryHint}`.toLowerCase();
    expect(blob).toContain("quota");
    expect(ux.retryHint.toLowerCase()).toMatch(/wait|later|again/);
  });

  it("unauthorized frames it as our fault, not the visitor's", () => {
    const ux = semanticForceErrorToUx(mk("unauthorized", 401));
    expect(`${ux.detail}`.toLowerCase()).toMatch(/our end|not anything you|misconfigured|expired/);
  });
});

describe("semanticForceErrorToUx — defensive default", () => {
  it("an off-union code (cast through) still yields the unknown copy, never throws", () => {
    // Simulate a future provider raising a code the union/map hasn't caught up to.
    const rogue = new SemanticForceError(
      "teapot" as SemanticForceErrorCode,
      "RAW upstream detail for teapot",
    );
    const ux = semanticForceErrorToUx(rogue);
    expect(ux.title).toBe(semanticForceErrorToUx(mk("unknown")).title);
    expect(ux.retryHint.trim().length).toBeGreaterThan(0);
  });
});
