// GET /api/reviews?placeId=...&format=json|csv|xlsx&limit=N
//
// Pagination walker per docs/methodology.md §2: walks SF in PAGE_SIZE-sized
// pages, assembles into a single payload, sets `truncated: true` if either
// HARD_CAP fires. Mid-walk rate-limit returns 429 with whatever we collected
// so far as `partial`.
//
// KV cache (L2.3) is wired below — assembled payloads are stored at
// `gr:reviews:v1:<slug>` with a 24h TTL; the `limit` query param slices the
// cached array client-side so a `limit=50` and a `limit=200` request share
// one entry. Edge rate-limit (L2.8) is not yet wired in. CSV (L2.6) and
// XLSX (L2.7) are wired through `lib/export/csv.ts` and `lib/export/xlsx.ts`
// respectively.
import { NextRequest, NextResponse } from "next/server";
import { createSemanticForceClient } from "@/lib/semanticforce/client";
import {
  PlaceMeta,
  Review,
  SemanticForceError,
  SemanticForceErrorCode,
} from "@/lib/semanticforce/types";
import {
  normalisePlaceId,
  PlaceIdParseError,
} from "@/lib/semanticforce/place-id";
import {
  CachedReviewsPayload,
  createReviewsCache,
} from "@/lib/cache/reviews-cache";
import { csvFilename, formatReviewsAsCsv } from "@/lib/export/csv";
import {
  XLSX_CONTENT_TYPE,
  formatReviewsAsXlsx,
  xlsxFilename,
} from "@/lib/export/xlsx";

export const runtime = "edge";

const PAGE_SIZE = 100;
const HARD_CAP_REVIEWS = 5_000;
const HARD_CAP_PAGES = 50;
const SUPPORTED_FORMATS = ["json", "csv", "xlsx"] as const;
type Format = (typeof SUPPORTED_FORMATS)[number];

type ErrorBody = { error: { code: string; message: string } };
type ReviewsBody = {
  place: PlaceMeta;
  reviews: Review[];
  fetched_at: string;
  truncated?: true;
};
type PartialBody = ErrorBody & {
  partial: Review[];
  retry_after_s?: number;
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const placeIdInput = params.get("placeId");
  const formatRaw = (params.get("format") ?? "json").toLowerCase();
  const limitRaw = params.get("limit");

  if (!placeIdInput) {
    return errorJson("bad_request", "Missing required query param: placeId", 400);
  }

  if (!isFormat(formatRaw)) {
    return errorJson(
      "bad_request",
      `Unsupported format "${formatRaw}". Use one of: ${SUPPORTED_FORMATS.join(", ")}`,
      400,
    );
  }
  const format: Format = formatRaw;

  let userLimit: number | undefined;
  if (limitRaw != null) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return errorJson(
        "bad_request",
        `Invalid limit "${limitRaw}" — must be a positive integer.`,
        400,
      );
    }
    userLimit = Math.min(Math.floor(parsed), HARD_CAP_REVIEWS);
  }

  let normalised;
  try {
    normalised = normalisePlaceId(placeIdInput);
  } catch (err) {
    if (err instanceof PlaceIdParseError) {
      return errorJson("bad_request", err.message, 400);
    }
    throw err;
  }

  const cache = createReviewsCache();
  const cached = await cache.get(normalised.slug);
  if (cached) {
    return respondSuccess(cached, format, userLimit, "HIT", normalised.slug);
  }

  const client = createSemanticForceClient();
  const collected: Review[] = [];
  let placeMeta: PlaceMeta | null = null;
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let rateLimited = false;
  let rateLimitMessage = "Upstream rate-limited mid-walk; returning partial result.";
  let retryAfterS: number | undefined;

  try {
    do {
      const page = await client.getReviews({
        placeId: normalised.raw,
        limit: PAGE_SIZE,
        after: cursor,
      });
      pages += 1;
      if (!placeMeta) placeMeta = page.place;

      for (const review of page.reviews) {
        if (collected.length >= HARD_CAP_REVIEWS) {
          truncated = true;
          break;
        }
        collected.push(review);
      }

      cursor = page.next_cursor;

      if (truncated) break;
      if (pages >= HARD_CAP_PAGES) {
        if (cursor) truncated = true;
        break;
      }
    } while (cursor);
  } catch (err) {
    if (err instanceof SemanticForceError) {
      if (err.code === "rate_limited") {
        rateLimited = true;
        rateLimitMessage = err.message || rateLimitMessage;
        retryAfterS = inferRetryAfter(err);
      } else {
        return errorJson(err.code, err.message, statusForCode(err.code, err.status));
      }
    } else {
      return errorJson(
        "unknown",
        `Unexpected error: ${(err as Error).message}`,
        500,
      );
    }
  }

  if (!placeMeta) {
    return errorJson(
      "not_found",
      "No place metadata returned for that placeId.",
      404,
    );
  }

  if (rateLimited) {
    // Methodology §3: partial walks caused by mid-walk rate-limit are NOT
    // cached — the next request should retry against SF, not inherit the
    // partial. We slice with userLimit for the response only.
    const partialTrimmed =
      userLimit != null ? collected.slice(0, userLimit) : collected;
    const body: PartialBody = {
      error: { code: "rate_limited", message: rateLimitMessage },
      partial: partialTrimmed,
    };
    if (retryAfterS != null) body.retry_after_s = retryAfterS;
    const headers: Record<string, string> = {};
    if (retryAfterS != null) headers["Retry-After"] = String(retryAfterS);
    return NextResponse.json(body, { status: 429, headers });
  }

  // Cache the full assembled walk (pre-limit) so a later request with a
  // different `limit` reuses the same entry. Truncation from HARD_CAP is
  // a stable outcome and IS cacheable (methodology §3); only the partial-
  // from-rate-limit branch above is excluded.
  const payload: CachedReviewsPayload = {
    place: placeMeta,
    reviews: collected,
    fetched_at: new Date().toISOString(),
  };
  if (truncated) payload.truncated = true;

  await cache.set(normalised.slug, payload);

  return respondSuccess(payload, format, userLimit, "MISS", normalised.slug);
}

function respondSuccess(
  payload: CachedReviewsPayload,
  format: Format,
  userLimit: number | undefined,
  cacheStatus: "HIT" | "MISS",
  slug: string,
) {
  const trimmed =
    userLimit != null ? payload.reviews.slice(0, userLimit) : payload.reviews;
  // CSV and XLSX exports operate on the trimmed view too, so a `limit=N`
  // request produces a file with N rows. The cache key is unaffected
  // (D-030: cache holds the full walk).
  const trimmedPayload: CachedReviewsPayload = {
    place: payload.place,
    reviews: trimmed,
    fetched_at: payload.fetched_at,
  };
  if (payload.truncated) trimmedPayload.truncated = true;

  if (format === "json") {
    const body: ReviewsBody = {
      place: payload.place,
      reviews: trimmed,
      fetched_at: payload.fetched_at,
    };
    if (payload.truncated) body.truncated = true;
    return NextResponse.json(body, {
      headers: { "X-Cache": cacheStatus },
    });
  }

  if (format === "csv") {
    const csv = formatReviewsAsCsv(trimmedPayload);
    const filename = csvFilename(slug, payload.fetched_at);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  // format === "xlsx" — only branch left after json/csv above.
  const xlsx = formatReviewsAsXlsx(trimmedPayload);
  const xlsxName = xlsxFilename(slug, payload.fetched_at);
  return new NextResponse(xlsx, {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${xlsxName}"`,
      "X-Cache": cacheStatus,
    },
  });
}

function isFormat(s: string): s is Format {
  return (SUPPORTED_FORMATS as readonly string[]).includes(s);
}

function errorJson(code: string, message: string, status: number) {
  const body: ErrorBody = { error: { code, message } };
  return NextResponse.json(body, { status });
}

function statusForCode(code: SemanticForceErrorCode, upstream?: number): number {
  if (upstream && upstream >= 400 && upstream < 600) return upstream;
  switch (code) {
    case "not_found":
      return 404;
    case "unauthorized":
      return 401;
    case "rate_limited":
      return 429;
    case "bad_request":
      return 400;
    case "upstream_error":
      return 502;
    default:
      return 500;
  }
}

// SF's real error envelope might carry a Retry-After value; until L4.1 wires
// the real client through we conservatively default to a 30s hint when SF
// rate-limits us mid-walk and provides no explicit value.
function inferRetryAfter(err: SemanticForceError): number | undefined {
  const m = /retry[\s_-]*after[^0-9]{0,4}(\d{1,5})/i.exec(err.message);
  if (m) return Number(m[1]);
  return 30;
}

export const __testing = {
  PAGE_SIZE,
  HARD_CAP_REVIEWS,
  HARD_CAP_PAGES,
  SUPPORTED_FORMATS,
  statusForCode,
  inferRetryAfter,
};
