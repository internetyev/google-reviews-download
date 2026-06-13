# Money keywords — scored landing-page plan

_Data: DataForSEO Labs keyword overview (US, 2026-06-08). Volume = DFS exact-match (undercounts the cluster; treat as directional). KD = DFS difficulty (0 = trivial). CPC in USD = commercial intent. Ahrefs parent-topic/traffic-potential unavailable this run (key over per-key cap)._

## Scoring model

`priority = intent_fit × (1 + cpc_signal) × winnability` where:
- **intent_fit** (0–3): does the query name an action+format our tool does in one click? (3 = "export to csv", 1 = "extract" which also attracts scraping intent)
- **cpc_signal**: high CPC ⇒ commercial demand even where exact volume reads 0.
- **winnability**: KD≈0 and the SERP lacks a dedicated landing page for this exact modifier.

Because exact volumes are low and KD is ~0 across the board, **coverage beats selection**: we ship the whole high-intent set rather than betting on one term. Tiering is about *sequence*, not exclusion.

## Tier 1 — wire live now (8)

| Slug | Keyword | Vol | KD | CPC | intent_fit |
|---|---|---|---|---|---|
| export-google-reviews-to-csv | export google reviews to csv | 10 | 19 | – | 3 |
| download-google-reviews-as-excel | download google reviews as excel | 0 | 0 | – | 3 |
| export-google-reviews-to-excel | export google reviews to excel | 10 | 0 | $8.09 | 3 |
| download-google-maps-reviews | download google maps reviews | 10 | 0 | – | 3 |
| download-google-business-reviews | download google business reviews | 10 | 0 | – | 3 |
| export-google-my-business-reviews | export google my business reviews | 10 | 0 | – | 3 |
| download-all-google-reviews | download all google reviews | 10 | 0 | – | 3 |
| backup-google-reviews | backup google reviews | 0 | 0 | – | 3 |

## Tier 2 — ship after Tier 1 indexes (6)

| Slug | Keyword | Vol | KD | CPC | Note |
|---|---|---|---|---|---|
| google-reviews-to-json | google reviews to json | 0 | 0 | – | dev intent; pairs with API blog |
| google-reviews-to-xlsx | google reviews to xlsx | 0 | 0 | – | extension-named, lowest competition |
| extract-google-reviews | extract google reviews | 10 | 0 | $9.88 | high CPC; "your business" framing to filter scrapers |
| save-google-reviews-to-file | save google reviews to file | 0 | 0 | – | format-agnostic; lead with toggle |
| bulk-export-google-reviews | bulk export google reviews | 0 | 0 | – | agency/multi-location; honest per-place limits |
| google-business-profile-reviews-export | google business profile reviews export | 0 | 0 | – | current official GBP naming |

## Owned by the home page (not separate nodes)

| Keyword | Vol | KD | CPC |
|---|---|---|---|
| export google reviews | 50 | 0 | $7.10 |
| download google reviews | 50 | 0 | – |
| google reviews export | 20 | 0 | $4.86 |
| google reviews download | 20 | 0 | $2.93 |

Splitting these into their own pages would cannibalise the hub — they stay on `/`.

## Out of scope (demand exists, product doesn't serve it)

`google reviews api` (880) → an **API docs page + blog explainer**, not a download landing page. `google review management` (1000), `google business profile reviews` (480) → too broad / different SERP (reputation suites); blog-only, framed back to download.
