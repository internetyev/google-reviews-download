// Coverage for lib/reviews/provider.ts (L27.3) — the REVIEWS_PROVIDER switch.
// The factory must (a) parse the env value to a known provider, defaulting
// unknown/unset to mock, and (b) hand back a working SemanticForceClient. The
// mock branch must serve fixtures even when an ambient SF_API_KEY is present
// (so a misconfigured deploy degrades to mock, never a surprise live call).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createReviewsProvider, resolveProviderName } from "@/lib/reviews/provider";

describe("resolveProviderName", () => {
  it("recognises the three providers (case/space-insensitive)", () => {
    expect(resolveProviderName("serpapi")).toBe("serpapi");
    expect(resolveProviderName("  SerpApi ")).toBe("serpapi");
    expect(resolveProviderName("semanticforce")).toBe("semanticforce");
    expect(resolveProviderName("sf")).toBe("semanticforce");
    expect(resolveProviderName("mock")).toBe("mock");
  });

  it("defaults unknown / empty / null to mock", () => {
    expect(resolveProviderName(undefined)).toBe("mock");
    expect(resolveProviderName(null)).toBe("mock");
    expect(resolveProviderName("")).toBe("mock");
    expect(resolveProviderName("nope")).toBe("mock");
  });
});

describe("createReviewsProvider", () => {
  let savedProvider: string | undefined;
  let savedSfKey: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.REVIEWS_PROVIDER;
    savedSfKey = process.env.SF_API_KEY;
    delete process.env.REVIEWS_PROVIDER;
    delete process.env.SF_API_KEY;
  });
  afterEach(() => {
    if (savedProvider === undefined) delete process.env.REVIEWS_PROVIDER;
    else process.env.REVIEWS_PROVIDER = savedProvider;
    if (savedSfKey === undefined) delete process.env.SF_API_KEY;
    else process.env.SF_API_KEY = savedSfKey;
  });

  it("returns a client exposing getReviews for each provider", () => {
    for (const provider of ["serpapi", "semanticforce", "mock"]) {
      // serpapi needs a key to construct; provide one via env for that case
      if (provider === "serpapi") process.env.SERPAPI_API_KEY = "k1";
      const client = createReviewsProvider({ provider });
      expect(typeof client.getReviews).toBe("function");
      delete process.env.SERPAPI_API_KEY;
    }
  });

  it("mock provider serves committed fixtures even when SF_API_KEY is set", async () => {
    process.env.SF_API_KEY = "live-key-should-be-ignored";
    const client = createReviewsProvider({ provider: "mock" });
    // FixtureClient resolves MOCK_* ids offline; a live client would try to
    // hit SF_API_BASE (unset) and throw instead.
    const res = await client.getReviews({ placeId: "MOCK_SMALL_001", limit: 3 });
    expect(res.place.place_id).toBe("MOCK_SMALL_001");
    expect(res.reviews.length).toBe(3);
  });

  it("reads REVIEWS_PROVIDER from env when no override is passed", async () => {
    process.env.REVIEWS_PROVIDER = "mock";
    const client = createReviewsProvider();
    const res = await client.getReviews({ placeId: "MOCK_MID_001", limit: 1 });
    expect(res.reviews.length).toBe(1);
  });
});
