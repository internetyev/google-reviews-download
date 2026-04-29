# google-reviews-download — Roadmap

_Last updated: 2026-04-28_

Leaf-task granularity. Each leaf should fit in **one scheduled run (≤10 commands)**. The routine picks the next unchecked leaf top-down. Mark `[x]` when merged, `[~]` when draft PR open awaiting review, `[!]` when blocked.

---

## Phase 0 — Planning bundle (Sprint 0)

- [x] L0.1 Write `PLAN.md`, `ROADMAP.md`, `ROUTINE.md`, `DECISIONS.md`, `LEDGER.md`
- [x] L0.2 Bootstrap commit on `main` (no PR — empty repo)
- [x] L0.3 Mirror to Obsidian `GOOGLE-REVIEWS-DOWNLOAD/`
- [x] L0.4 Write `docs/semanticforce-api.md` stub + `mocks/semanticforce/` fixture skeleton
- [x] L0.5 Schedule the 04:00 Madrid autonomous routine

## Phase 1 — Foundation (Sprint 1, ~5 daily runs)

- [ ] L1.1 Add `package.json` with Next.js 15 + TS + Tailwind + shadcn/ui + `xlsx` (manifest only — no install)
- [ ] L1.2 Add `.gitignore`, `.env.example` (lists `SF_API_KEY`, `SF_API_BASE`, `KV_*`), `tsconfig.json`, base `next.config.ts`
- [ ] L1.3 Flesh out `mocks/semanticforce/`: small (10 reviews), mid (80), large (500). Include unicode, multi-language, varying star distributions, photo URLs.
- [ ] L1.4 Implement `lib/semanticforce/client.ts` with the type interface and a fixture-fallback when `SF_API_KEY` is unset. Add `lib/semanticforce/types.ts` with `Review`, `PlaceMeta`, `GetReviewsResponse`.
- [ ] L1.5 Write `docs/methodology.md` — how `place_id` is normalised (slug + raw), how pagination is handled, how cache keys are constructed, how rate-limiting is enforced
- [ ] L1.6 Long-tail seed: list ~10 candidate variants in `docs/seo-variants.md`. (deferred: needs local corgi pass for keyword volumes — agent commits the candidate list, Andrei runs corgi locally to add volumes)
- [ ] L1.7 Write `DECISIONS.md` ADRs for stack, mock-first contract, export-format defaults

## Phase 2 — Core MVP (Sprint 2, ~6 daily runs)

- [ ] L2.1 Scaffold Next.js app skeleton (commit code only; no install)
- [ ] L2.2 Implement `app/api/reviews/route.ts` calling the SF client; query params: `placeId`, `format` (csv/json/xlsx), `limit?`
- [ ] L2.3 Implement KV cache layer keyed by normalised `place_id`, 24h TTL
- [ ] L2.4 Build the input form `app/page.tsx` — single field, format toggle, download button
- [ ] L2.5 Build the result preview component (first 5 reviews + total count + download CTA)
- [ ] L2.6 Implement CSV writer in `lib/export/csv.ts` — UTF-8 BOM, CRLF, QUOTE_ALL (per `feedback_csv_ascii_for_excel`)
- [ ] L2.7 Implement XLSX writer in `lib/export/xlsx.ts` using `xlsx`; one row per review, frozen header, sensible column widths
- [ ] L2.8 Add edge rate-limit middleware (token-bucket per IP, e.g. 10 req/min)
- [ ] L2.9 Write `docs/launch-checklist.md` for human sign-off before deploy
- [ ] L2.10 Add Plausible analytics snippet (env-gated)

## Phase 3 — SEO surface (Sprint 3, ~3 daily runs)

- [ ] L3.1 (depends on L1.6) Pick top 5 long-tail variants from `seo-variants.md` and create `app/(seo)/<slug>/page.tsx` for each — same tool below the fold, custom intro/explainer above
- [ ] L3.2 Add sitemap.xml, robots.txt, JSON-LD `FAQPage` schema on each variant page
- [ ] L3.3 Add a "How it works" + "Is this allowed by Google?" FAQ to `app/page.tsx`

## Phase 4 — Real-creds integration (Sprint 4, ~2 daily runs — gated)

- [ ] L4.1 (**human-gated**, requires real SF creds) Update `client.ts` to call the live SF API; verify against fixtures; document any schema deltas
- [ ] L4.2 Add a `/api/healthcheck` route that pings SF with a known place and reports latency

## Phase 5 — Launch prep (Sprint 5)

- [ ] L5.1 Naming + domain decision (target candidates: `googlereviewsdownload.com`, `.co`, `.app` — **human-gated** purchase)
- [ ] L5.2 Deploy to Vercel (**human-gated**, needs SF + KV creds)
- [ ] L5.3 Draft launch posts in `docs/launch-posts.md` (ProductHunt, IndieHackers, LinkedIn)
- [ ] L5.4 Outreach plan to local-SEO communities

---

## Out-of-scope parking lot

- Multi-place batch export
- Sentiment analysis / summarisation
- Browser extension
- Competitor monitoring
- White-label embed
