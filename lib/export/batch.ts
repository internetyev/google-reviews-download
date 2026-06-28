// Multi-place batch export (Phase 31, L31.1).
//
// The single entry point for downloading the reviews of several places as ONE
// file. The actual row/format logic lives in `lib/export/csv.ts` and
// `lib/export/xlsx.ts` (single source of truth for the column contract); this
// module re-exports the batch writers and adds the batch filename convention so
// a future API/UI leaf imports everything batch-related from one place.
//
// Each `CachedReviewsPayload` is one place's result (place meta + its reviews).
// The combined file carries the per-row `place_id`/`place_name`/`place_url`
// columns, so the per-place split is recoverable downstream (see the csv.ts
// header). This is purely additive: no existing single-place path changes.

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";

import { formatBatchAsCsv } from "./csv";
import { formatBatchAsXlsx } from "./xlsx";
import { formatBatchAsMarkdown } from "./markdown";
import { formatBatchAsHtml } from "./html";
import { formatBatchAsText } from "./text";
import { formatBatchAsJsonLd } from "./jsonld";
import { formatBatchAsRss } from "./rss";

export {
  formatBatchAsCsv,
  formatBatchAsXlsx,
  formatBatchAsMarkdown,
  formatBatchAsHtml,
  formatBatchAsText,
  formatBatchAsJsonLd,
  formatBatchAsRss,
};

export type BatchExportFormat =
  | "csv"
  | "xlsx"
  | "md"
  | "html"
  | "txt"
  | "jsonld"
  | "rss";

// Total reviews across every place in the batch — what a caller shows as the
// "N reviews from M places" summary without re-walking the payloads.
export function batchReviewCount(payloads: CachedReviewsPayload[]): number {
  return payloads.reduce((sum, p) => sum + p.reviews.length, 0);
}

// Filename convention for a batch download. Mirrors the single-place
// `google-reviews-<slug>-<YYYYMMDD>.<ext>` shape (ADR-003) but uses a
// `batch-<count>-places` stem instead of a single slug, so a user can tell a
// combined export apart from a single-place one at a glance in the Downloads
// folder. `dateIso` is the freshest payload's `fetched_at` (data vintage, not
// wall clock) — callers pass `max(fetched_at)` across the batch.
export function batchFilename(
  placeCount: number,
  dateIso: string,
  ext: BatchExportFormat,
): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-batch-${placeCount}-places-${ymd}.${ext}`;
}
