// Name → data_id resolution (L27.2).
//
// Users paste either an identifier (a Google Place ID, a 0x…:0x… data_id, a
// MOCK_* fixture id, or a Google Maps URL containing one) OR a free-text
// business name. `classifyInput` decides which; a name is resolved to a
// data_id via SerpApi `engine=google_maps&type=search`, picking the best
// `local_results` / `place_results` match. The result is mapped onto the
// internal PlaceMeta contract — callers never see SerpApi's raw shape.
//
// Mapping table + endpoint: docs/serpapi-reviews.md §1.

import {
  normalisePlaceId,
  PlaceIdParseError,
} from "@/lib/semanticforce/place-id";
import {
  PlaceMeta,
  SemanticForceError,
} from "@/lib/semanticforce/types";
import { collectKeysFromEnv, serpApiGetJson } from "@/lib/serpapi/client";

const SERPAPI_BASE = "https://serpapi.com/search.json";

// A Maps URL we couldn't extract an id from should fail loudly rather than be
// searched as if it were a business name.
const MAPS_URLISH = /^https?:\/\/|google\.[a-z.]+\/maps|goo\.gl/i;

export type ResolvedInput =
  | { kind: "place_id"; dataId: string; slug: string }
  | { kind: "name"; query: string };

/**
 * Decide whether the raw input is already an identifier or a business name.
 * - Recognised Place ID / data_id / MOCK_ id / Maps URL → `place_id`.
 * - Anything URL-shaped we can't parse → bad_request (don't search a URL).
 * - Otherwise → `name` (a free-text query to resolve).
 */
export function classifyInput(input: string): ResolvedInput {
  if (typeof input !== "string" || !input.trim()) {
    throw new SemanticForceError("bad_request", "Empty place/business input.");
  }
  try {
    const { raw, slug } = normalisePlaceId(input);
    return { kind: "place_id", dataId: raw, slug };
  } catch (err) {
    if (!(err instanceof PlaceIdParseError)) throw err;
    const query = input.trim().replace(/\s+/g, " ");
    if (MAPS_URLISH.test(query)) {
      throw new SemanticForceError(
        "bad_request",
        "Could not extract a Place ID from that URL — paste the full Google Maps URL, the Place ID, or the business name.",
      );
    }
    return { kind: "name", query };
  }
}

// --- SerpApi google_maps search raw shapes (only the fields we read) ------

type SerpSearchCandidate = {
  title?: string;
  data_id?: string;
  place_id?: string;
  rating?: number;
  reviews?: number;
  address?: string;
  gps_coordinates?: unknown;
};

type SerpSearchRaw = {
  place_results?: SerpSearchCandidate;
  local_results?: SerpSearchCandidate[];
  error?: string;
};

export type ResolvedPlace = { dataId: string; place: PlaceMeta };

/**
 * Pure: pick the best candidate from a google_maps search response and map it
 * to { dataId, PlaceMeta }. Prefers an exact `place_results` hit, else the
 * first `local_results` row that carries a `data_id`. Returns null when nothing
 * usable is present.
 */
export function pickBestPlace(raw: SerpSearchRaw): ResolvedPlace | null {
  const candidate =
    (raw.place_results && raw.place_results.data_id ? raw.place_results : undefined) ??
    (raw.local_results ?? []).find((r) => Boolean(r.data_id));
  if (!candidate || !candidate.data_id) return null;

  const place: PlaceMeta = {
    place_id: candidate.data_id,
    name: candidate.title ?? "",
    rating_avg: typeof candidate.rating === "number" ? candidate.rating : 0,
    rating_count: typeof candidate.reviews === "number" ? candidate.reviews : 0,
  };
  if (candidate.address) place.address = candidate.address;
  return { dataId: candidate.data_id, place };
}

export type ResolveOptions = {
  apiKeys?: string[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

/**
 * Resolve a free-text business name to a data_id (1 SerpApi search call).
 * Throws `not_found` when the search returns no usable place.
 */
export async function resolvePlaceName(
  query: string,
  options: ResolveOptions = {},
): Promise<ResolvedPlace> {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new SemanticForceError("bad_request", "Empty business name.");
  }
  const apiKeys = (options.apiKeys ?? collectKeysFromEnv()).filter(Boolean);
  if (apiKeys.length === 0) {
    throw new SemanticForceError(
      "unauthorized",
      "No SerpApi key configured — set SERPAPI_API_KEY or SERPAPI_API_KEY_1..3.",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = new URL(options.baseUrl ?? SERPAPI_BASE);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", apiKeys[0]);

  const raw = await serpApiGetJson<SerpSearchRaw>(url, fetchImpl);
  const best = pickBestPlace(raw);
  if (!best) {
    throw new SemanticForceError(
      "not_found",
      `No Google Maps place found for "${trimmed}".`,
    );
  }
  return best;
}

/**
 * High-level entry the provider/route will call: accept either an identifier
 * or a business name and return { dataId, place? }. For an identifier we skip
 * the search call entirely (saves quota); `place` is only populated when a
 * search was performed.
 */
export async function resolveToDataId(
  input: string,
  options: ResolveOptions = {},
): Promise<{ dataId: string; slug?: string; place?: PlaceMeta }> {
  const classified = classifyInput(input);
  if (classified.kind === "place_id") {
    return { dataId: classified.dataId, slug: classified.slug };
  }
  const resolved = await resolvePlaceName(classified.query, options);
  return { dataId: resolved.dataId, place: resolved.place };
}
