// Regression guard for app/_components/faq.tsx (L3.2b / L3.3).
//
// faq.tsx is the single source of truth for both the visible <FaqSection />
// accordion and the FAQPage JSON-LD emitted on the home + variant pages.
// Google requires the structured data to mirror the FAQ content that is
// actually visible. faq.tsx enforces this structurally by deriving both from
// one FAQ_ITEMS array where each item carries `a` (rich JSX, on-page) and
// `text` (plain string, JSON-LD). This suite pins that contract so a refactor
// cannot reintroduce drift:
//   - faqJsonLd() is a valid schema.org FAQPage (@context/@type/mainEntity),
//   - one Question per FAQ_ITEMS entry, in order, with the right name,
//   - acceptedAnswer.text is *exactly* item.text — and item.text is genuine
//     plain prose (no HTML tags, no unescaped JSX entities like &apos;),
//   - the object JSON-round-trips unchanged (it ships via JSON.stringify into
//     a <script type="application/ld+json">).
//
// Imports the .tsx module directly; vitest.config.ts sets esbuild automatic
// JSX so the module-level JSX in each item's `a` field evaluates harmlessly
// (we never render it here). Committed, not run in-routine — no node_modules;
// runs on `npm install && npm test` (D-039/D-040/D-042 posture).

import { describe, it, expect } from "vitest";
import { FAQ_ITEMS, faqJsonLd } from "@/app/_components/faq";

describe("FAQ_ITEMS — source-of-truth shape", () => {
  it("has at least the three L3.3 entries", () => {
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(3);
  });

  it("every item carries a non-empty question and plain-text answer", () => {
    for (const item of FAQ_ITEMS) {
      expect(typeof item.q).toBe("string");
      expect(item.q.trim().length).toBeGreaterThan(0);
      expect(typeof item.text).toBe("string");
      expect(item.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("the plain-text mirror is genuine prose, not leaked markup", () => {
    for (const item of FAQ_ITEMS) {
      // No HTML/JSX tags survived into the structured-data string.
      expect(item.text).not.toMatch(/<[^>]+>/);
      // JSX uses &apos;/&amp; entities; the plain mirror must use real glyphs
      // so the JSON-LD answer reads as Google will index it.
      expect(item.text).not.toContain("&apos;");
      expect(item.text).not.toContain("&amp;");
      expect(item.text).not.toContain("&quot;");
    }
  });

  it("questions are unique (no duplicate FAQ entries)", () => {
    const qs = FAQ_ITEMS.map((i) => i.q);
    expect(new Set(qs).size).toBe(qs.length);
  });
});

describe("faqJsonLd() — schema.org FAQPage contract", () => {
  const ld = faqJsonLd();

  it("declares the FAQPage context and type", () => {
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("FAQPage");
  });

  it("mainEntity has exactly one Question per FAQ_ITEMS entry, in order", () => {
    expect(Array.isArray(ld.mainEntity)).toBe(true);
    expect(ld.mainEntity).toHaveLength(FAQ_ITEMS.length);

    ld.mainEntity.forEach((entity, i) => {
      const item = FAQ_ITEMS[i];
      expect(entity["@type"]).toBe("Question");
      expect(entity.name).toBe(item.q);
      expect(entity.acceptedAnswer["@type"]).toBe("Answer");
      // The parity invariant: structured answer === the plain-text mirror
      // that backs the visible <FaqSection />. If these ever diverge, the
      // page ships FAQPage markup Google can flag as not matching content.
      expect(entity.acceptedAnswer.text).toBe(item.text);
    });
  });

  it("round-trips through JSON unchanged (it ships via JSON.stringify)", () => {
    const roundTripped = JSON.parse(JSON.stringify(ld));
    expect(roundTripped).toEqual(ld);
  });

  it("is a fresh object each call (no shared mutable state)", () => {
    const a = faqJsonLd();
    const b = faqJsonLd();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
