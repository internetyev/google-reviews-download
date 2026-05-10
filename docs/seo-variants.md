# SEO Variants — long-tail seed list

_Status: candidate variants only. Volumes / SERP-difficulty are **not** populated here — that is a corgi (DataForSEO) pass that runs locally on Andrei's machine and respects the LEDGER's $1/week real-cash cap. When corgi data lands, this doc gains a `Volume` and `Top-3 SERP signal` column and L1.6b can be marked `[x]`._

The autonomous routine cannot call DataForSEO, so this leaf is split:

- **L1.6a (this doc, agent)** — propose ~10 candidate variants with intent classification + a one-line rationale per variant, so corgi has a focused list to score rather than the universe of "google reviews" queries.
- **L1.6b (deferred — human-gated)** — Andrei runs `corgi keywords <variants>` locally, pastes volume + competition + top-3 SERP characterisation back into this file, then we pick **5** variants for L3.1.

Picking 5 from a corgi-scored 10 is cheaper and less risky than letting the routine guess at volumes — which is exactly what the LEDGER cap is designed to enforce.

---

## Picking criteria

A variant is on the list only if it clears all three filters:

1. **Buyer intent.** The query implies an action ("download", "export", "save", "csv", "to excel"), not just curiosity ("how do reviews work"). Curiosity queries lose to Google Help and review-site listicles; action queries lose to whoever ships the tool.
2. **Tool-shaped SERP gap.** A quick eyeballing of the SERP shows blog spam, agency lead-magnets, or buried features — not a purpose-built tool sitting at #1. (Final confirmation comes from corgi in L1.6b; rough manual judgement here.)
3. **Trivially fulfillable by our tool as-is.** The variant maps to "paste a Place ID → get a file." Variants that imply a feature we do not have (sentiment scoring, multi-place batch, summarisation) are parked in `## Out-of-scope variants` below — they are real demand, but not for **this** product.

Variants are grouped by intent so corgi-side comparisons are apples-to-apples (export-format queries cluster differently from save-as-action queries).

---

## Head term

| # | Variant | Intent | Maps to | Rationale |
|---|---------|--------|---------|-----------|
| H | `google reviews download` | export | `app/page.tsx` (root) | The EMD target. Already covered by the root page in L2.4 and a JSON-LD FAQ at L3.3 — listed here for completeness, not as a Phase 3 variant page. |

## Group A — format-named export ("...as csv", "...to excel")

These are the highest-conviction variants. The query name *is* the feature: someone typing "google reviews to excel" is one button-click away from done if they land on us.

| # | Variant | Intent | Maps to | Rationale |
|---|---------|--------|---------|-----------|
| A1 | `export google reviews to csv` | export | `app/(seo)/export-google-reviews-to-csv/` | CSV is our default format and our CSV writer is Excel-ready (UTF-8 BOM, CRLF, QUOTE_ALL — D-005). Above-the-fold copy can call out the Excel-friendliness explicitly, which is a differentiator vs. the generic JSON-only tools that show up in the SERP. |
| A2 | `download google reviews as excel` | export | `app/(seo)/download-google-reviews-as-excel/` | XLSX writer is a first-class output (L2.7), one row per review, frozen header. The variant matches user mental model ("I want it in Excel") more directly than "...as xlsx". |
| A3 | `google reviews to xlsx` | export | `app/(seo)/google-reviews-to-xlsx/` | Same tool, but indexes the literal extension. Lower volume than A2 but lower competition too — the queries that name a file extension are typically typed by people who *know* what they want, which is our strongest conversion segment. |
| A4 | `google business reviews csv export` | export | `app/(seo)/google-business-reviews-csv-export/` | "Business reviews" is the SMB-owner phrasing (vs. "Maps reviews" which skews consumer/curiosity). Pairs naturally with copy aimed at the primary audience in PLAN.md. |

## Group B — verb-led action queries

These variants use a verb the user is about to execute. Conversion potential is high; the page just needs to not get in the way.

| # | Variant | Intent | Maps to | Rationale |
|---|---------|--------|---------|-----------|
| B1 | `save google reviews to file` | export | `app/(seo)/save-google-reviews-to-file/` | "To file" is intentionally generic — the page offers the format toggle (CSV / JSON / XLSX) prominently. Catches users who haven't decided on a format yet. |
| B2 | `extract google reviews` | export | `app/(seo)/extract-google-reviews/` | "Extract" is the SEO-consultant phrasing. Slight risk: it also attracts scraping intent, which we explicitly do not serve (PLAN.md anti-audience). Above-the-fold copy says "**your** business's reviews" to filter out the wrong crowd. |
| B3 | `backup google reviews` | export | `app/(seo)/backup-google-reviews/` | SMB-owner mindset ("what if Google deletes them?"). Lower volume, but the conversion rate from this query is likely the highest in the list because the user has a specific, durable reason to download. |

## Group C — surface / source variants

These name the surface ("Google Maps reviews", "Google Business Profile reviews") rather than the action. Mid-conviction — they catch the long-tail, but the SERPs are noisier.

| # | Variant | Intent | Maps to | Rationale |
|---|---------|--------|---------|-----------|
| C1 | `download google maps reviews` | export | `app/(seo)/download-google-maps-reviews/` | "Maps reviews" is the consumer-side phrasing. Volume is probably the highest in this group; competition includes ORM platforms and at least one Chrome extension, so the differentiator is "no install, no signup". |
| C2 | `google business profile reviews download` | export | `app/(seo)/google-business-profile-reviews-download/` | The official 2026 Google branding (replaced "Google My Business"). Newer queries tend to have weaker SERPs because legacy content uses the old name — small but real opportunity. |
| C3 | `download all reviews from google` | export | `app/(seo)/download-all-reviews-from-google/` | "All" is the keyword — pairs with the page-walker's `HARD_CAP_REVIEWS = 5_000` (D-019) and lets the copy promise "every review, not just the first page", which is a real edge over Google Takeout (limited) and most extensions (visible-page only). |

---

## Out-of-scope variants (parked, not on the corgi list)

These show real demand in casual searches but they imply features we do not build in v1. Listed so future scope reviews don't re-discover them from scratch.

- `analyse google reviews` / `google review sentiment` — would require sentiment scoring (PLAN.md "Scope — OUT").
- `monitor google reviews` / `google review alerts` — recurring task, requires accounts + scheduling.
- `compare google reviews competitors` — multi-place batch; explicitly out per PLAN.md anti-audience.
- `summarise google reviews with ai` — AI summarisation is a separate product if there is pull.
- `delete google reviews` — completely different surface (and a Google-side action, not ours).

If post-launch data shows one of these dominates traffic intent, the right move is to spin a sibling tool, not bolt features onto this one.

---

## Next step (L1.6b, human-gated)

```
# locally, on Andrei's machine — costs real cash, tracked in LEDGER.md
corgi keywords \
  "export google reviews to csv" \
  "download google reviews as excel" \
  "google reviews to xlsx" \
  "google business reviews csv export" \
  "save google reviews to file" \
  "extract google reviews" \
  "backup google reviews" \
  "download google maps reviews" \
  "google business profile reviews download" \
  "download all reviews from google"
```

Paste the resulting volume + competition columns back into the tables above, then close L1.6b. L3.1 picks the top 5 by `volume × (1 - competition)`-style score, with manual override if a low-volume variant has uniquely weak top-3 SERPs.
