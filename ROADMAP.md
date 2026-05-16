# google-reviews-download — Roadmap

_Last updated: 2026-05-16_ (Phase 6 — Hardening & quality — added (D-042): every standard Phase 0–5 leaf is now done except corgi/human-gated ones (L1.6b, L3.1b, L4.1, L5.1, L5.2), so this run opened an agent-doable hardening phase rather than idling. L6.1 lands the first automated tests: a `vitest` harness (`vitest.config.ts` with the tsconfig `@/*` alias mirrored, `node` env, `tests/**/*.test.ts`), `test`/`test:watch` scripts + `vitest` devDep in `package.json`, and regression suites `tests/place-id.test.ts` + `tests/export-csv.test.ts` exercising the existing `__testing` hooks on the two purest, highest-stakes modules — Place-ID canonicalisation (cache-key/filename integrity) and the CSV Excel contract (BOM/CRLF/QUOTE_ALL, the `feedback_csv_ascii_for_excel` memory). Tests are committed but not executed in-routine: repo is manifest-only/no `node_modules` and `npm install` is a human step (same posture as D-039/D-040); they run on `npm install && npm test`. Earlier history follows. — L2.5 result preview rebuilt cleanly off `main` (old PR #20 was CONFLICTING/closed): new server route `app/preview/page.tsx` fetches the first 5 reviews via the SF client server-side, shows place meta + `rating_count` total + per-format download CTA, and `robots: noindex`; shared `app/_components/review-tool-form.tsx` rewired from `target=_blank` raw `/api/reviews` to a same-tab `/preview` GET (`format` carried as preferred-download); stale "ships in L2.5" placeholder removed from `app/page.tsx` and the variant route; preview skips KV walk + L2.8 rate-limit by design (D-041). L3.2b lands JSON-LD `FAQPage` on variant pages via shared `app/_components/faq.tsx` — paired rich-JSX/plain-text FAQ used by both home and variant pages so visible copy and structured data can't drift; home page refactored onto it with no content change. L3.1 split into L3.1a — agent-half variant-page infrastructure: `lib/seo/variants.ts` 10-candidate registry with `published` flag, shared `app/_components/review-tool-form.tsx` extracted from the home page, dynamic `app/(seo)/[variant]/page.tsx` with `dynamicParams = false`, sitemap enumerates published variants; all `published: false` so everything is inert/404 until L3.1b — and L3.1b — corgi-gated, flips top-5 to published after the L1.6b volume pass; L2.8 edge rate-limit middleware landed via consolidated rebuild; L4.2 adds `app/api/healthcheck/route.ts` — edge route that pings SF via the shared client with `MOCK_SMALL_001`/`limit:1`, reports `status` (ok/degraded/down), `mode` (fixture/live, inferred from `SF_API_KEY`), and `latency_ms`; 200 when ok, 503 otherwise, `Cache-Control: no-store`; mock-safe so it runs before the human-gated L4.1; L5.4 lands `docs/outreach-plan.md` — per-channel community outreach plan for after launch: Sterling Sky Local Search Forum, r/bigseo, LocalU, r/SEO, r/smallbusiness, Traffic Think Tank, AgencyAnalytics Slack, Search Engine Roundtable, Twitter/X, LinkedIn groups; pre-flight gates on L5.2 deploy + L2.8 rate-limit + L2.10 analytics + L4.1 real creds; one channel per weekday cadence with UTM tagging for Plausible attribution; explicit skip list (BHW, Warrior Forum, FB groups); L3.3 FAQ on `app/page.tsx` — three `<details>` items — unblocks FAQ-content half of L3.2b; L5.3 launch posts in `docs/launch-posts.md`; L3.2 split into L3.2a — robots.ts + sitemap.ts for root — and L3.2b — JSON-LD `FAQPage` deferred until L3.1; L2.10 Plausible snippet env-gated; L2.9 launch-checklist landed; L2.5 has PR #20 with a merge conflict needing human rebase; L1.6b deferred for local corgi pass)

Leaf-task granularity. Each leaf should fit in **one scheduled run (≤10 commands)**. The routine picks the next unchecked leaf top-down. Mark `[x]` when merged, `[~]` when draft PR open awaiting review, `[!]` when blocked.

---

## Phase 0 — Planning bundle (Sprint 0)

- [x] L0.1 Write `PLAN.md`, `ROADMAP.md`, `ROUTINE.md`, `DECISIONS.md`, `LEDGER.md`
- [x] L0.2 Bootstrap commit on `main` (no PR — empty repo)
- [x] L0.3 Mirror to Obsidian `GOOGLE-REVIEWS-DOWNLOAD/`
- [x] L0.4 Write `docs/semanticforce-api.md` stub + `mocks/semanticforce/` fixture skeleton
- [x] L0.5 Schedule the 04:00 Madrid autonomous routine

## Phase 1 — Foundation (Sprint 1, ~5 daily runs)

- [x] L1.1 Add `package.json` with Next.js 15 + TS + Tailwind + shadcn/ui + `xlsx` (manifest only — no install)
- [x] L1.2 Add `.gitignore`, `.env.example` (lists `SF_API_KEY`, `SF_API_BASE`, `KV_*`), `tsconfig.json`, base `next.config.ts`
- [x] L1.3 Flesh out `mocks/semanticforce/`: small (10 reviews), mid (80), large (500). Include unicode, multi-language, varying star distributions, photo URLs.
- [x] L1.4 Implement `lib/semanticforce/client.ts` with the type interface and a fixture-fallback when `SF_API_KEY` is unset. Add `lib/semanticforce/types.ts` with `Review`, `PlaceMeta`, `GetReviewsResponse`.
- [x] L1.5 Write `docs/methodology.md` — how `place_id` is normalised (slug + raw), how pagination is handled, how cache keys are constructed, how rate-limiting is enforced
- [x] L1.6a Long-tail seed (agent half): write `docs/seo-variants.md` with ~10 candidate variants grouped by intent + per-variant rationale, **no volumes**. Volumes are L1.6b.
- [ ] L1.6b Long-tail seed (corgi half): run `corgi keywords ...` locally on the L1.6a variants and paste volume + competition columns back into `docs/seo-variants.md`. **(deferred: needs local corgi pass — human-gated, real-cash spend tracked in LEDGER.md.)**
- [x] L1.7 Write `DECISIONS.md` ADRs for stack, mock-first contract, export-format defaults

## Phase 2 — Core MVP (Sprint 2, ~6 daily runs)

- [x] L2.1 Scaffold Next.js app skeleton (commit code only; no install)
- [x] L2.2 Implement `app/api/reviews/route.ts` calling the SF client; query params: `placeId`, `format` (csv/json/xlsx), `limit?`
- [x] L2.3 Implement KV cache layer keyed by normalised `place_id`, 24h TTL
- [x] L2.4 Build the input form `app/page.tsx` — single field, format toggle, download button
- [x] L2.5 Build the result preview component (first 5 reviews + total count + download CTA) — rebuilt cleanly off `main` as server route `app/preview/page.tsx`; form rewired paste→preview→download; old conflicted PR #20 superseded
- [x] L2.6 Implement CSV writer in `lib/export/csv.ts` — UTF-8 BOM, CRLF, QUOTE_ALL (per `feedback_csv_ascii_for_excel`)
- [x] L2.7 Implement XLSX writer in `lib/export/xlsx.ts` using `xlsx`; one row per review, frozen header, sensible column widths
- [x] L2.8 Add edge rate-limit middleware (token-bucket per IP, e.g. 10 req/min)
- [x] L2.9 Write `docs/launch-checklist.md` for human sign-off before deploy
- [x] L2.10 Add Plausible analytics snippet (env-gated)

## Phase 3 — SEO surface (Sprint 3, ~3 daily runs)

- [x] L3.1a Build the SEO variant-page infrastructure (agent half, content-agnostic): `lib/seo/variants.ts` registry of all 10 L1.6a candidates with a `published` flag, shared `app/_components/review-tool-form.tsx` (extracted from `app/page.tsx` so home + variant pages share one tool), dynamic `app/(seo)/[variant]/page.tsx` (`dynamicParams = false`, custom intro above the fold, shared tool below), and `app/sitemap.ts` enumerating published variants. All variants `published: false` → routes 404 and sitemap unchanged until L3.1b.
- [ ] L3.1b (depends on L1.6b) Flip the corgi-picked top-5 variants to `published: true` in `lib/seo/variants.ts` (score `volume × (1 - competition)` from the L1.6b pass, manual override allowed for uniquely-weak SERPs). **(deferred: needs local corgi pass — gated behind L1.6b.)**
- [x] L3.2a Add `app/robots.ts` and `app/sitemap.ts` (root route only; variant routes get added in L3.1; `NEXT_PUBLIC_SITE_URL` env var with fallback)
- [x] L3.2b Add JSON-LD `FAQPage` schema on each variant page (shared `app/_components/faq.tsx`: `FAQ_ITEMS` with paired rich-JSX `a` + plain-text `text`, `FaqSection`, `faqJsonLd()`; home page refactored onto it with no content change; variant page emits `<script type="application/ld+json">` + visible `<FaqSection />` so markup matches on-page content).
- [x] L3.3 Add a "How it works" + "Is this allowed by Google?" FAQ to `app/page.tsx`

## Phase 4 — Real-creds integration (Sprint 4, ~2 daily runs — gated)

- [ ] L4.1 (**human-gated**, requires real SF creds) Update `client.ts` to call the live SF API; verify against fixtures; document any schema deltas
- [x] L4.2 Add a `/api/healthcheck` route that pings SF with a known place and reports latency

## Phase 5 — Launch prep (Sprint 5)

- [ ] L5.1 Naming + domain decision (target candidates: `googlereviewsdownload.com`, `.co`, `.app` — **human-gated** purchase)
- [ ] L5.2 Deploy to Vercel (**human-gated**, needs SF + KV creds)
- [x] L5.3 Draft launch posts in `docs/launch-posts.md` (ProductHunt, IndieHackers, LinkedIn)
- [x] L5.4 Outreach plan to local-SEO communities

## Phase 6 — Hardening & quality (agent-doable, no creds/deploys)

_Added because Phase 0–5 agent work is exhausted; only corgi/human-gated leaves remain. These need no SF creds, no deploy, no real-cash corgi — pure regression/quality work the routine can land cleanly._

- [x] L6.1 Add a `vitest` test harness (manifest + `vitest.config.ts` with the tsconfig `@/*` alias, `node` env) and the first regression suites for the two purest, highest-stakes modules: `tests/place-id.test.ts` (canonicalisation rules that decide cache keys/filenames, incl. D-018 short-link rejection + host-before-pattern precedence) and `tests/export-csv.test.ts` (the Excel BOM/CRLF/QUOTE_ALL contract + unicode survival + `csvFilename` data-vintage). Both drive the already-present `__testing` hooks. Committed, not run in-routine (no `node_modules`; `npm install` is a human step — D-039/D-040 posture).
- [ ] L6.2 Add `tests/export-xlsx.test.ts` (worksheet shape, one row/review, frozen header `ySplit:1`, column widths) and `tests/reviews-cache.test.ts` (`cacheKey` prefix, `MemoryCache` TTL expiry via injected `now`, `KvRestCache` pipeline body shape with a stub `fetchImpl`).
- [ ] L6.3 Add `tests/sf-client.test.ts` (fixture fallback when `SF_API_KEY` unset; `limit`/`after` paging against the committed mocks) and `tests/seo-variants.test.ts` (registry invariants: unique slugs, `publishedVariants()` ⊆ registry, every published variant has the fields the route renders).
- [ ] L6.4 Add a `.github/workflows/ci.yml` running `npm ci && npm run typecheck && npm run lint && npm test` on PRs to `main` (does not block the `claude/*` auto-merge workflow — informational status; human can later make it required).
- [ ] L6.5 Add `tests/api-reviews.test.ts` — param-validation contract for `app/api/reviews/route.ts` (bad `format` → 400 `bad_request` envelope, missing `placeId` → 400, valid → correct `Content-Type`/`Content-Disposition`), exercised via a direct route-handler import with a `Request`.

---

## Out-of-scope parking lot

- Multi-place batch export
- Sentiment analysis / summarisation
- Browser extension
- Competitor monitoring
- White-label embed
