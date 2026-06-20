// L35.3 — wire the column picker through the web form + preview.
//
// The pure projection layer is pinned by tests/reviews-project.test.ts and the
// route's `fields`/`columns` param by tests/api-reviews-project.test.ts. This
// suite covers the new-feature surface L35.3 adds: the web form's
// `<input type="checkbox" name="fields">` column controls (walked structurally
// with no react-dom, the D-050 technique the sibling sort-wiring / filter-wiring
// suites use) and the shared `parseFieldsParam` that BOTH the route and the
// preview use to read those controls — so the checkbox values can't silently
// drift from the `ReviewField` strings the pure layer accepts, and the form's
// repeated-param wire form stays parseable.
//
// Run offline via `npx vitest run` (node_modules present since D-086).

import { describe, it, expect } from "vitest";
import { parseReviewFields, projectReviews, __testing } from "@/lib/reviews/project";
import { parseFieldsParam } from "@/lib/reviews/project-params";
import { ReviewToolForm } from "@/app/_components/review-tool-form";

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

function fieldCheckboxes(): El[] {
  return findAll(
    tree,
    (el) => el.type === "input" && el.props.type === "checkbox" && el.props.name === "fields",
  );
}

describe("ReviewToolForm — L35.3 column picker", () => {
  it("emits one checkbox per Review field, all named 'fields'", () => {
    const values = fieldCheckboxes().map((c) => String(c.props.value));
    // Exactly the nine ReviewField strings the pure layer knows, no more/less.
    expect(values.slice().sort()).toEqual([...__testing.FIELDS].slice().sort());
  });

  it("every checkbox value round-trips through parseReviewFields", () => {
    // Load-bearing: a control whose value the pure layer can't narrow would
    // silently no-op (degrade to "all columns"). Pin each emitted value is a
    // real ReviewField so a label typo (e.g. 'reviewId') fails loudly here.
    for (const c of fieldCheckboxes()) {
      const v = String(c.props.value);
      expect(parseReviewFields([v]), `value=${v}`).toEqual([v]);
    }
  });

  it("no column checkbox is pre-checked so the default is all columns (opt-in)", () => {
    // An unchecked box submits no `fields` param → parseFieldsParam null →
    // projectReviews identity → exactly today's full-export behaviour. A
    // refactor that defaultChecked a box would silently start dropping columns.
    for (const c of fieldCheckboxes()) {
      expect(c.props.defaultChecked).toBeUndefined();
    }
  });
});

// --- the shared parser the form + route + preview all share -----------------

describe("parseFieldsParam — the form/route/preview de-drift parser", () => {
  it("reads the form's repeated `fields=…&fields=…` checkbox params", () => {
    const p = new URLSearchParams();
    p.append("fields", "rating");
    p.append("fields", "text");
    expect(parseFieldsParam(p)).toEqual(["rating", "text"]);
  });

  it("still reads the API's comma-separated single value", () => {
    expect(parseFieldsParam(new URLSearchParams("fields=rating,text"))).toEqual([
      "rating",
      "text",
    ]);
  });

  it("honours the `columns` alias only when `fields` is absent (fields precedence)", () => {
    expect(parseFieldsParam(new URLSearchParams("columns=rating"))).toEqual([
      "rating",
    ]);
    expect(
      parseFieldsParam(new URLSearchParams("fields=text&columns=rating")),
    ).toEqual(["text"]);
  });

  it("an absent / all-unrecognised selection is null (identity = all columns)", () => {
    expect(parseFieldsParam(new URLSearchParams())).toBeNull();
    expect(parseFieldsParam(new URLSearchParams("fields=nonsense"))).toBeNull();
    // And a null selection projects to whole reviews, not empty rows.
    const reviews = [
      { review_id: "a", rating: 5, author_name: "x", text: "t", published_at: "2024-01-01T00:00:00Z" },
    ] as Parameters<typeof projectReviews>[0];
    expect(projectReviews(reviews, parseFieldsParam(new URLSearchParams()))).toEqual(
      reviews,
    );
  });
});
