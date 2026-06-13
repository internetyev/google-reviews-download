// Coverage for lib/export/batch.ts (Phase 31, L31.1) — multi-place batch export.
// The batch writers must concatenate several places' reviews into ONE file with
// a single header, keep each place distinguishable via the per-row place
// columns, and never drift from the single-place column contract.

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

import {
  formatBatchAsCsv,
  formatBatchAsXlsx,
  batchFilename,
  batchReviewCount,
} from "@/lib/export/batch";
import { CSV_COLUMNS } from "@/lib/export/csv";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";

function placePayload(
  placeId: string,
  name: string,
  reviewIds: string[],
): CachedReviewsPayload {
  return {
    place: { place_id: placeId, name, rating_avg: 4.2, rating_count: 99 },
    fetched_at: "2026-06-14T08:00:00.000Z",
    reviews: reviewIds.map((id, i) => ({
      review_id: id,
      author_name: `Author ${id}`,
      rating: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      text: `Review ${id} for ${name}`,
      published_at: "2026-06-01T00:00:00.000Z",
    })),
  };
}

function batch(): CachedReviewsPayload[] {
  return [
    placePayload("ChIJplaceA", "Alpha Cafe", ["a1", "a2", "a3"]),
    placePayload("ChIJplaceB", "Beta Diner", ["b1", "b2"]),
  ];
}

// CRLF-split helper that drops the BOM and the trailing empty line.
function csvDataLines(out: string): string[] {
  return out.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
}

describe("formatBatchAsCsv — single header, all rows", () => {
  it("emits one header plus the sum of all places' reviews", () => {
    const lines = csvDataLines(formatBatchAsCsv(batch()));
    // 1 header + (3 + 2) data rows
    expect(lines.length).toBe(1 + 5);
    expect(lines[0]).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(","));
  });

  it("keeps each place distinguishable via the place_id column", () => {
    const out = formatBatchAsCsv(batch());
    expect(out).toContain('"ChIJplaceA"');
    expect(out).toContain('"ChIJplaceB"');
    // place_id is the 2nd column; both places' reviews carry their own id
    const aRows = csvDataLines(out).filter((l) => l.includes('"ChIJplaceA"'));
    const bRows = csvDataLines(out).filter((l) => l.includes('"ChIJplaceB"'));
    expect(aRows.length).toBe(3);
    expect(bRows.length).toBe(2);
  });

  it("preserves the Excel contract (BOM + CRLF) on the combined file", () => {
    const out = formatBatchAsCsv(batch());
    expect(out.startsWith("﻿")).toBe(true);
    expect(out.endsWith("\r\n")).toBe(true);
  });

  it("emits a header-only file for an empty batch", () => {
    const lines = csvDataLines(formatBatchAsCsv([]));
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(","));
  });
});

describe("formatBatchAsXlsx — combined sheet", () => {
  it("round-trips to one sheet with header + all reviews across places", () => {
    const bytes = formatBatchAsXlsx(batch());
    const wb = XLSX.read(bytes, { type: "array" });
    expect(wb.SheetNames).toEqual(["Reviews"]);
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Reviews"], {
      header: 1,
    });
    expect(grid[0]).toEqual([...CSV_COLUMNS]);
    // header + 5 review rows
    expect(grid.length).toBe(1 + 5);
    const flat = JSON.stringify(grid);
    expect(flat).toContain("ChIJplaceA");
    expect(flat).toContain("ChIJplaceB");
  });

  it("returns a fresh Uint8Array per call", () => {
    const b = batch();
    expect(formatBatchAsXlsx(b)).not.toBe(formatBatchAsXlsx(b));
  });
});

describe("batch helpers", () => {
  it("batchReviewCount sums reviews across all places", () => {
    expect(batchReviewCount(batch())).toBe(5);
    expect(batchReviewCount([])).toBe(0);
  });

  it("batchFilename uses a batch-<count>-places stem with the data-vintage date", () => {
    expect(batchFilename(2, "2026-06-14T08:00:00.000Z", "csv")).toBe(
      "google-reviews-batch-2-places-20260614.csv",
    );
    expect(batchFilename(2, "2026-06-14T08:00:00.000Z", "xlsx")).toBe(
      "google-reviews-batch-2-places-20260614.xlsx",
    );
  });
});
