// Render-contract guard for app/(seo)/[variant]/page.tsx (L3.1a infrastructure).
//
// The variant route ships *inert*: D-039 promises "nothing is indexable until a
// human-vetted volume pass (L3.1b) clears it." That promise is structural —
// the route resolves slugs through `findPublishedVariant` and 404s anything not
// `published: true`, and every registry entry is `published: false` until
// L3.1b. This suite pins that inert posture from both sides so a refactor that
// quietly widened the lookup (e.g. `SEO_VARIANTS.find` instead of
// `findPublishedVariant`, or dropping the `published` filter) ships ten live,
// indexable 404-shaped pages and fails loudly here instead of silently going
// public before the volume pass:
//
//   1. `dynamicParams === false` — unknown slugs are a hard 404, not an
//      on-demand render.
//   2. `generateStaticParams()` is exactly `publishedVariants()` mapped to
//      `{ variant: slug }` — empty pre-L3.1b. This is the assertion that flips
//      when L3.1b publishes the corgi-picked top-5 (mirrors the seo-variants
//      and seo-routes suites' pre-L3.1b note, D-044): the length change is then
//      the intended, reviewed change.
//   3. `generateMetadata` returns `{}` for every current slug (a real registry
//      slug that is `published: false`, plus a garbage slug) — never stale or
//      partial metadata for a page that does not exist.
//   4. `VariantPage` calls `notFound()` for every current slug — proven by the
//      thrown Next not-found sentinel, with zero `ReviewToolForm`/`FaqSection`
//      rendered (the render path must not be reached at all).
//
// Pre-L3.1b the *published* render path (h1/intro from the registry +
// `<ReviewToolForm/>` + `<FaqSection/>` + the FAQPage JSON-LD `<script>`) is
// not reachable through the real module: nothing is `published`, and this
// suite is deliberately no-mock and does not mutate the frozen `SEO_VARIANTS`
// registry (the D-044/D-048 "document the gap, don't hack the test" posture).
// Closing it is an L3.1b-era leaf — once a variant is `published`, the same
// structural-walk + pure-component-flatten technique used by the preview-route
// suite (D-050) applies directly. The limitation is documented, not worked
// around, so the failure mode is understood rather than mysterious.
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect } from "vitest";
import VariantPage, {
  dynamicParams,
  generateStaticParams,
  generateMetadata,
} from "@/app/(seo)/[variant]/page";
import * as variantRouteModule from "@/app/(seo)/[variant]/page";
import { SEO_VARIANTS, publishedVariants } from "@/lib/seo/variants";

// A real registry slug that is still `published: false` (Tier-2): the route
// must treat it as nonexistent exactly like an unknown slug. A published
// (Tier-1) slug must render. Derived from the registry so they stay correct as
// the published set changes.
const REAL_UNPUBLISHED_SLUG = SEO_VARIANTS.find((v) => !v.published)!.slug;
const REAL_PUBLISHED_SLUG = SEO_VARIANTS.find((v) => v.published)!.slug;
const GARBAGE_SLUG = "not-a-real-variant-xyz";

const mkParams = (slug: string) => ({ params: Promise.resolve({ variant: slug }) });

// --- tiny tree utilities (no react-dom; same shape as preview-route.test) ---

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

function countByName(root: unknown, name: string): number {
  let n = 0;
  eachElement(root, (el) => {
    if (typeof el.type === "function" && (el.type as { name?: string }).name === name) n++;
  });
  return n;
}

// notFound() throws a sentinel error. Across Next 15.x its marker is exposed as
// `error.digest` ("NEXT_NOT_FOUND" or the newer "NEXT_HTTP_ERROR_FALLBACK;404")
// — assert the throw unconditionally and, when a digest is present, that it is
// a not-found one. Tolerant on the exact string (D-043 freeze-guard precedent)
// so a Next bump that renames the sentinel doesn't false-fail the real
// contract, which is "this slug does not render a page".
async function expectNotFound(slug: string): Promise<void> {
  let threw = false;
  let caught: unknown;
  try {
    await VariantPage(mkParams(slug));
  } catch (e) {
    threw = true;
    caught = e;
  }
  expect(threw).toBe(true);
  const digest = (caught as { digest?: unknown })?.digest;
  if (typeof digest === "string") {
    expect(digest).toMatch(/NOT_FOUND|404/);
  }
}

// --- dynamicParams ---------------------------------------------------------

describe("variant route — dynamicParams", () => {
  it("is false so any slug outside generateStaticParams is a hard 404", () => {
    expect(dynamicParams).toBe(false);
  });
});

// --- generateStaticParams (the pre-L3.1b assertion that flips at L3.1b) -----

describe("variant route — generateStaticParams", () => {
  it("enumerates exactly publishedVariants() as { variant: slug }", () => {
    const pub = publishedVariants();
    const params = generateStaticParams();
    expect(params).toEqual(pub.map((v) => ({ variant: v.slug })));
  });

  it("enumerates the live Tier-1 set (L3.1b landed — 8 published)", () => {
    expect(generateStaticParams().length).toBe(publishedVariants().length);
    expect(generateStaticParams().length).toBeGreaterThan(0);
  });

  it.skip("is empty pre-L3.1b — superseded by L3.1b (kept for history)", () => {
    // Paired with the publishedVariants() length, mirroring the seo-variants /
    // seo-routes suites: when L3.1b flips the corgi-picked top-5 to published,
    // BOTH numbers change together and this is the intended, reviewed change.
    expect(publishedVariants()).toHaveLength(0);
    expect(generateStaticParams()).toHaveLength(0);
  });
});

// --- generateMetadata ------------------------------------------------------

describe("variant route — generateMetadata for a non-existent page", () => {
  it("returns {} for a real but unpublished registry slug", async () => {
    const meta = await generateMetadata(mkParams(REAL_UNPUBLISHED_SLUG));
    expect(meta).toEqual({});
  });

  it("returns {} for a garbage slug", async () => {
    const meta = await generateMetadata(mkParams(GARBAGE_SLUG));
    expect(meta).toEqual({});
  });
});

// --- VariantPage 404s every current slug -----------------------------------

describe("variant route — VariantPage publish gate (L3.1b)", () => {
  it("calls notFound() for a real but unpublished (Tier-2) registry slug", async () => {
    await expectNotFound(REAL_UNPUBLISHED_SLUG);
  });

  it("calls notFound() for a garbage slug", async () => {
    await expectNotFound(GARBAGE_SLUG);
  });

  it("404s every UNPUBLISHED slug, renders every PUBLISHED one (the gate)", async () => {
    // The core gate guard: a regression that widened the lookup past the
    // `published` flag would render a Tier-2 slug; one that narrowed it would
    // 404 a live page. Check both sides against the registry's own flags.
    for (const v of SEO_VARIANTS) {
      if (v.published) {
        const tree = await VariantPage(mkParams(v.slug));
        expect(countByName(tree, "ReviewToolForm")).toBe(1);
      } else {
        await expectNotFound(v.slug);
      }
    }
  });

  it("renders the shared tool + FAQ for a published slug", async () => {
    const tree = await VariantPage(mkParams(REAL_PUBLISHED_SLUG));
    expect(countByName(tree, "ReviewToolForm")).toBe(1);
    expect(countByName(tree, "FaqSection")).toBe(1);
  });

  it("never reaches the render path — zero ReviewToolForm rendered on 404", async () => {
    let tree: unknown;
    try {
      tree = await VariantPage(mkParams(REAL_UNPUBLISHED_SLUG));
    } catch {
      tree = undefined;
    }
    // notFound() threw, so there is no tree; assert the render path produced no
    // tool form either way (a regression that swallowed notFound and fell
    // through to a render would be caught here).
    expect(countByName(tree, "ReviewToolForm")).toBe(0);
    expect(countByName(tree, "FaqSection")).toBe(0);
  });
});

// --- module export surface: no surplus Next route-config exports -----------
//
// The route's contract with Next 15 is exactly four named exports: the
// `dynamicParams` constant, the `generateStaticParams` SSG enumerator, the
// `generateMetadata` per-slug metadata builder, and the `default` VariantPage
// component. A refactor that added `export const dynamic = "force-dynamic"`
// silently overrides `dynamicParams = false` and turns unknown slugs into
// on-demand SSR renders (a different 404 code path, with the inert-until-L3.1b
// guarantee weakened to "if the published filter holds" instead of "Next will
// never reach this route for an unlisted slug"). A surplus
// `export const revalidate = N` flips the route from pure SSG to ISR — the
// statically rendered pages would start refreshing on a clock, changing the
// build-pipeline contract. `export const runtime = "edge"` would move the
// route off Node — different cold-start, different fetch semantics. None of
// the existing `dynamicParams`/`generateStaticParams`/`generateMetadata`/
// VariantPage tests catch any of these because they each still behave as
// pinned; only the *surface* of the module changes. Pinned via
// `Object.keys(routeModule).sort()` exact-array equality, mirroring the
// L13.1/L13.2/L15.1 envelope-shape `Object.keys` pattern (D-027/D-070/D-072)
// applied to the module's export surface instead of a response body.
describe("variant route — module export surface", () => {
  it("exports exactly the four route hooks Next 15 needs — no surplus config", () => {
    expect(Object.keys(variantRouteModule).sort()).toEqual([
      "default",
      "dynamicParams",
      "generateMetadata",
      "generateStaticParams",
    ]);
  });
});

// --- freshness: no shared mutable state across calls -----------------------
//
// Two adjacent silent-regression threats share one principle: the route's
// inert-path returns (`generateMetadata` → `{}`, `generateStaticParams` → `[]`
// pre-L3.1b) must each build a NEW value per invocation, not hand back a
// memoised module-level constant.
//
//   - `generateMetadata` currently does `return {};` (fresh literal). A
//     refactor to `const EMPTY: Metadata = {}; ... return EMPTY;` (a common
//     "avoid the allocation" cleanup) would let Next or any downstream caller
//     mutate the shared instance — a single `meta.title = "..."` write would
//     then leak into every subsequent call's response. The `.toEqual({})`
//     pin above cannot catch this because both calls still match the
//     empty-shape literal; only a reference-inequality assertion proves the
//     value is freshly built per call.
//
//   - `generateStaticParams` currently does
//     `publishedVariants().map((v) => ({ variant: v.slug }))` — both filter
//     and map allocate new arrays. A "DRY" refactor to
//     `const PARAMS = publishedVariants().map(...); export function
//     generateStaticParams() { return PARAMS; }` (caching at module-load)
//     would freeze the SSG-params list — when L3.1b lands or the registry
//     mutates in dev/HMR, the stale module-level constant would be served
//     forever until the process restarts, and the L3.1b flip's intended
//     "static-params follow `publishedVariants()`" contract would silently
//     break in dev workflows. Reference inequality between two calls proves
//     the function builds fresh each time.
//
// Both pins mirror L11.1/D-064's `faqJsonLd()` "is a fresh object each call
// (no shared mutable state)" and L14.1/D-071's sitemap "two consecutive
// `sitemap()` calls return reference-unequal Date objects" precedent — same
// silent-mutation threat, same `!==` reference-inequality remedy.
describe("variant route — freshness (no shared mutable state)", () => {
  it("generateMetadata returns a fresh {} each call for an unpublished slug", async () => {
    const a = await generateMetadata(mkParams(REAL_UNPUBLISHED_SLUG));
    const b = await generateMetadata(mkParams(REAL_UNPUBLISHED_SLUG));
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("generateMetadata returns a fresh {} each call for a garbage slug", async () => {
    // Garbage slug exercises the same `if (!variant) return {};` branch but
    // through a different findPublishedVariant codepath (no registry match at
    // all, vs. registry match that fails the `published` filter). Pinning the
    // freshness on both inputs guards both branches against the same
    // shared-constant regression.
    const a = await generateMetadata(mkParams(GARBAGE_SLUG));
    const b = await generateMetadata(mkParams(GARBAGE_SLUG));
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("generateStaticParams returns a fresh array each call (even empty pre-L3.1b)", () => {
    const a = generateStaticParams();
    const b = generateStaticParams();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
