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

// L19.1 deepening (D-076) — object-keys-surface freeze + per-Question freshness.
//
// The existing suite proves shape (@context/@type/mainEntity) and parity
// (acceptedAnswer.text == item.text). It does NOT freeze the *exact* set of
// keys at each level of the JSON-LD object — a refactor adding e.g.
// `url`, `inLanguage`, `dateModified`, or `publisher` at any level would
// pass every existing assertion but ship surplus structured data Google may
// flag (extra Question/Answer fields trigger "incorrect type" rich-result
// warnings) or fingerprint the page differently across builds. The
// established Phase 13/15/18 pattern (D-027/D-070/D-072/D-075) freezes
// `Object.keys(x).sort()` exactly — applied here to a JSON-LD payload
// instead of an HTTP envelope. Plus per-Question/per-Answer freshness,
// mirroring L18.1/D-075's "fresh object per call" idea but pushed one
// level deeper than the top-level object (any one nested Answer being a
// shared module-level constant would let a downstream mutation leak
// across every Question on the next call).

describe("faqJsonLd() — exact object-keys surface freeze (D-076)", () => {
  const ld = faqJsonLd();

  it("top-level keys are exactly {@context, @type, mainEntity}", () => {
    expect(Object.keys(ld).sort()).toEqual(["@context", "@type", "mainEntity"]);
  });

  it("every Question entry has exactly {@type, acceptedAnswer, name}", () => {
    expect(ld.mainEntity.length).toBeGreaterThan(0);
    for (const entity of ld.mainEntity) {
      expect(Object.keys(entity).sort()).toEqual([
        "@type",
        "acceptedAnswer",
        "name",
      ]);
    }
  });

  it("every acceptedAnswer has exactly {@type, text}", () => {
    for (const entity of ld.mainEntity) {
      expect(Object.keys(entity.acceptedAnswer).sort()).toEqual([
        "@type",
        "text",
      ]);
    }
  });
});

describe("faqJsonLd() — per-Question freshness (D-076)", () => {
  it("each Question object is a fresh allocation across calls (no shared nested constants)", () => {
    const a = faqJsonLd();
    const b = faqJsonLd();
    expect(a.mainEntity).toHaveLength(b.mainEntity.length);
    a.mainEntity.forEach((entity, i) => {
      // Reference inequality at the Question level — a refactor that hoisted
      // `const QUESTIONS = FAQ_ITEMS.map(...)` to module scope would pass
      // .toEqual() (still value-equal) but share mutable Question objects.
      expect(entity).not.toBe(b.mainEntity[i]);
      // And one level deeper at the Answer (the parity-load-bearing field).
      expect(entity.acceptedAnswer).not.toBe(b.mainEntity[i].acceptedAnswer);
    });
  });
});
