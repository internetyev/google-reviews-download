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
import { SEO_VARIANTS, publishedVariants } from "@/lib/seo/variants";

// A real registry slug. Pre-L3.1b it is `published: false`, so the route must
// treat it as nonexistent exactly like an unknown slug — that equivalence is
// the whole inert-until-L3.1b contract.
const REAL_UNPUBLISHED_SLUG = SEO_VARIANTS[0].slug; // "export-google-reviews-to-csv"
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

  it("is empty pre-L3.1b — nothing is published yet (flips when L3.1b lands)", () => {
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

describe("variant route — VariantPage is inert pre-L3.1b", () => {
  it("calls notFound() for a real but unpublished registry slug", async () => {
    await expectNotFound(REAL_UNPUBLISHED_SLUG);
  });

  it("calls notFound() for a garbage slug", async () => {
    await expectNotFound(GARBAGE_SLUG);
  });

  it("404s EVERY registry slug — none is published before L3.1b", async () => {
    // The core inert-posture guard: a regression that widened the lookup past
    // the `published` gate would render one or more of these instead of 404ing.
    for (const v of SEO_VARIANTS) {
      await expectNotFound(v.slug);
    }
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
