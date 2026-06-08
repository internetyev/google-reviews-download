// Regression guard for lib/seo/variants.ts (L3.1a infrastructure).
//
// The registry feeds three things that break loudly if it drifts:
//   - `generateStaticParams` / sitemap enumeration (slug must be unique +
//     URL-safe, or two pages collide or a 404 ships in the sitemap),
//   - the dynamic route render (`h1`, `intro`, `metaTitle`,
//     `metaDescription` — see app/(seo)/[variant]/page.tsx),
//   - the L3.1b publish flip (`publishedVariants()` must stay a strict
//     subset of the registry and `findPublishedVariant` must never surface
//     an unpublished slug).
// This locks the invariants now so L3.1b only ever needs to change `published`.

import { describe, it, expect } from "vitest";
import {
  SEO_VARIANTS,
  publishedVariants,
  findPublishedVariant,
} from "@/lib/seo/variants";

describe("SEO_VARIANTS — registry shape", () => {
  it("holds the full candidate set (10 L1.6a + 3 from the 2026-06 keyword pass)", () => {
    expect(SEO_VARIANTS).toHaveLength(13);
  });

  it("has unique ids and unique slugs", () => {
    const ids = SEO_VARIANTS.map((v) => v.id);
    const slugs = SEO_VARIANTS.map((v) => v.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every slug is URL-safe (lowercase, alnum + single dashes)", () => {
    for (const v of SEO_VARIANTS) {
      expect(v.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("every variant carries the fields the route actually renders", () => {
    for (const v of SEO_VARIANTS) {
      expect(v.intent).toBe("export");
      expect(v.metaTitle.trim().length).toBeGreaterThan(0);
      expect(v.metaDescription.trim().length).toBeGreaterThan(0);
      expect(v.h1.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(v.intro)).toBe(true);
      expect(v.intro.length).toBeGreaterThan(0);
      for (const para of v.intro) {
        expect(typeof para).toBe("string");
        expect(para.trim().length).toBeGreaterThan(0);
      }
      expect(typeof v.published).toBe("boolean");
    }
  });
});

describe("publishedVariants / findPublishedVariant", () => {
  it("publishedVariants() is a strict subset of the registry", () => {
    const pub = publishedVariants();
    const slugs = new Set(SEO_VARIANTS.map((v) => v.slug));
    for (const v of pub) {
      expect(v.published).toBe(true);
      expect(slugs.has(v.slug)).toBe(true);
    }
    expect(pub.length).toBeLessThanOrEqual(SEO_VARIANTS.length);
  });

  it("publishes the Tier-1 money set (L3.1b — 8 live, one page per intent)", () => {
    // L3.1b landed: the 2026-06 keyword pass picked the Tier-1 set
    // (docs/seo/money-keywords.md). Pin the exact live slug set so any
    // publish/unpublish flip is a reviewed change.
    const liveSlugs = publishedVariants().map((v) => v.slug).sort();
    expect(liveSlugs).toEqual(
      [
        "backup-google-reviews",
        "download-all-reviews-from-google",
        "download-google-maps-reviews",
        "download-google-reviews-as-excel",
        "export-google-my-business-reviews",
        "export-google-reviews-to-csv",
        "google-business-profile-reviews-download",
        "google-reviews-to-json",
      ].sort(),
    );
  });

  it("findPublishedVariant returns undefined for an unknown slug", () => {
    expect(findPublishedVariant("no-such-slug")).toBeUndefined();
  });

  it("findPublishedVariant never surfaces an unpublished slug", () => {
    for (const v of SEO_VARIANTS) {
      const hit = findPublishedVariant(v.slug);
      if (v.published) {
        expect(hit).toBeDefined();
        expect(hit!.slug).toBe(v.slug);
      } else {
        expect(hit).toBeUndefined();
      }
    }
  });
});

// L11.5 deepening — the three load-bearing surfaces above-the-fold copy carries
// past the registry-shape invariants: the URL contract (once a slug is
// published, every external reference is to that exact string forever), the
// SERP-truncation ceiling on metaTitle/metaDescription (silent degradation, no
// throw), and topical-keyword presence (the whole point of the variant is the
// "google reviews" long-tail; a refactor that templated the strings and dropped
// either word turns the page off-topic with no test signal).

describe("SEO_VARIANTS — slug-id pair freeze (URL contract)", () => {
  // The {id, slug} pairs are the canonical doc cross-reference
  // (docs/seo-variants.md) AND the canonical URL once a variant is published.
  // A regression that silently renamed a slug ("export-google-reviews-to-csv"
  // -> "export-google-reviews-csv") changes the page's permanent URL — every
  // inbound link 404s and the L1.6b/corgi keyword score becomes meaningless.
  // Pin the exact pairs so any change is a reviewed change.
  const EXPECTED_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ["A1", "export-google-reviews-to-csv"],
    ["A2", "download-google-reviews-as-excel"],
    ["A3", "google-reviews-to-xlsx"],
    ["A4", "google-business-reviews-csv-export"],
    ["B1", "save-google-reviews-to-file"],
    ["B2", "extract-google-reviews"],
    ["B3", "backup-google-reviews"],
    ["C1", "download-google-maps-reviews"],
    ["C2", "google-business-profile-reviews-download"],
    ["C3", "download-all-reviews-from-google"],
    ["D1", "export-google-my-business-reviews"],
    ["D2", "google-reviews-to-json"],
    ["D3", "bulk-export-google-reviews"],
  ];

  it("registry order matches the expected {id, slug} pairs exactly", () => {
    const actual = SEO_VARIANTS.map((v) => [v.id, v.slug] as const);
    expect(actual).toEqual(EXPECTED_PAIRS);
  });

  it("group balance is 4 A + 3 B + 3 C + 3 D ids", () => {
    // A format-named, B verb-led, C surface/source (L1.6a), D the 2026-06
    // keyword-pass additions. Per-prefix count catches a silent group swap.
    const byPrefix = (p: string) =>
      SEO_VARIANTS.filter((v) => v.id.startsWith(p)).length;
    expect(byPrefix("A")).toBe(4);
    expect(byPrefix("B")).toBe(3);
    expect(byPrefix("C")).toBe(3);
    expect(byPrefix("D")).toBe(3);
    expect(byPrefix("A") + byPrefix("B") + byPrefix("C") + byPrefix("D")).toBe(
      SEO_VARIANTS.length,
    );
  });
});

describe("SEO_VARIANTS — SERP-length bounds on metaTitle/metaDescription", () => {
  // Google truncates <title> at ~60 chars and <meta description> at ~160 chars
  // in the SERP display (Moz/Ahrefs published thresholds — conservative). A
  // refactor that bloated a title past 60 silently lops off the tail; the page
  // still ships, the keyword still ranks, but CTR drops because the visible
  // headline trails into an ellipsis. There is no runtime signal — pin the
  // ceiling at the boundary so the regression reads as a red test.
  const TITLE_MAX = 60;
  const DESCRIPTION_MAX = 160;

  it("every metaTitle is non-empty and within the 60-char SERP ceiling", () => {
    for (const v of SEO_VARIANTS) {
      expect(v.metaTitle.length).toBeGreaterThan(0);
      expect(v.metaTitle.length).toBeLessThanOrEqual(TITLE_MAX);
    }
  });

  it("every metaDescription is non-empty and within the 160-char SERP ceiling", () => {
    for (const v of SEO_VARIANTS) {
      expect(v.metaDescription.length).toBeGreaterThan(0);
      expect(v.metaDescription.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("metaTitle ceiling is verified to be a real boundary (guard-the-guard)", () => {
    // Positive guard so the ceiling assertion above can't pass vacuously on an
    // empty registry or a tabulation that dropped string content. Picks the
    // longest current metaTitle and asserts it really did fit (not >TITLE_MAX
    // and silently got bypassed). Mirrors the L11.3 "positive round-trip so
    // the negatives can't pass vacuously" pattern.
    const longest = SEO_VARIANTS.reduce(
      (acc, v) => (v.metaTitle.length > acc ? v.metaTitle.length : acc),
      0,
    );
    expect(longest).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(TITLE_MAX);
  });
});

describe("SEO_VARIANTS — topical-keyword presence on visible/meta copy", () => {
  // The whole reason these variants exist is the "google reviews" long-tail
  // keyword cluster (L1.6a). A refactor that templated the strings — say,
  // s/Google Reviews/customer feedback/g — would silently turn every page into
  // a topical mismatch for its target query. No test in the registry-shape
  // block catches this because the strings would still be non-empty and
  // URL-safe. Pin "google" and "review" presence (case-insensitive) on the
  // three surfaces a search engine actually weights: <title>, <h1>, and the
  // description that ships into the SERP snippet.
  const containsBoth = (s: string) => {
    const lower = s.toLowerCase();
    return lower.includes("google") && lower.includes("review");
  };

  it("every metaTitle contains both 'google' and 'review' (case-insensitive)", () => {
    for (const v of SEO_VARIANTS) {
      expect(containsBoth(v.metaTitle)).toBe(true);
    }
  });

  it("every h1 contains both 'google' and 'review' (case-insensitive)", () => {
    for (const v of SEO_VARIANTS) {
      expect(containsBoth(v.h1)).toBe(true);
    }
  });

  it("every metaDescription contains both 'google' and 'review' (case-insensitive)", () => {
    for (const v of SEO_VARIANTS) {
      expect(containsBoth(v.metaDescription)).toBe(true);
    }
  });
});
