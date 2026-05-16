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
