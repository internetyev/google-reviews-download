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
