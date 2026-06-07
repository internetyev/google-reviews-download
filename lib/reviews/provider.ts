// Reviews provider factory (L27.3).
//
// One switch decides which data source backs the whole app. Callers
// (`app/api/reviews/route.ts`, `app/preview/page.tsx`) construct a client
// through here and depend only on the `SemanticForceClient` contract
// (`getReviews → GetReviewsResponse`), so swapping SerpApi ↔ SemanticForce ↔
// mock is a single env value with zero caller changes (honours D-003/D-084).
//
//   REVIEWS_PROVIDER = serpapi      → live SerpApi (the trial source)
//                    = semanticforce → live SemanticForce (intended production)
//                    = mock | unset  → committed fixtures (offline default)

import { SemanticForceClient } from "@/lib/semanticforce/types";
import { createSemanticForceClient } from "@/lib/semanticforce/client";
import { createSerpApiClient } from "@/lib/serpapi/client";

export type ReviewsProviderName = "serpapi" | "semanticforce" | "mock";

/** Normalise the raw env value to a known provider; anything unknown → mock. */
export function resolveProviderName(raw?: string | null): ReviewsProviderName {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "serpapi") return "serpapi";
  if (v === "semanticforce" || v === "sf") return "semanticforce";
  return "mock";
}

export type CreateReviewsProviderOptions = {
  /** Override the env-derived provider (mainly for tests). */
  provider?: string | null;
};

/**
 * Return the reviews client for the active provider. Defaults to the offline
 * fixture client so a misconfigured deploy degrades to mock data, never a
 * surprise live call.
 */
export function createReviewsProvider(
  options: CreateReviewsProviderOptions = {},
): SemanticForceClient {
  const name = resolveProviderName(
    options.provider ?? process.env.REVIEWS_PROVIDER,
  );
  switch (name) {
    case "serpapi":
      return createSerpApiClient();
    case "semanticforce":
      return createSemanticForceClient();
    case "mock":
    default:
      // Force the FixtureClient regardless of any ambient SF_API_KEY: an empty
      // string is falsy (so `createSemanticForceClient` takes its no-key branch)
      // yet not nullish (so `?? process.env.SF_API_KEY` does NOT fall through).
      return createSemanticForceClient({ apiKey: "" });
  }
}
