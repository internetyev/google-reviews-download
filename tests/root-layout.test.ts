// Render-contract guard for app/layout.tsx (L2.10 / D-035 family).
//
// app/layout.tsx is the last runtime module without a dedicated suite. The
// home-page suite (home-page.test) already pins the *inherited* layout
// metadata, but two layout-owned contracts are pinned nowhere and each guards
// a real, silent regression:
//
//   1. The env-gated Plausible analytics snippet (L2.10). The snippet renders
//      *only* when `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is set. Both failure modes
//      are real: a snippet that renders unconditionally ships analytics on
//      every build (including local/preview, and before the human has signed
//      off on tracking — a privacy regression), while a snippet that never
//      renders means a deployed site collects nothing despite the env var
//      being set. We pin both sides: present-and-correct when the var is set,
//      and *absent* when it is not. When present, the script must be the
//      real next/script `<Script>` (the `afterInteractive` strategy and the
//      deferred load only work through next/script), carry the env value as
//      `data-domain`, the canonical plausible.io src, and be `defer`red.
//
//   2. The document shell: a single `<html lang="en">` and a single `<body>`
//      whose className carries the design-token classes, with `children`
//      passed through into the body (not dropped, not double-wrapped). A
//      refactor that lost `lang` (an a11y/SEO regression) or stopped rendering
//      children fails here.
//
// `RootLayout` is a pure, synchronous, hookless server component: it reads
// `process.env` at call time and returns intrinsic elements plus the imported
// `<Script>`. So the same no-react-dom structural walk the other suites use
// (D-050) reaches everything — we never render, never touch the DOM, and the
// `<Script>` is identified by reference identity against the same `next/script`
// import the layout uses (module identity holds: one module instance), with a
// props cross-check so the assertion can't pass on the wrong element.
//
// `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is captured and restored per-test (D-044 env
// pattern, same as seo-routes.test): a dev shell or CI runner that exported it
// would otherwise silently route the "absent" assertions down the present
// path. Committed, not run in-routine (no node_modules; `npm install` is a
// human step — D-039/D-040/D-042 posture, same as every other suite).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Script from "next/script";
import RootLayout, { metadata } from "@/app/layout";
import * as rootLayoutModule from "@/app/layout";

// --- tiny tree utilities (no react-dom; same shape as home-page.test) -------

type El = { $$typeof: symbol; type: unknown; props: Record<string, unknown> };

function isElement(x: unknown): x is El {
  return (
    x != null &&
    typeof x === "object" &&
    "$$typeof" in (x as object) &&
    "props" in (x as object)
  );
}

// Structural walk: descend props.children WITHOUT invoking function
// components, so intrinsic tags (html/head/body) and the next/script <Script>
// element are visited as they sit in RootLayout's returned tree (D-050).
function eachElement(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) eachElement(n, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  eachElement(node.props?.children, visit);
}

function elementsWhere(root: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  eachElement(root, (el) => {
    if (pred(el)) out.push(el);
  });
  return out;
}

const PLAUSIBLE_SRC = "https://plausible.io/js/script.js";
const ENV = "NEXT_PUBLIC_PLAUSIBLE_DOMAIN";
// A sentinel child so we can prove `children` is passed through into <body>.
const CHILD_SENTINEL = "ROOT_LAYOUT_CHILD_SENTINEL";
const childMarker = { $$typeof: Symbol.for("react.element"), type: "div", props: { children: CHILD_SENTINEL } } as unknown as React.ReactNode;

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV];
  delete process.env[ENV];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

// --- the env-gated Plausible snippet ----------------------------------------

describe("RootLayout — env-gated Plausible analytics snippet (L2.10)", () => {
  it("renders NO analytics script when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is unset", () => {
    // beforeEach already deleted the var. Neither a next/script <Script> nor
    // any element pointing at plausible.io may appear — an unconditional
    // snippet would track every build before the human opts in.
    const tree = RootLayout({ children: childMarker });
    const scripts = elementsWhere(tree, (el) => el.type === Script);
    expect(scripts).toHaveLength(0);
    const plausibleAny = elementsWhere(tree, (el) =>
      typeof el.props?.src === "string" && (el.props.src as string).includes("plausible.io"),
    );
    expect(plausibleAny).toHaveLength(0);
  });

  it("renders exactly one Plausible <Script> when the domain is set", () => {
    process.env[ENV] = "example.com";
    const tree = RootLayout({ children: childMarker });
    const scripts = elementsWhere(tree, (el) => el.type === Script);
    expect(scripts).toHaveLength(1);
    // Cross-check by props so the reference-identity match can't be a fluke:
    // it is the canonical plausible loader carrying the env value as the
    // data-domain, loaded deferred via the afterInteractive strategy.
    const s = scripts[0];
    expect(s.props.src).toBe(PLAUSIBLE_SRC);
    expect(s.props["data-domain"]).toBe("example.com");
    expect(s.props.defer).toBeTruthy();
    expect(s.props.strategy).toBe("afterInteractive");
  });

  it("threads the exact domain value through to data-domain", () => {
    // A different value to prove data-domain is the env var, not a constant.
    process.env[ENV] = "reviews.acme.io";
    const tree = RootLayout({ children: childMarker });
    const scripts = elementsWhere(tree, (el) => el.type === Script);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].props["data-domain"]).toBe("reviews.acme.io");
  });
});

// --- the document shell ------------------------------------------------------

describe("RootLayout — document shell", () => {
  it("returns a single <html lang=\"en\"> root", () => {
    const tree = RootLayout({ children: childMarker });
    const html = elementsWhere(tree, (el) => el.type === "html");
    expect(html).toHaveLength(1);
    expect(html[0].props.lang).toBe("en");
  });

  it("renders a single <body> carrying the design-token className", () => {
    const tree = RootLayout({ children: childMarker });
    const body = elementsWhere(tree, (el) => el.type === "body");
    expect(body).toHaveLength(1);
    const cls = body[0].props.className;
    expect(typeof cls).toBe("string");
    // The tokens the rest of the app's styling assumes are present on body.
    expect(cls as string).toMatch(/\bbg-background\b/);
    expect(cls as string).toMatch(/\btext-foreground\b/);
    expect(cls as string).toMatch(/\bmin-h-screen\b/);
  });

  it("passes children through into the <body> (not dropped, not double-wrapped)", () => {
    const tree = RootLayout({ children: childMarker });
    const body = elementsWhere(tree, (el) => el.type === "body")[0];
    // The sentinel child must be reachable somewhere under body.
    const sentinelSeen = elementsWhere(body, (el) =>
      el.props?.children === CHILD_SENTINEL,
    );
    expect(sentinelSeen).toHaveLength(1);
  });
});

// --- the layout-owned metadata (self-contained sanity; home-page.test pins
//     the *inherited* view, this pins the layout's own export) ---------------

describe("RootLayout — owned static metadata", () => {
  it("exports a static metadata object with title + format-naming description", () => {
    expect(typeof metadata.title).toBe("string");
    expect((metadata.title as string).length).toBeGreaterThan(0);
    const desc = metadata.description;
    expect(typeof desc).toBe("string");
    expect(desc as string).toMatch(/CSV/i);
    expect(desc as string).toMatch(/JSON/i);
    expect(desc as string).toMatch(/XLSX/i);
  });
});

// --- D-079 (L22.1): module export surface, per-call freshness, html-as-root --

// (a) Pins the `app/layout.tsx` module's *exact* named-export surface. The
//     existing import of `metadata` proves the named export exists, but does
//     not catch a surplus `export const dynamic`/`revalidate`/`runtime`/
//     `fetchCache`/`viewport` — each of which silently changes the root
//     layout's SSG/ISR/runtime/viewport contract without altering the rendered
//     output. Symmetric with L18.1/D-075's variant-route exact-surface pin,
//     L20.1/D-077's faq-module exact-surface pin, and L21.1/D-078's home-route
//     exact-surface pin, here applied to the root layout module.
describe("RootLayout — module's named-export surface is exactly { default, metadata }", () => {
  it("Object.keys(rootLayoutModule).sort() is exactly [\"default\", \"metadata\"]", () => {
    expect(Object.keys(rootLayoutModule).sort()).toEqual(["default", "metadata"]);
  });
});

// (b) Pins that RootLayout() returns a *fresh* element tree per call. A `const
//     TREE = (<html>...</html>); export default function RootLayout(...) {
//     return TREE; }` "avoid the allocation" refactor would freeze the tree at
//     module-load and let any downstream reconciler/test/dev-tools mutation
//     leak across renders. `.toEqual()` cannot catch this because the structures
//     remain equal; only identity comparison does. Mirrors L21.1/D-078's
//     `HomePage` freshness pin pushed onto the root layout's returned tree.
//
//     Two its on purpose: a hoist of the *whole* tree fails the first; a hoist
//     of just the `<body>` subtree (root re-allocated, body reused) fails the
//     second.
describe("RootLayout — returns a fresh element tree per call", () => {
  it("two calls return reference-distinct root <html> elements", () => {
    const a = RootLayout({ children: childMarker });
    const b = RootLayout({ children: childMarker });
    expect(a).not.toBe(b);
  });

  it("two calls return reference-distinct <body> elements", () => {
    const a = RootLayout({ children: childMarker });
    const b = RootLayout({ children: childMarker });
    const aBody = elementsWhere(a, (el) => el.type === "body")[0];
    const bBody = elementsWhere(b, (el) => el.type === "body")[0];
    expect(aBody).not.toBe(bBody);
  });
});

// (c) Pins that <html> is the *outermost* returned element, not just *present*.
//     The existing `html.length === 1` count passes whether <html> sits at the
//     root or is wrapped in any outer container — wrapping silently breaks the
//     document-root contract React expects from a Next App-Router root layout
//     (the root layout MUST return the `<html>` element as the root of the
//     document tree React feeds to the runtime; SSR + hydration assume it).
describe("RootLayout — <html> is the outermost returned element", () => {
  it("the returned root is literally an element (not array/Fragment/string)", () => {
    // Negative side of the pin: a refactor that returned a Fragment (`<>...</>`)
    // or a bare array of siblings would still walk fine with eachElement but
    // would not be an outermost <html>. isElement(tree) catches arrays and
    // primitives; the next it pins the element's type itself.
    const tree = RootLayout({ children: childMarker });
    expect(Array.isArray(tree)).toBe(false);
    expect(isElement(tree)).toBe(true);
  });

  it("(tree as El).type === \"html\" (root is the <html> node itself)", () => {
    // A `<div><html>...</html></div>` or `<><html>...</html></>` wrapper would
    // still satisfy `html.length === 1` from the document-shell describe — only
    // this identity check pins that the root layout IS the <html>.
    const tree = RootLayout({ children: childMarker });
    expect((tree as unknown as El).type).toBe("html");
  });
});
