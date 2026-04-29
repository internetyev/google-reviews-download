# google-reviews-download — Project Plan

_Last updated: 2026-04-28_

## What it is

A web tool that takes a **Google Business name or Place ID** and returns a **downloadable export of that business's Google reviews** in CSV, JSON, or XLSX. One field, one click, one file. Reviews are fetched via the SemanticForce API.

## Why now

- "google reviews download" is a clean, buyer-intent query with weak SERP. Most ranking pages are blog spam, agency lead magnets, or buried features inside ORM platforms. No purpose-built tool owns the query.
- EMD plus a fast, single-purpose tool plus content for the long-tail variants is a realistic top-3 path for the head term.
- Local SMBs, SEO consultants, and ORM teams all have a recurring need (backup, sentiment analysis, training data, marketing quotes). Right now they cobble together browser extensions or scrape manually.

## Audience

- **Primary:** local-SEO consultants and agency analysts pulling reviews for client work.
- **Secondary:** SMB owners wanting a backup of their reviews; marketing teams pulling quotes for case studies; sentiment / ORM analysts.
- **Anti-audience:** anyone wanting to scrape competitor reviews at scale for unethical use. The tool is for the business's own reviews and openly available public data — we will not enable bulk scraping or evade rate limits.

## Success metrics

- **Phase 1 (MVP):** working tool against mock data, p50 export latency < 2s, all three formats correct.
- **Phase 2 (post real-creds + deploy):** 500 uniques/month, ≥30% form-submit-to-download conversion, top-10 ranking for "google reviews download" within 90 days.
- **Phase 3 (12 months):** top-3 for the head term, ≥10 indexed long-tail pages, freemium tier converting (cap free downloads at N reviews/month, paid tier removes the cap).

## Scope — IN

- Single-page tool: input → export
- Mock SemanticForce backend until real creds arrive (fixtures committed in `mocks/semanticforce/`)
- Three export formats: CSV (UTF-8 with BOM, CRLF, QUOTE_ALL — Excel-friendly), JSON, XLSX
- Pre-rendered SEO pages for ~10 long-tail variants ("export google reviews", "download google maps reviews", "google business reviews csv", "save google reviews to excel", etc.)
- Cache layer (Vercel KV, keyed by `place_id`, TTL 24h) so repeat downloads don't burn API quota
- Basic analytics (Plausible)

## Scope — OUT (for now)

- User accounts, auth, billing
- Bulk multi-place exports in one go
- Sentiment analysis, summarisation, AI features (separate product if there's pull)
- Browser extension
- Competitor review monitoring

## Stack (working assumption)

- **Frontend:** Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui
- **Hosting:** Vercel
- **Data source:** SemanticForce API (mocked in dev via fixtures)
- **Cache:** Vercel KV, key = normalised place_id, TTL 24h
- **Export:** native `Response` for CSV+JSON, SheetJS (`xlsx`) for XLSX
- **Analytics:** Plausible

These are starting positions. The autonomous routine may revisit them in Phase 1 if it finds a real reason.

## SemanticForce — mock-first

We do not have SF credentials yet. To unblock the build:

1. A typed client `lib/semanticforce/client.ts` that reads `process.env.SF_API_KEY` and `process.env.SF_API_BASE`.
2. When `SF_API_KEY` is unset (dev / CI / current state), the client returns fixture data from `mocks/semanticforce/*.json` keyed by an input. Fixtures live in the repo so any contributor or cloud-agent run gets reproducible data.
3. The client's surface area matches a single hypothetical endpoint: `getReviews({placeId, limit?, after?}) → {reviews: Review[], next_cursor?: string, place: PlaceMeta}`. Real schema TBD when creds land — adapt the client then, leave callers untouched.
4. Mock fixtures cover: small business with ~10 reviews, mid-size with ~80, large with ~500 (for paging tests). Reviews include 1-5 stars across the range, multi-language samples, unicode (em dashes, smart quotes — these go into the data so the CSV exporter is properly stress-tested), and a few photo-attachment URLs.

When real creds arrive, swap one config value, leave `mocks/` in place for offline dev.

## Operating constraints

- Daily autonomous run window: **04:00 Europe/Madrid (= 02:00 UTC during CEST, 03:00 UTC during CET).** Spaced one hour after `halflife-nightly` so the two routines don't fight for the same compute window.
- Daily command budget: **≤10 tool/command calls per scheduled run.**
- Weekly external-data budget: **≤ $1 USD/week of `corgi` skill usage** (for keyword research on long-tail variants and for SERP qualification).
- No production deploys, no domain purchases, no API-key commits, no destructive git operations.
- Same wrapper-publishes model as `halflife`: the agent commits and exits; the cloud platform publishes the branch and opens the PR. Direct `git push` and `gh pr create` are 403'd by the proxy.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| SemanticForce schema differs from our guess | Adapter pattern in `lib/semanticforce/`; callers depend on our types, not SF's |
| Google ToS / scraping concerns | Use SemanticForce only — no direct scraping; tool is for business owners and analysts pulling public data |
| API cost runaway when popular | KV cache 24h; rate-limit by IP at the edge; later: free-tier cap at N reviews/month |
| Excel breaks on unicode | CSV writer uses UTF-8 BOM + CRLF + QUOTE_ALL (per project memory: feedback_csv_ascii_for_excel) |
| EMD penalty / thin content | Pair the tool with substantive long-tail pages for variant queries; never doorway-page |
| Domain dispute (Google trademark) | Avoid Google's logo/branding; use neutral "review" iconography; clear "not affiliated with Google" disclaimer |

## Document map

- `PLAN.md` — this file
- `ROADMAP.md` — phased leaf-task breakdown
- `ROUTINE.md` — protocol for each scheduled 04:00 Madrid run
- `DECISIONS.md` — append-only ADRs
- `BLOCKED.md` — created only when a run cannot proceed
- `LEDGER.md` — corgi spend tracker
- `docs/semanticforce-api.md` — current best-guess of the SF API shape we depend on
- `mocks/semanticforce/` — fixture data (small/mid/large business samples)
