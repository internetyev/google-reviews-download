// Coverage for lib/serpapi/client.ts (L27.1) — the SerpApi → internal-contract
// mapping and pagination. Two correctness surfaces:
//   1. The pure mappers translate google_maps_reviews JSON into Review/PlaceMeta
//      exactly per docs/serpapi-reviews.md (rating round, original-snippet
//      preference, owner-response, photos). A silent drift here corrupts every
//      export.
//   2. getReviews honours `limit` across pages and rotates keys — driven through
//      an injected fetchImpl stub against the committed fixture. NO live calls.

import { describe, it, expect } from "vitest";
import reviewsPage1 from "@/mocks/serpapi/maps-reviews-page1.json";
import {
  createSerpApiClient,
  mapReview,
  mapPlaceMeta,
  mapReviewsPage,
  __testing,
} from "@/lib/serpapi/client";
import { SemanticForceError } from "@/lib/semanticforce/types";

const DATA_ID = "0x80858098babc2d4b:0xbeedd659cc698c92";

type SerpRaw = typeof reviewsPage1;

// A fetchImpl stub returning a JSON 200 with the given body.
function jsonOk(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("mapReview", () => {
  const sample = (reviewsPage1 as SerpRaw).reviews[0];

  it("maps the core fields per the documented table", () => {
    const r = mapReview(sample);
    expect(r.review_id).toBe(sample.review_id);
    expect(r.author_name).toBe(sample.user.name);
    expect(r.author_url).toBe(sample.user.link);
    expect(r.published_at).toBe(sample.iso_date);
    // rating is rounded to an int in 1..5
    expect(r.rating).toBe(Math.round(sample.rating));
    expect(Number.isInteger(r.rating)).toBe(true);
  });

  it("prefers extracted_snippet.original over snippet when present", () => {
    const r = mapReview({
      review_id: "x",
      rating: 5,
      snippet: "translated text",
      extracted_snippet: { original: "original text" },
      iso_date: "2025-01-01T00:00:00Z",
      user: { name: "A" },
    });
    expect(r.text).toBe("original text");
  });

  it("falls back to snippet when there is no extracted_snippet", () => {
    const r = mapReview({ review_id: "x", rating: 4, snippet: "plain", user: { name: "A" } });
    expect(r.text).toBe("plain");
  });

  it("maps images → photos[].url and owner response → owner_response", () => {
    const withResponse = (reviewsPage1 as SerpRaw).reviews.find((rv) => rv.response);
    expect(withResponse).toBeTruthy();
    const r = mapReview(withResponse!);
    expect(r.owner_response?.text).toBe(withResponse!.response!.snippet);
    expect(r.owner_response?.responded_at).toBe(withResponse!.response!.iso_date);

    const withImage = (reviewsPage1 as SerpRaw).reviews.find(
      (rv) => Array.isArray(rv.images) && rv.images.length > 0,
    );
    expect(withImage).toBeTruthy();
    const ri = mapReview(withImage!);
    expect(ri.photos?.[0]?.url).toBe(withImage!.images![0]);
  });

  it("clamps out-of-range / missing ratings into 1..5", () => {
    expect(__testing.clampRating(0)).toBe(1);
    expect(__testing.clampRating(6)).toBe(5);
    expect(__testing.clampRating(undefined)).toBe(1);
    expect(__testing.clampRating(4.4)).toBe(4);
    expect(__testing.clampRating(4.6)).toBe(5);
  });
});

describe("mapPlaceMeta", () => {
  it("maps place_info → PlaceMeta with the data_id as place_id", () => {
    const meta = mapPlaceMeta((reviewsPage1 as SerpRaw).place_info, DATA_ID, "https://maps/x");
    expect(meta.place_id).toBe(DATA_ID);
    expect(meta.name).toBe("Blue Bottle Coffee");
    expect(meta.address).toBe("315 Linden St, San Francisco, CA 94102");
    expect(meta.rating_avg).toBe(4.6);
    expect(meta.rating_count).toBe(891);
    expect(meta.url).toBe("https://maps/x");
  });

  it("tolerates missing place_info", () => {
    const meta = mapPlaceMeta(undefined, DATA_ID);
    expect(meta).toMatchObject({ place_id: DATA_ID, name: "", rating_avg: 0, rating_count: 0 });
  });
});

describe("mapReviewsPage", () => {
  it("returns all reviews and the next_page_token from the fixture", () => {
    const page = mapReviewsPage(reviewsPage1 as SerpRaw, DATA_ID);
    expect(page.reviews).toHaveLength((reviewsPage1 as SerpRaw).reviews.length);
    expect(page.nextPageToken).toBe(
      (reviewsPage1 as SerpRaw).serpapi_pagination.next_page_token,
    );
    expect(page.place.name).toBe("Blue Bottle Coffee");
  });
});

describe("createSerpApiClient.getReviews", () => {
  it("honours a limit smaller than one page and sets a cursor when more exist", async () => {
    const client = createSerpApiClient({ apiKeys: ["k1"], fetchImpl: jsonOk(reviewsPage1) });
    const out = await client.getReviews({ placeId: DATA_ID, limit: 3 });
    expect(out.reviews).toHaveLength(3);
    expect(out.place.name).toBe("Blue Bottle Coffee");
    // fixture page carries a next_page_token → more reviews exist upstream
    expect(out.next_cursor).toBeDefined();
  });

  it("paginates across pages to satisfy a limit larger than one page", async () => {
    // Page 1 = the fixture (8 reviews, has token). Page 2 = 8 more, no token.
    const page2 = {
      ...reviewsPage1,
      reviews: (reviewsPage1 as SerpRaw).reviews.map((r, i) => ({
        ...r,
        review_id: `p2_${i}`,
      })),
      serpapi_pagination: { next: "", next_page_token: undefined },
    };
    let call = 0;
    const fetchImpl = (async (url: URL) => {
      call += 1;
      const hasToken = String(url).includes("next_page_token");
      return new Response(JSON.stringify(hasToken ? page2 : reviewsPage1), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = createSerpApiClient({ apiKeys: ["k1"], fetchImpl });
    const out = await client.getReviews({ placeId: DATA_ID, limit: 12 });
    expect(out.reviews).toHaveLength(12);
    expect(call).toBe(2); // exactly two pages fetched
    // page 2 had no token → no more upstream → no cursor
    expect(out.next_cursor).toBeUndefined();
  });

  it("rotates api keys round-robin across requests", async () => {
    const seenKeys: string[] = [];
    const fetchImpl = (async (url: URL) => {
      seenKeys.push(new URL(url).searchParams.get("api_key") ?? "");
      // each call returns a no-token page so getReviews does one fetch per call
      return new Response(
        JSON.stringify({ ...reviewsPage1, serpapi_pagination: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = createSerpApiClient({ apiKeys: ["k1", "k2", "k3"], fetchImpl });
    await client.getReviews({ placeId: DATA_ID, limit: 5 });
    await client.getReviews({ placeId: DATA_ID, limit: 5 });
    await client.getReviews({ placeId: DATA_ID, limit: 5 });
    expect(seenKeys).toEqual(["k1", "k2", "k3"]);
  });

  it("maps an HTTP error status to the right SemanticForceError code", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "rate limit" }), {
        status: 429,
      })) as unknown as typeof fetch;
    const client = createSerpApiClient({ apiKeys: ["k1"], fetchImpl });
    await expect(client.getReviews({ placeId: DATA_ID })).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(client.getReviews({ placeId: DATA_ID })).rejects.toBeInstanceOf(
      SemanticForceError,
    );
  });

  it("surfaces a 200-with-top-level-error as an upstream_error", async () => {
    const client = createSerpApiClient({
      apiKeys: ["k1"],
      fetchImpl: jsonOk({ error: "Google hasn't returned any results" }),
    });
    await expect(client.getReviews({ placeId: DATA_ID })).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("throws unauthorized when no keys are configured", () => {
    expect(() => createSerpApiClient({ apiKeys: [] })).toThrow(SemanticForceError);
  });
});
