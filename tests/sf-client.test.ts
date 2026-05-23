// Regression guard for lib/semanticforce/client.ts (methodology §2–§3).
//
// Two contracts matter here and a silent change to either is a correctness bug:
//   1. Fixture fallback — with no SF_API_KEY the client MUST serve the committed
//      mocks (the whole routine is mock-first; a regression here would either
//      hit a real API or 500). Paging over the 500-review large fixture is the
//      stress path for limit-clamp + cursor round-trip.
//   2. HTTP wiring — when creds are present the request URL/headers and the
//      status→error-code mapping are the live integration surface (L4.1).
//
// No network: HttpClient is exercised through an injected `fetchImpl` stub.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSemanticForceClient, __testing } from "@/lib/semanticforce/client";
import { SemanticForceError } from "@/lib/semanticforce/types";

// createSemanticForceClient reads process.env when options are omitted; pin a
// known-empty env so "no key → fixture" is deterministic regardless of host.
let savedKey: string | undefined;
let savedBase: string | undefined;

beforeEach(() => {
  savedKey = process.env.SF_API_KEY;
  savedBase = process.env.SF_API_BASE;
  delete process.env.SF_API_KEY;
  delete process.env.SF_API_BASE;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.SF_API_KEY;
  else process.env.SF_API_KEY = savedKey;
  if (savedBase === undefined) delete process.env.SF_API_BASE;
  else process.env.SF_API_BASE = savedBase;
});

describe("createSemanticForceClient — fixture fallback (no SF_API_KEY)", () => {
  it("returns a client that serves the small fixture by exact id", async () => {
    const client = createSemanticForceClient();
    const res = await client.getReviews({ placeId: "MOCK_SMALL_001" });
    expect(res.place.place_id).toBe("MOCK_SMALL_001");
    expect(res.reviews).toHaveLength(12); // whole fixture, under default limit
    expect(res.next_cursor).toBeUndefined();
  });

  it("an explicit empty apiKey still falls back to fixtures", async () => {
    const client = createSemanticForceClient({ apiKey: "" });
    const res = await client.getReviews({ placeId: "MOCK_MID_001" });
    expect(res.place.place_id).toBe("MOCK_MID_001");
  });

  it("defaults to a 50-review page and emits a cursor when more remain", async () => {
    const client = createSemanticForceClient();
    const res = await client.getReviews({ placeId: "MOCK_LARGE_001" });
    expect(res.reviews).toHaveLength(50);
    expect(res.next_cursor).toBeTruthy();
  });

  it("walks the 500-review large fixture page-by-page via next_cursor", async () => {
    const client = createSemanticForceClient();
    const ids = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await client.getReviews({
        placeId: "MOCK_LARGE_001",
        limit: 100,
        after: cursor,
      });
      expect(page.reviews.length).toBeLessThanOrEqual(100);
      for (const r of page.reviews) ids.add(r.review_id);
      cursor = page.next_cursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(10); // 500/100 → exactly 5; guard runaway
    } while (cursor);
    expect(pages).toBe(5);
    expect(ids.size).toBe(500); // every review seen exactly once, no overlap
  });

  it("a garbage cursor restarts from offset 0 rather than throwing", async () => {
    const client = createSemanticForceClient();
    const res = await client.getReviews({
      placeId: "MOCK_SMALL_001",
      after: "not-base64-json",
    });
    expect(res.reviews).toHaveLength(12);
  });
});

describe("createSemanticForceClient — HTTP path (SF_API_KEY set)", () => {
  it("throws bad_request when a key is set but no base is configured", () => {
    expect(() => createSemanticForceClient({ apiKey: "k" })).toThrow(
      SemanticForceError,
    );
    expect(() => createSemanticForceClient({ apiKey: "k" })).toThrow(
      "SF_API_BASE is missing",
    );
  });

  it("builds the request URL/headers and strips a trailing slash from base", async () => {
    let seenUrl: URL | undefined;
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (url: URL, init?: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return new Response(
        JSON.stringify({ place: { place_id: "X" }, reviews: [] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = createSemanticForceClient({
      apiKey: "secret",
      apiBase: "https://sf.example.com/v1/", // trailing slash must be dropped
      fetchImpl,
    });
    await client.getReviews({ placeId: "ChIJabc", limit: 7, after: "cur" });

    expect(seenUrl!.toString()).toBe(
      "https://sf.example.com/v1/reviews?place_id=ChIJabc&limit=7&after=cur",
    );
    expect(
      (seenInit!.headers as Record<string, string>).Authorization,
    ).toBe("Bearer secret");
  });

  it("maps a non-ok response to a SemanticForceError carrying status + code", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "nope" } }), {
        status: 429,
      })) as unknown as typeof fetch;
    const client = createSemanticForceClient({
      apiKey: "k",
      apiBase: "https://sf.example.com",
      fetchImpl,
    });
    await expect(client.getReviews({ placeId: "p" })).rejects.toMatchObject({
      name: "SemanticForceError",
      code: "rate_limited",
      status: 429,
      message: "nope",
    });
  });

  it("wraps a fetch network throw as upstream_error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const client = createSemanticForceClient({
      apiKey: "k",
      apiBase: "https://sf.example.com",
      fetchImpl,
    });
    await expect(client.getReviews({ placeId: "p" })).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});

describe("__testing helpers", () => {
  it("clampLimit defaults, floors, and caps at 100", () => {
    const { clampLimit } = __testing;
    expect(clampLimit()).toBe(50);
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(-3)).toBe(50);
    expect(clampLimit(Number.NaN)).toBe(50);
    expect(clampLimit(12.9)).toBe(12);
    expect(clampLimit(9999)).toBe(100);
  });

  it("pickFixture: exact id wins, else LARGE/MID substring, else small", () => {
    const { pickFixture } = __testing;
    expect(pickFixture("MOCK_LARGE_001").place.place_id).toBe("MOCK_LARGE_001");
    expect(pickFixture("anything-large-ish").place.place_id).toBe(
      "MOCK_LARGE_001",
    );
    expect(pickFixture("some-mid-thing").place.place_id).toBe("MOCK_MID_001");
    expect(pickFixture("unknown-place").place.place_id).toBe("MOCK_SMALL_001");
  });

  it("encodeCursor/decodeCursor round-trip; missing/garbage → 0", () => {
    const { encodeCursor, decodeCursor } = __testing;
    expect(decodeCursor(encodeCursor(137))).toBe(137);
    expect(decodeCursor()).toBe(0);
    expect(decodeCursor("###")).toBe(0);
  });

  it("mapStatusToCode covers each documented bucket", () => {
    const { mapStatusToCode } = __testing;
    expect(mapStatusToCode(401)).toBe("unauthorized");
    expect(mapStatusToCode(403)).toBe("unauthorized");
    expect(mapStatusToCode(404)).toBe("not_found");
    expect(mapStatusToCode(429)).toBe("rate_limited");
    expect(mapStatusToCode(422)).toBe("bad_request");
    expect(mapStatusToCode(503)).toBe("upstream_error");
    expect(mapStatusToCode(302)).toBe("unknown");
  });
});

// Page-boundary slicing — the FixtureClient's `hasMore = nextOffset < length`
// branch decides whether a `next_cursor` ships. The fallback test walks the
// 500-review LARGE fixture page-by-page and proves "every id seen exactly
// once" via set-size, but a regression that emitted a spurious tail cursor
// (off-by-one `<=`) or swallowed a partial last page (off-by-one `>`) would
// still satisfy that walk on LARGE because 500 is exactly divisible by 100.
// Pin the partial-tail and exact-fit boundaries on the SMALL fixture where
// they're observable in two passes.
describe("FixtureClient — page-boundary slicing", () => {
  it("partial tail: limit=5 over 12 reviews → 5, 5, 2 with no cursor on the last page", async () => {
    const client = createSemanticForceClient();
    const page1 = await client.getReviews({
      placeId: "MOCK_SMALL_001",
      limit: 5,
    });
    expect(page1.reviews).toHaveLength(5);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await client.getReviews({
      placeId: "MOCK_SMALL_001",
      limit: 5,
      after: page1.next_cursor,
    });
    expect(page2.reviews).toHaveLength(5);
    expect(page2.next_cursor).toBeTruthy();
    // The cursor must advance — same-cursor on two pages would be an infinite
    // loop for any caller walking until `next_cursor` is undefined.
    expect(page2.next_cursor).not.toBe(page1.next_cursor);

    const page3 = await client.getReviews({
      placeId: "MOCK_SMALL_001",
      limit: 5,
      after: page2.next_cursor,
    });
    expect(page3.reviews).toHaveLength(2);
    expect(page3.next_cursor).toBeUndefined();
  });

  it("exact fit: limit=12 over 12 reviews → one page, no spurious tail cursor", async () => {
    // `hasMore = nextOffset < length` is the off-by-one switch — at nextOffset
    // === length we must NOT emit a cursor, or the caller round-trips one more
    // page just to be told `[]` (or worse, gets an empty page with a cursor
    // and loops). The exact-fit boundary is the silent-extra-RTT regression.
    const client = createSemanticForceClient();
    const page = await client.getReviews({
      placeId: "MOCK_SMALL_001",
      limit: 12,
    });
    expect(page.reviews).toHaveLength(12);
    expect(page.next_cursor).toBeUndefined();
  });
});

// HTTP wire-shape negatives — the existing HTTP path test pins what IS sent
// when both `limit` and `after` are supplied; these pin what must NOT be sent
// in the load-bearing edge cases. Both are silent-SF-rejection regressions
// with no test signal otherwise (we'd see an opaque 4xx from SF in L4.1).
describe("HttpClient — URL hygiene", () => {
  it("clamps user-supplied limit to MAX_LIMIT (100) on the wire, not the raw value", async () => {
    let seenUrl: URL | undefined;
    const fetchImpl = (async (url: URL) => {
      seenUrl = url;
      return new Response(
        JSON.stringify({ place: { place_id: "X" }, reviews: [] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = createSemanticForceClient({
      apiKey: "k",
      apiBase: "https://sf.example.com",
      fetchImpl,
    });
    await client.getReviews({ placeId: "p", limit: 9999 });

    // A refactor that forwarded `args.limit` directly to the URL (skipping
    // clampLimit) would emit `limit=9999` and SF would reject the request.
    expect(seenUrl!.searchParams.get("limit")).toBe("100");
  });

  it("omits the `after` query param entirely when no cursor is supplied", async () => {
    let seenUrl: URL | undefined;
    const fetchImpl = (async (url: URL) => {
      seenUrl = url;
      return new Response(
        JSON.stringify({ place: { place_id: "X" }, reviews: [] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = createSemanticForceClient({
      apiKey: "k",
      apiBase: "https://sf.example.com",
      fetchImpl,
    });
    await client.getReviews({ placeId: "p" });

    // Belt-and-braces: assert absence via both `has` and the URL string so a
    // future refactor that sets `after=undefined` (which serialises to the
    // literal string "undefined" — a real SF query-parsing footgun) fails.
    expect(seenUrl!.searchParams.has("after")).toBe(false);
    expect(seenUrl!.toString()).not.toContain("after=");
  });
});

// decodeCursor offset-field guards — the existing helper test pins the
// outer try/catch (garbage base64 → 0, missing → 0). These pin the inner
// `typeof parsed.offset === "number" && parsed.offset >= 0` guard against a
// refactor that loosened it (e.g. `parsed.offset ?? 0` would let -5 through
// and slice from a negative offset, which Array.slice silently treats as
// "from the end" — a fixture-page corruption with no error signal). Mirrors
// the L11.3 pattern-floor pinning approach: bad inputs caught at the edge.
describe("decodeCursor — offset-field guards", () => {
  it("falls back to 0 for negative, non-numeric, and missing offset fields", () => {
    const { decodeCursor } = __testing;
    // Wire format per D-015: btoa(JSON.stringify({offset:N})).
    const enc = (payload: unknown) => btoa(JSON.stringify(payload));

    expect(decodeCursor(enc({ offset: -5 }))).toBe(0); // negative rejected
    expect(decodeCursor(enc({ offset: "12" }))).toBe(0); // string rejected
    expect(decodeCursor(enc({ offset: null }))).toBe(0); // null rejected
    expect(decodeCursor(enc({}))).toBe(0); // missing field rejected
    // Sanity: a valid encoded offset still round-trips through this path,
    // so the negative assertions can't pass vacuously on a broken decoder.
    expect(decodeCursor(enc({ offset: 7 }))).toBe(7);
  });
});
