// Regression guard for lib/export/xlsx.ts (ADR-003).
// XLSX mirrors the CSV column schema but adds spreadsheet-only contract:
// a single "Reviews" sheet, one data row per review under a frozen header
// (`ySplit: 1`), and the hand-tuned per-column widths. These assertions
// round-trip the produced workbook through SheetJS so a refactor that
// breaks sheet shape, freeze pane, or widths fails loudly.

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  formatReviewsAsXlsx,
  xlsxFilename,
  XLSX_COLUMNS,
  __testing,
} from "@/lib/export/xlsx";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";

const { COLUMN_WIDTHS, PHOTO_URL_JOIN, SHEET_NAME } = __testing;

function payload(): CachedReviewsPayload {
  return {
    place: {
      place_id: "ChIJTest",
      name: 'Café "Niño" — Łódź',
      rating_avg: 4.5,
      rating_count: 2,
      url: "https://maps.example/x",
    },
    fetched_at: "2026-05-16T08:30:00.000Z",
    reviews: [
      {
        review_id: "r1",
        author_name: "Anaïs 🌟",
        author_url: "https://u/anais",
        rating: 5,
        text: 'Loved it.\nGreat "service"!',
        language: "en",
        published_at: "2026-05-01T00:00:00.000Z",
        photos: [{ url: "https://p/1.jpg" }, { url: "https://p/2.jpg" }],
        owner_response: {
          text: "Thank you!",
          responded_at: "2026-05-02T00:00:00.000Z",
        },
      },
      {
        review_id: "r2",
        author_name: "Bob",
        rating: 3,
        text: "ok",
        published_at: "2026-05-03T00:00:00.000Z",
      },
    ],
  };
}

function roundTrip(p: CachedReviewsPayload) {
  const bytes = formatReviewsAsXlsx(p);
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes.byteLength).toBeGreaterThan(0);
  const wb = XLSX.read(bytes, { type: "array" });
  return wb;
}

describe("formatReviewsAsXlsx — workbook shape", () => {
  const wb = roundTrip(payload());

  it("has exactly one sheet named Reviews", () => {
    expect(wb.SheetNames).toEqual([SHEET_NAME]);
  });

  it("emits one data row per review under the header (no extra/blank rows)", () => {
    const ws = wb.Sheets[SHEET_NAME];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    expect(rows).toHaveLength(2);
    // Header keys round-trip in the documented column order.
    expect(Object.keys(rows[0])).toEqual([...XLSX_COLUMNS]);
  });

  it("ref spans 14 columns × header + 2 rows", () => {
    const ws = wb.Sheets[SHEET_NAME];
    const ref = XLSX.utils.decode_range(ws["!ref"] as string);
    expect(ref.e.c - ref.s.c + 1).toBe(XLSX_COLUMNS.length);
    expect(ref.e.r - ref.s.r + 1).toBe(3); // header + r1 + r2
  });

  it("carries the place + review fields into the right cells", () => {
    const ws = wb.Sheets[SHEET_NAME];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    expect(rows[0].place_name).toBe('Café "Niño" — Łódź');
    expect(rows[0].rating).toBe(5);
    expect(rows[0].photo_count).toBe(2);
    expect(rows[0].photo_urls).toBe(
      `https://p/1.jpg${PHOTO_URL_JOIN}https://p/2.jpg`,
    );
    // r2 has no photos / language / owner response → blank, not undefined.
    expect(rows[1].photo_count).toBe(0);
    expect(rows[1].owner_response_text).toBe("");
  });
});

describe("formatReviewsAsXlsx — frozen header + column widths", () => {
  const wb = roundTrip(payload());
  const ws = wb.Sheets[SHEET_NAME];

  it("freezes the header row at ySplit 1", () => {
    // SheetJS 0.18.x round-trips pane state into one of these props; the
    // source sets both for writer-path robustness, so assert on whichever
    // the reader populated.
    const freeze = (ws as Record<string, unknown>)["!freeze"] as
      | { ySplit?: number }
      | undefined;
    const views = (ws as Record<string, unknown>)["!views"] as
      | Array<{ ySplit?: number; state?: string }>
      | undefined;
    const frozen =
      freeze?.ySplit === 1 ||
      (views?.some((v) => v.ySplit === 1) ?? false);
    expect(frozen).toBe(true);
  });

  it("applies the hand-tuned per-column widths", () => {
    const cols = ws["!cols"] as Array<{ wch?: number }> | undefined;
    expect(cols).toBeDefined();
    expect(cols).toHaveLength(XLSX_COLUMNS.length);
    XLSX_COLUMNS.forEach((col, i) => {
      expect(cols![i].wch).toBe(COLUMN_WIDTHS[col]);
    });
  });
});

describe("__testing.rowFor", () => {
  it("joins photo URLs and blanks missing optional fields", () => {
    const p = payload();
    const row = __testing.rowFor(p.reviews[1], p);
    expect(row.photo_count).toBe(0);
    expect(row.photo_urls).toBe("");
    expect(row.author_url).toBe("");
    expect(row.language).toBe("");
    expect(row.owner_response_text).toBe("");
    expect(row.owner_response_at).toBe("");
  });
});

describe("xlsxFilename", () => {
  it("uses the data vintage date, not wall clock, as YYYYMMDD", () => {
    expect(xlsxFilename("mock-small-001", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-mock-small-001-20260516.xlsx",
    );
  });
});
