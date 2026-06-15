// Summary-card contract guard for app/preview/page.tsx (L32.3).
//
// The single-place preview now renders a <SummaryCard> backed by the shared
// `summariseReviews` (L32.1) — star distribution bars, a sentiment split, and
// the operational signals (photos / owner responses / languages). Four things
// are a contract a silent refactor could regress:
//
//   1. Exactly one SummaryCard renders on the single-place happy path, wired to
//      the same {place, reviews} the page fetched (so the card can never drift
//      from the reviews shown below it).
//   2. The card is SAMPLE-scoped, never whole-place: its `sampled_reviews` is
//      the count of reviews actually shown (≤5), distinct from the place's
//      canonical `rating_count` that PlaceHeader surfaces (D-041/D-031). The
//      distribution histogram and the sentiment split each reconcile to that
//      sampled size — not to the place total — so a "summarise the whole place
//      from a 5-review sample" regression fails loudly.
//   3. Bad input (missing / unparseable placeId) renders an error card with
//      ZERO SummaryCards — the digest never appears on a degraded page.
//   4. The batch path renders no SummaryCard — the card is single-place only
//      (matching L32.2's JSON-single-place-only scope); a refactor that folded
//      it into BatchPreview would show a per-place-meaningless aggregate.
//
// Driven with NO react-dom (same harness as preview-route.test.ts): the page is
// an async server component, so we walk the returned tree structurally to find
// the SummaryCard element (and read its `summary` prop directly), and invoke
// the pure card to flatten its visible text. SF_API_KEY is neutralised per-test
// so createReviewsProvider() falls back to the committed FixtureClient (D-044).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import PreviewPage from "@/app/preview/page";
import type { ReviewSummary } from "@/lib/reviews/summary";

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

// Structural walk: descend props.children WITHOUT invoking function components,
// so a component element (like SummaryCard) created directly in PreviewPage's
// returned tree is reachable by its function name.
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

function findByName(root: unknown, name: string): El {
  let found: El | undefined;
  eachElement(root, (el) => {
    if (
      found === undefined &&
      typeof el.type === "function" &&
      (el.type as { name?: string }).name === name
    ) {
      found = el;
    }
  });
  if (!found) throw new Error(`no <${name}> element found in tree`);
  return found;
}

// Text flatten: invoke pure, hookless function components so their inner text
// becomes reachable.
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

const mk = (sp: { placeId?: string; format?: string; places?: string }) => ({
  searchParams: Promise.resolve(sp),
});

const distSum = (s: ReviewSummary) =>
  s.rating_distribution[1] +
  s.rating_distribution[2] +
  s.rating_distribution[3] +
  s.rating_distribution[4] +
  s.rating_distribution[5];

const sentimentSum = (s: ReviewSummary) =>
  s.sentiment.positive + s.sentiment.neutral + s.sentiment.negative;

// --- happy path: the card is wired and sample-scoped ----------------------

describe("PreviewPage — summary card (L32.3)", () => {
  it("renders exactly one SummaryCard on the single-place happy path", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    expect(countByName(tree, "SummaryCard")).toBe(1);
  });

  it("card is sample-scoped, not whole-place (D-041/D-031)", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const summary = findByName(tree, "SummaryCard").props.summary as ReviewSummary;
    // small fixture: rating_count 12, preview fetches ≤5. The card's sampled
    // denominator is the reviews actually shown (5), NOT the place total (12).
    expect(summary.sampled_reviews).toBeGreaterThan(0);
    expect(summary.sampled_reviews).toBeLessThanOrEqual(5);
    expect(summary.total_reviews).toBe(12);
    expect(summary.sampled_reviews).not.toBe(summary.total_reviews);
  });

  it("distribution + sentiment each reconcile to the sampled size, not the place total", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const summary = findByName(tree, "SummaryCard").props.summary as ReviewSummary;
    // A regression that summarised the whole place from the 5-review sample
    // would make these sums 12 (the place total), not 5 (the sample).
    expect(distSum(summary)).toBe(summary.sampled_reviews);
    expect(sentimentSum(summary)).toBe(summary.sampled_reviews);
  });

  it("renders the sampled count and average in visible card text", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const card = findByName(tree, "SummaryCard");
    const summary = card.props.summary as ReviewSummary;
    const text = norm(card);
    expect(text).toContain(`Summary of the ${summary.sampled_reviews} reviews shown`);
    expect(text).toContain(summary.sampled_average_rating.toFixed(1));
    // the operational signals are surfaced as words, not just emoji
    expect(text).toContain("with photos");
    expect(text).toContain("with owner response");
  });

  it("renders one distribution row per star level (5 rows) with the per-star counts", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_SMALL_001" }));
    const card = findByName(tree, "SummaryCard");
    const summary = card.props.summary as ReviewSummary;
    const text = norm(card);
    // one bar per star level → at least five ★ glyphs (the flatten joins the
    // `{star}` digit and the literal ★ with a space, so we count glyphs rather
    // than the fragile "5★" concatenation; the sample-average row adds one more)
    expect((text.match(/★/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // sentiment legend words are present
    expect(text).toMatch(/Positive/);
    expect(text).toMatch(/Neutral/);
    expect(text).toMatch(/Negative/);
    // guard-the-guard: the card actually carries data, not an empty sample
    expect(distSum(summary)).toBeGreaterThan(0);
  });

  it("large fixture: card still sample-scoped (≤5), not the walked length (500) or place total (609)", async () => {
    const tree = await PreviewPage(mk({ placeId: "MOCK_LARGE_001" }));
    const summary = findByName(tree, "SummaryCard").props.summary as ReviewSummary;
    expect(summary.sampled_reviews).toBeLessThanOrEqual(5);
    expect(summary.sampled_reviews).not.toBe(500);
    expect(summary.total_reviews).toBe(609);
    expect(distSum(summary)).toBe(summary.sampled_reviews);
  });
});

// --- the digest never appears on a degraded or batch page -----------------

describe("PreviewPage — no summary card off the single-place happy path", () => {
  it("missing placeId → error card, zero SummaryCards", async () => {
    const tree = await PreviewPage(mk({}));
    expect(countByName(tree, "SummaryCard")).toBe(0);
    expect(textOf(tree)).toContain("Nothing to preview");
  });

  it("unparseable placeId → error card, zero SummaryCards", async () => {
    const tree = await PreviewPage(mk({ placeId: "https://maps.app.goo.gl/abc123" }));
    expect(countByName(tree, "SummaryCard")).toBe(0);
  });

  it("batch path (places=…) renders no SummaryCard — the card is single-place only", async () => {
    const tree = await PreviewPage(
      mk({ places: "MOCK_SMALL_001\nMOCK_LARGE_001" }),
    );
    expect(countByName(tree, "SummaryCard")).toBe(0);
  });
});
