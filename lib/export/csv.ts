// CSV writer for the reviews export, per ADR-003.
//
// Defaults (Excel-on-Windows friendly):
//   - UTF-8 with BOM
//   - CRLF line endings
//   - QUOTE_ALL: every field is wrapped in double quotes, internal `"` doubled
//
// Row schema is one row per review, flat-denormalised so the same CSV opens
// in Excel without an import wizard. Place metadata is repeated on every row
// so users who concat multiple exports can group by `place_id` later.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review } from "@/lib/semanticforce/types";
import type { ReviewField } from "@/lib/reviews/project";

export const CSV_COLUMNS = [
  "place_name",
  "place_id",
  "place_url",
  "review_id",
  "author_name",
  "author_url",
  "rating",
  "text",
  "language",
  "published_at",
  "photo_count",
  "photo_urls",
  "owner_response_text",
  "owner_response_at",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

// Which flat CSV column(s) each logical `Review` field maps to (L35.2). Most
// fields are 1:1 with a column; the two denormalised fields fan out — `photos`
// → `photo_count` + `photo_urls`, `owner_response` → `owner_response_text` +
// `owner_response_at` — so asking for `photos` carries the whole photo view.
// The three `place_*` context columns intentionally have NO `ReviewField`: they
// are place metadata, not review fields, so a column selection (which names
// review fields) drops them — the single-place file's vintage lives in the
// filename, and the place is the whole point of a single-place download.
const REVIEW_FIELD_TO_CSV: Record<ReviewField, readonly CsvColumn[]> = {
  review_id: ["review_id"],
  author_name: ["author_name"],
  author_url: ["author_url"],
  rating: ["rating"],
  text: ["text"],
  language: ["language"],
  published_at: ["published_at"],
  photos: ["photo_count", "photo_urls"],
  owner_response: ["owner_response_text", "owner_response_at"],
};

// Narrow the full CSV column list to the requested review fields (L35.2),
// preserving each field's first-requested order and de-duplicating the fanned-
// out columns. A `null`/empty selection (the parsed-fields identity) returns the
// whole 14-column schema, so an absent/blank/all-unrecognised `fields` param is
// a no-op — never an empty file.
export function selectCsvColumns(
  fields: ReviewField[] | null,
): readonly CsvColumn[] {
  if (!fields || fields.length === 0) return CSV_COLUMNS;
  const seen = new Set<CsvColumn>();
  const out: CsvColumn[] = [];
  for (const field of fields) {
    for (const col of REVIEW_FIELD_TO_CSV[field] ?? []) {
      if (!seen.has(col)) {
        seen.add(col);
        out.push(col);
      }
    }
  }
  return out.length > 0 ? out : CSV_COLUMNS;
}

const BOM = "﻿";
const CRLF = "\r\n";
const PHOTO_URL_JOIN = " | ";

export function formatReviewsAsCsv(
  payload: CachedReviewsPayload,
  fields: ReviewField[] | null = null,
): string {
  const columns = selectCsvColumns(fields);
  const lines: string[] = [];
  lines.push(columns.map(quote).join(","));
  for (const review of payload.reviews) {
    const byColumn = rowRecord(rowFor(review, payload));
    lines.push(columns.map((c) => quote(byColumn[c])).join(","));
  }
  return BOM + lines.join(CRLF) + CRLF;
}

// Zip the positional `rowFor` array back to a column-keyed record so a column
// subset can be projected without `rowFor` having to know about selection (it
// stays the single source of every column's value).
function rowRecord(row: string[]): Record<CsvColumn, string> {
  const rec = {} as Record<CsvColumn, string>;
  CSV_COLUMNS.forEach((col, i) => {
    rec[col] = row[i];
  });
  return rec;
}

// Multi-place batch export (Phase 31): concatenate the reviews of several
// places into ONE CSV with a single header. The per-row `place_name`/
// `place_id`/`place_url` columns (already emitted by `rowFor`) keep each
// place distinguishable, so a downstream `GROUP BY place_id` recovers the
// per-place split — the exact use case the row schema was designed for
// (see the file header). Reuses `rowFor`/`quote`/`CSV_COLUMNS` so the batch
// output can never drift from the single-place writer's column contract.
export function formatBatchAsCsv(payloads: CachedReviewsPayload[]): string {
  const lines: string[] = [];
  lines.push(CSV_COLUMNS.map(quote).join(","));
  for (const payload of payloads) {
    for (const review of payload.reviews) {
      lines.push(rowFor(review, payload).map(quote).join(","));
    }
  }
  return BOM + lines.join(CRLF) + CRLF;
}

function rowFor(review: Review, payload: CachedReviewsPayload): string[] {
  const photos = review.photos ?? [];
  return [
    payload.place.name,
    payload.place.place_id,
    payload.place.url ?? "",
    review.review_id,
    review.author_name,
    review.author_url ?? "",
    String(review.rating),
    review.text,
    review.language ?? "",
    review.published_at,
    String(photos.length),
    photos.map((p) => p.url).join(PHOTO_URL_JOIN),
    review.owner_response?.text ?? "",
    review.owner_response?.responded_at ?? "",
  ];
}

// QUOTE_ALL: every field is double-quoted, internal `"` is escaped as `""`.
// Embedded newlines inside `text` survive intact — CSV permits CR/LF within
// a quoted field and Excel renders it as a wrapped cell.
function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Filename convention from ADR-003: `google-reviews-<slug>-<YYYYMMDD>.csv`.
// `dateIso` is the payload's `fetched_at` so the filename matches the data
// vintage, not the wall clock at download time (which can differ on a cache
// hit served hours later).
export function csvFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.csv`;
}

export const __testing = {
  BOM,
  CRLF,
  PHOTO_URL_JOIN,
  quote,
  rowFor,
  rowRecord,
  REVIEW_FIELD_TO_CSV,
};
