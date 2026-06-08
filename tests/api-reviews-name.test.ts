// Coverage for L28.1 — business-name input on /api/reviews. The route falls
// through to a name→data_id resolver when placeId isn't a parseable id/URL, but
// ONLY for the serpapi provider. Driven via the injectable __testing.handleGet
// with a stub resolver + stub reviews client — fully offline, no network.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import smallBusiness from "@/mocks/semanticforce/small-business.json";
import { __testing } from "@/app/api/reviews/route";
import {
  SemanticForceError,
  type GetReviewsResponse,
} from "@/lib/semanticforce/types";

const REAL_DATA_ID = "0x80858098babc2d4b:0xbeedd659cc698c92";
const fixture = smallBusiness as unknown as GetReviewsResponse;

function req(qs: string) {
  return new NextRequest(`https://x.test/api/reviews?${qs}`);
}

// A reviews client that serves the committed fixture for any id (offline walk).
function fixtureClient() {
  return {
    getReviews: async ({ limit }: { placeId: string; limit?: number }) => ({
      place: fixture.place,
      reviews: limit != null ? fixture.reviews.slice(0, limit) : fixture.reviews,
    }),
  };
}

describe("/api/reviews — business-name resolution (L28.1)", () => {
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

  it("resolves a business name, then walks reviews for the resolved id", async () => {
    let seenInput = "";
    const deps = {
      resolve: async (input: string) => {
        seenInput = input;
        return { dataId: REAL_DATA_ID };
      },
      client: fixtureClient(),
    };
    const res = await __testing.handleGet(
      req("placeId=Blue%20Bottle%20Coffee&format=json&limit=2"),
      deps,
    );
    expect(seenInput).toBe("Blue Bottle Coffee");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews.length).toBe(2);
  });

  it("rejects a name with 400 when the provider is not serpapi", async () => {
    process.env.REVIEWS_PROVIDER = "mock";
    let resolveCalls = 0;
    const deps = {
      resolve: async () => {
        resolveCalls += 1;
        return { dataId: REAL_DATA_ID };
      },
      client: fixtureClient(),
    };
    const res = await __testing.handleGet(req("placeId=Some%20Business%20Name"), deps);
    expect(res.status).toBe(400);
    expect(resolveCalls).toBe(0); // never attempted off serpapi
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("maps a resolver not_found to a 404", async () => {
    const deps = {
      resolve: async () => {
        throw new SemanticForceError("not_found", "No place found");
      },
      client: fixtureClient(),
    };
    const res = await __testing.handleGet(req("placeId=zzz%20nonexistent"), deps);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("still accepts a plain id without invoking the resolver", async () => {
    let resolveCalls = 0;
    const deps = {
      resolve: async () => {
        resolveCalls += 1;
        return { dataId: REAL_DATA_ID };
      },
      client: fixtureClient(),
    };
    const res = await __testing.handleGet(req("placeId=MOCK_SMALL_001&limit=1"), deps);
    expect(res.status).toBe(200);
    expect(resolveCalls).toBe(0);
  });
});
