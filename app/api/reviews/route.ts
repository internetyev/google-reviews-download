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
// one entry. Edge rate-limit (L2.8) lives in `middleware.ts` and runs in
// front of this route (10 req/min/IP, burst 10, Retry-After: 6). CSV
// (L2.6) and XLSX (L2.7) are wired through `lib/export/csv.ts` and
// `lib/export/xlsx.ts` respectively.
import { NextRequest, NextResponse } from "next/server";
import { createReviewsProvider } from "@/lib/reviews/provider";
import {
  PlaceMeta,
  Review,
  SemanticForceError,
  SemanticForceErrorCode,
} from "@/lib/semanticforce/types";
import { PlaceIdParseError } from "@/lib/semanticforce/place-id";
import {
  CachedReviewsPayload,
  createReviewsCache,
} from "@/lib/cache/reviews-cache";
import { resolveToDataId } from "@/lib/serpapi/resolve";
import { resolveInputToNormalised } from "@/lib/reviews/resolve-input";
import { csvFilename, formatReviewsAsCsv } from "@/lib/export/csv";
import {
  XLSX_CONTENT_TYPE,
  formatReviewsAsXlsx,
  xlsxFilename,
} from "@/lib/export/xlsx";
import {
  batchFilename,
  batchReviewCount,
  formatBatchAsCsv,
  formatBatchAsXlsx,
} from "@/lib/export/batch";

export const runtime = "edge";

const PAGE_SIZE = 100;
const HARD_CAP_REVIEWS = 5_000;
const HARD_CAP_PAGES = 50;
// The largest `limit` a single request may ask for. Equal to the assembled-walk
// hard cap (a request can never receive more rows than we ever assemble), and
// used as the clamp ceiling so `?limit=9999999` is silently bounded rather than
// rejected — over-asking is benign, we just return everything we have.
const MAX_LIMIT = HARD_CAP_REVIEWS;
// Input-hardening bound on the free-text `placeId` param (which doubles as a
// business-name on the serpapi provider). A real Place ID, a Google Maps URL,
// or a business name all fit comfortably under this; a multi-kilobyte string is
// a malformed/abusive input we reject at the edge BEFORE it reaches the
// quota-metered SerpApi name resolver.
const MAX_INPUT_LENGTH = 2_048;
// Upper bound on places in one batch download. A batch resolves+walks each
// place upstream, so the count directly caps quota spend per request; 25 is a
// generous "paste a list" ceiling that still bounds a single request's cost.
const MAX_BATCH_PLACES = 25;
// Raw control characters (incl. NUL, tab, newline, DEL) never appear in a
// legitimate id/URL/name once the querystring is decoded; their presence is a
// malformed input (or an injection probe) we reject rather than forward.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
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

type ReviewsClient = {
  getReviews: (args: {
    placeId: string;
    limit?: number;
    after?: string;
  }) => Promise<{ place: PlaceMeta; reviews: Review[]; next_cursor?: string }>;
};

// Resolver seam: a name → data_id resolver, injectable for offline tests.
// Production uses the real SerpApi resolver (resolveToDataId).
type RouteDeps = {
  resolve: (input: string) => Promise<{ dataId: string; place?: PlaceMeta }>;
  // Optional reviews client override (offline tests); defaults to the factory.
  client?: ReviewsClient;
};

export async function GET(req: NextRequest) {
  return handleGet(req, { resolve: resolveToDataId });
}

async function handleGet(req: NextRequest, deps: RouteDeps) {
  const params = req.nextUrl.searchParams;
  // Batch mode: a `places` param (comma/newline-separated list) downloads
  // several businesses as one combined file (L31.2). It is purely additive —
  // the single-place `placeId` path below is unchanged when `places` is absent.
  if (params.get("places") != null) {
    return handleBatch(req, deps);
  }
  const placeIdInput = params.get("placeId");
  const formatRaw = (params.get("format") ?? "json").toLowerCase();
  const limitRaw = params.get("limit");

  if (!placeIdInput) {
    return errorJson("bad_request", "Missing required query param: placeId", 400);
  }

  // Harden the free-text input BEFORE the quota-metered resolver sees it: a
  // blank/whitespace-only, over-long, or control-char-laden `placeId` is a
  // malformed business-name we reject at the edge (L30.5).
  const inputCheck = validateInput(placeIdInput);
  if (!inputCheck.ok) {
    return errorJson("bad_request", inputCheck.message, 400);
  }
  const cleanInput = inputCheck.value;

  if (!isFormat(formatRaw)) {
    return errorJson(
      "bad_request",
      `Unsupported format "${formatRaw}". Use one of: ${SUPPORTED_FORMATS.join(", ")}`,
      400,
    );
  }
  const format: Format = formatRaw;

  const limit = parseLimit(limitRaw);
  if (!limit.ok) {
    return errorJson("bad_request", limit.message, 400);
  }
  const userLimit = limit.value;

  // Accept an id/URL or a business name (serpapi-resolved, cached) — shared
  // with the web preview so both surfaces behave identically (L28.1/L28.2).
  let normalised;
  try {
    normalised = await resolveInputToNormalised(cleanInput, { resolve: deps.resolve });
  } catch (err) {
    if (err instanceof SemanticForceError) {
      return errorJson(err.code, err.message, statusForCode(err.code, err.status));
    }
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

  const client = deps.client ?? createReviewsProvider();
  const outcome = await walkAndAssemble(client, normalised.raw);

  if (outcome.kind === "partial") {
    // Methodology §3: partial walks caused by mid-walk rate-limit are NOT
    // cached — the next request should retry against SF, not inherit the
    // partial. We slice with userLimit for the response only.
    const partialTrimmed =
      userLimit != null ? outcome.partial.slice(0, userLimit) : outcome.partial;
    const body: PartialBody = {
      error: { code: "rate_limited", message: outcome.message },
      partial: partialTrimmed,
    };
    if (outcome.retryAfterS != null) body.retry_after_s = outcome.retryAfterS;
    const headers: Record<string, string> = {};
    if (outcome.retryAfterS != null)
      headers["Retry-After"] = String(outcome.retryAfterS);
    return NextResponse.json(body, { status: 429, headers });
  }
  if (outcome.kind === "no_place") {
    return errorJson(
      "not_found",
      "No place metadata returned for that placeId.",
      404,
    );
  }
  if (outcome.kind === "error") {
    return errorJson(outcome.code, outcome.message, outcome.status);
  }
  if (outcome.kind === "unknown") {
    return errorJson("unknown", outcome.message, 500);
  }

  // Cache the full assembled walk (pre-limit) so a later request with a
  // different `limit` reuses the same entry. Truncation from HARD_CAP is
  // a stable outcome and IS cacheable (methodology §3); only the partial-
  // from-rate-limit branch above is excluded.
  await cache.set(normalised.slug, outcome.payload);

  return respondSuccess(outcome.payload, format, userLimit, "MISS", normalised.slug);
}

// One place's assemble-walk: paginate the provider in PAGE_SIZE pages up to the
// HARD_CAP_* ceilings, returning a discriminated outcome the single-place and
// batch paths both interpret. Single source of truth for the walk so the two
// surfaces can never drift (mirrors the L31.1 batch-export "reuse the single
// column contract" posture, applied to the fetch path).
type WalkOutcome =
  | { kind: "ok"; payload: CachedReviewsPayload }
  | {
      kind: "partial";
      partial: Review[];
      message: string;
      retryAfterS?: number;
    }
  | { kind: "no_place" }
  | { kind: "error"; code: SemanticForceErrorCode; message: string; status: number }
  | { kind: "unknown"; message: string };

async function walkAndAssemble(
  client: ReviewsClient,
  rawId: string,
): Promise<WalkOutcome> {
  const collected: Review[] = [];
  let placeMeta: PlaceMeta | null = null;
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  try {
    do {
      const page = await client.getReviews({
        placeId: rawId,
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
        return {
          kind: "partial",
          partial: collected,
          message:
            err.message ||
            "Upstream rate-limited mid-walk; returning partial result.",
          retryAfterS: inferRetryAfter(err),
        };
      }
      return {
        kind: "error",
        code: err.code,
        message: err.message,
        status: statusForCode(err.code, err.status),
      };
    }
    return { kind: "unknown", message: `Unexpected error: ${(err as Error).message}` };
  }

  if (!placeMeta) return { kind: "no_place" };

  const payload: CachedReviewsPayload = {
    place: placeMeta,
    reviews: collected,
    fetched_at: new Date().toISOString(),
  };
  if (truncated) payload.truncated = true;
  return { kind: "ok", payload };
}

// Batch download: resolve + walk several places, combine into ONE file. Each
// place is cached individually (same `gr:reviews:v1:<slug>` entries the single
// path writes, so a batch warms — and reuses — the single-place cache). A batch
// is all-or-nothing: any place that errors or rate-limits fails the whole
// request, because a silently-short combined file is worse than a clear error.
async function handleBatch(req: NextRequest, deps: RouteDeps) {
  const params = req.nextUrl.searchParams;
  const placesRaw = params.get("places") ?? "";
  const formatRaw = (params.get("format") ?? "csv").toLowerCase();
  const limitRaw = params.get("limit");

  if (!isFormat(formatRaw)) {
    return errorJson(
      "bad_request",
      `Unsupported format "${formatRaw}". Use one of: ${SUPPORTED_FORMATS.join(", ")}`,
      400,
    );
  }
  const format: Format = formatRaw;

  const limit = parseLimit(limitRaw);
  if (!limit.ok) return errorJson("bad_request", limit.message, 400);
  const userLimit = limit.value;

  // Split on comma or newline, trim, drop blanks, dedupe by raw text
  // (preserving first-seen order).
  const rawItems = placesRaw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seenInput = new Set<string>();
  const inputs: string[] = [];
  for (const item of rawItems) {
    if (seenInput.has(item)) continue;
    seenInput.add(item);
    inputs.push(item);
  }

  if (inputs.length === 0) {
    return errorJson(
      "bad_request",
      "Query param places must list at least one business (comma- or newline-separated).",
      400,
    );
  }
  if (inputs.length > MAX_BATCH_PLACES) {
    return errorJson(
      "bad_request",
      `Too many places (max ${MAX_BATCH_PLACES} per batch); received ${inputs.length}.`,
      400,
    );
  }
  // Edge-harden every input before any quota-metered resolver runs (same checks
  // as the single path) so one bad entry fails fast and cheap.
  for (const input of inputs) {
    const check = validateInput(input);
    if (!check.ok) {
      return errorJson(
        "bad_request",
        `Invalid place "${truncateForMessage(input)}": ${check.message}`,
        400,
      );
    }
  }

  const cache = createReviewsCache();
  const client = deps.client ?? createReviewsProvider();
  const payloads: CachedReviewsPayload[] = [];
  const seenSlug = new Set<string>();
  let allCached = true;

  for (const input of inputs) {
    let normalised;
    try {
      normalised = await resolveInputToNormalised(input, { resolve: deps.resolve });
    } catch (err) {
      if (err instanceof SemanticForceError) {
        return errorJson(
          err.code,
          `${err.message} (place: "${truncateForMessage(input)}")`,
          statusForCode(err.code, err.status),
        );
      }
      if (err instanceof PlaceIdParseError) {
        return errorJson(
          "bad_request",
          `${err.message} (place: "${truncateForMessage(input)}")`,
          400,
        );
      }
      throw err;
    }

    // Two inputs that resolve to the same place (e.g. a name and its data_id)
    // collapse to one column-set in the combined file.
    if (seenSlug.has(normalised.slug)) continue;
    seenSlug.add(normalised.slug);

    const cached = await cache.get(normalised.slug);
    if (cached) {
      payloads.push(cached);
      continue;
    }
    allCached = false;

    const outcome = await walkAndAssemble(client, normalised.raw);
    if (outcome.kind === "ok") {
      await cache.set(normalised.slug, outcome.payload);
      payloads.push(outcome.payload);
    } else if (outcome.kind === "partial") {
      const headers: Record<string, string> = {};
      if (outcome.retryAfterS != null)
        headers["Retry-After"] = String(outcome.retryAfterS);
      return NextResponse.json(
        {
          error: {
            code: "rate_limited",
            message: `${outcome.message} (place: "${truncateForMessage(input)}")`,
          },
        },
        { status: 429, headers },
      );
    } else if (outcome.kind === "no_place") {
      return errorJson(
        "not_found",
        `No place metadata returned for "${truncateForMessage(input)}".`,
        404,
      );
    } else if (outcome.kind === "error") {
      return errorJson(
        outcome.code,
        `${outcome.message} (place: "${truncateForMessage(input)}")`,
        outcome.status,
      );
    } else {
      return errorJson("unknown", outcome.message, 500);
    }
  }

  // `limit` caps EACH place at N rows before combining (consistent with the
  // single path's per-request slice; the per-place cache still holds the full
  // walk so a later larger limit reuses it).
  const finalPayloads =
    userLimit != null
      ? payloads.map((p) => slicePayload(p, userLimit))
      : payloads;

  return respondBatch(finalPayloads, format, allCached ? "HIT" : "MISS");
}

function slicePayload(p: CachedReviewsPayload, n: number): CachedReviewsPayload {
  const out: CachedReviewsPayload = {
    place: p.place,
    reviews: p.reviews.slice(0, n),
    fetched_at: p.fetched_at,
  };
  if (p.truncated) out.truncated = true;
  return out;
}

function respondBatch(
  payloads: CachedReviewsPayload[],
  format: Format,
  cacheStatus: "HIT" | "MISS",
) {
  const placeCount = payloads.length;
  // Data vintage of the batch = freshest place's fetch time (matches the
  // batchFilename convention's `max(fetched_at)`).
  const freshest = payloads.reduce(
    (max, p) => (p.fetched_at > max ? p.fetched_at : max),
    payloads[0]?.fetched_at ?? "",
  );

  if (format === "json") {
    const body = {
      places: payloads.map((p) => {
        const b: ReviewsBody = {
          place: p.place,
          reviews: p.reviews,
          fetched_at: p.fetched_at,
        };
        if (p.truncated) b.truncated = true;
        return b;
      }),
      place_count: placeCount,
      review_count: batchReviewCount(payloads),
      fetched_at: freshest,
    };
    return NextResponse.json(body, { headers: { "X-Cache": cacheStatus } });
  }

  if (format === "csv") {
    const csv = formatBatchAsCsv(payloads);
    const filename = batchFilename(placeCount, freshest, "csv");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  // format === "xlsx"
  const xlsx = formatBatchAsXlsx(payloads);
  const filename = batchFilename(placeCount, freshest, "xlsx");
  return new NextResponse(new Blob([new Uint8Array(xlsx)]), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Cache": cacheStatus,
    },
  });
}

// Truncate a user-supplied input echoed back in an error message, so a near-
// limit (2KB) value can't bloat the error body.
function truncateForMessage(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
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
  // Wrap the bytes in a Blob: a BodyInit the edge runtime accepts directly.
  // Copy into a fresh ArrayBuffer-backed view so the type is a concrete
  // BlobPart (TS 5.7's Uint8Array<ArrayBufferLike> isn't assignable as-is).
  return new NextResponse(new Blob([new Uint8Array(xlsx)]), {
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

// Result of validating/normalising a free-text `placeId` (id, URL, or name).
type InputCheck =
  | { ok: true; value: string }
  | { ok: false; message: string };

// Edge-side hardening for the `placeId` param. Runs before the quota-metered
// SerpApi name resolver so a malformed/abusive value never burns a search:
//  - trims surrounding whitespace (the resolver/normaliser trim too, but we
//    reject on the trimmed length so "   " is caught here, not downstream);
//  - blank-after-trim → 400 (distinct from the missing-param 400 above);
//  - over MAX_INPUT_LENGTH → 400 (a multi-KB string is never a real id/URL/name);
//  - any raw control character → 400 (NUL/newline/DEL etc. are malformed input).
function validateInput(raw: string): InputCheck {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, message: "Query param placeId must not be blank." };
  }
  if (value.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      message: `Query param placeId is too long (max ${MAX_INPUT_LENGTH} characters).`,
    };
  }
  if (CONTROL_CHARS.test(value)) {
    return {
      ok: false,
      message: "Query param placeId contains invalid control characters.",
    };
  }
  return { ok: true, value };
}

// Result of parsing the optional `limit` param.
type LimitCheck =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

// Parse + clamp the `limit` param. Absent → undefined (no slice, return all).
// Non-numeric / NaN / Infinity / < 1 → 400. Otherwise floored to an integer and
// clamped to MAX_LIMIT so an absurd `?limit=9999999` is bounded, not rejected
// (over-asking is benign — the user just gets everything we assembled).
function parseLimit(limitRaw: string | null): LimitCheck {
  if (limitRaw == null) return { ok: true, value: undefined };
  const parsed = Number(limitRaw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return {
      ok: false,
      message: `Invalid limit "${limitRaw}" — must be a positive integer.`,
    };
  }
  return { ok: true, value: Math.min(Math.floor(parsed), MAX_LIMIT) };
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
  MAX_LIMIT,
  MAX_INPUT_LENGTH,
  MAX_BATCH_PLACES,
  SUPPORTED_FORMATS,
  statusForCode,
  inferRetryAfter,
  validateInput,
  parseLimit,
  // Drive the handler with an injected name resolver (offline tests).
  handleGet,
};
