// XLSX writer for the reviews export, per ADR-003.
//
// One worksheet ("Reviews"), one row per review, header row first with the
// pane frozen at row 1 (`ySplit: 1`), per-column widths tuned by hand from
// the fixture data. Column schema mirrors `lib/export/csv.ts` exactly so a
// user who switches between formats sees the same columns in the same
// order. Unicode is native to XLSX so no BOM/encoding gymnastics.
//
// SheetJS `xlsx` is pinned to ^0.18.5 (D-009). `XLSX.write({type: "array"})`
// returns a `Uint8Array` / `ArrayBuffer` which is edge-safe (no Node Buffer
// escapes), so the route on the edge runtime can hand it straight to
// `NextResponse`.

import * as XLSX from "xlsx";

import { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { Review } from "@/lib/semanticforce/types";
import { CSV_COLUMNS, CsvColumn, selectCsvColumns } from "./csv";
import type { ReviewField } from "@/lib/reviews/project";

export const XLSX_COLUMNS = CSV_COLUMNS;
export type XlsxColumn = CsvColumn;

const SHEET_NAME = "Reviews";
const PHOTO_URL_JOIN = " | ";

// Column widths in `wch` units (≈ characters). Tuned by hand from the
// fixture data (`mocks/semanticforce/{small,mid,large}.json`): wide enough
// that the common case reads without horizontal scroll, narrow enough that
// the full 14-column sheet still fits on a 1080p screen at default zoom.
const COLUMN_WIDTHS: Record<XlsxColumn, number> = {
  place_name: 28,
  place_id: 32,
  place_url: 32,
  review_id: 22,
  author_name: 22,
  author_url: 32,
  rating: 8,
  text: 64,
  language: 10,
  published_at: 22,
  photo_count: 12,
  photo_urls: 48,
  owner_response_text: 48,
  owner_response_at: 22,
};

type Row = {
  place_name: string;
  place_id: string;
  place_url: string;
  review_id: string;
  author_name: string;
  author_url: string;
  rating: number;
  text: string;
  language: string;
  published_at: string;
  photo_count: number;
  photo_urls: string;
  owner_response_text: string;
  owner_response_at: string;
};

// SheetJS' published types stop at `!cols`/`!rows`/`!merges`/`!ref`; the
// `!views` (canonical OOXML SheetView) and `!freeze` (legacy convenience)
// props we set for the frozen header are real but not in the .d.ts.
type SheetWithFreeze = XLSX.WorkSheet & {
  "!views"?: Array<{
    state: "frozen" | "split" | "normal";
    xSplit?: number;
    ySplit?: number;
    topLeftCell?: string;
    activePane?: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  }>;
  "!freeze"?: { xSplit?: number; ySplit?: number };
};

// Build the worksheet our writer hands to SheetJS: one row per review in the
// fixed column order, hand-tuned column widths (`!cols`), and a frozen header
// row requested via both the canonical SheetView pane (`!views`) and SheetJS'
// legacy convenience prop (`!freeze`). Pure + synchronous, so the writer's
// contract is unit-testable without round-tripping through SheetJS' reader
// (which is lossy — see below).
//
// NOTE (verified L28.3): SheetJS 0.18.5 CE serializes `!cols` (column widths
// DO reach the file) but does NOT serialize a freeze pane from any of these
// props — the `!views`/`!freeze` intent is retained here so a future SheetJS
// upgrade (or Pro build) emits the frozen header with no code change, but the
// shipped 0.18.5 workbook does not actually freeze. Its reader also does not
// repopulate `!cols` on read-back, so file inspection must be at the
// worksheet-construction layer, not via XLSX.read.
function buildReviewsSheet(
  payload: CachedReviewsPayload,
  columns: readonly XlsxColumn[] = XLSX_COLUMNS,
): SheetWithFreeze {
  const rows: Row[] = payload.reviews.map((r) => rowFor(r, payload));

  // `header` selects which keys (and in what order) reach the sheet, so passing
  // a column subset (L35.2) drops the unrequested fields from the workbook —
  // `rowFor` still builds the full record, json_to_sheet just emits the chosen
  // columns. Widths track the same subset so the frozen header stays aligned.
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [...columns],
  }) as SheetWithFreeze;

  ws["!cols"] = columns.map((col) => ({ wch: COLUMN_WIDTHS[col] }));
  ws["!views"] = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: 1,
      topLeftCell: "A2",
      activePane: "bottomLeft",
    },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  return ws;
}

export function formatReviewsAsXlsx(
  payload: CachedReviewsPayload,
  fields: ReviewField[] | null = null,
): Uint8Array {
  return writeWorkbook(buildReviewsSheet(payload, selectCsvColumns(fields)));
}

// Multi-place batch export (Phase 31): one "Reviews" sheet whose rows are the
// reviews of every place concatenated in order, header frozen, same column
// widths. The per-row place columns (from `rowFor`) keep places
// distinguishable — mirrors `formatBatchAsCsv` so CSV and XLSX batch exports
// carry identical rows. Reuses `rowFor`/`XLSX_COLUMNS`/`COLUMN_WIDTHS` so the
// batch sheet can never drift from the single-place writer's contract.
function buildBatchSheet(payloads: CachedReviewsPayload[]): SheetWithFreeze {
  const rows: Row[] = payloads.flatMap((payload) =>
    payload.reviews.map((r) => rowFor(r, payload)),
  );

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [...XLSX_COLUMNS],
  }) as SheetWithFreeze;

  ws["!cols"] = XLSX_COLUMNS.map((col) => ({ wch: COLUMN_WIDTHS[col] }));
  ws["!views"] = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: 1,
      topLeftCell: "A2",
      activePane: "bottomLeft",
    },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  return ws;
}

export function formatBatchAsXlsx(payloads: CachedReviewsPayload[]): Uint8Array {
  return writeWorkbook(buildBatchSheet(payloads));
}

// Shared workbook serialisation so the single-place and batch writers emit
// byte-identical wrapping (one "Reviews" sheet, edge-safe Uint8Array).
function writeWorkbook(ws: SheetWithFreeze): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  const out = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }) as ArrayBuffer | Uint8Array;

  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

function rowFor(review: Review, payload: CachedReviewsPayload): Row {
  const photos = review.photos ?? [];
  return {
    place_name: payload.place.name,
    place_id: payload.place.place_id,
    place_url: payload.place.url ?? "",
    review_id: review.review_id,
    author_name: review.author_name,
    author_url: review.author_url ?? "",
    rating: review.rating,
    text: review.text,
    language: review.language ?? "",
    published_at: review.published_at,
    photo_count: photos.length,
    photo_urls: photos.map((p) => p.url).join(PHOTO_URL_JOIN),
    owner_response_text: review.owner_response?.text ?? "",
    owner_response_at: review.owner_response?.responded_at ?? "",
  };
}

// Filename convention from ADR-003: `google-reviews-<slug>-<YYYYMMDD>.xlsx`.
// Mirrors `csvFilename` exactly (only the extension differs) so a user who
// downloads CSV then XLSX gets two files with matching prefixes — easy to
// spot in the same Downloads folder.
export function xlsxFilename(slug: string, dateIso: string): string {
  const ymd = dateIso.slice(0, 10).replace(/-/g, "");
  return `google-reviews-${slug}-${ymd}.xlsx`;
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const __testing = {
  COLUMN_WIDTHS,
  PHOTO_URL_JOIN,
  SHEET_NAME,
  buildBatchSheet,
  buildReviewsSheet,
  rowFor,
};
