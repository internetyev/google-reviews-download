// SerpApi reviews client — the trial data source (ADR D-084).
//
// Implements the internal `SemanticForceClient` contract so callers depend only
// on `GetReviewsResponse` / `Review` / `PlaceMeta` (lib/semanticforce/types.ts),
// never on SerpApi's raw shape. Mapping table: docs/serpapi-reviews.md.
//
// Two SerpApi engines back this:
//   - google_maps_reviews  → reviews for a data_id (this file)
//   - google_maps (search) → name → data_id resolution (L27.2, sibling module)
//
// Quota discipline: tests drive the pure mappers + an injected `fetchImpl`
// against mocks/serpapi/ — never a live call. Key rotation across
// SERPAPI_API_KEY_1..3 stretches the 750/mo free trial.

import { normalisePlaceId } from "@/lib/semanticforce/place-id";
import {
  GetReviewsArgs,
  GetReviewsResponse,
  PlaceMeta,
  Review,
  SemanticForceClient,
  SemanticForceError,
  SemanticForceErrorCode,
} from "@/lib/semanticforce/types";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
// SerpApi returns ~8 reviews/page; cap loop iterations so a missing/looping
// token can never burn unbounded quota. 50 pages ≈ 400 reviews ≥ MAX_LIMIT.
const PAGE_SAFETY_CAP = 50;

// --- SerpApi raw shapes (only the fields we read) -------------------------

type SerpReviewUser = { name?: string; link?: string };
type SerpReviewResponse = { snippet?: string; iso_date?: string };

type SerpReview = {
  review_id?: string;
  rating?: number;
  snippet?: string;
  extracted_snippet?: { original?: string; translated?: string };
  iso_date?: string;
  images?: string[];
  user?: SerpReviewUser;
  response?: SerpReviewResponse;
};

type SerpPlaceInfo = {
  title?: string;
  address?: string;
  rating?: number;
  reviews?: number;
};

type SerpPagination = { next?: string; next_page_token?: string };

type SerpReviewsRaw = {
  place_info?: SerpPlaceInfo;
  reviews?: SerpReview[];
  serpapi_pagination?: SerpPagination;
  search_metadata?: { google_maps_reviews_url?: string };
  error?: string;
};

// --- Pure mappers (SerpApi → internal contract) ---------------------------

function clampRating(rating?: number): Review["rating"] {
  const rounded = Math.round(Number.isFinite(rating) ? (rating as number) : 0);
  const bounded = Math.min(5, Math.max(1, rounded));
  return bounded as Review["rating"];
}

export function mapReview(raw: SerpReview): Review {
  // Prefer the un-translated original snippet when SerpApi auto-translated.
  const text = raw.extracted_snippet?.original ?? raw.snippet ?? "";
  const review: Review = {
    review_id: raw.review_id ?? "",
    author_name: raw.user?.name ?? "Anonymous",
    rating: clampRating(raw.rating),
    text,
    published_at: raw.iso_date ?? "",
  };
  if (raw.user?.link) review.author_url = raw.user.link;
  if (raw.images && raw.images.length > 0) {
    review.photos = raw.images.map((url) => ({ url }));
  }
  if (raw.response) {
    review.owner_response = {
      text: raw.response.snippet ?? "",
      responded_at: raw.response.iso_date ?? "",
    };
  }
  return review;
}

export function mapPlaceMeta(
  info: SerpPlaceInfo | undefined,
  dataId: string,
  url?: string,
): PlaceMeta {
  const meta: PlaceMeta = {
    place_id: dataId,
    name: info?.title ?? "",
    rating_avg: typeof info?.rating === "number" ? info.rating : 0,
    rating_count: typeof info?.reviews === "number" ? info.reviews : 0,
  };
  if (info?.address) meta.address = info.address;
  if (url) meta.url = url;
  return meta;
}

export function mapReviewsPage(
  raw: SerpReviewsRaw,
  dataId: string,
): { place: PlaceMeta; reviews: Review[]; nextPageToken?: string } {
  const reviews = (raw.reviews ?? []).map(mapReview);
  const place = mapPlaceMeta(
    raw.place_info,
    dataId,
    raw.search_metadata?.google_maps_reviews_url,
  );
  return {
    place,
    reviews,
    nextPageToken: raw.serpapi_pagination?.next_page_token,
  };
}

// --- Client ---------------------------------------------------------------

export type SerpApiClientOptions = {
  apiKeys?: string[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export function createSerpApiClient(
  options: SerpApiClientOptions = {},
): SemanticForceClient {
  const apiKeys = (options.apiKeys ?? collectKeysFromEnv()).filter(Boolean);
  if (apiKeys.length === 0) {
    throw new SemanticForceError(
      "unauthorized",
      "No SerpApi key configured — set SERPAPI_API_KEY or SERPAPI_API_KEY_1..3.",
    );
  }
  return new SerpApiClient({
    apiKeys,
    fetchImpl: options.fetchImpl ?? fetch,
    baseUrl: options.baseUrl ?? SERPAPI_BASE,
  });
}

class SerpApiClient implements SemanticForceClient {
  private readonly apiKeys: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private keyCursor = 0;

  constructor(opts: { apiKeys: string[]; fetchImpl: typeof fetch; baseUrl: string }) {
    this.apiKeys = opts.apiKeys;
    this.fetchImpl = opts.fetchImpl;
    this.baseUrl = opts.baseUrl;
  }

  // Round-robin a key per HTTP request to spread the per-key 250/mo quota.
  private nextKey(): string {
    const key = this.apiKeys[this.keyCursor % this.apiKeys.length];
    this.keyCursor += 1;
    return key;
  }

  async getReviews(args: GetReviewsArgs): Promise<GetReviewsResponse> {
    const limit = clampLimit(args.limit);
    const dataId = normalisePlaceId(args.placeId).raw;

    const collected: Review[] = [];
    let place: PlaceMeta | undefined;
    let pageToken = args.after;
    let lastToken: string | undefined;
    let pages = 0;

    // Fetch whole pages until we have at least `limit` reviews or run out.
    while (collected.length < limit && pages < PAGE_SAFETY_CAP) {
      const raw = await this.fetchPage(dataId, pageToken);
      const mapped = mapReviewsPage(raw, dataId);
      if (!place) place = mapped.place;
      collected.push(...mapped.reviews);
      lastToken = mapped.nextPageToken;
      pages += 1;
      if (!mapped.nextPageToken || mapped.reviews.length === 0) {
        lastToken = undefined;
        break;
      }
      pageToken = mapped.nextPageToken;
    }

    const reviews = collected.slice(0, limit);
    // next_cursor advances past the last fetched page. When `limit` lands
    // mid-page the trailing reviews of that page are dropped from a resumed
    // call — acceptable for the trial (primary flow downloads a full limit in
    // one shot); a page-aligned compound cursor is deferred. (D-085)
    const moreAvailable = collected.length > limit || lastToken != null;

    return {
      place: place ?? mapPlaceMeta(undefined, dataId),
      reviews,
      next_cursor: moreAvailable ? lastToken : undefined,
    };
  }

  private async fetchPage(dataId: string, pageToken?: string): Promise<SerpReviewsRaw> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("engine", "google_maps_reviews");
    url.searchParams.set("data_id", dataId);
    url.searchParams.set("hl", "en");
    if (pageToken) url.searchParams.set("next_page_token", pageToken);
    url.searchParams.set("api_key", this.nextKey());

    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (cause) {
      throw new SemanticForceError(
        "upstream_error",
        `Network error calling SerpApi: ${(cause as Error).message}`,
      );
    }

    if (!res.ok) {
      const code = mapStatusToCode(res.status);
      let message = `SerpApi returned ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // body wasn't JSON; keep status-based message
      }
      throw new SemanticForceError(code, message, res.status);
    }

    const body = (await res.json()) as SerpReviewsRaw;
    // SerpApi returns HTTP 200 with a top-level `error` for some failures.
    if (body.error) {
      throw new SemanticForceError("upstream_error", body.error);
    }
    return body;
  }
}

// --- helpers --------------------------------------------------------------

function clampLimit(limit?: number): number {
  if (limit == null) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function collectKeysFromEnv(): string[] {
  const keys: string[] = [];
  const primary = process.env.SERPAPI_API_KEY;
  if (primary) keys.push(primary);
  for (const suffix of ["_1", "_2", "_3"]) {
    const k = process.env[`SERPAPI_API_KEY${suffix}`];
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

function mapStatusToCode(status: number): SemanticForceErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "bad_request";
  if (status >= 500) return "upstream_error";
  return "unknown";
}

export const __testing = {
  clampLimit,
  clampRating,
  collectKeysFromEnv,
  mapStatusToCode,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PAGE_SAFETY_CAP,
};

export type { Review };
