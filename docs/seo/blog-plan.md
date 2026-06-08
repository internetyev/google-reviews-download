# Blog content plan — 20 launch articles

_Central entity: Google reviews download. Each article: primary keyword, intent, the ONE money page it links down to, and a one-line angle. Brief shape modeled on `/pandadoc-content-brief` (every post = Key Takeaways block under H1 + sourced stat where a claim needs one + a CTA to the tool). Topic sources: DFS informational pull (US, 2026-06-08) + 10 harvested PAA questions + adjacent higher-volume terms._

Conventions: posts live at `/blog/<slug>`; `links_to` is the money/hub page each post must internal-link with the target's primary keyword as anchor.

## Cluster 5a — How-to / fulfilment (core, 8)

| # | Title | slug | Primary keyword | Vol/KD | links_to | Angle |
|---|---|---|---|---|---|---|
| 1 | How to Download Google Reviews (2026 Guide) | how-to-download-google-reviews | how to download google reviews | 30/0 | `/` | Pillar how-to. 3 methods (our tool, GBP manual, API), why the tool is fastest. |
| 2 | How to Export Google Reviews to Excel | how-to-export-google-reviews-to-excel | how to export google reviews to excel | 10/47 | `/export-google-reviews-to-excel` | Step-by-step to a clean .xlsx; why CSV-into-Excel breaks (encoding) and ours doesn't. |
| 3 | How to Export Google Reviews to CSV | how-to-export-google-reviews-to-csv | export google reviews to csv | 10/19 | `/export-google-reviews-to-csv` | UTF-8/BOM/CRLF so Excel opens it cleanly; field-by-field column guide. |
| 4 | How to Get Google Reviews Into Google Sheets | google-reviews-to-google-sheets | how to pull google reviews into google sheets | 0/0 | `/export-google-reviews-to-csv` | Export CSV → File>Import in Sheets; why IMPORTXML/scraping breaks. |
| 5 | Can You Export All of Your Google Reviews? | can-you-export-all-google-reviews | can you export google reviews | 10/0 | `/download-all-google-reviews` | Yes — with the full walk; the GBP UI's hidden limits. |
| 6 | How Many Google Reviews Can You Download? | how-many-google-reviews-can-you-export | how many google reviews can you export | 0/0 | `/download-all-google-reviews` | Caps, pagination, what "all" really means. |
| 7 | How to Export Google Reviews Without the API | export-google-reviews-without-api | how to export google reviews without api | 0/0 | `/` | No code, no API key, no quota — paste a name, get a file. |
| 8 | How to Download Google My Business Reviews | download-google-my-business-reviews-guide | how do i download google my business reviews | 0/0 (PAA) | `/export-google-my-business-reviews` | GMB→GBP rename; where reviews live now; export route. |

## Cluster 5b — Use-case / decision (6)

| # | Title | slug | Primary keyword | Vol/KD | links_to | Angle |
|---|---|---|---|---|---|---|
| 9 | How to Back Up Your Google Reviews Before You Lose Them | how-to-backup-google-reviews | how to backup google reviews | 0/0 | `/backup-google-reviews` | Reviews disappear (account suspension, removal); a monthly export habit. |
| 10 | How to Export Google Reviews for Analysis | export-google-reviews-for-analysis | how to export google reviews for analysis | 0/0 | `/export-google-reviews-to-excel` | Get them into Excel/Sheets and pivot by rating/date/keyword. |
| 11 | Can You Transfer Google Reviews to Another Account? | transfer-google-reviews-to-another-account | can i transfer my google reviews to another account | 0/0 (PAA) | `/backup-google-reviews` | The honest answer (no native transfer); export-and-keep as the workaround. |
| 12 | The Google Reviews API: What It Is and When You Need It | google-reviews-api-explained | google reviews api | 880/7 | `/google-reviews-to-json` | Official API vs. third-party; when a no-API tool is enough. |
| 13 | Export Google Reviews as JSON (Developer Guide) | export-google-reviews-as-json | google reviews to json | 0/0 | `/google-reviews-to-json` | JSON shape, the HTTP API + MCP server, code samples. |
| 14 | Bulk-Exporting Google Reviews for Multiple Locations | bulk-export-google-reviews-locations | bulk export google reviews | 0/0 | `/bulk-export-google-reviews` | Per-location export workflow; honest about one-place-at-a-time. |

## Cluster 5c — Adjacent authority (higher volume, link back to CSI, 6)

| # | Title | slug | Primary keyword | Vol/KD | links_to | Angle |
|---|---|---|---|---|---|---|
| 15 | Google Review Management: A Small-Business Playbook | google-review-management-guide | google review management | 1000/18 | `/` | Collect→export→analyze→respond loop; export is step 2. |
| 16 | How to Get More Google Reviews (That Stick) | how-to-get-more-google-reviews | how to get more google reviews | 480/21 | `/` | Ask cadence, links, QR; then export to track what's working. |
| 17 | How to Report a Fake Google Review and Get It Removed | how-to-report-fake-google-reviews | how to report fake google reviews | 320/13 | `/backup-google-reviews` | Flag flow + evidence; export a snapshot before it changes. |
| 18 | How to Monitor Your Google Reviews | how-to-monitor-google-reviews | how to monitor google reviews | 0/0 | `/backup-google-reviews` | Alerts + a monthly export-and-diff habit. |
| 19 | How to Embed Google Reviews on Your Website | how-to-embed-google-reviews | how to embed google reviews | 20/38 | `/google-reviews-to-json` | Widgets vs. JSON-fed custom embeds. |
| 20 | How to Analyze Google Reviews in Excel (Step by Step) | analyze-google-reviews-in-excel | analyze google reviews in excel | 0/0 | `/export-google-reviews-to-excel` | Pivot tables, rating trends, keyword frequency from the export. |

## Brief template (each article, when written)

```
H1: <title>
Key Takeaways: 3–5 bullets (the answer up front)
Primary kw: <kw>  | Secondary: <2–4 related/PAA>
Intent: <informational/decision>  | Money link: <links_to> (anchor = its primary kw)
Sections (H2s): derived from PAA + the steps the task actually takes
Sourced stat: 1 where a claim needs proof (verbatim, cited)
CTA: "Download your Google reviews as CSV/JSON/XLSX — free, no signup" → tool
Schema: Article + (where step-based) HowTo JSON-LD
```
