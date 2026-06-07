// LIVE end-to-end smoke test for the SerpApi path (L27.5).
//
// SKIPPED BY DEFAULT — it makes a real SerpApi call and is never part of a
// normal `vitest run` / CI pass (which must stay offline, fixtures-only, per
// the quota rule). Run it deliberately:
//
//     SERPAPI_E2E=1 npx vitest run tests/serpapi-e2e.test.ts
//
// It exercises exactly ONE live page (limit 8 = one google_maps_reviews page,
// so one SerpApi search) through the real configured path
// (createReviewsProvider → SerpApi client) and proves real reviews survive into
// CSV / JSON / XLSX. Keys are read from the gitignored `.env.local`.

import { describe, it, expect, beforeAll } from "vitest";
import { createReviewsProvider } from "@/lib/reviews/provider";
import { formatReviewsAsCsv, csvFilename } from "@/lib/export/csv";
import { formatReviewsAsXlsx } from "@/lib/export/xlsx";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";

const LIVE = Boolean(process.env.SERPAPI_E2E);

// A real, stable Google Maps data_id (Blue Bottle Coffee, SF) — the same place
// captured in mocks/serpapi/, so a live result is directly comparable.
const REAL_DATA_ID = "0x80858098babc2d4b:0xbeedd659cc698c92";

describe("SerpApi live E2E (guarded — SERPAPI_E2E=1; makes 1 live call)", () => {
  beforeAll(() => {
    if (!LIVE) return;
    try {
      // Node ≥20.12 — load the gitignored creds for this process.
      (process as NodeJS.Process & { loadEnvFile: (p?: string) => void }).loadEnvFile(
        ".env.local",
      );
    } catch {
      // already in env, or older Node — rely on ambient SERPAPI_API_KEY*
    }
  });

  it.skipIf(!LIVE)(
    "fetches one real reviews page and exports CSV/JSON/XLSX with real data",
    async () => {
      // The real configured path: provider factory → SerpApi client.
      const client = createReviewsProvider({ provider: "serpapi" });
      // limit 8 = one page = exactly one SerpApi search (quota-safe).
      const res = await client.getReviews({ placeId: REAL_DATA_ID, limit: 8 });

      expect(res.reviews.length).toBeGreaterThan(0);
      expect(res.place.name).toBeTruthy();
      expect(res.place.place_id).toBe(REAL_DATA_ID);

      const payload: CachedReviewsPayload = {
        place: res.place,
        reviews: res.reviews,
        fetched_at: new Date().toISOString(),
      };

      const csv = formatReviewsAsCsv(payload);
      const json = JSON.stringify(payload);
      const xlsx = formatReviewsAsXlsx(payload);

      // A real review's author must appear in the text formats and the workbook
      // must carry bytes — proving real data flows through every exporter.
      const firstAuthor = res.reviews[0].author_name;
      expect(csv).toContain(firstAuthor);
      expect(json).toContain(firstAuthor);
      expect(xlsx.byteLength).toBeGreaterThan(0);

      // Proof to stdout (visible in the test run).
      // eslint-disable-next-line no-console
      console.log(
        `\n=== SerpApi E2E proof ===\n` +
          `place:   ${res.place.name} (${res.place.rating_avg}★, ${res.place.rating_count} reviews)\n` +
          `fetched: ${res.reviews.length} reviews in one page\n` +
          `first:   ${firstAuthor} — ${res.reviews[0].rating}★ — "${res.reviews[0].text.slice(0, 70)}"\n` +
          `exports: csv=${csv.length}B json=${json.length}B xlsx=${xlsx.byteLength}B\n` +
          `file:    ${csvFilename("blue-bottle-coffee", payload.fetched_at)}\n`,
      );
    },
  );
});
