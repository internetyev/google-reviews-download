// Batch-preview contract guard for app/preview/page.tsx (L31.3).
//
// When the preview route receives a `places` searchParam it renders BatchPreview
// instead of the single-place view: it resolves each pasted business, shows a
// per-place review count, and offers ONE combined download. Four things are a
// contract a silent refactor could regress:
//
//   1. Each place's canonical review total (place.rating_count) is shown, and
//      the header sums them — the multi-place analogue of the single path's
//      D-041 "show rating_count, not a walk count" invariant. Two distinct
//      fixtures (small rating_count 12, large rating_count 609) make the sum
//      (621) impossible to match by a "count what we fetched" regression.
//   2. The combined download links target `/api/reviews?places=…` (NOT the
//      single-place `?placeId=`), carrying the raw pasted list percent-encoded,
//      one anchor per format with the preferred format first.
//   3. Empty / blank `places` → a "Nothing to preview" error card, not a crash.
//   4. More than MAX_BATCH_PLACES places → a "Too many businesses" card (the
//      quota guard), not an unbounded fan-out of upstream calls.
//
// Same no-react-dom technique as preview-route.test (D-050): PreviewPage is an
// async server component; we walk its returned tree structurally and flatten
// the pure sub-components' text. Env is neutralised so createReviewsProvider()
// falls back to the offline FixtureClient (REVIEWS_PROVIDER unset → mock) and
// the caches are in-process MemoryCaches (KV_* unset) — zero network, the
// fixture chosen purely by the MOCK_* id we pass.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import PreviewPage from "@/app/preview/page";
import { MAX_BATCH_PLACES } from "@/lib/reviews/batch-input";

// Clear everything that could route a real call or a shared KV: provider
// selection, SF creds, and the KV REST cache endpoint.
const ENV_KEYS = [
  "REVIEWS_PROVIDER",
  "SF_API_KEY",
  "SF_API_BASE",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;
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

function collectAnchors(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collectAnchors(n, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (node.type === "a") out.push(node);
  if (typeof node.type === "function") {
    try {
      collectAnchors((node.type as (p: unknown) => unknown)(node.props), out);
    } catch {
      collectAnchors(node.props?.children, out);
    }
    return out;
  }
  collectAnchors(node.props?.children, out);
  return out;
}

function apiReviewsHrefs(root: unknown): string[] {
  return collectAnchors(root)
    .map((a) => a.props?.href)
    .filter(
      (h): h is string =>
        typeof h === "string" && h.startsWith("/api/reviews?"),
    );
}

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

function norm(node: unknown): string {
  return textOf(node).replace(/\s+/g, " ").trim();
}

const mk = (sp: {
  placeId?: string;
  format?: string;
  places?: string;
}) => ({ searchParams: Promise.resolve(sp) });

// --- happy path: two distinct fixtures -------------------------------------

describe("PreviewPage batch mode — two places, combined preview", () => {
  // small (Joe's Coffee, rating_count 12) + large (The Riverside Hotel,
  // rating_count 609). 12 ≠ 609 and 621 ≠ 5/10/etc., so a "count what we
  // fetched" regression cannot coincidentally match these numbers.
  const PLACES = "MOCK_SMALL_001\nMOCK_LARGE_001";

  it("renders both place names and each place's canonical rating_count", async () => {
    const tree = await PreviewPage(mk({ places: PLACES }));
    const text = norm(tree);
    expect(text).toContain("Joe's Coffee");
    expect(text).toContain("The Riverside Hotel");
    // per-place canonical totals (rating_count), not a walk count
    expect(text).toContain("12 reviews");
    expect(text).toContain("609 reviews");
  });

  it("the header counts the businesses and sums their rating_counts (621)", async () => {
    const tree = await PreviewPage(mk({ places: PLACES }));
    const text = norm(tree);
    expect(text).toContain("2 businesses");
    // 12 + 609 = 621 — the summed canonical total, distinct from any
    // fetched/walked count so a regression cannot match it by accident.
    expect(text).toContain("621");
  });
});

// --- combined download URL contract ----------------------------------------

describe("PreviewPage batch mode — combined download links", () => {
  const PLACES = "MOCK_SMALL_001\nMOCK_LARGE_001";

  it("links to /api/reviews?places=… (not ?placeId=), preferred format first", async () => {
    const tree = await PreviewPage(mk({ places: PLACES, format: "xlsx" }));
    const hrefs = apiReviewsHrefs(tree);
    // one anchor per supported format (csv/json/xlsx/md/html/txt,
    // L37.3/L38.3/L39.3), preferred (xlsx) first.
    expect(hrefs).toHaveLength(6);
    expect(hrefs[0]).toContain("format=xlsx");
    for (const href of hrefs) {
      // the batch download must carry the whole pasted list as `places`,
      // never the single-place `placeId` param.
      expect(href).toContain("places=");
      expect(href).not.toContain("placeId=");
    }
  });

  it("percent-encodes the raw pasted list (newline → %0A) so it round-trips", async () => {
    const tree = await PreviewPage(mk({ places: PLACES, format: "csv" }));
    const hrefs = apiReviewsHrefs(tree);
    expect(hrefs.length).toBeGreaterThan(0);
    // the newline separator must be encoded, not left literal in the URL.
    for (const href of hrefs) {
      expect(href).toContain("MOCK_SMALL_001%0AMOCK_LARGE_001");
    }
  });
});

// --- degrade-not-crash: bad batch input ------------------------------------

describe("PreviewPage batch mode — bad input renders a card, never throws", () => {
  it("empty places (only whitespace/commas) → 'Nothing to preview'", async () => {
    const tree = await PreviewPage(mk({ places: "  , \n , " }));
    expect(textOf(tree)).toContain("Nothing to preview");
    // it must not have reached the combined-download path
    expect(apiReviewsHrefs(tree)).toHaveLength(0);
  });

  it("more than MAX_BATCH_PLACES places → 'Too many businesses' (quota guard)", async () => {
    const tooMany = Array.from(
      { length: MAX_BATCH_PLACES + 1 },
      (_, i) => `MOCK_SMALL_${String(i).padStart(3, "0")}`,
    ).join("\n");
    const tree = await PreviewPage(mk({ places: tooMany }));
    const text = textOf(tree);
    expect(text).toContain("Too many businesses");
    // no upstream fan-out, no download link
    expect(apiReviewsHrefs(tree)).toHaveLength(0);
  });
});

// --- additivity: the single-place path is untouched ------------------------

describe("PreviewPage — `places` absent still renders the single-place view", () => {
  it("a placeId (no places) renders the single place, not a batch header", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const text = norm(tree);
    expect(text).toContain("Joe's Coffee");
    // the single path uses the "…of N reviews" copy, never the batch
    // "N businesses" header.
    expect(text).not.toContain("businesses");
  });
});
