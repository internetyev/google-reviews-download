// Render-contract guard for FaqSection() in app/_components/faq.tsx
// (L3.2b / L3.3).
//
// faq.tsx is the single source of truth for both the visible FAQ accordion
// (<FaqSection />) and the FAQPage JSON-LD (faqJsonLd()). The parity invariant
// — structured answer === plain-text mirror of the visible answer — is pinned
// in tests/faq-jsonld.test.ts (item.text → ld.mainEntity[].acceptedAnswer.text).
//
// That suite never invokes FaqSection itself, so two load-bearing pieces of
// the contract are unguarded:
//
//   1. The accessible-name pair: <section aria-labelledby="faq-heading"> +
//      <h2 id="faq-heading">FAQ</h2>. If either side drifts, aria-labelledby
//      silently loses its target and the visible heading dissociates from the
//      region — a screen-reader regression no JSON-LD test would catch.
//
//   2. The divergence-by-design: on-page the body renders the *rich* JSX
//      (`item.a`, with <code>429</code> etc.); the JSON-LD ships the *plain*
//      mirror (`item.text`). A refactor that swapped FaqSection to render
//      item.text would collapse the two paths into one — on the rate-limits
//      FAQ that means "429"/"Retry-After" stop being code-styled — and the
//      failure is invisible to the parity suite (both still contain the
//      digits, just with no inline <code> formatting on the page).
//
// FaqSection is pure, synchronous, hookless, and composes only intrinsic JSX
// elements (section/h2/div/details/summary/span/p) plus item.a's intrinsics
// (<> Fragment + <code>), so it is invoked directly and the returned element
// tree walked structurally — the same no-react-dom technique as the
// review-tool-form / variant-page / root-layout suites (D-050).
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040/D-042 posture, same as the other suites).

import { describe, it, expect } from "vitest";
import { FAQ_ITEMS, FaqSection } from "@/app/_components/faq";

// --- tiny tree utilities (no react-dom; same shape as review-tool-form.test) -

type El = { $$typeof: symbol; type: unknown; props: Record<string, unknown> };

function isElement(x: unknown): x is El {
  return (
    x != null &&
    typeof x === "object" &&
    "$$typeof" in (x as object) &&
    "props" in (x as object)
  );
}

function eachElement(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) eachElement(n, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  eachElement(node.props?.children, visit);
}

function findAll(root: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  eachElement(root, (el) => {
    if (pred(el)) out.push(el);
  });
  return out;
}

// Flatten visible text from an element tree by descending children. FaqSection
// composes only intrinsics + Fragment + <code>, so a structural descent reaches
// every leaf string without invoking any function component. JSX text entities
// (&apos;, &amp;) are parsed by the JSX runtime into real glyphs before the
// string leaves the element, so the flatten reads as real prose.
function visibleText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (isElement(node)) return visibleText(node.props?.children);
  return "";
}

const tree = FaqSection();

// --- region shell + accessible labelling -----------------------------------

describe("FaqSection — region shell + accessible labelling", () => {
  it("returns exactly one <section> with the documented aria-labelledby", () => {
    const sections = findAll(tree, (el) => el.type === "section");
    expect(sections).toHaveLength(1);
    expect(sections[0].props["aria-labelledby"]).toBe("faq-heading");
  });

  it("pairs the reference with exactly one <h2 id='faq-heading'>FAQ</h2>", () => {
    // aria-labelledby silently fails if the referenced id no longer exists,
    // so we pin both ends: the reference (above) AND the target (here). A
    // refactor that renamed the id on either side would land in dev unnoticed.
    const h2s = findAll(tree, (el) => el.type === "h2");
    expect(h2s).toHaveLength(1);
    expect(h2s[0].props.id).toBe("faq-heading");
    expect(visibleText(h2s[0]).trim()).toBe("FAQ");
  });
});

// --- one <details> per FAQ_ITEMS, in order ---------------------------------

describe("FaqSection — one <details> per FAQ_ITEMS, in surfaced order", () => {
  const detailsEls = findAll(tree, (el) => el.type === "details");

  it("renders exactly FAQ_ITEMS.length <details> entries", () => {
    expect(detailsEls).toHaveLength(FAQ_ITEMS.length);
  });

  it("matches FAQ_ITEMS order: nth <summary> contains the nth item.q", () => {
    // Same check-order spirit as L6.5/D-046 — pinning the order the user sees
    // so a reordering refactor that desyncs visible accordion order from the
    // JSON-LD's `mainEntity` order (faq-jsonld.test pins the JSON-LD order)
    // fails loudly here.
    detailsEls.forEach((d, i) => {
      const summaries = findAll(d, (el) => el.type === "summary");
      expect(summaries).toHaveLength(1);
      // visibleText collapses the chevron span + the question into one string,
      // so we substring-match — the question text must be present, regardless
      // of decorative siblings.
      expect(visibleText(summaries[0])).toContain(FAQ_ITEMS[i].q);
    });
  });

  it("entries default closed (accordion contract — no stray `open` prop)", () => {
    // A stray `open` on any <details> would ship the whole FAQ expanded by
    // default — a layout regression the design explicitly does not want.
    for (const d of detailsEls) {
      expect(d.props.open).toBeFalsy();
    }
  });
});

// --- rich JSX (item.a) is what renders, not the plain mirror (item.text) ---

describe("FaqSection — visible body uses rich JSX (item.a), not plain text", () => {
  // The divergence-by-design: on-page renders item.a (rich JSX, including
  // <code> for the rate-limits item); the JSON-LD ships item.text (plain
  // string). A refactor that swapped FaqSection to render item.text would
  // silently collapse the two paths — the rate-limits FAQ would lose its
  // inline <code> formatting on "429" / "Retry-After" — and the parity suite
  // would NOT catch it (both copies contain the digits as substrings).
  const detailsEls = findAll(tree, (el) => el.type === "details");

  it("renders a <code> element from the rate-limits item's rich JSX", () => {
    // FAQ_ITEMS[2] is the "What about rate limits?" entry — its `a` field is
    // the rich JSX that contains <code>429</code> and <code>Retry-After</code>.
    // Only item.a carries <code> markup; item.text is a plain string. Finding
    // at least one <code> inside the third <details> proves the rich path is
    // the one rendered.
    expect(detailsEls).toHaveLength(FAQ_ITEMS.length);
    const codes = findAll(detailsEls[2], (el) => el.type === "code");
    expect(codes.length).toBeGreaterThan(0);
  });

  it("visible text reads as real glyphs, not surviving HTML entities", () => {
    // Guard-the-guard: the JSX source uses &apos; / &amp;, but the JSX runtime
    // converts those to ' / & before they leave the element. If the flatten
    // surfaces a bare entity, either the flatten regressed (vacuous walk) or
    // FaqSection started stringifying item.a naively — both are silent fails
    // worth catching here.
    const flattened = visibleText(tree);
    expect(flattened.length).toBeGreaterThan(0);
    expect(flattened).not.toContain("&apos;");
    expect(flattened).not.toContain("&amp;");
    expect(flattened).not.toContain("&quot;");
  });
});
