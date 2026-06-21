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

// Anchor walk (L16.1): invoke function components so we can reach the <a>
// elements that DownloadCta emits past the wrapper, then collect every
// intrinsic <a> element (type-string equality, distinct from function
// components by JS type). next/link's Link is a forwardRef object so it is
// descended structurally; its inner anchor (when rendered by the next
// runtime) is not reached here, but the DownloadCta hrefs use plain <a>, so
// every URL under test is reachable.
function collectAnchors(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collectAnchors(n, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (node.type === "a") out.push(node);
  if (typeof node.type === "function") {
    try {
      collectAnchors(
        (node.type as (p: unknown) => unknown)(node.props),
        out,
      );
    } catch {
      collectAnchors(node.props?.children, out);
    }
    return out;
  }
  collectAnchors(node.props?.children, out);
  return out;
}

function firstApiReviewsHref(root: unknown): string {
  const anchors = collectAnchors(root);
  for (const a of anchors) {
    const href = a.props?.href;
    if (typeof href === "string" && href.startsWith("/api/reviews?")) return href;
  }
  throw new Error("no /api/reviews anchor found in tree");
}

function apiReviewsHrefs(root: unknown): string[] {
  return collectAnchors(root)
    .map((a) => a.props?.href)
    .filter((h): h is string => typeof h === "string" && h.startsWith("/api/reviews?"));
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

// L16.1 (a): metadata exact-shape — the surplus-keys threat. A refactor
// adding metadata.openGraph / metadata.twitter / metadata.alternates would
// surface the per-query throwaway URL into shared-link previews (still
// embedded by social-graph crawlers regardless of robots.txt) and into
// rel=canonical (which overrides the noindex intent for crawlers that
// honour it above robots). Pin the top-level shape AND the title literal
// so a "rename the browser tab" change is loud, not silent. Symmetric with
// L13.2/L15.1's Object.keys(body).sort() envelope pins.
describe("preview metadata — exact shape (L16.1)", () => {
  it("Object.keys(metadata).sort() is exactly ['robots','title'] — no surplus OG/Twitter/alternates", () => {
    expect(Object.keys(metadata).sort()).toEqual(["robots", "title"]);
  });

  it("metadata.title is exactly 'Review preview' — the documented browser-tab label", () => {
    expect(metadata.title).toBe("Review preview");
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

// --- L16.1 (b): DownloadCta deep-link URL contract ------------------------
//
// DownloadCta builds `/api/reviews?placeId=<encoded>&format=<fmt>` and
// orders the anchors as [preferred, ...others]. Two regressions a refactor
// could land silently without breaking any existing assertion:
//
//   (i) primary CTA shows the wrong format — `ordered = [preferred, ...]`
//       puts the user's preferred format first; flip to "always csv first"
//       or "preferred always last" and every shared link's primary CTA is
//       silently downgraded.
//
//   (ii) `encodeURIComponent` dropped — a paste like `placeId=ChIJ&format=xlsx`
//       reaches /api/reviews as two parsed pairs (`malicious=true` style),
//       breaking the route contract while every preview still "works".

describe("PreviewPage — DownloadCta deep-link URL contract (L16.1)", () => {
  for (const fmt of ["csv", "json", "xlsx", "md"] as const) {
    it(`preferred format=${fmt} is the primary anchor, others follow`, async () => {
      const tree = await PreviewPage(
        mk({ placeId: "MOCK_SMALL_001", format: fmt }),
      );
      const hrefs = apiReviewsHrefs(tree);
      // expect exactly 4 anchors (one per supported format), preferred first.
      expect(hrefs.length).toBe(4);
      expect(hrefs[0]).toContain(`format=${fmt}`);
      // the three secondary anchors are the remaining formats; each appears
      // exactly once — pin the "filter doesn't double-emit / doesn't drop"
      // contract on the secondary slice.
      const rest = ["csv", "json", "xlsx", "md"].filter((f) => f !== fmt);
      const secondaryFormats = hrefs.slice(1).map((h) => {
        const m = /format=([a-z]+)/.exec(h);
        return m ? m[1] : "";
      });
      expect(secondaryFormats.sort()).toEqual([...rest].sort());
    });
  }

  it("placeId carrying & and = is percent-encoded — `&format=` paste cannot inject", async () => {
    // The CTA href uses the RAW original input (the page passes `rawInput`,
    // not `normalised.raw`, to DownloadCta) so the encoder is the only
    // thing standing between the paste and the receiving /api/reviews
    // route. We pick a string that PASSES normalisePlaceId (the regex
    // finds `MOCK_SMALL_001` inside) AND carries `&` and `=` so the
    // encoder's effect is visible — the original `&malicious=true` survives
    // in rawInput, the encoder must turn `&` → `%26` and `=` → `%3D`.
    const tree = await PreviewPage(
      mk({ placeId: "MOCK_SMALL_001&malicious=true" }),
    );
    const hrefs = apiReviewsHrefs(tree);
    expect(hrefs.length).toBe(4);
    // Every emitted href must have its `placeId=` value encoded. A
    // regression dropping encodeURIComponent would produce
    // `placeId=MOCK_SMALL_001&malicious=true` (literal `&` and `=`), which
    // the URL parser at /api/reviews would split into
    // {placeId: "MOCK_SMALL_001", malicious: "true"} — placeId truncated
    // silently, the CTA broken, no test signal today.
    for (const href of hrefs) {
      expect(href).toContain("placeId=MOCK_SMALL_001%26malicious%3Dtrue");
      // and the literal-injection form must NOT appear:
      expect(href).not.toContain("placeId=MOCK_SMALL_001&malicious=true");
    }
  });
});

// --- L16.1 (c): `format` searchParam validation default -------------------
//
// `preferred: Format = isFormat(formatRaw) ? formatRaw : "csv"`. The
// existing 8-it suite never passes a `format` searchParam, so all four
// branches of this expression are unguarded. A refactor to
// `formatRaw ?? "csv"` drops the SUPPORTED_FORMATS gate and lets bogus
// formats reach /api/reviews (which 400s on the click — silent UX
// regression from "we picked a default" to "you typed a bad format and now
// the CTA is dead"). Case sensitivity is a documented asymmetry with the
// /api/reviews route (which lowercases before validating, L15.1); pinning
// the case-sensitive default here makes a "harmonise to case-insensitive"
// cleanup loud, not silent.

describe("PreviewPage — format validation default (L16.1)", () => {
  it("no format searchParam → primary CTA defaults to csv", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const primary = firstApiReviewsHref(tree);
    expect(primary).toContain("format=csv");
  });

  it("format=garbage → primary CTA falls back to csv (validation, not pass-through)", async () => {
    const tree = await PreviewPage(
      mk({ placeId: "MOCK_SMALL_001", format: "garbage" }),
    );
    const primary = firstApiReviewsHref(tree);
    expect(primary).toContain("format=csv");
    // and the bogus token must not have leaked into the URL anywhere.
    expect(primary).not.toContain("garbage");
  });

  it("format=xlsx (valid) → primary CTA passes through as xlsx", async () => {
    const tree = await PreviewPage(
      mk({ placeId: "MOCK_SMALL_001", format: "xlsx" }),
    );
    const primary = firstApiReviewsHref(tree);
    expect(primary).toContain("format=xlsx");
  });

  it("format=md (valid, L37.3) → primary CTA passes through as md", async () => {
    // `md` is the L37.3 Markdown testimonials format; isFormat now accepts it
    // so the form's `format=md` rides through to the download CTA verbatim.
    const tree = await PreviewPage(
      mk({ placeId: "MOCK_SMALL_001", format: "md" }),
    );
    const primary = firstApiReviewsHref(tree);
    expect(primary).toContain("format=md");
  });

  it("format=markdown (the API alias) → primary CTA falls back to csv (preview accepts only the canonical `md`)", async () => {
    // The route accepts both `md` and the `markdown` alias (L37.2), but the
    // preview's isFormat gate is canonical-only and case-sensitive — the same
    // documented asymmetry as `CSV` above. The form only ever submits the
    // short `md`, so this is a manual-URL edge: `markdown` is not a SUPPORTED_
    // FORMATS member, so preferred falls back to csv rather than leaking a
    // token the gate doesn't recognise.
    const tree = await PreviewPage(
      mk({ placeId: "MOCK_SMALL_001", format: "markdown" }),
    );
    const primary = firstApiReviewsHref(tree);
    expect(primary).toContain("format=csv");
    expect(primary).not.toContain("format=markdown");
  });

  it("format=CSV (upper-case) → primary CTA falls back to csv (isFormat is case-sensitive)", async () => {
    // SUPPORTED_FORMATS members are lowercase ("csv"/"json"/"xlsx") and
    // isFormat checks `.includes(s)` without normalising — so "CSV" is NOT
    // a valid Format value and falls through to the csv default. This is
    // the inverse of /api/reviews's case-insensitive `format` handling
    // (L15.1); the asymmetry is documented, the pin makes a "harmonise
    // everything" cleanup loud rather than silent.
    const tree = await PreviewPage(
      mk({ placeId: "MOCK_SMALL_001", format: "CSV" }),
    );
    const primary = firstApiReviewsHref(tree);
    expect(primary).toContain("format=csv");
    // and the upper-case form did not leak through:
    expect(primary).not.toContain("format=CSV");
  });
});
