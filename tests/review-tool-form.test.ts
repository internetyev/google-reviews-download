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
//   3. Exactly five `name="format"` radios with values json/csv/xlsx/md/html
//      in that order, and `json` is the one `defaultChecked` — the order the
//      form surfaces (same check-order spirit as L6.5/D-046) and the documented
//      default download format that rides along to the preview CTA. (`md` is
//      the L37.3 Markdown testimonials format and `html` the L38.3 self-
//      contained testimonials page, wired alongside JSON/CSV/XLSX.)
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

  it("renders exactly five format radios named format", () => {
    expect(radios).toHaveLength(5);
    for (const r of radios) {
      expect(r.props.name).toBe("format");
    }
  });

  it("offers json/csv/xlsx/md/html in that surfaced order", () => {
    // The order the form surfaces — same check-order spirit as L6.5/D-046.
    // `md` (Markdown testimonials, L37.3) and `html` (self-contained
    // testimonials page, L38.3) are appended after the columnar formats —
    // the canonical tokens /api/reviews accepts (the `markdown` alias is
    // API-only; the form submits the short `md`/`html`).
    expect(radios.map((r) => r.props.value)).toEqual([
      "json",
      "csv",
      "xlsx",
      "md",
      "html",
    ]);
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

// --- accessibility: label/input pairing (htmlFor ↔ id) ---------------------

describe("ReviewToolForm — accessibility: label/input pairing", () => {
  // The placeId <label htmlFor="placeId"> + <input id="placeId"> pair is the
  // screen-reader contract: AT walks `htmlFor` → `id` to associate the visible
  // label with the input. A refactor that dropped either side, renamed `id`
  // to `placeIdInput`, or moved the `htmlFor` to a different label silently
  // breaks association — sighted users see the same form, AT users see an
  // unlabelled text field. Pin both sides + the exact pairing.
  it("has exactly one <label htmlFor='placeId'> pointing at the placeId input", () => {
    const labels = findAll(tree, (el) => el.type === "label");
    const placeIdLabels = labels.filter((l) => l.props.htmlFor === "placeId");
    expect(placeIdLabels).toHaveLength(1);
  });

  it("the placeId input carries id='placeId' (the label's htmlFor target)", () => {
    const placeIdInputs = findAll(
      tree,
      (el) =>
        el.type === "input" &&
        el.props.type === "text" &&
        el.props.name === "placeId",
    );
    expect(placeIdInputs).toHaveLength(1);
    // A regression that named the id `placeIdInput` (a common refactor target)
    // would leave `htmlFor="placeId"` pointing at nothing — pin the exact id.
    expect(placeIdInputs[0].props.id).toBe("placeId");
  });
});

// --- input paste-safety attributes (mobile auto-correct kills place_ids) ---

describe("ReviewToolForm — placeId input paste-safety attrs", () => {
  // Mobile browsers and modern desktop browsers will, by default, offer
  // autofill suggestions for text inputs (saved addresses, prior values) and
  // underline typed/pasted content as misspellings, auto-correcting on the
  // next focus event. Either silently corrupts a pasted place_id like
  // `ChIJN1t_tDeuEmsRUsoyG83frY4` — autofill may swap it for a saved value,
  // spellcheck may "correct" `ChIJ` to `Chij` or `CHIJ`. Both are silent
  // visual UX bugs no other test catches (the form still submits; the value
  // is just wrong). Pin both attributes; a refactor that dropped either ships
  // the corruption.
  const placeIdInput = (() => {
    const inputs = findAll(
      tree,
      (el) =>
        el.type === "input" &&
        el.props.type === "text" &&
        el.props.name === "placeId",
    );
    expect(inputs).toHaveLength(1);
    return inputs[0];
  })();

  it("has autoComplete='off' so saved-form autofill cannot overwrite a paste", () => {
    expect(placeIdInput.props.autoComplete).toBe("off");
  });

  it("has spellCheck={false} so 'ChIJ...' is not silently auto-corrected", () => {
    // Strictly `false` (the boolean prop value) — a refactor to the string
    // `"false"` (an easy slip with JSX) still suppresses spellcheck visually
    // in most browsers but is the legacy attribute form the post-React-17
    // typings reject; pin the boolean to surface that drift loudly.
    expect(placeIdInput.props.spellCheck).toBe(false);
  });

  it("is type='text', not 'email' / 'search' / 'url' (no browser validation)", () => {
    // type=email/url enforces keyboard validation that rejects valid
    // place_id chars (no `@` for email; the `ChIJ...` form is not a URL).
    // type=search adds a UA "x" reset button that visually offsets the input
    // and changes the placeholder behaviour on some browsers. type=text is
    // the only correct value here; pin against the three common slips.
    expect(placeIdInput.props.type).toBe("text");
  });
});

// --- placeholder UX: documents every accepted input form -------------------

describe("ReviewToolForm — placeId placeholder documents accepted forms", () => {
  // Methodology §1 / L1.5 / D-018 documents three accepted input forms: a
  // Google Maps place URL (`https://maps.google.com/...`), a `place_id`
  // (`ChIJ...`), and (per docs/methodology.md) numeric CIDs. The placeholder
  // is the only on-screen affordance that tells the user which forms are
  // accepted — a regression that narrowed it to URL-only (or ChIJ-only)
  // silently degrades UX for users pasting the other form: they type/paste,
  // submit, hit a `bad_request` error card downstream, and bounce.
  const placeIdInput = (() => {
    const inputs = findAll(
      tree,
      (el) =>
        el.type === "input" &&
        el.props.type === "text" &&
        el.props.name === "placeId",
    );
    return inputs[0];
  })();

  it("placeholder mentions the Google Maps URL form", () => {
    const ph = String(placeIdInput.props.placeholder ?? "");
    expect(ph.length).toBeGreaterThan(0);
    expect(ph.toLowerCase()).toContain("maps.google.com");
  });

  it("placeholder mentions the ChIJ short-form place_id", () => {
    const ph = String(placeIdInput.props.placeholder ?? "");
    // Case-significant: `ChIJ` is the canonical prefix the SF docs name
    // (D-018 normalisation rules); a placeholder copy of `chij...` would be
    // user-confusing about what to paste. Strict-substring assertion.
    expect(ph).toContain("ChIJ");
  });
});
