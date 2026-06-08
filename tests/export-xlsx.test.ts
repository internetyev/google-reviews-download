// Regression guard for lib/export/xlsx.ts (ADR-003).
// XLSX mirrors the CSV column schema but adds spreadsheet-only contract:
// a single "Reviews" sheet, one data row per review under a frozen header
// (`ySplit: 1`), and the hand-tuned per-column widths. These assertions
// round-trip the produced workbook through SheetJS so a refactor that
// breaks sheet shape, freeze pane, or widths fails loudly.

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import * as xlsxModule from "@/lib/export/xlsx";
import {
  formatReviewsAsXlsx,
  xlsxFilename,
  XLSX_COLUMNS,
  __testing,
} from "@/lib/export/xlsx";
import { CSV_COLUMNS } from "@/lib/export/csv";
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
  // SheetJS 0.18.5 CE's reader does not repopulate `!cols`/freeze on read-back
  // (verified L28.3), so the writer's contract is asserted on the worksheet our
  // code constructs (`__testing.buildReviewsSheet`) — the source of truth for
  // what we ask SheetJS to emit — not via the lossy XLSX.read round-trip.
  const ws = __testing.buildReviewsSheet(payload());

  it("requests a frozen header row at ySplit 1", () => {
    const views = ws["!views"] as Array<{ ySplit?: number; state?: string }> | undefined;
    const freeze = ws["!freeze"] as { ySplit?: number } | undefined;
    // Both the canonical pane and the legacy convenience prop carry ySplit 1.
    // (SheetJS 0.18.5 CE does not serialize either to the .xlsx — a documented
    // library limitation, retained for a future upgrade; see xlsx.ts.)
    expect(views?.some((v) => v.ySplit === 1 && v.state === "frozen")).toBe(true);
    expect(freeze?.ySplit).toBe(1);
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

  // L12.1 (iii): pin the slice ceiling at the year/month/day boundary so a
  // refactor to slice(0, 8) or slice(0, 11) misnames every download and
  // fails loudly. Symmetric with the L11.6/D-064 csvFilename pin.
  it("slices the first 10 chars of dateIso — no more, no less", () => {
    // Day-30 vs day-31 in the same month makes slice(0, 8) (which would
    // drop the day) fail because the asserted ymd carries the day; an
    // hour-prefix in chars 11+ makes slice(0, 11) fail because the trailing
    // "T" would survive into the filename.
    expect(xlsxFilename("x", "2026-12-31T23:59:59.999Z")).toBe(
      "google-reviews-x-20261231.xlsx",
    );
    expect(xlsxFilename("x", "2026-01-01T00:00:00.000Z")).toBe(
      "google-reviews-x-20260101.xlsx",
    );
  });
});

// L12.1 (a): XLSX_COLUMNS exact-order freeze + symmetry with CSV_COLUMNS +
// per-row arity via XLSX.read. Downstream pipelines read the sheet by
// column position; a refactor that swapped two columns (or inserted one in
// the middle) would shift every following cell across every consumer with
// no runtime signal. The symmetry assertion guards the documented
// `XLSX_COLUMNS = CSV_COLUMNS` contract (lib/export/xlsx.ts ADR-003: "a
// user who switches between formats sees the same columns in the same
// order") — a refactor that decoupled the two arrays would let them drift
// silently and the round-trip count tests would still pass on each side
// alone.
describe("XLSX_COLUMNS — exact-order freeze + CSV symmetry", () => {
  it("freezes the 14-column tuple in the documented surfaced order", () => {
    expect(XLSX_COLUMNS).toEqual([
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
    expect(XLSX_COLUMNS).toHaveLength(14);
  });

  it("is referentially identical to CSV_COLUMNS (one shared schema, not two)", () => {
    // A refactor that did `export const XLSX_COLUMNS = [...CSV_COLUMNS]`
    // (a copy) would pass an `.toEqual` check today but would let the two
    // arrays drift on the next column edit — pin reference equality so the
    // single-source-of-truth invariant holds structurally.
    expect(XLSX_COLUMNS).toBe(CSV_COLUMNS);
  });

  it("emits every row carrying exactly XLSX_COLUMNS.length cells", () => {
    const wb = roundTrip(payload());
    const ws = wb.Sheets[SHEET_NAME];
    // `header: 1` returns each row as an array (no key-shape coercion), so
    // a row whose cell count drifted from 14 surfaces here as a length
    // mismatch rather than being papered over by `sheet_to_json`'s
    // header-merged shape.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    expect(grid).toHaveLength(3); // header + r1 + r2
    grid.forEach((row) => {
      expect(row).toHaveLength(XLSX_COLUMNS.length);
    });
    // Header row equals XLSX_COLUMNS in surfaced order (the writer's
    // header-emission path under json_to_sheet({ header })).
    expect(grid[0]).toEqual([...XLSX_COLUMNS]);
  });
});

// L12.1 (b): typed-cell fidelity. Unlike CSV (every field is text), XLSX
// cells carry types — `rating` and `photo_count` are JS numbers in the
// row object, and SheetJS should write them as numeric ("n") cells. A
// refactor that stringified either via `String(rating)` or `.toString()`
// would silently break Excel's number formatting/sorting on those columns
// (=SUM, =AVERAGE, numeric sort all fail on text cells), with no visible
// error in the file. Round-trip preserves the JS `typeof` so the test can
// pin the type without inspecting raw OOXML.
describe("formatReviewsAsXlsx — typed-cell fidelity", () => {
  const wb = roundTrip(payload());
  const ws = wb.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

  it("writes rating as a numeric cell (typeof number, value preserved)", () => {
    expect(typeof rows[0].rating).toBe("number");
    expect(typeof rows[1].rating).toBe("number");
    expect(rows[0].rating).toBe(5);
    expect(rows[1].rating).toBe(3);
  });

  it("writes photo_count as a numeric cell (including the zero-photo case)", () => {
    expect(typeof rows[0].photo_count).toBe("number");
    expect(typeof rows[1].photo_count).toBe("number");
    expect(rows[0].photo_count).toBe(2);
    // The no-photos case: zero must round-trip as number 0, not "" — the
    // rowFor blank-fill is for *string* fields only (D-043-adjacent: types
    // matter for spreadsheet semantics).
    expect(rows[1].photo_count).toBe(0);
  });

  it("writes text-typed fields as strings (review_id/published_at)", () => {
    // Counterpart to the numeric checks above: a refactor that
    // accidentally coerced review_id or published_at to a number (e.g. an
    // all-digit fixture id) must not slip through — XLSX writes whatever
    // JS type the row object carries.
    expect(typeof rows[0].review_id).toBe("string");
    expect(typeof rows[0].published_at).toBe("string");
    expect(rows[0].published_at).toBe("2026-05-01T00:00:00.000Z");
  });
});

// L12.1 (c): empty-reviews shape + single-photo boundary. A brand-new
// place with zero reviews must still produce a valid workbook (header +
// freeze + widths intact), and the existing 2-photo case in `payload()`
// can't distinguish a `url1 | ` (trailing-separator) regression from the
// correct `url1` bare-URL output — the 1-photo case is the load-bearing
// boundary. Symmetric with L11.6 (iii) for the CSV writer.
describe("formatReviewsAsXlsx — empty-reviews + single-photo boundary", () => {
  it("emits a valid workbook for empty reviews: header only, freeze + widths intact", () => {
    const p = payload();
    p.reviews = [];
    // File integrity via the read-back (valid workbook, header-only grid).
    const wb = roundTrip(p);
    expect(wb.SheetNames).toEqual([SHEET_NAME]);
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET_NAME], {
      header: 1,
    });
    expect(grid).toHaveLength(1); // header only, no data rows
    expect(grid[0]).toEqual([...XLSX_COLUMNS]);
    // Widths + frozen-header intent persist on the empty-reviews worksheet too
    // (they depend on header + sheet metadata, not data rows). Asserted on the
    // constructed worksheet — SheetJS' reader is lossy on these props (L28.3).
    const ws = __testing.buildReviewsSheet(p);
    expect(ws["!cols"]).toHaveLength(XLSX_COLUMNS.length);
    const views = ws["!views"] as Array<{ ySplit?: number }> | undefined;
    expect(views?.some((v) => v.ySplit === 1) ?? false).toBe(true);
  });

  it("single-photo case: photo_count = 1 and photo_urls is the bare URL (no trailing PHOTO_URL_JOIN)", () => {
    const p = payload();
    p.reviews = [
      {
        review_id: "solo",
        author_name: "Solo",
        rating: 4,
        text: "one photo",
        published_at: "2026-05-04T00:00:00.000Z",
        photos: [{ url: "https://p/only.jpg" }],
      },
    ];
    const wb = roundTrip(p);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[SHEET_NAME],
    );
    expect(rows).toHaveLength(1);
    // Typed: photo_count is a numeric 1, not the string "1".
    expect(typeof rows[0].photo_count).toBe("number");
    expect(rows[0].photo_count).toBe(1);
    // The load-bearing assertion: no trailing separator. A regression to
    // `photos.map(p => p.url + PHOTO_URL_JOIN).join("")` would emit
    // `https://p/only.jpg | ` and the existing 2-photo case (which
    // asserts `url1 | url2`) wouldn't catch it — the 1-photo case does.
    expect(rows[0].photo_urls).toBe("https://p/only.jpg");
    expect(rows[0].photo_urls).not.toContain(PHOTO_URL_JOIN);
  });
});

// L26.1 (a): module's named-export surface. A surplus export (e.g.
// `export const SHEET_NAME` re-exposing the internal sheet name, an
// `export function buildWorkbook` extracted mid-refactor, an
// `export const FREEZE_PANE` constant) would silently broaden the public
// contract every downstream importer is held to. Symmetric with
// L23.1/D-080 (sf-client), L24.1/D-081 (reviews-cache), L25.1/D-082
// (place-id) export-surface pins applied to the xlsx writer module.
// Type-only exports (`XlsxColumn`) are erased at runtime and do not
// appear in `Object.keys`.
describe("module export surface — Object.keys(xlsxModule).sort()", () => {
  it("freezes the runtime export surface at exactly 5 named exports", () => {
    expect(Object.keys(xlsxModule).sort()).toEqual([
      "XLSX_COLUMNS",
      "XLSX_CONTENT_TYPE",
      "__testing",
      "formatReviewsAsXlsx",
      "xlsxFilename",
    ]);
  });
});

// L26.1 (b): per-call freshness of formatReviewsAsXlsx's Uint8Array.
// SheetJS' XLSX.write returns a fresh buffer per invocation, but a
// "DRY" refactor that memoised the output by payload reference (or by
// a content hash) would silently let any downstream mutation of the
// returned Uint8Array (a defensive trim, a UI layer rewriting bytes)
// leak across callers. The route handler reads `bytes.byteLength` for
// the Content-Length header and passes the same buffer to
// NextResponse — a shared singleton would also mean two concurrent
// requests with the same payload reference would race on the buffer.
// Two `it`s — non-empty payload AND empty-reviews payload — so a
// memoise on either branch fails on its own assertion. Mirrors
// L23.1/D-080's per-call factory-freshness pin pushed onto the bytes
// the writer hands to the response.
describe("formatReviewsAsXlsx — per-call freshness", () => {
  it("returns reference-unequal Uint8Array instances across two calls (non-empty payload)", () => {
    const p = payload();
    const first = formatReviewsAsXlsx(p);
    const second = formatReviewsAsXlsx(p);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(second).toBeInstanceOf(Uint8Array);
    expect(first).not.toBe(second);
  });

  it("returns reference-unequal Uint8Array instances across two calls (empty-reviews payload)", () => {
    const p = payload();
    p.reviews = [];
    const first = formatReviewsAsXlsx(p);
    const second = formatReviewsAsXlsx(p);
    expect(first).not.toBe(second);
  });
});

// L26.1 (c): __testing namespace's exact key surface. A surplus
// helper leaking in (e.g. a `freezePane` builder extracted mid-refactor,
// a `widthFor` helper, the unexported `Row` type re-exposed as a
// runtime sentinel) would silently broaden the test-only contract.
// Symmetric with L23.1/D-080's, L24.1/D-081's, and L25.1/D-082's
// __testing exact-key-surface pins, applied to the xlsx writer's
// test-only escape-hatch namespace.
describe("__testing namespace — Object.keys(__testing).sort()", () => {
  it("exposes the test-only escape-hatch surface", () => {
    // L28.3 added `buildReviewsSheet` so the writer's pre-serialization contract
    // (widths + frozen-header intent) is testable without SheetJS' lossy reader.
    expect(Object.keys(__testing).sort()).toEqual([
      "COLUMN_WIDTHS",
      "PHOTO_URL_JOIN",
      "SHEET_NAME",
      "buildReviewsSheet",
      "rowFor",
    ]);
  });
});
