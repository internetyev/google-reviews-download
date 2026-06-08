# Topical Map — Google Reviews Download

_Central Entity: **Google reviews download** · Geo: US (English) · Built 2026-06-08 from corgi/DataForSEO keyword + SERP data (Ahrefs key was over its per-key unit cap this run — see `docs/seo/keyword-research.md` § Data sources). Methodology adapted from the vault `/topical-map` skill (5-layer URL spine) and `/pandadoc-content-brief` (per-page briefs)._

---

## 0. Central Entity & Central Search Intent

- **Central Entity (CE):** *Google reviews download* — a free, no-signup web tool that turns a Google business's reviews into a downloadable **CSV / JSON / XLSX** file (plus an HTTP API and an MCP server).
- **Central Search Intent (CSI):** *"I run (or manage) a business and I want to get my Google reviews out of Google as a file I can keep, open in Excel, or analyze."*
- **Who it is NOT for (hard topical border):** consumers scraping other people's reviews at scale, sentiment-AI platforms, review-generation/ORM suites. Those are adjacent demand we deliberately do not chase on money pages (they pull a different, more competitive SERP). We touch them only in the blog, framed back to our CSI.

### Why this CE (evidence)

- The export/download cluster ranks a **3-competitor, KD≈0** SERP: exportcomments, outscraper, elfsight, reviewflowz, saijogeorge, localsearchforum (corgi-serp 2026-06-08). Purpose-built tools exist but none own the **format-named long-tail** as dedicated landing pages — the gap we take.
- DataForSEO exact-match volumes are low (head terms 20–50/mo) but **difficulty is 0** and **CPC is high ($4–$10)** — a low-volume, high-commercial-intent, winnable long-tail. The play is *coverage of the whole cluster*, not one head-term grab.
- Our product fulfils the CSI literally: paste a business name / Place ID → get the file. Every money node maps to "the query name IS the feature."

---

## 1. The five-layer spine

```
L1  CENTRAL ENTITY ───────────────  / (home)  "Google reviews download"
        │
L2  MONEY / FUNCTIONAL  ──────────  the export action × format × surface (landing pages that convert)
        │   export-google-reviews · …-to-csv · …-as-excel · …-to-json · download-google-maps-reviews · …
        │
L3  FORMAT & SURFACE FACETS ──────  csv / excel / xlsx / json ; maps / business-profile / my-business
        │
L4  USE-CASE / AUDIENCE ──────────  for analysis · for backup · for agencies · for migration · bulk
        │
L5  INFORMATIONAL SUPPORT (BLOG) ─  how-to · can-you · API · comparisons · adjacent (manage/monitor/get-more)
```

L1–L4 are **money/landing surface** (the Next.js app + `lib/seo/variants.ts` registry). L5 is the **blog** (`/blog`), which exists to build topical authority and funnel internal links down into L1–L4.

---

## 2. Layer 1 — Central Entity (the hub)

| Node | URL | Primary keyword | Status |
|---|---|---|---|
| Home / tool | `/` | `google reviews download` (+ `export google reviews`, `download google reviews`) | LIVE (L2.4) |

The home page is the conversion hub and the strongest internal-link target. Every L2 page links up to it; every L5 article links down to it or to the most relevant L2 page.

---

## 3. Layer 2 — Money / functional landing pages

These are the pages that rank for an action+format query and convert in one click. Each is a `lib/seo/variants.ts` entry rendering the shared tool below a keyword-matched intro. **Scored + prioritised in `docs/seo/money-keywords.md`.** Tier-1 (ship live now) and Tier-2 (ship next) below.

### Tier 1 — ship live (highest intent × cleanest fulfilment)

| Slug | Primary keyword | Vol / KD / CPC | Angle |
|---|---|---|---|
| `export-google-reviews-to-csv` | export google reviews to csv | 10 / 19 / – | CSV is our default; Excel-ready (BOM/CRLF/QUOTE_ALL). |
| `download-google-reviews-as-excel` | download google reviews as excel | – / 0 / – | XLSX first-class output, one row per review. |
| `export-google-reviews-to-excel` | export google reviews to excel | 10 / 0 / $8.09 | High-CPC commercial twin of the above. |
| `download-google-maps-reviews` | download google maps reviews | 10 / 0 / – | Consumer/Maps phrasing; "no install, no signup". |
| `download-google-business-reviews` | download google business reviews | 10 / 0 / – | SMB-owner phrasing; GBP angle. |
| `export-google-my-business-reviews` | export google my business reviews | 10 / 0 / – | Legacy GMB phrasing still searched. |
| `download-all-google-reviews` | download all google reviews | 10 / 0 / – | "all" = completeness promise (full walk + cache). |
| `backup-google-reviews` | backup google reviews | – / 0 / – | Durable-reason intent ("what if Google deletes them"). Highest conversion. |

### Tier 2 — ship after Tier 1 indexes

| Slug | Primary keyword | Notes |
|---|---|---|
| `google-reviews-to-json` | google reviews to json | Developer intent; pairs with the API + `google reviews api` blog. |
| `google-reviews-to-xlsx` | google reviews to xlsx | Extension-named; lower vol, lowest competition. |
| `extract-google-reviews` | extract google reviews | High CPC ($9.88); filter scraping intent with "your business". |
| `save-google-reviews-to-file` | save google reviews to file | Format-agnostic; leads with the format toggle. |
| `bulk-export-google-reviews` | bulk export google reviews | Agency/multi-location framing (honest about per-place limits). |
| `google-business-profile-reviews-export` | google business profile reviews export | Current official GBP naming. |

Head terms `export google reviews` (50/0/$7.10) and `download google reviews` (50/0) are owned by the **home page**, not a separate L2 node (avoids self-cannibalisation with the hub).

---

## 4. Layers 3–4 — facets & use-cases

These are **not** all separate pages — most are *sections/intents folded into the L2 pages and the blog*. They become standalone pages only where a query has its own demand.

- **L3 format facets:** csv · excel · xlsx · json — each already a Tier-1/2 money page above.
- **L3 surface facets:** Google Maps reviews · Google Business Profile reviews · Google My Business reviews — covered by the surface-named L2 pages.
- **L4 use-cases (blog-led, link down to money pages):** export *for analysis* (→ Excel page), *for backup* (→ backup page), *for an agency / multiple locations* (→ bulk page), *for migration to another account* (PAA demand: "transfer Google reviews to another account").

---

## 5. Layer 5 — Informational support (the blog cluster)

20 launch articles. Three sub-clusters, each links down to the matching L2 money page and up to the hub. Full list + briefs in `docs/seo/blog-plan.md`. Topic sources: informational keyword pull + 10 harvested PAA questions + adjacent higher-volume terms.

- **5a. How-to / fulfilment (core):** how to export/download google reviews, …to Excel, …to CSV, …to Google Sheets, can you export all your reviews, how many you can export, export without the API.
- **5b. Use-case / decision:** export reviews for analysis, backup before they disappear, transfer to another account, for an agency, JSON for developers, the Google reviews API explained.
- **5c. Adjacent authority (higher volume, link back to CSI):** google review management (1000), how to get more google reviews (480), how to report fake google reviews (320), how to monitor/track google reviews, how to embed google reviews, sentiment analysis of google reviews. These rank for bigger terms and pass authority + internal links down to the money cluster.

---

## 6. Internal-linking logic

- **Up:** every L2 money page links to `/` (hub) with anchor = the head term; every L5 article links to `/` and to its single most-relevant L2 page (anchor = that page's primary keyword).
- **Down:** the hub links to the Tier-1 money pages; each money page links to 1–2 sibling money pages (format/surface twins) and to the 1–2 blog articles that target its how-to query.
- **Sideways (blog):** within a sub-cluster, each article links to 2–3 sibling articles (e.g. the CSV how-to ↔ the Excel how-to ↔ the Sheets how-to).
- **One canonical target per intent.** No two money pages compete for the same head term; the surface/format modifier is what differentiates them (the SERP-overlap guard from the `/topical-map` SOP).

---

## 7. Publishing sequence

1. **Hub already live.** Confirm the home page targets `google reviews download` / `export google reviews`.
2. **Tier-1 money pages (8)** — flip `published: true` in `lib/seo/variants.ts`; they enter the sitemap. (This is the deferred L3.1b, now unblocked.)
3. **Blog infrastructure** — `/blog` index + post route + Article JSON-LD + sitemap entries.
4. **Blog 5a (how-to core, ~8 articles)** — each links down to a Tier-1 money page.
5. **Tier-2 money pages (6)** as 5a indexes.
6. **Blog 5b + 5c (use-case + adjacent, ~12 articles).**
7. Re-pull SERP positions for the cluster after ~4 weeks; promote whichever Tier-2 page is closest to page 1 into the home-page link block.

---

## 8. Ship-readiness criteria (per node)

A node ships only when: (a) primary keyword maps to a real on-page intent the tool fulfils; (b) title ≤60 / meta ≤160 chars, both carrying "google" + the action/format; (c) it has its up-link to the hub and at least one down/side link; (d) for money pages, the shared tool renders below the fold; (e) for blog posts, a Key Takeaways block under the H1, a sourced stat where a claim needs one, and a CTA to the tool. Mirrors the `/pandadoc-content-brief` gate list.

---

## 9. Hard topical borders (what we will NOT publish)

- Pages that promise scraping **competitors'** reviews at scale (different SERP, against our anti-audience, and ToS-fraught).
- Sentiment-AI / review-reply-generation / reputation-management product pages (adjacent — blog only, framed back to download).
- "Buy Google reviews" / fake-review anything (we publish the *report fake reviews* explainer; we never facilitate).
