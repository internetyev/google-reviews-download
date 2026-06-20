// L33.3 — wire the review filter through the web form + preview.
//
// Two new-feature surfaces are covered here (the pure filter layer itself is
// already pinned by tests/reviews-filter.test.ts, and the route params by
// tests/api-reviews.test.ts):
//
//   1. The shared param parser `lib/reviews/filter-params.ts` — the de-drift
//      module both /api/reviews and the preview now read filter params through.
//   2. The web form controls (`ReviewToolForm`) that emit those params, walked
//      structurally with no react-dom (the D-050 technique the sibling
//      review-tool-form suite uses) so the new <select>/<checkbox> controls
//      can't silently regress the names the route + preview key on.
//
// Run offline via `npx vitest run` (node_modules present since D-086).

import { describe, it, expect } from "vitest";
import {
  FILTER_PARAM_KEYS,
  hasActiveFilter,
  parseFilter,
} from "@/lib/reviews/filter-params";
import { ReviewToolForm } from "@/app/_components/review-tool-form";

// --- shared param parser ---------------------------------------------------

describe("filter-params — shared parser (de-drift, D-095)", () => {
  it("maps the form's params onto a ReviewFilter", () => {
    const params = new URLSearchParams(
      "min_rating=2&max_rating=4&language=es&with_photos=1",
    );
    expect(parseFilter(params)).toEqual({
      minRating: 2,
      maxRating: 4,
      language: "es",
      withPhotos: true,
    });
  });

  it("an empty / all-blank query is the identity filter", () => {
    expect(parseFilter(new URLSearchParams(""))).toEqual({});
    expect(hasActiveFilter(parseFilter(new URLSearchParams("")))).toBe(false);
    // The form's "Any" selects submit an empty value → omitted, not 400.
    expect(
      parseFilter(new URLSearchParams("min_rating=&max_rating=&language=")),
    ).toEqual({});
  });

  it("hasActiveFilter is true once any criterion is set", () => {
    expect(hasActiveFilter(parseFilter(new URLSearchParams("min_rating=4")))).toBe(
      true,
    );
  });

  it("an unchecked with_photos box means 'don't care', never 'exclude'", () => {
    // The checkbox simply isn't submitted when unchecked, so the param is
    // absent — which must NOT set withPhotos (the filter only constrains on
    // explicit true). Mirrors filter.ts's contract.
    expect(parseFilter(new URLSearchParams("min_rating=4")).withPhotos).toBeUndefined();
  });
});

// --- the form controls (no react-dom structural walk) ----------------------

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

describe("ReviewToolForm — L33.3 filter controls", () => {
  it("emits a <select> for min_rating, max_rating, and language", () => {
    const selects = findAll(tree, (el) => el.type === "select");
    const names = selects.map((s) => s.props.name);
    expect(names).toContain("min_rating");
    expect(names).toContain("max_rating");
    expect(names).toContain("language");
  });

  it("each filter <select> defaults to the empty 'Any' value so it's opt-in", () => {
    const selects = findAll(
      tree,
      (el) =>
        el.type === "select" &&
        ["min_rating", "max_rating", "language"].includes(
          String(el.props.name),
        ),
    );
    expect(selects).toHaveLength(3);
    for (const s of selects) {
      // defaultValue "" → the param submits empty → parseFilter omits it →
      // the unfiltered behaviour is exactly today's. Pin it so a refactor that
      // pre-selected a rating can't silently start filtering every download.
      expect(s.props.defaultValue).toBe("");
    }
  });

  it("emits a with_photos checkbox whose value is a truthy token", () => {
    const boxes = findAll(
      tree,
      (el) => el.type === "input" && el.props.type === "checkbox",
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0].props.name).toBe("with_photos");
    // The value must be a token parseBooleanFlag accepts (1/true/yes); pin "1".
    expect(boxes[0].props.value).toBe("1");
  });

  it("the filter control names are exactly the FILTER_PARAM_KEYS the parser reads", () => {
    // The form must only emit param names the shared parser understands, else a
    // control would post a param the route/preview silently ignore.
    const emitted = findAll(
      tree,
      (el) =>
        (el.type === "select" || el.type === "input") &&
        typeof el.props.name === "string" &&
        (FILTER_PARAM_KEYS as readonly string[]).includes(
          el.props.name as string,
        ),
    ).map((el) => el.props.name);
    expect(new Set(emitted)).toEqual(
      new Set(["min_rating", "max_rating", "language", "with_photos"]),
    );
  });
});
