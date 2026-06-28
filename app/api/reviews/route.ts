// GET /api/reviews?placeId=...&format=json|csv|xlsx|md|html&limit=N
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
import { ReviewSummary, summariseReviews } from "@/lib/reviews/summary";
import { ReviewFilter, filterReviews } from "@/lib/reviews/filter";
import {
  parseBooleanFlag,
  parseFilter,
  parseRating,
} from "@/lib/reviews/filter-params";
import { ReviewOrder, parseReviewOrder, sortReviews } from "@/lib/reviews/sort";
import { ReviewField, projectReviews } from "@/lib/reviews/project";
import { parseFieldsParam } from "@/lib/reviews/project-params";
import { AnonymiseOptions, anonymiseReviews } from "@/lib/reviews/anonymise";
import { parseAnonymiseOptions } from "@/lib/reviews/anonymise-params";
import { resolveToDataId } from "@/lib/serpapi/resolve";
import { resolveInputToNormalised } from "@/lib/reviews/resolve-input";
import { MAX_BATCH_PLACES, parsePlacesList } from "@/lib/reviews/batch-input";
import { csvFilename, formatReviewsAsCsv } from "@/lib/export/csv";
import {
  XLSX_CONTENT_TYPE,
  formatReviewsAsXlsx,
  xlsxFilename,
} from "@/lib/export/xlsx";
import {
  MARKDOWN_CONTENT_TYPE,
  formatReviewsAsMarkdown,
  markdownFilename,
} from "@/lib/export/markdown";
import {
  HTML_CONTENT_TYPE,
  formatReviewsAsHtml,
  htmlFilename,
} from "@/lib/export/html";
import {
  TEXT_CONTENT_TYPE,
  formatReviewsAsText,
  textFilename,
} from "@/lib/export/text";
import {
  JSONLD_CONTENT_TYPE,
  formatReviewsAsJsonLd,
  jsonldFilename,
} from "@/lib/export/jsonld";
import {
  RSS_CONTENT_TYPE,
  formatReviewsAsRss,
  rssFilename,
} from "@/lib/export/rss";
import {
  batchFilename,
  batchReviewCount,
  formatBatchAsCsv,
  formatBatchAsHtml,
  formatBatchAsJsonLd,
  formatBatchAsMarkdown,
  formatBatchAsRss,
  formatBatchAsText,
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
// Raw control characters (incl. NUL, tab, newline, DEL) never appear in a
// legitimate id/URL/name once the querystring is decoded; their presence is a
// malformed input (or an injection probe) we reject rather than forward.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SUPPORTED_FORMATS = ["json", "csv", "xlsx", "md", "html", "txt", "jsonld", "rss"] as const;
type Format = (typeof SUPPORTED_FORMATS)[number];

// Format aliases the public surface accepts but normalises before validation:
// `markdown` is the long form of the canonical `md` (parity with the docs and
// the way users name the extension). Applied right after the lowercase so the
// rest of the route only ever sees the canonical `Format` tokens.
const FORMAT_ALIASES: Record<string, Format> = { markdown: "md" };

function normaliseFormat(raw: string): string {
  return FORMAT_ALIASES[raw] ?? raw;
}

type ErrorBody = { error: { code: string; message: string } };
type ReviewsBody = {
  place: PlaceMeta;
  // Full `Review[]` by default; a `Partial<Review>[]` when a `fields` column
  // selection (L35.2) narrows each object to its requested keys. `Review[]` is
  // assignable here, so the batch path (which never projects) is unaffected.
  reviews: Review[] | Partial<Review>[];
  fetched_at: string;
  truncated?: true;
  // Optional aggregate digest (star distribution, sentiment split, operational
  // signals) attached only when `?summary=1` is set on a JSON request (L32.2).
  // Derived from the SAME trimmed view the caller receives, so `sampled_reviews`
  // equals `reviews.length` above — never the whole-place total (that lives in
  // `summary.total_reviews`, the D-041/D-031 total-not-walk-count invariant).
  summary?: ReviewSummary;
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
  const formatRaw = normaliseFormat((params.get("format") ?? "json").toLowerCase());
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

  // Optional `?summary=1` flag — attaches an aggregate digest to the JSON
  // response (L32.2). Lenient: ignored on csv/xlsx (the file formats have no
  // place for it) and never the cause of a 400.
  const summaryFlag = parseSummaryFlag(params.get("summary"));

  // Optional review-filtering criteria (L33.2) — parsed leniently into a
  // `ReviewFilter` and applied to the assembled walk BEFORE the userLimit slice
  // and BEFORE export/summary, so every delivery surface filters identically
  // (the pure layer is `lib/reviews/filter.ts`, L33.1). A malformed criterion
  // degrades to "no constraint" rather than 400 — consistent with the filter
  // module's lenient-date design and the `?summary=1` flag; only the structural
  // params (placeId/format/limit) ever 400.
  const filter = parseFilter(params);

  // Optional review ordering (L34.2) — `order` (or its `sort` alias) parsed
  // leniently into a `ReviewOrder` and applied AFTER `filterReviews` and BEFORE
  // the userLimit slice + export/summary, so `order=lowest&limit=3` yields the 3
  // lowest-rated of the whole filtered set (not the lowest of the top-3). A bad
  // value degrades to `null` → identity (no sort), never a 400 — consistent with
  // the lenient filter/summary params (the pure layer is `lib/reviews/sort.ts`).
  const order = parseReviewOrder(params.get("order") ?? params.get("sort"));

  // Optional column selection (L35.2/L35.3) — `fields` (or its `columns` alias)
  // parsed leniently into an ordered, de-duplicated `ReviewField[]` and applied
  // AFTER filter+sort+limit, as the LAST transform before serialisation, so the
  // exported columns (JSON keys / CSV+XLSX headers) match the request. `null`
  // (absent/blank/all-unrecognised) is the identity → full objects / full 14
  // columns, never a 400 — consistent with the lenient filter/sort/summary
  // params. The shared `parseFieldsParam` (L35.3/D-095 de-drift) also accepts
  // the web form's repeated `fields=…&fields=…` checkbox params, not just the
  // API's comma string (the pure layer is `lib/reviews/project.ts`).
  const fields = parseFieldsParam(params);

  // Optional PII redaction (L36.2) — the `anonymize`/`anonymise` umbrella plus
  // the granular `mask_author`/`drop_author_url`/`drop_photos` flags parsed
  // leniently into an `AnonymiseOptions`. Applied AFTER filter+sort+limit and
  // BEFORE projection + serialisation/summary (`anonymiseReviews` needs the full
  // `Review` to mask `author_name`, which projection may have dropped), so every
  // delivery surface (JSON/CSV/XLSX) redacts identically. An empty bag (no
  // flag set / all unrecognised) is the identity → today's full export, never a
  // 400 — consistent with the lenient filter/sort/fields/summary params. The
  // shared `parseAnonymiseOptions` (de-drift, the L28.2/D-095 pattern) will also
  // back the web form's checkboxes in L36.3 (the pure layer is
  // `lib/reviews/anonymise.ts`).
  const anonymise = parseAnonymiseOptions(params);

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
    return respondSuccess(cached, format, userLimit, "HIT", normalised.slug, summaryFlag, filter, order, fields, anonymise);
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

  return respondSuccess(outcome.payload, format, userLimit, "MISS", normalised.slug, summaryFlag, filter, order, fields, anonymise);
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
  const formatRaw = normaliseFormat((params.get("format") ?? "csv").toLowerCase());
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
  // (preserving first-seen order) — shared with the web preview so both
  // surfaces parse a pasted list identically (L31.3).
  const inputs = parsePlacesList(placesRaw);

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

  if (format === "md") {
    const md = formatBatchAsMarkdown(payloads);
    const filename = batchFilename(placeCount, freshest, "md");
    return new NextResponse(md, {
      status: 200,
      headers: {
        "Content-Type": MARKDOWN_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "html") {
    const html = formatBatchAsHtml(payloads);
    const filename = batchFilename(placeCount, freshest, "html");
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": HTML_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "txt") {
    const txt = formatBatchAsText(payloads);
    const filename = batchFilename(placeCount, freshest, "txt");
    return new NextResponse(txt, {
      status: 200,
      headers: {
        "Content-Type": TEXT_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "jsonld") {
    const jsonld = formatBatchAsJsonLd(payloads);
    const filename = batchFilename(placeCount, freshest, "jsonld");
    return new NextResponse(jsonld, {
      status: 200,
      headers: {
        "Content-Type": JSONLD_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "rss") {
    const rss = formatBatchAsRss(payloads);
    const filename = batchFilename(placeCount, freshest, "rss");
    return new NextResponse(rss, {
      status: 200,
      headers: {
        "Content-Type": RSS_CONTENT_TYPE,
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
  summary: boolean,
  filter: ReviewFilter = {},
  order: ReviewOrder | null = null,
  fields: ReviewField[] | null = null,
  anonymise: AnonymiseOptions = {},
) {
  // Filter the assembled walk FIRST (L33.2), THEN sort (L34.2), THEN apply the
  // userLimit slice: a `min_rating=1&order=lowest&limit=50` request means "the
  // 50 lowest-rated 1★ reviews", not "the lowest-rated among the first 50". Both
  // filtering and ordering are per-request view concerns — the cache (D-030)
  // still holds the full unfiltered, unsorted walk. `order` is `null` for an
  // absent/unrecognised param, which `sortReviews` treats as the identity.
  const filtered = filterReviews(payload.reviews, filter);
  const sorted = sortReviews(filtered, order);
  const trimmed =
    userLimit != null ? sorted.slice(0, userLimit) : sorted;
  // Redact reviewer PII (L36.2) as a uniform pass over the assembled+sliced
  // `Review[]` — BEFORE projection (which can drop `author_name`, leaving
  // nothing to mask) and BEFORE every serialisation surface, so JSON/CSV/XLSX
  // and the summary all redact identically. An empty `anonymise` bag is the
  // identity (whole copies), so an absent redaction request reproduces today's
  // export byte-for-byte. Per-request view concern: the cache (D-030) still
  // holds the un-redacted walk.
  const redacted = anonymiseReviews(trimmed, anonymise);
  // CSV and XLSX exports operate on the redacted, trimmed view too, so a
  // `limit=N` request produces a file with N rows. The cache key is unaffected
  // (D-030: cache holds the full walk).
  const trimmedPayload: CachedReviewsPayload = {
    place: payload.place,
    reviews: redacted,
    fetched_at: payload.fetched_at,
  };
  if (payload.truncated) trimmedPayload.truncated = true;

  if (format === "json") {
    // Project the JSON objects down to the requested columns (L35.2) as the
    // last step before serialisation. `fields === null` is the identity, so an
    // absent/blank `fields` keeps full objects (the documented JSON default);
    // a recognised set narrows each object to exactly its present requested
    // keys, in first-requested order.
    const body: ReviewsBody = {
      place: payload.place,
      reviews: projectReviews(redacted, fields),
      fetched_at: payload.fetched_at,
    };
    if (payload.truncated) body.truncated = true;
    // Summarise the TRIMMED view (NOT the projected one) so the digest stays a
    // faithful aggregate even when columns are dropped: `summary.sampled_reviews`
    // matches the `reviews` array length (a limit=3 response digests 3 rows),
    // while `summary.total_reviews` still carries the whole-place headline.
    // Column selection is a presentation concern for the `reviews` array only.
    if (summary) body.summary = summariseReviews(trimmedPayload);
    return NextResponse.json(body, {
      headers: { "X-Cache": cacheStatus },
    });
  }

  if (format === "csv") {
    const csv = formatReviewsAsCsv(trimmedPayload, fields);
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

  if (format === "md") {
    // Markdown is a narrative testimonials document, NOT a column subset, so it
    // intentionally ignores `fields` (L37.1 design) while honouring the same
    // filter→sort→limit→anonymise pipeline as the other formats (it serialises
    // the redacted `trimmedPayload`).
    const md = formatReviewsAsMarkdown(trimmedPayload);
    const filename = markdownFilename(slug, payload.fetched_at);
    return new NextResponse(md, {
      status: 200,
      headers: {
        "Content-Type": MARKDOWN_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "html") {
    // HTML is a self-contained, publishable testimonials page (L38.1), NOT a
    // column subset, so — like Markdown — it intentionally ignores `fields`
    // while honouring the same filter→sort→limit→anonymise pipeline as the
    // other formats (it serialises the redacted `trimmedPayload`).
    const html = formatReviewsAsHtml(trimmedPayload);
    const filename = htmlFilename(slug, payload.fetched_at);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": HTML_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "txt") {
    // Plain text is an unstyled narrative testimonials document (L39.1), NOT a
    // column subset, so — like Markdown and HTML — it intentionally ignores
    // `fields` while honouring the same filter→sort→limit→anonymise pipeline as
    // the other formats (it serialises the redacted `trimmedPayload`).
    const txt = formatReviewsAsText(trimmedPayload);
    const filename = textFilename(slug, payload.fetched_at);
    return new NextResponse(txt, {
      status: 200,
      headers: {
        "Content-Type": TEXT_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "jsonld") {
    // JSON-LD is a schema.org structured-data document (L40.1), NOT a column
    // subset, so — like Markdown, HTML and plain text — it intentionally ignores
    // `fields` while honouring the same filter→sort→limit→anonymise pipeline as
    // the other formats (it serialises the redacted `trimmedPayload`).
    const jsonld = formatReviewsAsJsonLd(trimmedPayload);
    const filename = jsonldFilename(slug, payload.fetched_at);
    return new NextResponse(jsonld, {
      status: 200,
      headers: {
        "Content-Type": JSONLD_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  if (format === "rss") {
    // RSS 2.0 is a syndication feed (L41.1), NOT a column subset, so — like
    // Markdown, HTML, plain text and JSON-LD — it intentionally ignores `fields`
    // while honouring the same filter→sort→limit→anonymise pipeline as the other
    // formats (it serialises the redacted `trimmedPayload`).
    const rss = formatReviewsAsRss(trimmedPayload);
    const filename = rssFilename(slug, payload.fetched_at);
    return new NextResponse(rss, {
      status: 200,
      headers: {
        "Content-Type": RSS_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Cache": cacheStatus,
      },
    });
  }

  // format === "xlsx" — only branch left after json/csv/md/html/txt/jsonld/rss above.
  const xlsx = formatReviewsAsXlsx(trimmedPayload, fields);
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

// Parse the optional `summary` flag (L32.2). Truthy tokens (`1`/`true`/`yes`,
// case-insensitive, surrounding whitespace tolerated) → true; absent or any
// other value → false. Lenient by design: the flag is purely additive, so an
// unrecognised value is treated as "off" rather than failing an otherwise-valid
// download with a 400.
function parseSummaryFlag(raw: string | null): boolean {
  if (raw == null) return false;
  return ["1", "true", "yes"].includes(raw.trim().toLowerCase());
}

// The `min_rating`/`max_rating`/`with_photos`/… → `ReviewFilter` parsing now
// lives in the shared `lib/reviews/filter-params.ts` (L33.3) so this route and
// the web preview page parse the same query params identically (de-drift, the
// L28.2/D-095 pattern). `parseRating`/`parseBooleanFlag`/`parseFilter` are
// imported above and re-exported through `__testing` below for the existing
// route suites.

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
  parseSummaryFlag,
  parseRating,
  parseBooleanFlag,
  parseFilter,
  parseAnonymiseOptions,
  // Drive the handler with an injected name resolver (offline tests).
  handleGet,
};
