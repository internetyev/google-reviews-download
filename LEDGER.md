# Spend Ledger — google-reviews-download

External-data spend (corgi-cli, ad-hoc API calls). Append-only. The routine checks the last 7 days of entries against the $1.00 cap before any corgi call.

| Date | Run id | Tool | USD | Reason |
|------|--------|------|-----|--------|
| 2026-04-28 | setup | — | 0.00 | Bootstrap commit, no external data calls |
| 2026-05-11 | L1.6b-partial | corgi-serp | 0.0006 | Head-term SERP probe on `google reviews download` (depth=10). Volume data still TBD — no Ahrefs creds for `corgi-keywords`. Findings merged into `docs/seo-variants.md` as a competitive-landscape section. Per-variant SERP pass deferred. |
