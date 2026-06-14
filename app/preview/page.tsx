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
}: {
  placeIdInput: string;
  preferred: Format;
}) {
  const href = (fmt: Format) =>
    `/api/reviews?placeId=${encodeURIComponent(placeIdInput)}&format=${fmt}`;
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

function ReviewRow({ review }: { review: Review }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{review.author_name}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(review.published_at)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span aria-label={`${review.rating} out of 5 stars`} className="text-amber-500">
          {stars(review.rating)}
        </span>
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
  searchParams: Promise<{ placeId?: string; format?: string; places?: string }>;
}) {
  const {
    placeId: rawInput,
    format: formatRaw,
    places: rawPlaces,
  } = await searchParams;
  const preferred: Format = isFormat(formatRaw) ? formatRaw : "csv";

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
    if (prior) {
      place = prior.place;
      reviews = prior.reviews.slice(0, PREVIEW_COUNT);
    } else {
      const client = createReviewsProvider();
      const res = await client.getReviews({
        placeId: normalised.raw,
        limit: PREVIEW_COUNT,
      });
      place = res.place;
      reviews = res.reviews.slice(0, PREVIEW_COUNT);
      // Best-effort: never write the full-walk key from a partial preview.
      await previewCache.set(slug, {
        place,
        reviews,
        fetched_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    if (err instanceof SemanticForceError) {
      const ux = semanticForceErrorToUx(err);
      return (
        <ErrorCard title={ux.title} detail={ux.detail} retryHint={ux.retryHint} />
      );
    }
    throw err;
  }

  return (
    <Shell>
      <PlaceHeader place={place} />
      <DownloadCta placeIdInput={rawInput} preferred={preferred} />
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          First {Math.min(PREVIEW_COUNT, reviews.length)} of{" "}
          {place.rating_count.toLocaleString("en-US")} reviews
        </h2>
        <ul className="flex flex-col">
          {reviews.map((r) => (
            <ReviewRow key={r.review_id} review={r} />
          ))}
        </ul>
      </section>
    </Shell>
  );
}
