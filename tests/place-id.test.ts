// Regression guard for lib/semanticforce/place-id.ts (methodology §1).
// Pure function, no I/O — the canonicalisation rules here decide cache keys,
// share URLs, and filenames, so a silent change is a data-integrity bug.

import { describe, it, expect } from "vitest";
import {
  normalisePlaceId,
  PlaceIdParseError,
  __testing,
} from "@/lib/semanticforce/place-id";

const REAL_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

describe("normalisePlaceId — accepted inputs", () => {
  it("keeps the canonical ChIJ prefix and slugifies non-alnum", () => {
    expect(normalisePlaceId(REAL_ID)).toEqual({
      raw: REAL_ID,
      slug: "chijn1t-tdeuemsrusoyg83fry4",
    });
  });

  it("recases a lowercased chij token back to the canonical prefix", () => {
    expect(normalisePlaceId(REAL_ID.toLowerCase()).raw).toBe(REAL_ID);
  });

  it("lowercases a legacy 0x:0x hex pair", () => {
    const r = normalisePlaceId("0x89C259A9B3117469:0xD134E199A405A163");
    expect(r.raw).toBe("0x89c259a9b3117469:0xd134e199a405a163");
    expect(r.slug).toBe("0x89c259a9b3117469-0xd134e199a405a163");
  });

  it("uppercases a MOCK_ fixture id", () => {
    expect(normalisePlaceId("mock_small_001")).toEqual({
      raw: "MOCK_SMALL_001",
      slug: "mock-small-001",
    });
  });

  it("extracts the Place ID embedded in a long Google Maps URL", () => {
    const url = `https://www.google.com/maps/place/Foo/@40.7,-73.9,17z/data=!4m5!3m4!1s${REAL_ID}!8m2`;
    expect(normalisePlaceId(url).raw).toBe(REAL_ID);
  });

  it("trims and collapses surrounding whitespace before matching", () => {
    expect(normalisePlaceId(`\t  ${REAL_ID}\n `).raw).toBe(REAL_ID);
  });
});

describe("normalisePlaceId — rejected inputs", () => {
  it("rejects non-strings", () => {
    expect(() => normalisePlaceId(123)).toThrow(PlaceIdParseError);
    expect(() => normalisePlaceId(123)).toThrow("must be a string");
  });

  it("rejects empty / whitespace-only input", () => {
    expect(() => normalisePlaceId("")).toThrow("place_id is empty");
    expect(() => normalisePlaceId("    ")).toThrow("place_id is empty");
  });

  it("rejects unrecognised text", () => {
    expect(() => normalisePlaceId("just some words")).toThrow(
      "could not extract a Place ID",
    );
  });

  it("rejects maps.app.goo.gl / goo.gl short links (D-018)", () => {
    expect(() => normalisePlaceId("https://maps.app.goo.gl/abc123")).toThrow(
      "Short Google Maps links",
    );
    expect(() => normalisePlaceId("goo.gl/maps/xyz")).toThrow(
      "Short Google Maps links",
    );
  });

  it("checks short-link host BEFORE pattern match (precedence)", () => {
    // A string that contains both a short-link host and a valid ChIJ token
    // must still be rejected as a short link — the host guard runs first.
    expect(() => normalisePlaceId(`goo.gl ${REAL_ID}`)).toThrow(
      "Short Google Maps links",
    );
  });
});

describe("__testing helpers", () => {
  it("slugify is lowercase, alnum-or-dash, no leading/trailing/double dash", () => {
    expect(__testing.slugify("__Foo--Bar__")).toBe("foo-bar");
    expect(__testing.slugify("a.b:c d")).toBe("a-b-c-d");
  });

  it("canonicalisePrefix normalises each id family", () => {
    expect(__testing.canonicalisePrefix("chijABC")).toBe("ChIJABC");
    expect(__testing.canonicalisePrefix("0xAB:0xCD")).toBe("0xab:0xcd");
    expect(__testing.canonicalisePrefix("mock_x")).toBe("MOCK_X");
  });
});

// The slug *is* the cache key (D-020 `gr:reviews:v1:<slug>`), the share-URL
// segment, and the filename root (D-033). If two surface forms of the *same*
// Place ID produced different slugs, the KV cache would fragment into one
// entry per surface form (and the download filename would change between
// visits, breaking any automation that ingests by name). The single-rule
// suite above proves each canonicalisation arrow in isolation; this suite
// proves the cross-form invariant that *anchors the cache* (D-017): every
// alias of one ID collapses to one `{raw, slug}`.
describe("normalisePlaceId — surface-form aliasing (cache-key integrity)", () => {
  it("ChIJ in canonical / lowercased-prefix / whitespaced / URL-embedded forms all alias to one {raw, slug}", () => {
    const canonical = normalisePlaceId(REAL_ID);
    const loweredPrefix = normalisePlaceId(
      "chij" + REAL_ID.slice(4),
    );
    const whitespaced = normalisePlaceId(`\t  ${REAL_ID}\n `);
    const urlEmbedded = normalisePlaceId(
      `https://www.google.com/maps/place/Foo/@40.7,-73.9,17z/data=!4m5!3m4!1s${REAL_ID}!8m2`,
    );

    expect(loweredPrefix).toEqual(canonical);
    expect(whitespaced).toEqual(canonical);
    expect(urlEmbedded).toEqual(canonical);
  });

  it("MOCK_ in upper / lower / mixed case alias to one {raw, slug}", () => {
    const upper = normalisePlaceId("MOCK_SMALL_001");
    const lower = normalisePlaceId("mock_small_001");
    const mixed = normalisePlaceId("Mock_Small_001");

    expect(lower).toEqual(upper);
    expect(mixed).toEqual(upper);
  });

  it("0x hex pair in upper- and lower-case hex digits alias to one {raw, slug}", () => {
    const lower = normalisePlaceId(
      "0x89c259a9b3117469:0xd134e199a405a163",
    );
    const upper = normalisePlaceId(
      "0x89C259A9B3117469:0xD134E199A405A163",
    );

    expect(upper).toEqual(lower);
  });
});

// The cache writes a key once and reads it many times. If the canonical
// `raw` weren't itself a fixed point under re-normalisation, a
// normalise → store → re-normalise → fetch loop would silently miss its own
// writes. The aliasing suite above proves *different* surface forms collapse
// to one slug; this suite proves the *canonical* form is stable under a
// second pass (so callers can hand the cached `raw` back into
// `normalisePlaceId` without surprise).
describe("normalisePlaceId — canonical-form idempotency", () => {
  it("the canonical raw re-normalises to itself for ChIJ (started from a non-canonical input)", () => {
    const first = normalisePlaceId("chij" + REAL_ID.slice(4));
    const second = normalisePlaceId(first.raw);
    expect(second).toEqual(first);
  });

  it("the canonical raw re-normalises to itself for the MOCK_ and 0x families", () => {
    for (const input of ["mock_small_001", "0xAB:0xCD"]) {
      const first = normalisePlaceId(input);
      const second = normalisePlaceId(first.raw);
      expect(second).toEqual(first);
    }
  });
});

// The pattern's per-family length floors are load-bearing: a "ChIJ" prefix
// followed by only a few chars is *not* a real Place ID, and `0x:0x` with
// empty hex on either side isn't a real legacy hex pair. A refactor that
// loosened `{20,}` to `{1,}` or replaced `+` with `*` would let
// almost-real stubs through, and the live SF call would 404 with no
// validation signal at our edge. Pin the floors at the boundary so the
// regression reads as a red test, not a confusing upstream 404.
describe("PLACE_ID_PATTERN — minimum-length floor", () => {
  it("rejects a ChIJ token with fewer than 20 tail chars (below the {20,} floor)", () => {
    // ChIJ + 19 word chars => 4+19=23 total, only 19 in tail; below {20,}.
    expect(() => normalisePlaceId("ChIJ" + "a".repeat(19))).toThrow(
      "could not extract",
    );
  });

  it("accepts ChIJ with exactly 20 tail chars (boundary, the smallest match)", () => {
    const ok = normalisePlaceId("ChIJ" + "a".repeat(20));
    expect(ok.raw.startsWith("ChIJ")).toBe(true);
    expect(ok.slug.startsWith("chij")).toBe(true);
  });

  it("rejects 0x:0x with empty hex on either side", () => {
    expect(() => normalisePlaceId("0x:0xABCD")).toThrow("could not extract");
    expect(() => normalisePlaceId("0xABCD:0x")).toThrow("could not extract");
  });

  it("rejects a bare MOCK_ with no body", () => {
    expect(() => normalisePlaceId("MOCK_")).toThrow("could not extract");
  });
});
