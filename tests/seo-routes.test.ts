// Regression guard for app/robots.ts + app/sitemap.ts (L3.2a / D-035).
//
// Three contracts break silently and expensively if these drift:
//   - robots.ts must Disallow *only* `/api/` — a stray `/` Disallow
//     deindexes the whole site; a missing `/api/` lets crawlers hammer
//     the metered export endpoint.
//   - both routes resolve the site origin from `NEXT_PUBLIC_SITE_URL`
//     with the documented `https://googlereviewsdownload.com` fallback
//     (D-035): green build pre-domain-purchase, trailing slash stripped,
//     surrounding whitespace trimmed, empty/blank → fallback. A wrong
//     base poisons every absolute URL in the sitemap and the robots
//     `host`/`sitemap` lines.
//   - sitemap.ts enumerates exactly the root `/` plus `publishedVariants()`
//     — empty pre-L3.1b, so the sitemap is byte-stable until the reviewed
//     L3.1b publish flip (mirrors the seo-variants suite's pre-L3.1b note,
//     D-044). A regression that enumerated the full registry would ship
//     ten 404s into the sitemap.
//
// `NEXT_PUBLIC_SITE_URL` is captured and restored per-test (D-044 env
// pattern): a dev shell or CI runner that exports it would otherwise
// silently route the fallback assertions down the override path. Both
// modules are pure (no I/O) — committed-not-run (D-039/D-040/D-042
// posture: manifest-only, no `node_modules`; runs on `npm install && npm test`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { publishedVariants } from "@/lib/seo/variants";

const FALLBACK = "https://googlereviewsdownload.com";

let savedSiteUrl: string | undefined;

beforeEach(() => {
  savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  if (savedSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
  }
});

describe("robots() — crawl policy", () => {
  it("has exactly one wildcard rule allowing `/` and disallowing only `/api/`", () => {
    const r = robots();
    expect(Array.isArray(r.rules)).toBe(true);
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules).toHaveLength(1);

    const rule = rules[0];
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");

    const disallow = Array.isArray(rule.disallow)
      ? rule.disallow
      : [rule.disallow];
    expect(disallow).toEqual(["/api/"]);
    // The whole-site killer: `/` must never appear in Disallow.
    expect(disallow).not.toContain("/");
  });

  it("points `sitemap` and `host` at the fallback origin when env is unset", () => {
    const r = robots();
    expect(r.sitemap).toBe(`${FALLBACK}/sitemap.xml`);
    expect(r.host).toBe(FALLBACK);
  });

  it("honours NEXT_PUBLIC_SITE_URL and strips a single trailing slash", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://grd.example.com/";
    const r = robots();
    expect(r.host).toBe("https://grd.example.com");
    expect(r.sitemap).toBe("https://grd.example.com/sitemap.xml");
  });

  it("trims surrounding whitespace before using the override", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://grd.example.com  ";
    expect(robots().host).toBe("https://grd.example.com");
  });

  it("falls back when the override is blank/whitespace-only", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect(robots().host).toBe(FALLBACK);
  });
});

describe("sitemap() — URL enumeration", () => {
  it("always emits the root entry with weekly/priority-1 and an absolute URL", () => {
    const entries = sitemap();
    const root = entries.find((e) => e.url === `${FALLBACK}/`);
    expect(root).toBeDefined();
    expect(root!.changeFrequency).toBe("weekly");
    expect(root!.priority).toBe(1);
    for (const e of entries) {
      expect(e.url.startsWith(`${FALLBACK}/`)).toBe(true);
    }
  });

  it("enumerates exactly root + publishedVariants() — nothing else", () => {
    const entries = sitemap();
    const pub = publishedVariants();
    expect(entries).toHaveLength(1 + pub.length);

    const urls = new Set(entries.map((e) => e.url));
    expect(urls.has(`${FALLBACK}/`)).toBe(true);
    for (const v of pub) {
      expect(urls.has(`${FALLBACK}/${v.slug}`)).toBe(true);
    }
  });

  it("variant entries carry monthly/priority-0.8 when present", () => {
    const entries = sitemap();
    for (const e of entries) {
      if (e.url === `${FALLBACK}/`) continue;
      expect(e.changeFrequency).toBe("monthly");
      expect(e.priority).toBe(0.8);
    }
  });

  it("includes the live Tier-1 money pages (L3.1b landed)", () => {
    // L3.1b: the sitemap now carries root + the published variants. Pinned
    // against publishedVariants() so it tracks the live set automatically.
    expect(publishedVariants().length).toBeGreaterThan(0);
    expect(sitemap()).toHaveLength(1 + publishedVariants().length);
  });

  it("honours NEXT_PUBLIC_SITE_URL for the root URL too", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://grd.example.com/";
    const entries = sitemap();
    expect(entries.some((e) => e.url === "https://grd.example.com/")).toBe(
      true,
    );
  });
});

// L14.1: deepening describes that pin the contracts the per-module suites
// above cannot reach on their own (D-071).
//
// Cross-module symmetry (D-071 (a)). `app/robots.ts` and `app/sitemap.ts`
// each carry a *private* copy of `siteUrl()` — same FALLBACK constant, same
// trim+trailing-slash-strip logic, same blank→fallback path. The describes
// above pin all four env states on the robots side but only one on the
// sitemap side. If the two private helpers drift (a copy-edit to the
// fallback constant in one file; a refactor that adds trim-and-not-strip in
// the other), the robots `host` directive silently disagrees with every
// sitemap URL's origin — the canonical-host cross-reference Google relies
// on breaks with no runtime signal. Pinned symmetrically on the same four
// env states, asserting `robots().host` equals the sitemap's root-URL
// origin for every one.
//
// `lastModified` freshness (D-071 (b)). The sitemap suite asserts entry
// shape but never the freshness contract — `new Date()` per call is what
// makes the `<lastmod>` field track actual deploys. A regression to
// `new Date("2025-01-01")` (a hardcoded vintage) or a module-level
// `const now = new Date()` (memoised at import, frozen across calls) would
// silently stop refreshing — Google would see a permanent stale lastmod and
// crawl less often. Pinned via both timestamp window (the field is computed
// inside the call window, not before it) and reference inequality across
// two calls (`new Date()` returns a fresh object each time).
//
// URL uniqueness (D-071 (c)). The sitemap suite counts entries by length
// and looks up each variant URL with `urls.has(...)`, but never asserts
// uniqueness — a regression that double-spread `publishedVariants()` would
// pass `length === 1 + pub.length` only when `pub` is empty (it is
// pre-L3.1b), and once L3.1b lands the suite would silently accept a
// sitemap with duplicate variant URLs. Pinned as a Set-size equality so
// the load-bearing property fires at the L3.1b flip.

describe("siteUrl() — cross-module symmetry (robots vs sitemap)", () => {
  const cases: ReadonlyArray<{ label: string; env: string | undefined; expected: string }> = [
    { label: "env unset → fallback", env: undefined, expected: FALLBACK },
    { label: "trailing slash stripped", env: "https://grd.example.com/", expected: "https://grd.example.com" },
    { label: "surrounding whitespace trimmed", env: "  https://grd.example.com  ", expected: "https://grd.example.com" },
    { label: "blank/whitespace-only → fallback", env: "   ", expected: FALLBACK },
  ];

  for (const { label, env, expected } of cases) {
    it(`robots.host === sitemap root origin for env "${label}"`, () => {
      if (env === undefined) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = env;
      }

      const robotsHost = robots().host;
      // Root URL is always `${base}/` — strip the trailing slash to get the
      // origin the robots `host` directive carries.
      const rootEntry = sitemap().find((e) => e.url.endsWith("/"));
      expect(rootEntry).toBeDefined();
      const sitemapOrigin = rootEntry!.url.slice(0, -1);

      expect(robotsHost).toBe(expected);
      expect(sitemapOrigin).toBe(expected);
      // And the robots `sitemap` URL must point at the same origin too —
      // a drift here orphans the sitemap from the crawl-policy file.
      expect(robots().sitemap).toBe(`${expected}/sitemap.xml`);
    });
  }
});

describe("sitemap() — lastModified freshness", () => {
  it("emits a real Date instance on every entry, computed at call-time", () => {
    const before = Date.now();
    const entries = sitemap();
    const after = Date.now();

    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.lastModified).toBeInstanceOf(Date);
      const ts = (e.lastModified as Date).getTime();
      // Pinned inside the call window — proves the field is *computed*
      // when sitemap() runs, not a literal vintage like
      // `new Date("2025-01-01")` and not a module-load-time constant.
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    }
  });

  it("creates a fresh Date object on each call — not memoised at module load", () => {
    const first = sitemap()[0].lastModified as Date;
    const second = sitemap()[0].lastModified as Date;

    // Reference inequality is the load-bearing assertion: a module-level
    // `const now = new Date()` would return the same instance forever
    // (timestamps would also coincide, so `.getTime()` equality is silent
    // about that regression). `new Date()` per call always allocates a
    // fresh object, so `second !== first` proves the per-call allocation.
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(Date);
    expect(first).toBeInstanceOf(Date);
  });
});

describe("sitemap() — URL uniqueness", () => {
  it("emits no duplicate URLs across all entries", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    // Pre-L3.1b this is trivially 1 entry; post-L3.1b it is the load-bearing
    // guard against a regression that double-spread `publishedVariants()`
    // (which would silently emit the same variant URL twice, splitting the
    // crawler's link equity and the analytics signal across one canonical
    // and one duplicate). The `urls.has(...)` checks in the existing
    // describes are not sensitive to this — a Set lookup hides duplicates.
    expect(new Set(urls).size).toBe(urls.length);
  });
});
