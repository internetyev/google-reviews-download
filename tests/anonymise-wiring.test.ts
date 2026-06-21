// L36.3 — wire the anonymisation controls through the web form + preview.
//
// The pure anonymisation layer is pinned by tests/reviews-anonymise.test.ts and
// the route's redaction params by tests/anonymise-params.test.ts +
// tests/api-reviews-anonymise.test.ts. This suite covers the new-feature surface
// L36.3 adds: the web form's privacy `<input type="checkbox">` controls (walked
// structurally with no react-dom, the D-050 technique the sibling
// project-wiring / sort-wiring / filter-wiring suites use) and the shared
// `parseAnonymiseOptions` that BOTH the route and the preview use to read those
// controls — so the checkbox names can't silently drift from the
// `ANONYMISE_PARAM_KEYS` the parser accepts, and an unchecked box stays the
// identity (today's full, un-redacted export).
//
// Run offline via `npx vitest run` (node_modules present since D-086).

import { describe, it, expect } from "vitest";
import {
  ANONYMISE_PARAM_KEYS,
  parseAnonymiseOptions,
  hasActiveAnonymise,
} from "@/lib/reviews/anonymise-params";
import { ReviewToolForm } from "@/app/_components/review-tool-form";

// --- the form controls (no react-dom structural walk) ----------------------

type El = { $$typeof: symbol; type: unknown; props: Record<string, unknown> };

function isElement(x: unknown): x is El {
  return (
    x != null &&
    typeof x === "object" &&
    "props" in (x as object) &&
    "$$typeof" in (x as object)
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

const tree = ReviewToolForm();

// The three granular redaction flags the form exposes (the `anonymize` umbrella
// stays API-only). Scoped by name so the column-picker / filter checkboxes on
// the same form don't bleed into the count.
const PRIVACY_NAMES = ["mask_author", "drop_author_url", "drop_photos"] as const;

function privacyCheckboxes(): El[] {
  return findAll(
    tree,
    (el) =>
      el.type === "input" &&
      el.props.type === "checkbox" &&
      typeof el.props.name === "string" &&
      (PRIVACY_NAMES as readonly string[]).includes(el.props.name as string),
  );
}

describe("ReviewToolForm — L36.3 privacy controls", () => {
  it("emits exactly one checkbox per granular redaction flag", () => {
    const names = privacyCheckboxes().map((c) => String(c.props.name));
    expect(names.slice().sort()).toEqual([...PRIVACY_NAMES].slice().sort());
  });

  it("every privacy checkbox name is a key parseAnonymiseOptions reads", () => {
    // Load-bearing: a control whose name the parser doesn't understand would
    // post a param the route/preview silently ignore (degrade to "no
    // redaction"). Pin each emitted name is in the shared ANONYMISE_PARAM_KEYS
    // so a typo (e.g. 'maskAuthor') fails loudly here.
    for (const c of privacyCheckboxes()) {
      expect(
        (ANONYMISE_PARAM_KEYS as readonly string[]).includes(
          String(c.props.name),
        ),
        `name=${String(c.props.name)}`,
      ).toBe(true);
    }
  });

  it("each privacy checkbox carries the truthy token value '1'", () => {
    // parseBooleanFlag accepts `1`/`true`/`yes`; the box must submit one of them
    // when checked, else checking it would be a silent no-op.
    for (const c of privacyCheckboxes()) {
      expect(c.props.value).toBe("1");
    }
  });

  it("no privacy box is pre-checked so the default is no redaction (opt-in)", () => {
    // An unchecked box submits no param → parseAnonymiseOptions {} →
    // anonymiseReviews identity → exactly today's un-redacted export. A refactor
    // that defaultChecked a box would silently start redacting every download.
    for (const c of privacyCheckboxes()) {
      expect(c.props.defaultChecked).toBeUndefined();
    }
  });

  it("each checked privacy box round-trips to its one AnonymiseOptions flag", () => {
    // The form name → parsed option mapping the preview + route both rely on.
    const expected: Record<string, keyof ReturnType<typeof parseAnonymiseOptions>> = {
      mask_author: "maskAuthorName",
      drop_author_url: "dropAuthorUrl",
      drop_photos: "dropPhotos",
    };
    for (const c of privacyCheckboxes()) {
      const name = String(c.props.name);
      const opts = parseAnonymiseOptions(
        new URLSearchParams(`${name}=${String(c.props.value)}`),
      );
      expect(opts[expected[name]], `name=${name}`).toBe(true);
      // and it sets ONLY that one flag, not the others.
      expect(hasActiveAnonymise(opts)).toBe(true);
      expect(Object.keys(opts)).toEqual([expected[name]]);
    }
  });
});

// --- the shared parser the form + route + preview all share -----------------

describe("parseAnonymiseOptions — the form/route/preview de-drift parser", () => {
  it("an absent / all-blank query is the identity (no redaction)", () => {
    expect(parseAnonymiseOptions(new URLSearchParams())).toEqual({});
    expect(hasActiveAnonymise(parseAnonymiseOptions(new URLSearchParams()))).toBe(
      false,
    );
    // A box left unchecked but its sibling submitted: only the sibling turns on.
    expect(parseAnonymiseOptions(new URLSearchParams("mask_author=1"))).toEqual({
      maskAuthorName: true,
    });
  });

  it("the `anonymize` umbrella turns on all three granular redactions", () => {
    expect(parseAnonymiseOptions(new URLSearchParams("anonymize=1"))).toEqual({
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
    // the `anonymise` (en-GB) spelling is an accepted alias.
    expect(parseAnonymiseOptions(new URLSearchParams("anonymise=true"))).toEqual({
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
  });

  it("only truthy tokens count — a falsey value is 'don't redact'", () => {
    // Mirrors the unchecked-box semantics: a `mask_author=0` (never emitted by
    // the no-JS form, but defensible on the API) must not redact.
    expect(parseAnonymiseOptions(new URLSearchParams("mask_author=0"))).toEqual(
      {},
    );
    expect(
      parseAnonymiseOptions(new URLSearchParams("drop_photos=nope")),
    ).toEqual({});
  });
});
