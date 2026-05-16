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
  it("holds the ten L1.6a candidates", () => {
    expect(SEO_VARIANTS).toHaveLength(10);
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

  it("stays inert until L3.1b flips the corgi-picked top 5", () => {
    // Documents the pre-L3.1b state: nothing is live yet (gated on L1.6b).
    // When L3.1b lands this assertion is the intended, reviewed change.
    expect(publishedVariants()).toHaveLength(0);
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
