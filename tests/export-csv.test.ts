// Regression guard for lib/export/csv.ts (ADR-003).
// The Excel-on-Windows defaults — UTF-8 BOM, CRLF, QUOTE_ALL — are the whole
// reason this writer exists (project memory `feedback_csv_ascii_for_excel`).
// These tests pin that contract so a refactor can't silently regress it.

import { describe, it, expect } from "vitest";
import {
  formatReviewsAsCsv,
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
