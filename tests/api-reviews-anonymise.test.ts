// Coverage for the optional PII-redaction flags on /api/reviews (L36.2). Net-new
// feature code: the `anonymize`/`anonymise` umbrella plus the granular
// `mask_author`/`drop_author_url`/`drop_photos` flags are parsed into an
// `AnonymiseOptions` and applied as a uniform pass over the assembled+sliced
// reviews, BEFORE projection and every serialisation surface, so JSON/CSV/XLSX
// redact identically. The load-bearing contracts a consumer depends on:
//   - absent flags → un-redacted full reviews (additive, unchanged);
//   - `mask_author` replaces each `author_name` with initials;
//   - `drop_photos` strips the `photos` key from the rows that carried it;
//   - the `anonymize` umbrella enables all three at once;
//   - a bad/blank/non-truthy value degrades to "no redaction" (identity), never
//     a 400 — like the lenient summary/filter/sort/fields params;
//   - redaction composes with `limit` (applied to the trimmed view) and with
//     `fields` (masking happens before projection, so a masked column survives);
//   - CSV/XLSX still return a well-formed download with redaction set.
//
// Same offline posture as tests/api-reviews-project.test.ts: GET is driven with
// a real NextRequest, SF_API_KEY/KV_* unset so the committed MOCK_SMALL_001
// fixture and a fresh memory cache serve every request.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reviews/route";

const ENV_KEYS = [
  "SF_API_KEY",
  "SF_API_BASE",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function call(query: string) {
  return GET(new NextRequest(`https://grd.test/api/reviews${query}`));
}

// Initials-only display name: every word reduced to "X." joined by spaces.
const MASKED = /^([\p{L}\p{N}]\.)(\s[\p{L}\p{N}]\.)*$|^Anonymous$/u;

describe("GET /api/reviews — mask_author", () => {
  it("leaves author_name intact when no redaction flag is set", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001")).json();
    // The fixture carries full display names like "Maria S.", "Tom L.".
    expect(body.reviews.some((r: { author_name: string }) => r.author_name.includes(" "))).toBe(true);
    expect(body.reviews[0].author_name).toBe("Maria S.");
  });

  it("masks every author_name to initials", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&mask_author=1")
    ).json();
    for (const r of body.reviews) {
      expect(r.author_name, r.author_name).toMatch(MASKED);
    }
    // "Maria S." -> "M. S." specifically.
    expect(body.reviews[0].author_name).toBe("M. S.");
  });

  it("touches only author_name, leaving rating/text/published_at intact", async () => {
    const plain = await (await call("?placeId=MOCK_SMALL_001")).json();
    const masked = await (
      await call("?placeId=MOCK_SMALL_001&mask_author=1")
    ).json();
    for (let i = 0; i < plain.reviews.length; i++) {
      expect(masked.reviews[i].rating).toBe(plain.reviews[i].rating);
      expect(masked.reviews[i].text).toBe(plain.reviews[i].text);
      expect(masked.reviews[i].published_at).toBe(plain.reviews[i].published_at);
    }
  });
});

describe("GET /api/reviews — drop_photos", () => {
  it("the un-redacted response has at least one review carrying photos", async () => {
    const body = await (await call("?placeId=MOCK_SMALL_001")).json();
    expect(
      body.reviews.some((r: { photos?: unknown[] }) => Array.isArray(r.photos) && r.photos.length > 0),
    ).toBe(true);
  });

  it("strips the photos key from every review", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&drop_photos=1")
    ).json();
    for (const r of body.reviews) {
      expect("photos" in r, JSON.stringify(r)).toBe(false);
    }
  });
});

describe("GET /api/reviews — anonymize umbrella", () => {
  it("enables masking + photo-drop in one switch", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&anonymize=1")
    ).json();
    for (const r of body.reviews) {
      expect(r.author_name).toMatch(MASKED);
      expect("photos" in r).toBe(false);
      expect("author_url" in r).toBe(false);
    }
  });

  it("accepts the `anonymise` (en-GB) alias", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&anonymise=true")
    ).json();
    expect(body.reviews[0].author_name).toBe("M. S.");
  });
});

describe("GET /api/reviews — leniency & composition", () => {
  it("degrades a bad/blank/non-truthy value to no redaction (no 400)", async () => {
    for (const v of ["", "0", "false", "banana"]) {
      const res = await call(`?placeId=MOCK_SMALL_001&mask_author=${v}`);
      expect(res.status, `mask_author=${v}`).toBe(200);
      const body = await res.json();
      expect(body.reviews[0].author_name, `mask_author=${v}`).toBe("Maria S.");
    }
  });

  it("composes with limit (redaction applied to the trimmed view)", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&mask_author=1&limit=2")
    ).json();
    expect(body.reviews.length).toBe(2);
    for (const r of body.reviews) expect(r.author_name).toMatch(MASKED);
  });

  it("masks before projection, so a selected author_name column is redacted", async () => {
    const body = await (
      await call("?placeId=MOCK_SMALL_001&mask_author=1&fields=author_name,rating")
    ).json();
    for (const r of body.reviews) {
      expect(Object.keys(r).sort()).toEqual(["author_name", "rating"]);
      expect(r.author_name).toMatch(MASKED);
    }
  });
});

describe("GET /api/reviews — CSV/XLSX redaction", () => {
  it("returns a well-formed CSV with the author column masked", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=csv&mask_author=1");
    expect(res.status).toBe(200);
    const text = await res.text();
    // The full display names must be gone from the file body.
    expect(text).not.toContain("Maria S.");
    expect(text).toContain('"M. S."');
  });

  it("returns a well-formed XLSX download with redaction set", async () => {
    const res = await call("?placeId=MOCK_SMALL_001&format=xlsx&anonymize=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
