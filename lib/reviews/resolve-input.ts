// Shared "accept an id OR a business name" resolution (L28.1/L28.2).
//
// Used by BOTH the HTTP route (app/api/reviews/route.ts) and the web preview
// (app/preview/page.tsx) so the two surfaces handle name input identically —
// no drift. A parseable id/URL is normalised directly; otherwise, when the
// provider is `serpapi`, the input is treated as a business name and resolved
// to a data_id via Google Maps search (cached 24h to protect the quota).
// Other providers throw `PlaceIdParseError` (names unsupported off serpapi).

import {
  normalisePlaceId,
  PlaceIdParseError,
  type NormalisedPlaceId,
} from "@/lib/semanticforce/place-id";
import { resolveProviderName } from "@/lib/reviews/provider";
import { createResolveCache } from "@/lib/cache/reviews-cache";
import { resolveToDataId } from "@/lib/serpapi/resolve";
import type { PlaceMeta } from "@/lib/semanticforce/types";

/** Stable cache key for a free-text business name (case/space/punct-insensitive). */
export function inputNameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ResolveInputDeps = {
  // Override the name resolver (offline tests); defaults to the SerpApi resolver.
  resolve?: (input: string) => Promise<{ dataId: string; place?: PlaceMeta }>;
  // Override the provider name (tests); defaults to process.env.REVIEWS_PROVIDER.
  providerName?: string | null;
};

/**
 * Resolve raw user input to a normalised place id.
 * - Parseable id/URL → normalised directly (no upstream call).
 * - Free-text name + serpapi provider → resolved via Google Maps search,
 *   cached by name so a repeat lookup doesn't burn another search.
 * Throws `PlaceIdParseError` (not a name, or names unsupported on this
 * provider) or `SemanticForceError` (resolution failed upstream).
 */
export async function resolveInputToNormalised(
  input: string,
  deps: ResolveInputDeps = {},
): Promise<NormalisedPlaceId> {
  try {
    return normalisePlaceId(input);
  } catch (err) {
    if (!(err instanceof PlaceIdParseError)) throw err;
    const provider = resolveProviderName(
      deps.providerName ?? process.env.REVIEWS_PROVIDER,
    );
    if (provider !== "serpapi") throw err; // names only resolvable on serpapi
    const resolve = deps.resolve ?? resolveToDataId;
    const key = inputNameSlug(input);
    const cache = createResolveCache();
    const hit = await cache.get(key);
    const dataId = hit
      ? hit.dataId
      : await (async () => {
          const r = await resolve(input);
          await cache.set(key, { dataId: r.dataId, place: r.place });
          return r.dataId;
        })();
    return normalisePlaceId(dataId);
  }
}
