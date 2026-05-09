# Decisions Log — google-reviews-download

Append-only ADR-style log. One line per decision unless rationale is non-obvious.

## 2026-04-28

- **D-001** Project = EMD targeting "google reviews download" + variants. Cloned the operational setup of `halflife` (planning bundle, scheduled-routine, wrapper-publishes model, corgi $1/wk cap, Obsidian mirror).
- **D-002** SemanticForce is the only data source. No direct scraping. Mock-first: when `SF_API_KEY` is unset, the client returns fixture data from `mocks/semanticforce/*.json`. Real creds arrive via a human-gated Phase 4 leaf.
- **D-003** SF client surface area is **our** typed contract (`lib/semanticforce/types.ts`), not SF's. When the real schema lands, we adapt internally; callers and exporters never change.
- **D-004** Stack starting position: Next.js 15 App Router + TS + Tailwind + shadcn/ui on Vercel; Vercel KV for cache; SheetJS (`xlsx`) for XLSX export. Re-evaluatable in Phase 1.
- **D-005** CSV defaults: UTF-8 with BOM, CRLF, QUOTE_ALL (per project-memory `feedback_csv_ascii_for_excel`). XLSX gets unicode natively.
- **D-006** Daily autonomous routine, ≤10 commands/run, 04:00 Europe/Madrid (one hour after `halflife-nightly`), wrapper-publishes (no `git push` / `gh pr create` from the agent). Routine forbidden from running installs, deploying, buying domains, or sending external messages.
- **D-007** Cache strategy: Vercel KV keyed by normalised `place_id`, 24h TTL. Reviews are slow-changing; 24h amortises cost without staleness pain.

## 2026-05-09

- **D-008** Tailwind **v3.4** (not v4) for the manifest baseline. Rationale: shadcn/ui's component generators and most third-party Tailwind ecosystem snippets still assume v3 syntax; we can revisit v4 once shadcn's v4 path is the default. `tailwindcss-animate` is included because shadcn components reference it.
- **D-009** `xlsx` pinned to `^0.18.5` from the npm registry rather than the SheetJS CDN tarball (`https://cdn.sheetjs.com/...`). Rationale: keeps `package.json` registry-only and lockfile-friendly for now; the npm 0.18.5 build is sufficient for our writer (one row per review, frozen header, column widths). If a future SheetJS feature is needed we'll switch to the CDN tarball at that point — the import surface (`import * as XLSX from 'xlsx'`) is identical either way.
- **D-010** React 19 + Next.js 15 (App Router) confirmed in the manifest. Node engine `>=20.11` to match Next 15's minimum.
