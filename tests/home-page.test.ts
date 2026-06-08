// Render-contract guard for app/page.tsx (L2.4/L3.3/D-041).
//
// The home page is pure composition: it owns no logic, it wires the shared
// tool and the shared FAQ together under a heading. Three things about that
// composition are load-bearing and each has a real regression it guards:
//
//   1. It renders exactly one <ReviewToolForm/> and exactly one <FaqSection/>.
//      Both are the *shared* components (the variant pages render the same
//      ones — see review-tool-form.test / faq-jsonld.test): if the home page
//      ever inlined its own form or FAQ copy, the surfaces would drift and the
//      D-040 visible/structured-data parity that faqJsonLd() relies on would
//      no longer be guaranteed from this page. Counting by component-function
//      name (structural walk, D-050) catches an inline-copy regression.
//
//   2. The page exports **no** `metadata` of its own — it inherits the root
//      layout's static metadata (app/layout.tsx). That is deliberate: the home
//      page is the site root, so its title/description *are* the layout's, and
//      a stray `export const metadata` here would silently shadow the layout
//      and is the exact shape of an accidental-divergence bug. We pin the
//      absence of a page-level override AND assert the inherited layout
//      metadata still carries the expected non-empty title + a description
//      that names the export formats (the effective home-page metadata).
//
//   3. No stale "ships in L2.5" placeholder text survives anywhere in the
//      rendered tree. D-041 removed that placeholder from both the home page
//      and the variant route when the preview flow landed; this pins that it
//      stays gone. Proven by a deep flatten that invokes the pure, hookless
//      sub-components (ReviewToolForm, FaqSection, and the FAQ items' rich-JSX
//      `a` nodes) and collects every visible string — a regression that
//      reintroduced the placeholder, in this page or in a shared component it
//      pulls in, fails here.
//
// `HomePage` is a pure, synchronous, hookless component; ReviewToolForm and
// FaqSection are likewise pure/hookless (no async, no searchParams, no DOM),
// so the whole tree is reachable by invoking function components directly —
// the same no-react-dom technique as the variant-page / review-tool-form /
// preview-route suites (D-050). No render, no DOM, no mocks.
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect } from "vitest";
import HomePage from "@/app/page";
import * as homePageModule from "@/app/page";
import { metadata as layoutMetadata } from "@/app/layout";

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

// Structural walk: descend props.children WITHOUT invoking function
// components. Used to count the shared components by their function name as
// they sit directly in HomePage's returned tree (D-050 structural walk).
function eachElement(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) eachElement(n, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  eachElement(node.props?.children, visit);
}

function countByName(root: unknown, name: string): number {
  let n = 0;
  eachElement(root, (el) => {
    if (typeof el.type === "function" && (el.type as { name?: string }).name === name) {
      n++;
    }
  });
  return n;
}

// Deep flatten: collect every visible string in the tree, INVOKING pure
// hookless function components (ReviewToolForm, FaqSection, and any nested
// component) so their text is reachable too. The components used here take no
// required props and call no hooks, so a direct invoke is safe (D-050 deep
// flatten, same as the preview-route suite).
function collectText(node: unknown, out: string[], depth = 0): void {
  if (depth > 50) return; // cheap cycle/runaway guard
  if (node == null || node === false || node === true) return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectText(n, out, depth);
    return;
  }
  if (!isElement(node)) return;
  if (typeof node.type === "function") {
    // Pure, hookless component — invoke and recurse into its output.
    let rendered: unknown;
    try {
      rendered = (node.type as (p: unknown) => unknown)(node.props ?? {});
    } catch {
      rendered = node.props?.children;
    }
    collectText(rendered, out, depth + 1);
    return;
  }
  collectText(node.props?.children, out, depth + 1);
}

const tree = HomePage();
const visibleText = (() => {
  const parts: string[] = [];
  collectText(tree, parts);
  return parts.join(" ");
})();

// --- composition: the shared components ------------------------------------

describe("HomePage — shared-component composition", () => {
  it("renders exactly one shared <ReviewToolForm/>", () => {
    // Exactly one, by component name: an inlined home-only form (instead of
    // the shared component the variant pages also use) would read as 0 here.
    expect(countByName(tree, "ReviewToolForm")).toBe(1);
  });

  it("renders exactly one shared <FaqSection/>", () => {
    // The same FaqSection faqJsonLd() mirrors (D-040 parity). Inlined FAQ
    // copy on the home page would drift from the structured data and trip 0.
    expect(countByName(tree, "FaqSection")).toBe(1);
  });

  it("returns a single <main> landmark wrapping the page", () => {
    const mains: El[] = [];
    eachElement(tree, (el) => {
      if (el.type === "main") mains.push(el);
    });
    expect(mains).toHaveLength(1);
  });
});

// --- metadata: inherited from the root layout, not shadowed here -----------

describe("HomePage — metadata is the inherited layout metadata", () => {
  it("app/page.tsx exports NO metadata of its own (no silent shadow)", () => {
    // The home page is the site root: its effective metadata IS the layout's.
    // A stray `export const metadata` here would shadow the layout and is the
    // exact shape of an accidental-divergence bug — pin its absence.
    expect("metadata" in homePageModule).toBe(false);
    expect(
      (homePageModule as { metadata?: unknown }).metadata,
    ).toBeUndefined();
  });

  it("the inherited layout metadata has the expected title + description", () => {
    expect(typeof layoutMetadata.title).toBe("string");
    expect((layoutMetadata.title as string).length).toBeGreaterThan(0);
    expect(layoutMetadata.title).toBe("google-reviews-download");

    const desc = layoutMetadata.description;
    expect(typeof desc).toBe("string");
    expect((desc as string).length).toBeGreaterThan(0);
    // The effective home-page description must still name what the tool does
    // (the export formats) — a content gut that dropped this is a real
    // SEO-surface regression for the site root.
    expect(desc as string).toMatch(/CSV/i);
    expect(desc as string).toMatch(/JSON/i);
    expect(desc as string).toMatch(/XLSX/i);
  });
});

// --- no stale L2.5 placeholder anywhere in the rendered tree ---------------

describe("HomePage — D-041 placeholder stays gone", () => {
  it('renders no "ships in L2.5" (or any L2.5) placeholder text', () => {
    // D-041 removed the "result preview ships in L2.5" placeholder from the
    // home page and the variant route when the real preview flow landed. The
    // deep flatten reaches text inside the shared components too, so a
    // regression that reintroduced it here OR in ReviewToolForm/FaqSection
    // fails this assertion.
    expect(visibleText).not.toMatch(/ships in L2\.5/i);
    expect(visibleText).not.toMatch(/\bL2\.5\b/);
    expect(visibleText.toLowerCase()).not.toContain("placeholder");
    expect(visibleText.toLowerCase()).not.toContain("coming soon");
  });

  it("still renders real product copy (flatten reached actual text)", () => {
    // Guards the guard: if collectText silently produced nothing, the
    // negative assertions above would pass vacuously. Pin a stable phrase
    // from the home header so an empty flatten fails loudly instead.
    expect(visibleText).toMatch(/download every\s+review/i);
  });
});

// --- D-078 (L21.1): module export surface, per-call freshness, main-as-root --

// (a) Pins the `app/page.tsx` module's *exact* named-export surface. The
//     existing `"metadata" in homePageModule` check catches a `metadata`
//     shadow but does not catch a surplus `export const dynamic`/`revalidate`/
//     `runtime`/`fetchCache` — each of which silently changes the home page's
//     SSG/ISR/runtime contract without altering the rendered output. Symmetric
//     with L18.1/D-075's variant-route exact-surface pin and L20.1/D-077's
//     faq-module exact-surface pin, here applied to the home route module.
describe("HomePage — module's named-export surface is exactly { default }", () => {
  it("Object.keys(homePageModule).sort() is exactly [\"default\"]", () => {
    expect(Object.keys(homePageModule).sort()).toEqual(["default"]);
  });
});

// (b) Pins that HomePage() returns a *fresh* element tree per call. A `const
//     TREE = (<main>...</main>); export default function HomePage() { return
//     TREE; }` "avoid the allocation" refactor would freeze the tree at
//     module-load and let any downstream reconciler/test/dev-tools mutation
//     leak across renders. `.toEqual()` cannot catch this because the structures
//     remain equal; only identity comparison does. Mirrors L20.1/D-077's
//     `FaqSection` and L19.1/D-076's per-Question/per-Answer freshness pins,
//     pushed onto the home page's own returned tree.
//
//     Two its on purpose: a hoist of the *whole* tree fails the first; a hoist
//     of just the inner children array (root element re-allocated, children
//     reused) fails the second.
describe("HomePage — returns a fresh element tree per call", () => {
  it("two calls return reference-distinct root <main> elements", () => {
    const a = HomePage();
    const b = HomePage();
    expect(a).not.toBe(b);
  });

  it("two calls return reference-distinct nth direct children of <main>", () => {
    const a = HomePage() as unknown as El;
    const b = HomePage() as unknown as El;
    const aChildren = a.props?.children as unknown[];
    const bChildren = b.props?.children as unknown[];
    expect(Array.isArray(aChildren)).toBe(true);
    expect(Array.isArray(bChildren)).toBe(true);
    expect(aChildren.length).toBe(bChildren.length);
    expect(aChildren.length).toBeGreaterThan(0);
    // Identity-inequality on every direct child of <main>: a children-array
    // hoist that reused the inner nodes would pass the root check above and
    // fail here. We check each child so a hoist of *any* subset of children
    // is caught.
    for (let i = 0; i < aChildren.length; i++) {
      expect(aChildren[i]).not.toBe(bChildren[i]);
    }
  });
});

// (c) Pins that <main> is the *outermost* returned element, not just *present*.
//     The existing `mains.length === 1` count passes whether <main> sits at the
//     root or is wrapped in any <div>/<Fragment>/other landmark — wrapping it
//     silently weakens the AT-walk-to-outermost-landmark contract and the
//     Next 15 App-Router "the page IS the main" idiom.
describe("HomePage — <main> is the outermost returned element", () => {
  it("the returned root is literally an element (not array/Fragment/string)", () => {
    // Negative side of the pin: a refactor that returned a Fragment (`<>...</>`)
    // or a bare array of siblings would still walk fine with eachElement but
    // would not be an outermost <main>. isElement(tree) catches arrays and
    // primitives; the next it pins the element's type itself.
    expect(Array.isArray(tree)).toBe(false);
    expect(isElement(tree)).toBe(true);
  });

  it("(tree as El).type === \"main\" (root is the <main> node itself)", () => {
    // A `<div><main>...</main></div>` or `<><main>...</main></>` wrapper would
    // still satisfy `mains.length === 1` from the composition describe — only
    // this identity check pins that the page IS the <main>.
    expect((tree as unknown as El).type).toBe("main");
  });
});
