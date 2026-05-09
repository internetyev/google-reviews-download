import smallBusiness from "@/mocks/semanticforce/small-business.json";
import midBusiness from "@/mocks/semanticforce/mid-business.json";
import largeBusiness from "@/mocks/semanticforce/large-business.json";

import {
  GetReviewsArgs,
  GetReviewsResponse,
  Review,
  SemanticForceClient,
  SemanticForceError,
  SemanticForceErrorCode,
} from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Fixture = GetReviewsResponse;

const FIXTURES: Record<string, Fixture> = {
  MOCK_SMALL_001: smallBusiness as unknown as Fixture,
  MOCK_MID_001: midBusiness as unknown as Fixture,
  MOCK_LARGE_001: largeBusiness as unknown as Fixture,
};

export type SemanticForceClientOptions = {
  apiKey?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

export function createSemanticForceClient(
  options: SemanticForceClientOptions = {},
): SemanticForceClient {
  const apiKey = options.apiKey ?? process.env.SF_API_KEY;
  const apiBase = options.apiBase ?? process.env.SF_API_BASE;

  if (!apiKey) {
    return new FixtureClient();
  }

  if (!apiBase) {
    throw new SemanticForceError(
      "bad_request",
      "SF_API_KEY is set but SF_API_BASE is missing — cannot route real calls.",
    );
  }

  return new HttpClient({
    apiKey,
    apiBase,
    fetchImpl: options.fetchImpl ?? fetch,
  });
}

class FixtureClient implements SemanticForceClient {
  async getReviews(args: GetReviewsArgs): Promise<GetReviewsResponse> {
    const limit = clampLimit(args.limit);
    const fixture = pickFixture(args.placeId);
    const offset = decodeCursor(args.after);
    const slice = fixture.reviews.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < fixture.reviews.length;

    return {
      place: fixture.place,
      reviews: slice,
      next_cursor: hasMore ? encodeCursor(nextOffset) : undefined,
    };
  }
}

class HttpClient implements SemanticForceClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string; apiBase: string; fetchImpl: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl;
  }

  async getReviews(args: GetReviewsArgs): Promise<GetReviewsResponse> {
    const limit = clampLimit(args.limit);
    const url = new URL(`${this.apiBase}/reviews`);
    url.searchParams.set("place_id", args.placeId);
    url.searchParams.set("limit", String(limit));
    if (args.after) url.searchParams.set("after", args.after);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (cause) {
      throw new SemanticForceError(
        "upstream_error",
        `Network error calling SemanticForce: ${(cause as Error).message}`,
      );
    }

    if (!res.ok) {
      const code = mapStatusToCode(res.status);
      let message = `SemanticForce returned ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = body.error.message;
      } catch {
        // body wasn't JSON; keep status-based message
      }
      throw new SemanticForceError(code, message, res.status);
    }

    return (await res.json()) as GetReviewsResponse;
  }
}

function clampLimit(limit?: number): number {
  if (limit == null) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function pickFixture(placeId: string): Fixture {
  const exact = FIXTURES[placeId];
  if (exact) return exact;
  const upper = placeId.toUpperCase();
  if (upper.includes("LARGE")) return FIXTURES.MOCK_LARGE_001;
  if (upper.includes("MID")) return FIXTURES.MOCK_MID_001;
  return FIXTURES.MOCK_SMALL_001;
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }));
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(atob(cursor)) as { offset?: number };
    if (typeof parsed.offset === "number" && parsed.offset >= 0) {
      return Math.floor(parsed.offset);
    }
  } catch {
    // fallthrough
  }
  return 0;
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
  pickFixture,
  encodeCursor,
  decodeCursor,
  mapStatusToCode,
  FIXTURES,
};

export type { Review };
