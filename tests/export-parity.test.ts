// L30.4 — cross-exporter parity (ADR-003).
//
// The CSV and XLSX writers share one column schema by construction
// (`XLSX_COLUMNS = CSV_COLUMNS`, pinned referentially in export-xlsx.test.ts).
// That guards the *constants*. This suite guards the *emitted output*: it
// drives the same `Review[]` through both real writers and asserts the two
// produced files carry the same columns in the same order AND the same
// per-cell content. The constants pin can't catch a drift in how a writer
// *uses* the schema — e.g. a CSV emit path that dropped a column, an XLSX
// `header:` argument that reordered one, or a divergent blank-fill / photo
// join on one side only. Those pass each single-module suite and only fail
// when the two outputs are compared head-to-head. This is a genuine
// cross-module contract, not single-module padding (the banned rut, D-084).

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { formatReviewsAsCsv, CSV_COLUMNS, __testing } from "@/lib/export/csv";
import { formatReviewsAsXlsx } from "@/lib/export/xlsx";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";

const { BOM } = __testing;

// Same fixture shape used by export-csv.test.ts / export-xlsx.test.ts, plus a
// third review that exercises the blank-fill columns (no author_url, language,
// photos, or owner_response) so the parity check covers a row whose trailing
// cells are empty on both sides.
function payload(): CachedReviewsPayload {
  return {
    place: {
      place_id: "ChIJTest",
      name: 'Café "Niño" — Łódź',
      rating_avg: 4.5,
      rating_count: 3,
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
      {
        review_id: "r3",
        author_name: "Solo",
        rating: 4,
        text: "single, photo",
        published_at: "2026-05-04T00:00:00.000Z",
        photos: [{ url: "https://p/only.jpg" }],
      },
    ],
  };
}

// Minimal RFC4180 parser sufficient for our QUOTE_ALL output: every field is
// double-quoted, internal `"` doubled, embedded commas/newlines live inside
// quotes. Row separator is the bare LF of the CRLF terminator (CR is dropped
// outside quotes). Returns rows of raw string fields; the trailing CRLF does
// not produce an empty final row.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r") {
      i += 1; // CR of CRLF — ignored outside quotes
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Read the XLSX bytes back into a grid of string-coerced cells. SheetJS round-
// trips header text and cell values faithfully (only `!cols`/freeze are lossy,
// L28.3) so this is a true read of what the file carries. `header: 1` returns
// each row as a positional array; blanks come back as undefined → "".
function xlsxGrid(payload: CachedReviewsPayload): string[][] {
  const wb = XLSX.read(formatReviewsAsXlsx(payload), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
  });
  return grid.map((r) =>
    Array.from({ length: CSV_COLUMNS.length }, (_, c) =>
      r[c] == null ? "" : String(r[c]),
    ),
  );
}

describe("CSV ⇄ XLSX export parity (same Review[] → same columns + content)", () => {
  const p = payload();
  const csvGrid = parseCsv(formatReviewsAsCsv(p).slice(BOM.length));
  const xlGrid = xlsxGrid(p);

  it("both writers emit the same header row in the same order", () => {
    // Anchor each side to the schema first so a single-side drift names the
    // culprit, then compare the two emitted headers directly.
    expect(csvGrid[0]).toEqual([...CSV_COLUMNS]);
    expect(xlGrid[0]).toEqual([...CSV_COLUMNS]);
    expect(csvGrid[0]).toEqual(xlGrid[0]);
  });

  it("both writers emit the same number of rows (header + one per review)", () => {
    expect(csvGrid).toHaveLength(p.reviews.length + 1);
    expect(xlGrid).toHaveLength(p.reviews.length + 1);
  });

  it("every cell matches across formats (XLSX typed cells string-coerced)", () => {
    // The load-bearing assertion: a divergent blank-fill, a different photo
    // join, or a numeric-vs-text formatting split on one writer surfaces here
    // even though each single-module suite still passes. XLSX rating/photo_count
    // are numeric cells; CSV stringifies them — String() normalises both to the
    // same comparison so a genuine *content* drift (not a typing artefact) fails.
    expect(csvGrid).toEqual(xlGrid);
  });

  it("the empty-reviews case is header-only and identical on both sides", () => {
    const empty = payload();
    empty.reviews = [];
    const csv = parseCsv(formatReviewsAsCsv(empty).slice(BOM.length));
    const xl = xlsxGrid(empty);
    expect(csv).toEqual([[...CSV_COLUMNS]]);
    expect(xl).toEqual([[...CSV_COLUMNS]]);
    expect(csv).toEqual(xl);
  });
});
