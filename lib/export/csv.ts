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

const BOM = "﻿";
const CRLF = "\r\n";
const PHOTO_URL_JOIN = " | ";

export function formatReviewsAsCsv(payload: CachedReviewsPayload): string {
  const lines: string[] = [];
  lines.push(CSV_COLUMNS.map(quote).join(","));
  for (const review of payload.reviews) {
    lines.push(rowFor(review, payload).map(quote).join(","));
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
};
