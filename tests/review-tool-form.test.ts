// Render-contract guard for app/_components/review-tool-form.tsx (L2.4/L3.1a).
//
// `ReviewToolForm` is the single source of truth for the "paste a place,
// preview, download" tool — the home page (L2.4) and every SEO variant page
// (L3.1) render the *same* element so the tool can never drift between
// surfaces. Its contract is small but load-bearing, and the most dangerous
// regression is silent: a refactor back to the pre-D-041 flow (a raw
// `/api/reviews` link with `target="_blank"` that streamed a download in a new
// tab) would still "work" in a browser while bypassing the `/preview` step,
// the L2.8 edge rate-limit, and the KV cache the preview route fronts. This
// suite pins the post-D-041 shape so that regression fails loudly here:
//
//   1. It is a plain `<form action="/preview" method="GET">` — no client JS,
//      navigates to the preview route (the D-041 rewire). Asserting both the
//      action and the GET method guards against both a revert to
//      `/api/reviews` and a switch to POST (which `/preview` does not accept).
//   2. Exactly one text input, `name="placeId"`, `required` — the place
//      identifier the preview/normalisation pipeline keys on; `required`
//      stops an empty submit from round-tripping to an error card.
//   3. Exactly three `name="format"` radios with values json/csv/xlsx in that
//      order, and `json` is the one `defaultChecked` — the order the form
//      surfaces (same check-order spirit as L6.5/D-046) and the documented
//      default download format that rides along to the preview CTA.
//
// `ReviewToolForm` is a pure, synchronous, hookless component with no
// sub-components (only intrinsic JSX elements), so it is invoked directly and
// its returned element tree walked structurally — the same no-react-dom
// technique as the variant-page / preview-route suites (D-050). No render, no
// DOM, no mocks.
//
// Committed, not run in-routine (no node_modules; `npm install` is a human
// step — D-039/D-040 posture, same as the other suites).

import { describe, it, expect } from "vitest";
import { ReviewToolForm } from "@/app/_components/review-tool-form";

// --- tiny tree utilities (no react-dom; same shape as variant-page.test) ----

type El = { $$typeof: symbol; type: unknown; props: Record<string, unknown> };

function isElement(x: unknown): x is El {
  return (
    x != null &&
    typeof x === "object" &&
    "$$typeof" in (x as object) &&
    "props" in (x as object)
  );
}

// Depth-first visit of every element in the tree. The component is hookless
// and uses only intrinsic elements, so the returned tree is fully static —
// no function components to invoke, every node is reachable by descending
// `props.children` (D-050 structural walk).
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

// --- the form element ------------------------------------------------------

describe("ReviewToolForm — the form shell (D-041 preview rewire)", () => {
  it("is a single <form> posting GET to /preview, not /api/reviews", () => {
    const forms = findAll(tree, (el) => el.type === "form");
    expect(forms).toHaveLength(1);
    const form = forms[0];
    // The D-041 contract: GET to the preview route. A revert to the old
    // `/api/reviews` `target="_blank"` download flow, or a switch to POST
    // (which `/preview` does not handle), trips one of these.
    expect(form.props.action).toBe("/preview");
    expect(String(form.props.method).toUpperCase()).toBe("GET");
    expect(form.props.action).not.toContain("/api/reviews");
    expect(form.props.target).toBeUndefined();
  });
});

// --- the placeId input -----------------------------------------------------

describe("ReviewToolForm — the placeId input", () => {
  it("has exactly one required text input named placeId", () => {
    const inputs = findAll(tree, (el) => el.type === "input");
    const textInputs = inputs.filter((el) => el.props.type === "text");
    expect(textInputs).toHaveLength(1);

    const placeId = textInputs[0];
    expect(placeId.props.name).toBe("placeId");
    // `required` stops an empty submit from round-tripping to an error card.
    expect(placeId.props.required).toBe(true);
  });

  it("names the input field exactly placeId (the normalisation key)", () => {
    const named = findAll(
      tree,
      (el) => el.type === "input" && el.props.name === "placeId",
    );
    expect(named).toHaveLength(1);
  });
});

// --- the format radios -----------------------------------------------------

describe("ReviewToolForm — the export-format radios", () => {
  const radios = findAll(
    tree,
    (el) => el.type === "input" && el.props.type === "radio",
  );

  it("renders exactly three format radios named format", () => {
    expect(radios).toHaveLength(3);
    for (const r of radios) {
      expect(r.props.name).toBe("format");
    }
  });

  it("offers json/csv/xlsx in that surfaced order", () => {
    // The order the form surfaces — same check-order spirit as L6.5/D-046.
    expect(radios.map((r) => r.props.value)).toEqual(["json", "csv", "xlsx"]);
  });

  it("defaults to json (the documented preferred download format)", () => {
    // Exactly one radio is defaultChecked, and it is json — the value that
    // rides along to the preview CTA as the preferred download format.
    const checked = radios.filter((r) => r.props.defaultChecked === true);
    expect(checked).toHaveLength(1);
    expect(checked[0].props.value).toBe("json");
  });
});

// --- the submit button -----------------------------------------------------

describe("ReviewToolForm — the submit affordance", () => {
  it("has exactly one type=submit button so the GET form can navigate", () => {
    const submits = findAll(
      tree,
      (el) => el.type === "button" && el.props.type === "submit",
    );
    expect(submits).toHaveLength(1);
  });
});
