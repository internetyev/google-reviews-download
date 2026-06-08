# Launch Checklist — google-reviews-download

_Status: human sign-off gate before clicking deploy. The autonomous routine cannot tick these boxes (no creds, no deploys, no domains). This is the human's read-through immediately before Phase 5 (L5.1 / L5.2) and again after each deploy that crosses a meaningful boundary (real-creds flip, domain swap, KV provider change)._

The checklist is grouped by gate. **A gate is not green until every item in it is checked.** If a gate cannot be cleared, do not move to the next — open an issue or write `BLOCKED.md` and stop.

Items tagged **(routine)** are validated by the autonomous routine's PRs in passing; they are listed here so the human has one place to look. Items tagged **(human)** can only be done by the human and are the load-bearing ones.

---

## Gate A — Code is ready to deploy

- [ ] (routine) `ROADMAP.md` Phase 2 leaves L2.1–L2.10 are `[x]`, or each `[ ]` is explicitly justified as post-launch.
- [ ] (routine) `DECISIONS.md` is current; no `(deferred)` ADR blocks the launch path.
- [ ] (human) `npm install` runs cleanly on the launch machine; `package-lock.json` is committed.
- [ ] (human) `npx tsc --noEmit` passes — no type errors.
- [ ] (human) `npm run lint` passes (`next lint` against the legacy ESLint config per D-024).
- [ ] (human) `npm run build` succeeds locally. Note the bundle sizes Next prints for `app/api/reviews` and `app/page`.
- [ ] (human) `npm run dev` smoke: paste a `MOCK_*` Place ID into `app/page.tsx`, confirm JSON downloads, CSV opens in Excel without an import wizard prompt, XLSX opens with the tuned column widths. (Note: the header row is **not** frozen — SheetJS 0.18.5 CE doesn't serialize freeze panes; the writer requests it for a future upgrade. See D-096.) Try all three fixtures (small / mid / large).
- [ ] (human) Unicode spot-check: at least one reviewed CSV row contains em-dashes, smart quotes, and a non-Latin script (CJK or Cyrillic) and renders correctly in Excel-on-Windows. This is the entire reason for BOM+CRLF+QUOTE_ALL (ADR-003); if it breaks, do not deploy.
- [ ] (human) `middleware.ts` rate-limit smoke: hit `/api/reviews?placeId=MOCK_SMALL_001` 12 times in a row from `curl` — the 11th and 12th responses return `429` with `Retry-After: 6` and the `{error:{code:"rate_limited"}}` envelope from D-035.

## Gate B — SemanticForce creds (Phase 4 / L4.1)

Skip this entire gate if launching against fixtures (no real Phase 4 sign-off). In that case explicitly note "**Launching in fixture mode**" in the deploy commit message and set `SF_API_KEY` unset on Vercel — the client falls back to the bundled JSON per ADR-002.

- [ ] (human) `SF_API_KEY` is set on Vercel (Production environment only — not Preview).
- [ ] (human) `SF_API_BASE` is set if SF's real base URL differs from the `https://api.semanticforce.net` default in `.env.example` (D-013).
- [ ] (human) L4.1 has run: a real Place ID returns a payload that the existing `lib/semanticforce/types.ts` parses without throwing. Any schema delta is documented in `docs/semanticforce-api.md` (per ADR-002 — types are our contract, not theirs).
- [ ] (human) Error-path spot check: a deliberately-bad Place ID surfaces `not_found` (not `unknown`); a deliberately-malformed query surfaces `bad_request`. Both render through the UI without leaking SF's raw error envelope.
- [ ] (human) Cost ceiling: estimate per-place SF cost × expected first-week traffic. If > $5/week of upstream cost is plausible, tighten the rate-limit (`middleware.ts` `LIMIT` constant) or drop the 24h cache TTL **before** going live — not after.

## Gate C — Vercel project + KV

- [ ] (human) Vercel project created, linked to the GitHub repo, **Production branch = `main`**.
- [ ] (human) Default region picked (Fra1 / cdg1 for EU consultants — primary audience per PLAN.md). Document the choice in the deploy commit body so a future reader can find it.
- [ ] (human) Vercel KV provisioned and linked to the project. The four `KV_REST_API_*` envs (`URL`, `TOKEN`, `READ_ONLY_TOKEN`, plus the legacy `KV_URL`) appear in Vercel's Environment Variables panel. Per D-029 the cache reads these directly via `fetch`; if they are unset the app degrades to an in-memory `Map` and the launch is silently uncached — verify before announcing.
- [ ] (human) `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` set to the launch domain. If Plausible is not yet configured, set it blank (the L2.10 snippet is env-gated and a blank value renders nothing).
- [ ] (human) Preview deployment for the launch PR loads, renders the form, and completes one end-to-end fixture download.
- [ ] (human) Production deployment promotes cleanly. The first hit to `/api/reviews?placeId=...` returns `X-Cache: MISS`; the second within the TTL returns `X-Cache: HIT` (D-031).

## Gate D — Domain + DNS (L5.1)

- [ ] (human) Domain decided and purchased. Candidates from L5.1: `googlereviewsdownload.com`, `.co`, `.app`. Note the choice and the registrar in the deploy commit body.
- [ ] (human) DNS pointed at Vercel per their dashboard instructions. `dig <domain> A` returns Vercel IPs.
- [ ] (human) `www.<domain>` → apex redirect configured (one canonical host).
- [ ] (human) HTTPS certificate provisioned automatically by Vercel and `https://<domain>` loads without a warning.
- [ ] (human) "Not affiliated with Google" disclaimer is visible in the footer of the production site (risk row in PLAN.md — domain dispute mitigation).

## Gate E — Post-deploy smoke + monitoring

- [ ] (human) Production smoke: paste a **real** Place ID (your own business, or a friendly SMB). All three formats download. Open the CSV in Excel-on-Windows. Open the XLSX. Eyeball at least one multi-language row.
- [ ] (human) Rate-limit smoke from production: 12 rapid requests to `/api/reviews` from one IP return the expected `429` on the 11th/12th. Confirms the in-memory bucket survives the Vercel deploy correctly (D-035 / methodology §4).
- [ ] (human) Plausible dashboard shows the smoke test page-view + the `/api/reviews` hit (or the configured custom event). If empty after 10 min, the env var is wrong or the snippet did not render.
- [ ] (human) `Retry-After` and `X-Cache` headers visible in browser DevTools on the real request — these are the only observability surface in v1, do not deploy without confirming them.
- [ ] (human) `LEDGER.md` updated with the first week of real SF cost (post-launch — write this entry within 7 days of deploy).

## Gate F — Rollback path is real

- [ ] (human) Identify the last-known-good Vercel deployment in the dashboard. Confirm you can promote it back to production in one click. Practice it once on a Preview before launch day.
- [ ] (human) If a regression ships, rollback **first**, write the post-mortem **second**. The whole MVP is a single page + one API route; there is no reason to debug a broken prod with users watching.
- [ ] (human) `BLOCKED.md` template (per ROUTINE.md §6) is the right place to leave a note for the next routine run if a rollback is in effect. The routine will see it and not push more code until the human resolves.

## Gate G — Launch comms (L5.3, L5.4)

These belong to Phase 5 proper, not to the deploy gate, but list them here so they are not forgotten in the deploy adrenaline.

- [ ] (human) Draft posts ready in `docs/launch-posts.md` for ProductHunt / IndieHackers / LinkedIn.
- [ ] (human) Outreach list ready per L5.4 (local-SEO communities; r/SEO, r/bigseo, indie SEO Slack/Discords).
- [ ] (human) Site survives a deliberate 10× burst before any post goes live (one human running `for i in {1..200}; do curl -s ... ; done` is enough — we are not load-testing for scale, we are confirming the rate-limiter does not 500).

---

## Sign-off

When every applicable gate is green, record the sign-off below in this file (commit it as part of the launch PR):

```
Launched: <YYYY-MM-DD>
Deployer: <name>
Vercel deployment id: <id>
Domain: <chosen>
Mode: fixture | real-creds
Notes: <one paragraph — anything a future maintainer should know about this launch>
```

Past launches stay below this line for history. The checklist itself is reusable for every subsequent deploy that crosses a gate boundary; minor patch deploys do not need a full re-run, only the relevant gate.
