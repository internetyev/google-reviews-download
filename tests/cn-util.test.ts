// Regression guard for lib/utils.ts — the `cn()` className helper (L8.4).
//
// `cn(...inputs)` is `twMerge(clsx(inputs))`: clsx flattens/conditions the
// inputs into a space-joined string, then tailwind-merge collapses
// *conflicting* Tailwind utilities so the last one wins. It is tiny but every
// component in the tree calls it to compose classes, so a behavioural change
// from a clsx (^2.1.1) or tailwind-merge (^2.5.5) bump would silently reshape
// class strings site-wide. This pins both halves of the contract:
//
//   1. clsx layer — string/array/object/conditional inputs are joined and
//      falsy entries (false, null, undefined, 0, "") are dropped.
//   2. tailwind-merge layer — among classes that target the *same* CSS
//      property the later one wins (`cn("p-2","p-4") === "p-4"`), while
//      non-conflicting classes are all preserved and order is stable.
//
// Pure function, no I/O, no DOM. Committed, not run in-routine (repo is
// manifest-only, no node_modules; `npm install` is a human step — same
// D-039/D-040/D-042 posture as every other suite; runs on `npm test`).

import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn — clsx input handling", () => {
  it("joins plain string arguments with single spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("flattens array inputs", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("expands object inputs by truthy value", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("keeps the truthy side of a conditional and drops the falsy one", () => {
    const active = true;
    const disabled = false;
    expect(cn("base", active && "on", disabled && "off")).toBe("base on");
  });

  it("drops every falsy entry (false, null, undefined, 0, empty string)", () => {
    expect(cn("a", false, null, undefined, 0, "", "b")).toBe("a b");
  });

  it("returns an empty string when no class survives", () => {
    expect(cn(false, null, undefined, "")).toBe("");
  });
});

describe("cn — tailwind-merge conflict resolution", () => {
  it("lets the later conflicting Tailwind utility win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("resolves a conflict introduced via a conditional, last-wins", () => {
    expect(cn("p-2", true && "p-4")).toBe("p-4");
  });

  it("keeps non-conflicting utilities and preserves their order", () => {
    expect(cn("p-4", "text-sm", "font-bold")).toBe("p-4 text-sm font-bold");
  });

  it("only collapses the conflicting axis, not unrelated ones", () => {
    // px-* and py-* are different axes from p-*; the last p-* wins but the
    // axis-specific ones for *other* sides survive alongside it.
    expect(cn("text-sm", "p-2", "p-4", "font-bold")).toBe(
      "text-sm p-4 font-bold",
    );
  });

  it("dedupes an exact repeated class to a single occurrence", () => {
    expect(cn("flex", "flex")).toBe("flex");
  });
});

// L12.3 deepening (D-068) — the existing suite proves the *same-class* last-wins
// rule (`p-2` then `p-4` → `p-4`) and the non-conflicting survival rule, but
// three load-bearing tailwind-merge behaviours that components actually depend
// on were unguarded:
//
//   (a) directional vs shorthand interaction — `cn("p-4", "px-2")` must keep
//       both (later more-specific overrides only its axis), `cn("px-2", "p-4")`
//       collapses to `p-4` (later broader nukes the specific). A regression to
//       naive same-prefix last-wins would still pass every existing test and
//       silently break every component using the `cn(base, overrides)` pattern;
//   (b) variant-aware conflict scoping — `hover:`/`sm:` open independent scopes,
//       so `cn("p-2", "hover:p-4")` keeps both but `cn("hover:p-2", "hover:p-4")`
//       collapses to `hover:p-4`. A regression that ignored variants would nuke
//       every responsive/state-prefixed utility paired with an unprefixed one;
//   (c) property-aware (not prefix-aware) conflicts — `text-sm` (font-size) and
//       `text-blue-500` (color) share a *prefix* but target different CSS
//       properties and must both survive, while `text-red-500` + `text-blue-500`
//       (same property) collapses last-wins. A "merge by prefix" regression
//       would silently strip the type-scale class from every coloured-text
//       element on the site.

describe("cn — directional vs shorthand interaction", () => {
  it("keeps the later more-specific axis utility alongside the broad one", () => {
    // `cn(base, overrides)` is the common component pattern: a base `p-4`
    // followed by a per-call `px-2` must yield "p-4 px-2", not "p-4" or "px-2".
    expect(cn("p-4", "px-2")).toBe("p-4 px-2");
  });

  it("collapses when a later broad utility supersedes a specific one", () => {
    // The reverse direction: a per-call broad `p-4` overrides the prior `px-2`
    // because the broader utility's axis covers the specific one fully.
    expect(cn("px-2", "p-4")).toBe("p-4");
  });

  it("preserves a single-side override against a different broad axis", () => {
    // `p-4` covers all sides; a later `pt-2` overrides only the top side, so
    // both must survive (a "same root → drop" regression would nuke `pt-2`).
    expect(cn("p-4", "pt-2")).toBe("p-4 pt-2");
  });

  it("collapses a chain of specifics under a trailing shorthand", () => {
    // The terminal `p-8` covers every axis the prior specifics named, so
    // tailwind-merge drops them all — pins the multi-step collapse path.
    expect(cn("pt-2", "pl-4", "p-8")).toBe("p-8");
  });
});

describe("cn — variant-aware conflict scoping", () => {
  it("keeps an unprefixed utility alongside its variant-prefixed conflict", () => {
    // `p-2` and `hover:p-4` are *different* conflict scopes — the variant
    // opens an independent merge bucket — so both must ship.
    expect(cn("p-2", "hover:p-4")).toBe("p-2 hover:p-4");
  });

  it("collapses two utilities sharing the same variant prefix, last-wins", () => {
    // Within the `hover:` scope the normal same-class last-wins rule applies.
    expect(cn("hover:p-2", "hover:p-4")).toBe("hover:p-4");
  });

  it("treats `sm:` as a distinct scope from unprefixed", () => {
    // Asserted on a second variant so a regression that only handled `hover:`
    // correctly (or vice-versa) still fails on one of the two.
    expect(cn("text-sm", "sm:text-lg")).toBe("text-sm sm:text-lg");
  });

  it("collapses within a single `sm:` scope and leaves other scopes alone", () => {
    // Three buckets: unprefixed `p-2`, `sm:` (last wins → `sm:p-8`), `hover:`
    // (single entry survives). All three coexist; the `sm:` collapse is the
    // load-bearing assertion that proves the bucketing is real, not coincidental.
    expect(cn("p-2", "sm:p-4", "sm:p-8", "hover:p-4")).toBe(
      "p-2 sm:p-8 hover:p-4",
    );
  });
});

describe("cn — property-aware (not prefix-aware) conflicts", () => {
  it("keeps `text-sm` (font-size) alongside `text-blue-500` (color)", () => {
    // Both start with `text-` but target distinct CSS properties — the
    // load-bearing case that proves tailwind-merge groups by *property*, not
    // by token prefix. A naive prefix-based regression would strip the size.
    expect(cn("text-sm", "text-blue-500")).toBe("text-sm text-blue-500");
  });

  it("collapses two text-colors in the same property scope, last-wins", () => {
    // Same `text-` prefix, same property (color) → last wins.
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("collapses two font-weights in the same property scope, last-wins", () => {
    // A second property family (font-weight) so the property-awareness can't
    // pass vacuously on the color family alone.
    expect(cn("font-bold", "font-medium")).toBe("font-medium");
  });

  it("keeps `bg-blue-500` and `text-white` — distinct properties entirely", () => {
    // Different prefix AND different property — the trivial keep-both case,
    // pinned so a wholesale "drop on shared substring" regression fails loudly.
    expect(cn("bg-blue-500", "text-white")).toBe("bg-blue-500 text-white");
  });
});

describe("cn — no-arg and pre-joined input edges", () => {
  it("returns an empty string when called with no arguments", () => {
    // The zero-arg case the existing "no class survives" test doesn't cover.
    expect(cn()).toBe("");
  });

  it("treats a single space-separated string as multiple classes for merging", () => {
    // `cn("p-2 p-4")` and `cn("p-2", "p-4")` should both collapse to `p-4`:
    // tailwind-merge tokenises whitespace inside a single arg, not just across
    // args. A regression that only merged across args would let `p-2 p-4`
    // through as a literal two-class string.
    expect(cn("p-2 p-4")).toBe("p-4");
  });
});
