// Coverage for L31.2 — multi-place batch export on /api/reviews. A `places`
// param (comma/newline-separated) resolves + walks each business and returns
// ONE combined CSV/XLSX/JSON. Driven via the injectable __testing.handleGet
// with a stub resolver + stub client — fully offline, no network.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import smallBusiness from "@/mocks/semanticforce/small-business.json";
import midBusiness from "@/mocks/semanticforce/mid-business.json";
import { __testing } from "@/app/api/reviews/route";
import {
  SemanticForceError,
  type GetReviewsResponse,
} from "@/lib/semanticforce/types";

const small = smallBusiness as unknown as GetReviewsResponse;
const mid = midBusiness as unknown as GetReviewsResponse;

// Two distinct, already-canonical data_ids → no resolver call (identifiers
// skip the quota-metered search). "aaaa" selects small, "bbbb" selects mid.
const ID_A = "0x1111111111111111:0xaaaaaaaaaaaaaaaa";
const ID_B = "0x2222222222222222:0xbbbbbbbbbbbbbbbb";

function req(qs: string) {
  return new NextRequest(`https://x.test/api/reviews?${qs}`);
}

// Reviews client that serves the right fixture by the resolved id (offline).
function batchClient() {
  return {
    getReviews: async ({
      placeId,
      limit,
    }: {
      placeId: string;
      limit?: number;
    }) => {
      const fx = placeId.includes("aaaa") ? small : mid;
      return {
        place: fx.place,
        reviews: limit != null ? fx.reviews.slice(0, limit) : fx.reviews,
      };
    },
  };
}

// CRLF-split helper that drops the BOM and the trailing empty line.
function csvDataLines(out: string): string[] {
  return out
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((l) => l.length > 0);
}

describe("/api/reviews — batch export (L31.2)", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {
      REVIEWS_PROVIDER: process.env.REVIEWS_PROVIDER,
      KV_REST_API_URL: process.env.KV_REST_API_URL,
    };
    process.env.REVIEWS_PROVIDER = "serpapi";
    delete process.env.KV_REST_API_URL; // memory cache
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function deps(extra?: Partial<{ resolve: unknown }>) {
    return {
      resolve: async (_input: string) => {
        throw new Error("resolver should not run for identifier inputs");
      },
      client: batchClient(),
      ...(extra as object),
    } as Parameters<typeof __testing.handleGet>[1];
  }

  it("combines several places into one CSV (single header, summed rows)", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=csv`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.csv/,
    );
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const lines = csvDataLines(await res.text());
    // 1 header + (12 small + 80 mid) data rows.
    expect(lines.length).toBe(1 + 12 + 80);
    const body = lines.join("\n");
    expect(body).toContain("MOCK_SMALL_001");
    expect(body).toContain("MOCK_MID_001");
  });

  it("does NOT call the resolver for identifier inputs (quota guard)", async () => {
    let resolverCalls = 0;
    const d = deps({
      resolve: async () => {
        resolverCalls += 1;
        return { dataId: ID_A };
      },
    });
    await __testing.handleGet(req(`places=${ID_A},${ID_B}&format=csv`), d);
    expect(resolverCalls).toBe(0);
  });

  it("combines into one XLSX sheet with summed rows", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=xlsx`),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(
      /google-reviews-batch-2-places-\d{8}\.xlsx/,
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames.length).toBe(1);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
    });
    // 1 header + 92 data rows.
    expect(rows.length).toBe(1 + 12 + 80);
  });

  it("returns a JSON array with per-place counts", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=json`),
      deps(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place_count).toBe(2);
    expect(body.review_count).toBe(12 + 80);
    expect(body.places.length).toBe(2);
    expect(body.places[0].reviews.length).toBe(12);
    expect(body.places[1].reviews.length).toBe(80);
  });

  it("applies `limit` per place before combining", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_B}&format=csv&limit=3`),
      deps(),
    );
    const lines = csvDataLines(await res.text());
    // 1 header + 3 (small capped) + 3 (mid capped).
    expect(lines.length).toBe(1 + 3 + 3);
  });

  it("dedupes inputs that resolve to the same place", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A},${ID_A}&format=json`),
      deps(),
    );
    const body = await res.json();
    expect(body.place_count).toBe(1);
  });

  it("splits on newline as well as comma", async () => {
    const res = await __testing.handleGet(
      req(`places=${encodeURIComponent(`${ID_A}\n${ID_B}`)}&format=json`),
      deps(),
    );
    const body = await res.json();
    expect(body.place_count).toBe(2);
  });

  it("400s an empty places list", async () => {
    const res = await __testing.handleGet(req(`places=,,&format=csv`), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("400s more than MAX_BATCH_PLACES", async () => {
    const many = Array.from(
      { length: __testing.MAX_BATCH_PLACES + 1 },
      (_, i) => `0x${i}000000000000000:0x${i}000000000000000`,
    ).join(",");
    const res = await __testing.handleGet(req(`places=${many}&format=csv`), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Too many places/);
  });

  it("400s an over-long input among the list", async () => {
    const tooLong = "x".repeat(__testing.MAX_INPUT_LENGTH + 1);
    const res = await __testing.handleGet(
      req(`places=${ID_A},${encodeURIComponent(tooLong)}&format=csv`),
      deps(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Invalid place/);
  });

  it("400s an unsupported format", async () => {
    const res = await __testing.handleGet(
      req(`places=${ID_A}&format=pdf`),
      deps(),
    );
    expect(res.status).toBe(400);
  });

  it("maps a resolver not_found to 404 with the place echoed", async () => {
    const d = deps({
      resolve: async () => {
        throw new SemanticForceError("not_found", "No match");
      },
    });
    const res = await __testing.handleGet(
      req(`places=${encodeURIComponent("Nonexistent Cafe")}&format=csv`),
      d,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("Nonexistent Cafe");
  });

  it("leaves the single-place path unchanged when `places` is absent", async () => {
    const res = await __testing.handleGet(
      req(`placeId=${ID_A}&format=json`),
      deps(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Single-place JSON shape: a `reviews` array, no `place_count`.
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(body.place_count).toBeUndefined();
  });
});
