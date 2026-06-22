// Render-contract guard for app/_components/batch-review-tool-form.tsx (L31.3).
//
// BatchReviewToolForm is the multi-place sibling of ReviewToolForm: the home
// page renders both, but only this one collects a *list* of businesses and
// GET-navigates to the batch preview. It is kept SEPARATE from ReviewToolForm
// precisely so the single-place form's heavily-pinned L8.2 contract stays
// untouched — so this suite pins the batch form's own load-bearing shape, with
// the same no-react-dom structural walk (D-050):
//
//   1. It is a plain `<form action="/preview" method="GET">` — same target as
//      the single form, so the batch list rides the preview route (which reads
//      `places` in batch mode). A revert to a raw `/api/reviews` target or a
//      switch to POST (which /preview does not handle) trips this.
//   2. Exactly one `required` `<textarea name="places">` — the multi-line paste
//      area the batch-input parser (parsePlacesList) splits. `required` stops an
//      empty submit. A regression to a single `<input name="placeId">` (folding
//      it back into the single form's shape) would silently break batch mode.
//   3. Exactly five `name="format"` radios with values csv/xlsx/json/md/html in
//      that surfaced order, and `csv` is the one defaultChecked — the documented
//      batch default (a combined file is most useful as a spreadsheet), which
//      is deliberately a DIFFERENT default from the single form's json
//      (L8.2/D-046); pinning it makes a "harmonise the two forms" cleanup loud.
//      (`md` is the L37.3 combined Markdown testimonials document and `html`
//      the L38.3 combined testimonials page, wired alongside the columnar
//      formats — batch parity with the single form.)
//   4. label/textarea pairing (htmlFor="places" ↔ id="places") — the a11y
//      contract, same as the single form's placeId pairing.
//
// BatchReviewToolForm is pure, synchronous and hookless (only intrinsic JSX
// elements), so it is invoked directly and its returned tree walked
// structurally — no render, no DOM, no mocks (D-050).

import { describe, it, expect } from "vitest";
import { BatchReviewToolForm } from "@/app/_components/batch-review-tool-form";

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

const tree = BatchReviewToolForm();

// --- the form shell --------------------------------------------------------

describe("BatchReviewToolForm — the form shell", () => {
  it("is a single <form> posting GET to /preview, not /api/reviews", () => {
    const forms = findAll(tree, (el) => el.type === "form");
    expect(forms).toHaveLength(1);
    const form = forms[0];
    expect(form.props.action).toBe("/preview");
    expect(String(form.props.method).toUpperCase()).toBe("GET");
    // A revert to a raw /api/reviews download target, or POST, trips one of
    // these — the batch list must ride the preview route in `places` mode.
    expect(form.props.action).not.toContain("/api/reviews");
    expect(form.props.target).toBeUndefined();
  });

  it("has exactly one type=submit button so the GET form can navigate", () => {
    const submits = findAll(
      tree,
      (el) => el.type === "button" && el.props.type === "submit",
    );
    expect(submits).toHaveLength(1);
  });
});

// --- the places textarea ---------------------------------------------------

describe("BatchReviewToolForm — the places textarea", () => {
  it("has exactly one required <textarea> named places (not a single input)", () => {
    const textareas = findAll(tree, (el) => el.type === "textarea");
    expect(textareas).toHaveLength(1);
    const ta = textareas[0];
    expect(ta.props.name).toBe("places");
    // `required` stops an empty submit round-tripping to an error card.
    expect(ta.props.required).toBe(true);

    // The batch form must NOT carry the single form's placeId input — a
    // regression that folded it back into ReviewToolForm's shape would lose
    // the multi-line paste and silently break batch mode.
    const placeIdInputs = findAll(
      tree,
      (el) => el.type === "input" && el.props.name === "placeId",
    );
    expect(placeIdInputs).toHaveLength(0);
  });

  it("the textarea carries paste-safety attrs (autoComplete off, spellCheck false)", () => {
    // Same paste-corruption guard as the single form: a pasted ChIJ... / name
    // must not be autofilled-over or auto-corrected.
    const ta = findAll(tree, (el) => el.type === "textarea")[0];
    expect(ta.props.autoComplete).toBe("off");
    expect(ta.props.spellCheck).toBe(false);
  });
});

// --- a11y: label/textarea pairing -----------------------------------------

describe("BatchReviewToolForm — accessibility: label/textarea pairing", () => {
  it("has exactly one <label htmlFor='places'> pointing at the textarea", () => {
    const placesLabels = findAll(
      tree,
      (el) => el.type === "label" && el.props.htmlFor === "places",
    );
    expect(placesLabels).toHaveLength(1);
  });

  it("the textarea carries id='places' (the label's htmlFor target)", () => {
    const ta = findAll(tree, (el) => el.type === "textarea")[0];
    expect(ta.props.id).toBe("places");
  });
});

// --- the format radios -----------------------------------------------------

describe("BatchReviewToolForm — the export-format radios", () => {
  const radios = findAll(
    tree,
    (el) => el.type === "input" && el.props.type === "radio",
  );

  it("renders exactly five format radios named format", () => {
    expect(radios).toHaveLength(5);
    for (const r of radios) {
      expect(r.props.name).toBe("format");
    }
  });

  it("offers csv/xlsx/json/md/html in that surfaced order", () => {
    // `md` (combined Markdown testimonials, L37.3) and `html` (combined
    // testimonials page, L38.3) are appended after the columnar formats —
    // the canonical tokens /api/reviews accepts.
    expect(radios.map((r) => r.props.value)).toEqual([
      "csv",
      "xlsx",
      "json",
      "md",
      "html",
    ]);
  });

  it("defaults to csv — the batch default (deliberately ≠ the single form's json)", () => {
    // Exactly one radio is defaultChecked, and it is csv. The single
    // ReviewToolForm defaults to json (L8.2/D-046); the batch default is csv
    // because a multi-place combined file is most useful as a spreadsheet.
    // Pinning both ends makes a "harmonise the two form defaults" cleanup loud.
    const checked = radios.filter((r) => r.props.defaultChecked === true);
    expect(checked).toHaveLength(1);
    expect(checked[0].props.value).toBe("csv");
  });
});
