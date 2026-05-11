"use client";

import { useMemo, useState } from "react";
import type { PlaceMeta, Review } from "@/lib/semanticforce/types";

const FORMATS = [
  { value: "json", label: "JSON", hint: "available today" },
  { value: "csv", label: "CSV", hint: "ships in L2.6" },
  { value: "xlsx", label: "XLSX", hint: "ships in L2.7" },
] as const;

type Format = (typeof FORMATS)[number]["value"];

type ReviewsBody = {
  place: PlaceMeta;
  reviews: Review[];
  fetched_at: string;
  truncated?: true;
};

type ErrorBody = { error: { code: string; message: string } };
type PartialBody = ErrorBody & { partial: Review[]; retry_after_s?: number };

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: ReviewsBody }
  | { status: "partial"; data: ReviewsBody; message: string; retryAfterS?: number }
  | { status: "error"; code: string; message: string };

const PREVIEW_LIMIT = 5;

export default function HomePage() {
  const [placeId, setPlaceId] = useState("");
  const [format, setFormat] = useState<Format>("json");
  const [state, setState] = useState<FetchState>({ status: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = placeId.trim();
    if (!trimmed) return;
    setState({ status: "loading" });

    const url = `/api/reviews?placeId=${encodeURIComponent(trimmed)}&format=json`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (err) {
      setState({
        status: "error",
        code: "network_error",
        message: (err as Error).message || "Network request failed.",
      });
      return;
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      setState({
        status: "error",
        code: "bad_response",
        message: `Server returned non-JSON (${res.status}).`,
      });
      return;
    }

    if (res.status === 429 && isPartial(payload)) {
      const place: PlaceMeta = {
        place_id: "",
        name: "(partial — rate-limited mid-walk)",
        rating_avg: 0,
        rating_count: payload.partial.length,
      };
      setState({
        status: "partial",
        data: {
          place,
          reviews: payload.partial,
          fetched_at: new Date().toISOString(),
        },
        message: payload.error.message,
        retryAfterS: payload.retry_after_s,
      });
      return;
    }

    if (!res.ok) {
      const err = isError(payload)
        ? payload.error
        : { code: `http_${res.status}`, message: `Request failed (${res.status}).` };
      setState({ status: "error", code: err.code, message: err.message });
      return;
    }

    if (!isReviews(payload)) {
      setState({
        status: "error",
        code: "bad_response",
        message: "Server returned an unexpected payload shape.",
      });
      return;
    }
    setState({ status: "success", data: payload });
  }

  function onDownload() {
    if (state.status !== "success" && state.status !== "partial") return;
    if (format === "json") {
      const blob = new Blob([JSON.stringify(state.data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      triggerDownload(blob, filenameFor(state.data.place, "json"));
      return;
    }
    // CSV/XLSX writers ship in L2.6 / L2.7; the API returns 501 today. Surface
    // that here instead of opening a broken download.
    setState((prev) =>
      prev.status === "success" || prev.status === "partial"
        ? {
            status: "error",
            code: "not_implemented",
            message: `${format.toUpperCase()} export ships in ${
              format === "csv" ? "L2.6" : "L2.7"
            }. Pick JSON to download today.`,
          }
        : prev,
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          google-reviews-download
        </h1>
        <p className="text-base text-muted-foreground">
          Paste a Google Maps place URL or a raw Place ID and download every
          review as CSV, JSON, or XLSX.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="flex w-full flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <label className="flex flex-col gap-2 text-sm" htmlFor="placeId">
          <span className="font-medium">Place URL or Place ID</span>
          <input
            id="placeId"
            type="text"
            name="placeId"
            required
            autoComplete="off"
            spellCheck={false}
            value={placeId}
            onChange={(e) => setPlaceId(e.target.value)}
            placeholder="https://maps.google.com/...   or   ChIJ..."
            className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            Accepts a Google Maps place URL, a <code>place_id</code> (
            <code>ChIJ…</code>), or a numeric CID. Normalisation rules: see{" "}
            <code>docs/methodology.md</code> §1.
          </span>
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">Export format</legend>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2"
              >
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                />
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">
                  ({f.hint})
                </span>
              </label>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Preview always loads as JSON; the download button uses the selected
            format. CSV/XLSX downloads ship in L2.6 / L2.7.
          </span>
        </fieldset>

        <button
          type="submit"
          disabled={state.status === "loading"}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.status === "loading" ? "Fetching reviews…" : "Fetch preview"}
        </button>
      </form>

      <ResultPanel state={state} format={format} onDownload={onDownload} />
    </main>
  );
}

function ResultPanel({
  state,
  format,
  onDownload,
}: {
  state: FetchState;
  format: Format;
  onDownload: () => void;
}) {
  if (state.status === "idle") {
    return (
      <p className="text-xs text-muted-foreground">
        Submit a place to load a preview of the first {PREVIEW_LIMIT} reviews.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Walking SemanticForce pages…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <p className="font-medium">Error ({state.code})</p>
        <p className="mt-1 text-destructive/90">{state.message}</p>
      </div>
    );
  }

  const partialNote =
    state.status === "partial"
      ? `Partial result — upstream rate-limited mid-walk${
          state.retryAfterS ? `; retry in ~${state.retryAfterS}s.` : "."
        } ${state.message}`
      : null;

  return (
    <ResultPreview
      data={state.data}
      partialNote={partialNote}
      format={format}
      onDownload={onDownload}
    />
  );
}

function ResultPreview({
  data,
  partialNote,
  format,
  onDownload,
}: {
  data: ReviewsBody;
  partialNote: string | null;
  format: Format;
  onDownload: () => void;
}) {
  const preview = useMemo(
    () => data.reviews.slice(0, PREVIEW_LIMIT),
    [data.reviews],
  );
  const total = data.reviews.length;
  const downloadDisabled = format !== "json";

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{data.place.name || "(unknown)"}</h2>
        {data.place.address && (
          <p className="text-sm text-muted-foreground">{data.place.address}</p>
        )}
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {data.place.rating_avg ? data.place.rating_avg.toFixed(1) : "–"} ★
          </span>{" "}
          · {total} review{total === 1 ? "" : "s"} fetched
          {data.place.rating_count > total &&
            ` of ${data.place.rating_count} reported`}
          {data.truncated && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              truncated
            </span>
          )}
        </p>
        {partialNote && (
          <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
            {partialNote}
          </p>
        )}
      </header>

      <ol className="flex flex-col gap-3">
        {preview.map((r) => (
          <ReviewRow key={r.review_id} review={r} />
        ))}
        {total === 0 && (
          <li className="text-sm text-muted-foreground">No reviews returned.</li>
        )}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onDownload}
          disabled={total === 0 || downloadDisabled}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          Download all {total} review{total === 1 ? "" : "s"} as{" "}
          {format.toUpperCase()}
        </button>
        {downloadDisabled && (
          <p className="text-xs text-muted-foreground">
            {format.toUpperCase()} writer ships in{" "}
            {format === "csv" ? "L2.6" : "L2.7"}. Switch to JSON to download
            today.
          </p>
        )}
      </div>
    </section>
  );
}

function ReviewRow({ review }: { review: Review }) {
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{review.author_name}</span>
          <span aria-label={`${review.rating} of 5 stars`}>
            {"★".repeat(review.rating)}
            <span className="text-muted-foreground">
              {"★".repeat(5 - review.rating)}
            </span>
          </span>
          {review.language && review.language !== "en" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {review.language}
            </span>
          )}
        </div>
        <time
          dateTime={review.published_at}
          className="text-xs text-muted-foreground"
        >
          {formatDate(review.published_at)}
        </time>
      </div>
      {review.text && (
        <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">
          {truncate(review.text, 280)}
        </p>
      )}
    </li>
  );
}

function isReviews(x: unknown): x is ReviewsBody {
  return (
    typeof x === "object" &&
    x !== null &&
    "place" in x &&
    "reviews" in x &&
    Array.isArray((x as ReviewsBody).reviews)
  );
}

function isError(x: unknown): x is ErrorBody {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as ErrorBody).error?.code === "string"
  );
}

function isPartial(x: unknown): x is PartialBody {
  return (
    isError(x) &&
    "partial" in x &&
    Array.isArray((x as PartialBody).partial)
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function filenameFor(place: PlaceMeta, ext: string): string {
  const base = (place.name || place.place_id || "reviews")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "reviews";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}-${stamp}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
