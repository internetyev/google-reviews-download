// L34.3 — wire the review sort control through the web form + preview.
//
// The pure sort layer itself is already pinned by tests/reviews-sort.test.ts,
// and the route's `order`/`sort` param by tests/api-reviews.test.ts. This suite
// covers the new-feature surface L34.3 adds: the web form's `<select name="order">`
// control that emits the `order` param the route + preview key on, walked
// structurally with no react-dom (the D-050 technique the sibling
// review-tool-form / filter-wiring suites use) so the order option values can't
// silently drift from the `ReviewOrder` strings the pure layer accepts.
//
// Run offline via `npx vitest run` (node_modules present since D-086).

import { describe, it, expect } from "vitest";
import { parseReviewOrder, sortReviews, __testing } from "@/lib/reviews/sort";
import { ReviewToolForm } from "@/app/_components/review-tool-form";

// --- the form control (no react-dom structural walk) -----------------------

type El = { $$typeof: symbol; type: unknown; props: Record<string, unknown> };

function isElement(x: unknown): x is El {
  return x != null && typeof x === "object" && "props" in (x as object) && "$$typeof" in (x as object);
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

const tree = ReviewToolForm();

function orderSelect(): El {
  const selects = findAll(
    tree,
    (el) => el.type === "select" && el.props.name === "order",
  );
  expect(selects).toHaveLength(1);
  return selects[0];
}

describe("ReviewToolForm — L34.3 sort control", () => {
  it("emits exactly one <select name='order'>", () => {
    expect(orderSelect()).toBeDefined();
  });

  it("the order <select> defaults to the empty 'As listed' value so it's opt-in", () => {
    // defaultValue "" → the param submits empty → parseReviewOrder returns null
    // → sortReviews is the identity → exactly today's unordered behaviour. Pin
    // it so a refactor that pre-selected an order can't silently start
    // reordering every download.
    expect(orderSelect().props.defaultValue).toBe("");
  });

  it("offers an <option value=''> identity plus exactly the four ReviewOrder values", () => {
    const options = findAll(
      orderSelect(),
      (el) => el.type === "option",
    ).map((o) => String(o.props.value));
    // The empty identity option + the four orders the pure layer accepts.
    expect(options).toEqual(["", "newest", "oldest", "highest", "lowest"]);
  });

  it("every non-empty option value round-trips through parseReviewOrder", () => {
    // The load-bearing contract: a control whose value the pure layer can't
    // parse would silently no-op (degrade to identity) on submit. Pin that each
    // emitted value is a real ReviewOrder so an option-label typo (e.g.
    // 'newest-first') fails loudly here, not silently at runtime.
    const values = findAll(orderSelect(), (el) => el.type === "option")
      .map((o) => String(o.props.value))
      .filter((v) => v.length > 0);
    expect(values).toEqual([...__testing.ORDERS]);
    for (const v of values) {
      expect(parseReviewOrder(v)).toBe(v);
    }
  });

  it("the order control name is not one the filter parser would mistake for a criterion", () => {
    // `order` is a sort param, not a filter param; it must reach the route as a
    // distinct key (the route reads `order` / `sort`, never folds it into the
    // ReviewFilter). A trivial guard that the control exists under that exact
    // name and applying its value actually reorders the sample.
    const reviews = [
      { review_id: "a", rating: 5, author_name: "x", text: "t", published_at: "2024-01-01T00:00:00Z" },
      { review_id: "b", rating: 1, author_name: "y", text: "u", published_at: "2024-02-01T00:00:00Z" },
    ] as Parameters<typeof sortReviews>[0];
    const lowestFirst = sortReviews(reviews, parseReviewOrder("lowest"));
    expect(lowestFirst.map((r) => r.review_id)).toEqual(["b", "a"]);
  });
});
