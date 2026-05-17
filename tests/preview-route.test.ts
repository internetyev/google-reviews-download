// Result-preview contract guard for app/preview/page.tsx (L2.5).
//
// The preview is the page the shared review tool lands on; four things are a
// contract a silent refactor could regress:
//
//   1. metadata.robots is noindex — the preview is per-query, throwaway URL
//      space and must never enter the index (the page exports a static
//      `metadata` with `robots: { index: false }`).
//   2. It shows the FIRST ≤ PREVIEW_COUNT (5) reviews — never more, even when
//      the fixture/upstream has hundreds.
//   3. The "total" it displays is `place.rating_count` (Google's canonical
//      count) and NOT a walk/fetch count (D-041/D-031). This is the subtle one:
//      with the small fixture rating_count(12) ≠ rendered rows(5); with the
//      large fixture rating_count(609) ≠ rows(5) ≠ full fixture length(500) —
//      so a regression to "count what we fetched/walked" can't hide behind a
//      coincidentally-equal number.
//   4. Missing / blank / unparseable `placeId` renders an error *card*, not a
//      thrown crash (the page must degrade, since the form can GET-navigate
//      here with anything a user pasted).
//
// PreviewPage is an async server component returning a React element tree. We
// have no react-dom in this harness, so instead of rendering we (a) walk the
// returned tree structurally to count `ReviewRow` elements and (b) invoke the
// pure, hookless sub-components to flatten the visible text. SF_API_KEY is
// neutralised per-test so createSemanticForceClient() always falls back to the
// committed FixtureClient (D-044 pattern) and the fixture is selected purely by
// the placeId we pass (pickFixture: *LARGE*→large, *MID*→mid, else→small).
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import PreviewPage, { metadata } from "@/app/preview/page";

// SF_API_KEY drives the client path (unset → FixtureClient). SF_API_BASE only
// matters when a key is present; clear both so no test can accidentally route a
// real call regardless of the host's ambient env.
const ENV_KEYS = ["SF_API_KEY", "SF_API_BASE"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// --- tiny tree utilities (no react-dom) -----------------------------------

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
// components. The ReviewRow elements are created directly in PreviewPage's
// returned tree (reviews.map(<ReviewRow/>)) and passed down as children, so
// they are reachable structurally — which lets us count them by component
// function name regardless of what the wrappers render.
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
    if (typeof el.type === "function" && (el.type as { name?: string }).name === name) n++;
  });
  return n;
}

// Text flatten: invoke pure, hookless function components so their inner text
// (place name, totals, error copy) becomes reachable. next/link's Link is a
// forwardRef object (typeof !== "function") so it is descended structurally,
// surfacing its child text without needing the next runtime.
function textOf(node: unknown): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isElement(node)) {
    const t = node.type;
    if (typeof t === "function") {
      try {
        return textOf((t as (p: unknown) => unknown)(node.props));
      } catch {
        return textOf(node.props?.children);
      }
    }
    return textOf(node.props?.children);
  }
  return "";
}

// textOf joins array children with a space, so JSX expression boundaries
// produce runs of whitespace ("First  5  of   609  reviews"). Collapse them
// before substring assertions so the tests check the visible words, not the
// incidental spacing of the flatten.
function norm(node: unknown): string {
  return textOf(node).replace(/\s+/g, " ").trim();
}

const mk = (sp: { placeId?: string; format?: string }) => ({
  searchParams: Promise.resolve(sp),
});

// --- metadata --------------------------------------------------------------

describe("preview metadata", () => {
  it("is noindex — a per-query throwaway URL must never be indexed", () => {
    expect(metadata.robots).toEqual({ index: false });
  });
});

// --- happy path: small fixture --------------------------------------------

describe("PreviewPage — small fixture (no SF_API_KEY)", () => {
  it("renders the place name and renders at most PREVIEW_COUNT (5) review rows", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const text = norm(tree);
    expect(text).toContain("Joe's Coffee");
    const rows = countByName(tree, "ReviewRow");
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(5);
    // small fixture has 12 reviews; preview must cap at 5, not show all 12.
    expect(rows).toBe(5);
  });

  it("shows the total as place.rating_count, not the rendered/fetched count (D-041)", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const text = norm(tree);
    const rows = countByName(tree, "ReviewRow");
    // small fixture: rating_count = 12, rendered rows = 5. The canonical total
    // (12) must appear; the fetched/rendered count (5) must not be presented
    // as the review total.
    expect(text).toMatch(/\b12\b/);
    expect(rows).toBe(5);
    expect(rows).not.toBe(12);
    expect(text).toContain("12 reviews on Google");
    expect(text).toContain("of 12 reviews");
  });
});

// --- ≤5 + total invariant under a large fixture ---------------------------

describe("PreviewPage — large fixture pins the ≤5 and rating_count invariants", () => {
  it("still renders exactly 5 rows while the total reflects rating_count (609), not the walk (500)", async () => {
    // placeId containing LARGE → pickFixture → large fixture (500 reviews,
    // rating_count 609). 5 ≠ 609 ≠ 500: a regression to "count what we
    // fetched/walked" cannot coincidentally match the displayed total here.
    const tree = await PreviewPage(mk({ placeId: "MOCK_LARGE_001" }));
    const text = norm(tree);
    expect(text).toContain("The Riverside Hotel");
    expect(countByName(tree, "ReviewRow")).toBe(5);
    expect(text).toContain("609 reviews on Google");
    expect(text).toContain("of 609 reviews");
    expect(text).not.toContain("of 500 reviews");
    expect(text).not.toContain("of 5 reviews");
  });
});

// --- degrade-not-crash: bad input -----------------------------------------

describe("PreviewPage — bad input renders an error card, never throws", () => {
  it("missing placeId → 'Nothing to preview'", async () => {
    const tree = await PreviewPage(mk({}));
    expect(textOf(tree)).toContain("Nothing to preview");
  });

  it("blank/whitespace placeId → 'Nothing to preview' (no crash)", async () => {
    const tree = await PreviewPage(mk({ placeId: "   " }));
    expect(textOf(tree)).toContain("Nothing to preview");
  });

  it("unparseable placeId (goo.gl short link, D-018) → 'That doesn't look like a place'", async () => {
    const tree = await PreviewPage(
      mk({ placeId: "https://maps.app.goo.gl/abc123" }),
    );
    const text = textOf(tree);
    expect(text).toContain("That doesn't look like a place");
    // it should NOT have reached the review-rendering path
    expect(countByName(tree, "ReviewRow")).toBe(0);
  });

  it("garbage placeId → error card, not a thrown exception", async () => {
    const tree = await PreviewPage(mk({ placeId: "not a place id at all" }));
    // any of the two error titles is fine; the contract is "no throw, an
    // error card rendered, zero review rows".
    expect(countByName(tree, "ReviewRow")).toBe(0);
    expect(textOf(tree).length).toBeGreaterThan(0);
  });
});
