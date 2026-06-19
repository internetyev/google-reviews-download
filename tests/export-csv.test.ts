// Regression guard for lib/export/csv.ts (ADR-003).
// The Excel-on-Windows defaults — UTF-8 BOM, CRLF, QUOTE_ALL — are the whole
// reason this writer exists (project memory `feedback_csv_ascii_for_excel`).
// These tests pin that contract so a refactor can't silently regress it.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsCsv,
  selectCsvColumns,
  csvFilename,
  CSV_COLUMNS,
  __testing,
} from "@/lib/export/csv";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";

const { BOM, CRLF, PHOTO_URL_JOIN } = __testing;

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

describe("formatReviewsAsCsv — Excel contract", () => {
  const out = formatReviewsAsCsv(payload());

  it("starts with a UTF-8 BOM and ends with CRLF", () => {
    expect(out.startsWith(BOM)).toBe(true);
    expect(out.endsWith(CRLF)).toBe(true);
  });

  it("emits a header plus one row per review (CRLF-separated)", () => {
    const rows = out.slice(BOM.length).split(CRLF);
    // header, r1, r2, then trailing "" from the final CRLF terminator.
    expect(rows).toHaveLength(4);
    expect(rows[3]).toBe("");
    expect(rows[0]).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(","));
  });

  it("QUOTE_ALL: every field double-quoted, internal quotes doubled", () => {
    const r1 = out.slice(BOM.length).split(CRLF)[1];
    expect(r1.startsWith('"')).toBe(true);
    // text field keeps its embedded newline and escapes the inner quotes.
    expect(r1).toContain('"Loved it.\nGreat ""service""!"');
  });

  it("joins photo URLs and reports photo_count; blanks optional fields", () => {
    const [, , r2] = out.slice(BOM.length).split(CRLF);
    // r2 has no photos / url / language / owner_response → empty quoted cells.
    expect(r2).toContain('"0"'); // photo_count
    expect(r2).toContain('""'); // an empty optional field
    expect(r2.endsWith('""')).toBe(true); // owner_response_at (last column)
  });

  it("preserves unicode in place name and author", () => {
    expect(out).toContain('Café ""Niño"" — Łódź');
    expect(out).toContain("Anaïs 🌟");
  });
});

describe("__testing.rowFor", () => {
  it("joins multiple photo URLs with the documented separator", () => {
    const p = payload();
    const row = __testing.rowFor(p.reviews[0], p);
    const photoUrlsCol = CSV_COLUMNS.indexOf("photo_urls");
    expect(row[photoUrlsCol]).toBe(
      `https://p/1.jpg${PHOTO_URL_JOIN}https://p/2.jpg`,
    );
  });
});

describe("csvFilename", () => {
  it("uses the data vintage date, not wall clock, as YYYYMMDD", () => {
    expect(csvFilename("mock-small-001", "2026-05-16T08:30:00.000Z")).toBe(
      "google-reviews-mock-small-001-20260516.csv",
    );
  });
});

// L11.6 deepening — three cross-cutting load-bearing concerns the
// existing 7-it/3-describe suite never reached. The CSV writer is the
// project's user-facing data deliverable (the `feedback_csv_ascii_for_excel`
// memory); a silent regression in column order, delimiter escaping, or
// edge-case shape would corrupt every downstream pipeline that reads
// these files in Excel.

// Minimal RFC-4180-style CSV parser for the QUOTE_ALL output. Only the
// shape `"field"(,"field")*\r\n` need be handled; doubled `""` inside a
// quoted field decodes to a single `"`. Suite-local helper, not shipped.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 2;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe("CSV_COLUMNS — schema freeze + per-row arity", () => {
  // Downstream pipelines read the CSV by column position. A refactor that
  // silently swapped `rating` and `language` (or added a column in the
  // middle) would shift every following cell across every existing
  // consumer with no runtime signal. Pin the exact 14-element ordered
  // tuple so any change to the schema is a reviewed change.
  it("freezes the exact 14-column ordered tuple", () => {
    expect([...CSV_COLUMNS]).toEqual([
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
    ]);
    expect(CSV_COLUMNS.length).toBe(14);
  });

  it("header row parses to exactly CSV_COLUMNS in surfaced order", () => {
    const out = formatReviewsAsCsv(payload());
    const rows = parseCsv(out.slice(BOM.length));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
  });

  it("every emitted row carries exactly CSV_COLUMNS.length cells", () => {
    const out = formatReviewsAsCsv(payload());
    const rows = parseCsv(out.slice(BOM.length));
    // header + 2 reviews.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveLength(CSV_COLUMNS.length);
    }
  });
});

describe("Embedded CSV-danger characters survive QUOTE_ALL escaping", () => {
  // The QUOTE_ALL contract's whole point: review text containing any of
  // the four CSV-danger characters (comma, CR, LF, double-quote) must
  // round-trip intact without splitting the row or shifting columns.
  // The existing suite proves LF + `"` survive; it does NOT prove that
  // embedded **comma** (the field delimiter — would split a row under
  // QUOTE_MINIMAL) or embedded **CR** (half of the row delimiter — would
  // mid-row terminate under a naive splitter) survive. Pin both, plus
  // assert alignment via parser round-trip so a refactor to QUOTE_MINIMAL
  // would fail loudly on a structural cell count rather than silently
  // depending on whether the test author happened to put a comma in.
  it("comma + CR + LF + doubled-quote inside text all round-trip intact", () => {
    const p = payload();
    const dangerous = 'comma, here\nLF here\rCR here "quote" here';
    p.reviews = [{ ...p.reviews[0], text: dangerous }];
    const out = formatReviewsAsCsv(p);
    const rows = parseCsv(out.slice(BOM.length));
    // header + 1 review — embedded CR/LF/comma did NOT split into more rows.
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(CSV_COLUMNS.length);
    const textCol = CSV_COLUMNS.indexOf("text");
    expect(rows[1][textCol]).toBe(dangerous);
  });

  it("a comma-only text doesn't shift downstream column values", () => {
    // Catastrophic regression class: QUOTE_MINIMAL keeps the surrounding
    // quotes only on cells that contain a delimiter, so a comma-bearing
    // `text` would otherwise be the one cell that didn't shift, hiding
    // the real failure. Pin downstream cells (rating, published_at) by
    // value so a column shift fails loudly here too.
    const p = payload();
    p.reviews = [{ ...p.reviews[0], text: "a, b, c" }];
    const out = formatReviewsAsCsv(p);
    const rows = parseCsv(out.slice(BOM.length));
    const ratingCol = CSV_COLUMNS.indexOf("rating");
    const publishedCol = CSV_COLUMNS.indexOf("published_at");
    expect(rows[1][ratingCol]).toBe("5");
    expect(rows[1][publishedCol]).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("Empty reviews + photo_count boundary + filename slice ceiling", () => {
  // An empty `payload.reviews` array is the natural state on a brand-new
  // place with no reviews yet; the writer must still emit a valid Excel
  // file (BOM + header + trailing CRLF) — a refactor that emitted just
  // the BOM, or skipped the header on empty, would break import.
  it("empty reviews array still emits BOM + header + trailing CRLF (no data rows)", () => {
    const p = payload();
    p.reviews = [];
    const out = formatReviewsAsCsv(p);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out.endsWith(CRLF)).toBe(true);
    const rows = parseCsv(out.slice(BOM.length));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
  });

  // photo_count is a stringified array length; the join collapses 1
  // photo to just the URL with no trailing PHOTO_URL_JOIN separator,
  // which the existing 2-photo case can't distinguish from a regression
  // that emitted `url1 | ` (trailing separator) on a 1-photo review.
  it("single-photo review: photo_count='1' and photo_urls is the bare URL", () => {
    const p = payload();
    p.reviews = [
      {
        ...p.reviews[0],
        photos: [{ url: "https://only.example/1.jpg" }],
      },
    ];
    const row = __testing.rowFor(p.reviews[0], p);
    const photoCountCol = CSV_COLUMNS.indexOf("photo_count");
    const photoUrlsCol = CSV_COLUMNS.indexOf("photo_urls");
    expect(row[photoCountCol]).toBe("1");
    expect(row[photoUrlsCol]).toBe("https://only.example/1.jpg");
    expect(row[photoUrlsCol]).not.toContain(PHOTO_URL_JOIN);
  });

  // csvFilename uses `dateIso.slice(0, 10)` — a refactor that swapped
  // it to `slice(0, 8)` (the YMD digit count) or `slice(0, 11)` would
  // silently misname every download. Pin the slice ceiling at a
  // year/month/day boundary that fails loudly under either drift.
  it("csvFilename slices first 10 chars regardless of dateIso tail", () => {
    expect(csvFilename("slug", "2026-12-31T23:59:59.999Z")).toBe(
      "google-reviews-slug-20261231.csv",
    );
    expect(csvFilename("slug", "2026-01-02")).toBe(
      "google-reviews-slug-20260102.csv",
    );
  });
});

// Column selection (L35.2): selectCsvColumns narrows the 14-column schema to
// the requested review fields, and formatReviewsAsCsv emits only those columns.
describe("selectCsvColumns + formatReviewsAsCsv — column selection (L35.2)", () => {
  it("returns the full schema for a null/empty selection (identity)", () => {
    expect(selectCsvColumns(null)).toEqual(CSV_COLUMNS);
    expect(selectCsvColumns([])).toEqual(CSV_COLUMNS);
  });

  it("maps fields to columns, preserving first-requested order", () => {
    expect(selectCsvColumns(["text", "rating"])).toEqual(["text", "rating"]);
  });

  it("fans photos + owner_response out to their denormalised columns", () => {
    expect(selectCsvColumns(["photos"])).toEqual(["photo_count", "photo_urls"]);
    expect(selectCsvColumns(["owner_response"])).toEqual([
      "owner_response_text",
      "owner_response_at",
    ]);
  });

  it("drops place_* context columns (they are not review fields)", () => {
    expect(selectCsvColumns(["rating", "text"])).not.toContain("place_name");
  });

  it("emits a header + rows limited to the selected columns", () => {
    const csv = formatReviewsAsCsv(payload(), ["rating", "text"]);
    const [header, row1] = csv.replace(/^﻿/, "").split("\r\n");
    expect(header).toBe('"rating","text"');
    expect(row1).toBe('"5","Loved it.\nGreat ""service""!"');
  });

  it("leaves the full output unchanged when no selection is given", () => {
    expect(formatReviewsAsCsv(payload())).toBe(formatReviewsAsCsv(payload(), null));
  });
});
