// Result preview (L2.5) — the page the shared review tool now lands on.
//
// Flow: ReviewToolForm GET-navigates here with `placeId` (+ preferred
// `format`). We normalise the id, fetch only the FIRST 5 reviews via the
// SemanticForce client (server-side, so this bypasses the KV walk and the
// edge rate-limit middleware — a preview must stay cheap and instant), then
// render place meta + those 5 reviews + a download CTA. The "total count"
// shown is `place.rating_count` (Google's canonical review total) rather
// than a full walk: the preview deliberately never paginates (D-031).
//
// Actual file generation still happens in `/api/reviews` (CSV/JSON/XLSX);
// the CTA buttons just deep-link there with the original input preserved.

import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { createReviewsProvider } from "@/lib/reviews/provider";
import { createReviewsCache, createPreviewCache } from "@/lib/cache/reviews-cache";
import { summariseReviews, type ReviewSummary } from "@/lib/reviews/summary";
import { filterReviews, type ReviewFilter } from "@/lib/reviews/filter";
import {
  FILTER_PARAM_KEYS,
  hasActiveFilter,
  parseFilter,
} from "@/lib/reviews/filter-params";
import { sortReviews, parseReviewOrder } from "@/lib/reviews/sort";
import { projectReviews } from "@/lib/reviews/project";
import { parseFieldsParam } from "@/lib/reviews/project-params";
import { resolveInputToNormalised } from "@/lib/reviews/resolve-input";
import { MAX_BATCH_PLACES, parsePlacesList } from "@/lib/reviews/batch-input";
import { PlaceIdParseError } from "@/lib/semanticforce/place-id";
import { semanticForceErrorToUx } from "@/lib/semanticforce/error-ux";
import {
  SemanticForceError,
  type PlaceMeta,
  type Review,
} from "@/lib/semanticforce/types";

const PREVIEW_COUNT = 5;
const SUPPORTED_FORMATS = ["csv", "json", "xlsx"] as const;
type Format = (typeof SUPPORTED_FORMATS)[number];

function isFormat(s: string | undefined): s is Format {
  return s != null && (SUPPORTED_FORMATS as readonly string[]).includes(s);
}

function stars(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      {children}
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/" className="underline">
          ← Start over
        </Link>
      </p>
    </main>
  );
}

function ErrorCard({
  title,
  detail,
  retryHint,
}: {
  title: string;
  detail: string;
  retryHint?: string;
}) {
  return (
    <Shell>
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
        {retryHint && (
          <p className="text-sm text-foreground">
            <span className="font-medium">What to try:</span> {retryHint}
          </p>
        )}
      </div>
    </Shell>
  );
}

function DownloadCta({
  placeIdInput,
  preferred,
  filterQuery,
}: {
  placeIdInput: string;
  preferred: Format;
  // Already-encoded `min_rating=…&language=…&order=…` suffix (no leading `&`);
  // empty string when no filter/sort is active. Forwarded verbatim so the
  // download applies the exact same slice + order the preview showed (L33.3/L34.3).
  filterQuery: string;
}) {
  const href = (fmt: Format) => {
    const base = `/api/reviews?placeId=${encodeURIComponent(placeIdInput)}&format=${fmt}`;
    return filterQuery ? `${base}&${filterQuery}` : base;
  };
  const ordered: Format[] = [
    preferred,
    ...SUPPORTED_FORMATS.filter((f) => f !== preferred),
  ];
  const [primary, ...secondary] = ordered;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
      <span className="text-sm font-medium">Download all reviews</span>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={href(primary)}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Download {primary.toUpperCase()}
        </a>
        {secondary.map((f) => (
          <a
            key={f}
            href={href(f)}
            className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            {f.toUpperCase()}
          </a>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        The full export includes every review (preview shows the first{" "}
        {PREVIEW_COUNT}). CSV is Excel-ready (UTF-8 BOM, CRLF); XLSX has a
        frozen header.
      </span>
    </div>
  );
}

// Accepts a `Partial<Review>` so the L35.3 column projection can drop fields:
// every field is guarded, so a deselected column simply disappears from the card
// (the preview reflects the chosen columns, matching the download's projection).
function ReviewRow({ review }: { review: Partial<Review> }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border py-4 last:border-0">
      {(review.author_name || review.published_at) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {review.author_name && (
            <span className="font-medium">{review.author_name}</span>
          )}
          {review.published_at && (
            <span className="text-xs text-muted-foreground">
              {formatDate(review.published_at)}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        {review.rating != null && (
          <span
            aria-label={`${review.rating} out of 5 stars`}
            className="text-amber-500"
          >
            {stars(review.rating)}
          </span>
        )}
        {review.language && review.language !== "en" && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {review.language}
          </span>
        )}
        {review.photos && review.photos.length > 0 && (
          <span className="text-xs text-muted-foreground">
            📷 {review.photos.length}
          </span>
        )}
      </div>
      {review.text && (
        <p className="whitespace-pre-line text-sm text-foreground">
          {review.text}
        </p>
      )}
      {review.owner_response && (
        <p className="mt-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          <span className="font-medium">Owner response:</span>{" "}
          {review.owner_response.text}
        </p>
      )}
    </li>
  );
}

function PlaceHeader({ place }: { place: PlaceMeta }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{place.name}</h1>
      {place.address && (
        <p className="text-sm text-muted-foreground">{place.address}</p>
      )}
      <p className="text-sm">
        <span className="text-amber-500">{stars(place.rating_avg)}</span>{" "}
        <span className="font-medium">{place.rating_avg.toFixed(1)}</span>{" "}
        <span className="text-muted-foreground">
          · {place.rating_count.toLocaleString("en-US")} reviews on Google
        </span>
      </p>
    </header>
  );
}

function pct(n: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

// At-a-glance digest of the sampled reviews (L32.3), backed by the shared
// `summariseReviews` (L32.1) so the card, the JSON `?summary=1` field (L32.2)
// and any future MCP surface report identical figures. Everything here
// describes only the reviews actually shown — the sample, NOT the whole place:
// the heading names the sampled count and PlaceHeader above already carries
// Google's canonical `rating_count` total, so the two are never conflated
// (the D-041/D-031 total-not-walk-count invariant). Pure/hookless so the
// preview suites can flatten it without a react-dom render (D-050).
function SummaryCard({ summary }: { summary: ReviewSummary }) {
  const sampled = summary.sampled_reviews;
  const dist = summary.rating_distribution;
  const { positive, neutral, negative } = summary.sentiment;
  return (
    <section
      aria-labelledby="summary-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="summary-heading" className="text-sm font-medium">
          Summary of the {sampled} reviews shown
        </h2>
        <span className="text-xs text-muted-foreground">
          Sample average{" "}
          <span className="text-amber-500">★</span>{" "}
          {summary.sampled_average_rating.toFixed(1)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {([5, 4, 3, 2, 1] as const).map((star) => (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-7 shrink-0 tabular-nums text-muted-foreground">
              {star}★
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
              <span
                className="block h-full bg-amber-500"
                style={{ width: pct(dist[star], sampled) }}
              />
            </span>
            <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
              {dist[star]}
            </span>
          </div>
        ))}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Positive</dt>
          <dd className="font-medium text-emerald-600">{positive}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Neutral</dt>
          <dd className="font-medium">{neutral}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted-foreground">Negative</dt>
          <dd className="font-medium text-destructive">{negative}</dd>
        </div>
      </dl>

      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <li>📷 {summary.with_photos} with photos</li>
        <li>💬 {summary.with_owner_response} with owner response</li>
        <li>
          🌐{" "}
          {summary.languages.length === 0
            ? "no language data"
            : `${summary.languages.length} ${
                summary.languages.length === 1 ? "language" : "languages"
              }: ${summary.languages.join(", ")}`}
        </li>
      </ul>
    </section>
  );
}

// One place's preview slice via the same three-tier cache the single path
// uses (completed download → prior preview → live+cache), so batch and single
// preview cost the same upstream and warm the same entries. Throws the same
// PlaceIdParseError / SemanticForceError the single path catches.
async function loadPlacePreview(
  rawInput: string,
): Promise<{ place: PlaceMeta; reviews: Review[] }> {
  const normalised = await resolveInputToNormalised(rawInput);
  const slug = normalised.slug;
  const reviewsCache = createReviewsCache();
  const previewCache = createPreviewCache();
  const full = await reviewsCache.get(slug);
  const prior = full ?? (await previewCache.get(slug));
  if (prior) {
    return { place: prior.place, reviews: prior.reviews.slice(0, PREVIEW_COUNT) };
  }
  const client = createReviewsProvider();
  const res = await client.getReviews({
    placeId: normalised.raw,
    limit: PREVIEW_COUNT,
  });
  const place = res.place;
  const reviews = res.reviews.slice(0, PREVIEW_COUNT);
  await previewCache.set(slug, {
    place,
    reviews,
    fetched_at: new Date().toISOString(),
  });
  return { place, reviews };
}

// Batch preview (L31.3): resolve each pasted place, show its review count, and
// offer ONE combined download. All-or-nothing like the /api/reviews batch path
// — any place that fails to resolve/fetch surfaces a clear error rather than a
// silently-short list.
async function BatchPreview({
  rawPlaces,
  preferred,
}: {
  rawPlaces: string;
  preferred: Format;
}) {
  const inputs = parsePlacesList(rawPlaces);
  if (inputs.length === 0) {
    return (
      <ErrorCard
        title="Nothing to preview"
        detail="No businesses were provided. Go back and paste one place per line (or comma-separated)."
      />
    );
  }
  if (inputs.length > MAX_BATCH_PLACES) {
    return (
      <ErrorCard
        title="Too many businesses"
        detail={`A batch is limited to ${MAX_BATCH_PLACES} places; you pasted ${inputs.length}. Remove some and try again.`}
      />
    );
  }

  const places: PlaceMeta[] = [];
  try {
    for (const input of inputs) {
      const { place } = await loadPlacePreview(input);
      places.push(place);
    }
  } catch (err) {
    if (err instanceof PlaceIdParseError) {
      return (
        <ErrorCard title="That doesn't look like a place" detail={err.message} />
      );
    }
    if (err instanceof SemanticForceError) {
      const ux = semanticForceErrorToUx(err);
      return (
        <ErrorCard title={ux.title} detail={ux.detail} retryHint={ux.retryHint} />
      );
    }
    throw err;
  }

  const totalReviews = places.reduce((s, p) => s + p.rating_count, 0);
  const href = (fmt: Format) =>
    `/api/reviews?places=${encodeURIComponent(rawPlaces)}&format=${fmt}`;
  const ordered: Format[] = [
    preferred,
    ...SUPPORTED_FORMATS.filter((f) => f !== preferred),
  ];
  const [primary, ...secondary] = ordered;

  return (
    <Shell>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {places.length} businesses · {totalReviews.toLocaleString("en-US")}{" "}
          reviews
        </h1>
        <p className="text-sm text-muted-foreground">
          One combined download with a per-row place column.
        </p>
      </header>

      <ul className="flex flex-col rounded-lg border border-border bg-card">
        {places.map((p) => (
          <li
            key={p.place_id}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 last:border-0"
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-sm text-muted-foreground">
              <span className="text-amber-500">{stars(p.rating_avg)}</span>{" "}
              {p.rating_count.toLocaleString("en-US")} reviews
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <span className="text-sm font-medium">
          Download all {places.length} places as one file
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={href(primary)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Download {primary.toUpperCase()}
          </a>
          {secondary.map((f) => (
            <a
              key={f}
              href={href(f)}
              className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              {f.toUpperCase()}
            </a>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Each place&apos;s rows are tagged with its <code>place_id</code> /
          <code>place_name</code> so the combined file splits back apart.
        </span>
      </div>
    </Shell>
  );
}

export const metadata: Metadata = {
  title: "Review preview",
  robots: { index: false },
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    placeId?: string;
    format?: string;
    places?: string;
    // Filter criteria (L33.3) + sort (L34.3) + column selection (L35.3) ride
    // along from the web form's GET submit; they are parsed via the SAME shared
    // parsers /api/reviews uses, then forwarded to the download CTA so preview
    // and download apply an identical slice. A repeated param (the `fields`
    // checkbox group) arrives as a string[]; a single one as a string.
    [key: string]: string | string[] | undefined;
  }>;
}) {
  const sp = await searchParams;
  const { placeId: rawInput, format: formatRaw, places: rawPlaces } = sp;
  const preferred: Format = isFormat(formatRaw) ? formatRaw : "csv";

  // Build the review filter from the same query params the HTTP API reads, via
  // the shared `lib/reviews/filter-params.ts` parser (no drift, L33.3/D-095).
  // The encoded `filterQuery` is forwarded verbatim onto the download CTA so the
  // file the user downloads carries the exact filter the preview reflected.
  const filterParams = new URLSearchParams();
  for (const key of FILTER_PARAM_KEYS) {
    const value = sp[key];
    if (typeof value === "string" && value.length > 0) {
      filterParams.set(key, value);
    }
  }
  const filter: ReviewFilter = parseFilter(filterParams);

  // Optional ordering (L34.3): parse the form's `order` param (the route's
  // `sort` alias also accepted) via the shared pure layer, and carry it in the
  // SAME query string the download CTA forwards so preview + download order
  // identically. A blank "As listed" value parses to null → identity, and is
  // omitted from the query (exactly today's unordered behaviour).
  const order = parseReviewOrder(sp.order ?? sp.sort);
  if (order) filterParams.set("order", order);

  // Optional column selection (L35.3): the form's `fields` checkboxes submit
  // repeated `fields=…` params (and the API also accepts a `fields=a,b` comma
  // string / `columns` alias). Parse via the shared `parseFieldsParam` — the
  // SAME parser /api/reviews uses — then carry each selected field back onto the
  // download CTA (as repeated `fields=…` params) so the file the user downloads
  // projects to the exact columns the preview reflected. A null (all-unchecked)
  // selection appends nothing → full columns, exactly today's behaviour.
  // Next gives a repeated query param (`fields=a&fields=b`) as a string[] at
  // runtime, a single one as a string — collect both shapes into URLSearchParams.
  const requestParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") requestParams.append(k, v);
    else if (Array.isArray(v)) for (const item of v) requestParams.append(k, item);
  }
  const fields = parseFieldsParam(requestParams);
  if (fields) for (const f of fields) filterParams.append("fields", f);
  const filterQuery = filterParams.toString();

  // Batch mode (L31.3): a `places` list downloads several businesses as one
  // file. Purely additive — the single-place `placeId` path below is unchanged
  // when `places` is absent. We `await` BatchPreview rather than returning it as
  // an element so the page resolves its tree inline (same as the single path
  // does below), which keeps the whole preview testable through the no-react-dom
  // structural walk the suites use (D-050).
  if (rawPlaces != null) {
    return await BatchPreview({ rawPlaces, preferred });
  }

  if (!rawInput || !rawInput.trim()) {
    return (
      <ErrorCard
        title="Nothing to preview"
        detail="No place was provided. Go back and paste a Google Maps place URL or a Place ID."
      />
    );
  }

  // Accept an id/URL or a business name (serpapi-resolved, cached) — same
  // shared path as /api/reviews so the two surfaces behave identically (L28.2).
  let normalised;
  try {
    normalised = await resolveInputToNormalised(rawInput);
  } catch (err) {
    if (err instanceof PlaceIdParseError) {
      return (
        <ErrorCard title="That doesn't look like a place" detail={err.message} />
      );
    }
    if (err instanceof SemanticForceError) {
      const ux = semanticForceErrorToUx(err);
      return (
        <ErrorCard title={ux.title} detail={ux.detail} retryHint={ux.retryHint} />
      );
    }
    throw err;
  }

  let place: PlaceMeta;
  let reviews: Review[];
  try {
    const slug = normalised.slug;
    // Three tiers, cheapest first — protect the SerpApi quota:
    //   1. a completed full download (richest, authoritative) → preview free;
    //   2. a prior preview of this place → free;
    //   3. live fetch (1 upstream call) → cache under the preview namespace.
    const reviewsCache = createReviewsCache();
    const previewCache = createPreviewCache();
    const full = await reviewsCache.get(slug);
    const prior = full ?? (await previewCache.get(slug));
    // `sampled` is the unfiltered set we have on hand (the full walk when the
    // download cache is warm, otherwise the ≤5 preview sample). We filter THIS
    // and then slice — so a warm full cache shows the first PREVIEW_COUNT
    // *matching* reviews, while a cold preview can only filter its small sample
    // (the download still filters every review — L33.3). The cache always stores
    // the unfiltered sample so a later differently-filtered preview reuses it.
    let sampled: Review[];
    if (prior) {
      place = prior.place;
      sampled = prior.reviews;
    } else {
      const client = createReviewsProvider();
      const res = await client.getReviews({
        placeId: normalised.raw,
        limit: PREVIEW_COUNT,
      });
      place = res.place;
      sampled = res.reviews.slice(0, PREVIEW_COUNT);
      // Best-effort: never write the full-walk key from a partial preview.
      await previewCache.set(slug, {
        place,
        reviews: sampled,
        fetched_at: new Date().toISOString(),
      });
    }
    // Filter FIRST, then sort (L34.2/L34.3 ordering), then slice — the same
    // pipeline `/api/reviews` runs so the preview reflects the exact slice the
    // download will produce.
    reviews = sortReviews(filterReviews(sampled, filter), order).slice(
      0,
      PREVIEW_COUNT,
    );
  } catch (err) {
    if (err instanceof SemanticForceError) {
      const ux = semanticForceErrorToUx(err);
      return (
        <ErrorCard title={ux.title} detail={ux.detail} retryHint={ux.retryHint} />
      );
    }
    throw err;
  }

  // Summarise the FULL (unprojected) sample so the digest stays faithful even
  // when columns are dropped — the same call L35.2 makes over the trimmed-not-
  // projected payload. Projection narrows only the displayed review rows so the
  // preview reflects the chosen columns (a deselected field disappears from each
  // card); `fields === null` (nothing checked) is the identity → full rows.
  const summary = summariseReviews({ place, reviews });
  const projected = projectReviews(reviews, fields);

  return (
    <Shell>
      <PlaceHeader place={place} />
      <SummaryCard summary={summary} />
      <DownloadCta
        placeIdInput={rawInput}
        preferred={preferred}
        filterQuery={filterQuery}
      />
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          {hasActiveFilter(filter)
            ? `${reviews.length} matching of the previewed sample`
            : `First ${Math.min(PREVIEW_COUNT, reviews.length)} of ${place.rating_count.toLocaleString("en-US")} reviews`}
        </h2>
        {reviews.length === 0 && hasActiveFilter(filter) ? (
          <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            No reviews in the previewed sample match this filter. The full
            download still applies it across every review, so it may return
            matches the small preview sample missed.
          </p>
        ) : (
          <ul className="flex flex-col">
            {projected.map((r, i) => (
              <ReviewRow key={r.review_id ?? i} review={r} />
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
