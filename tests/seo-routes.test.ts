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

  it("stays root-only until L3.1b flips the corgi-picked top 5", () => {
    // Documents the pre-L3.1b state: no variant is published yet (gated on
    // L1.6b). When L3.1b lands, the sitemap grows by exactly the published
    // count and this length assertion is the intended, reviewed change —
    // mirrors the seo-variants suite's pre-L3.1b note (D-044).
    expect(publishedVariants()).toHaveLength(0);
    expect(sitemap()).toHaveLength(1);
  });

  it("honours NEXT_PUBLIC_SITE_URL for the root URL too", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://grd.example.com/";
    const entries = sitemap();
    expect(entries.some((e) => e.url === "https://grd.example.com/")).toBe(
      true,
    );
  });
});
