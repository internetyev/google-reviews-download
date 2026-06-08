# Keyword research — data sources & method

_Run 2026-06-08 via corgi (`/opt/homebrew/bin/corgi-*`) on this machine. Budget authorized: Ahrefs ≤20k units, corgi/DFS ≤$1, real SerpApi OK._

## Data sources actually used

| Source | What | Cost |
|---|---|---|
| DataForSEO Labs (via `corgi-ahrefs --provider dfs --metrics keyword_overview`) | Volume, difficulty, CPC for 24 money + 30 informational keywords | ~$0.02–0.05 (Labs keyword overview; not itemised in `corgi-log costs`) |
| DataForSEO SERP (`corgi-serp --features all`, standard) | Top-10 organic + PAA for 3 head queries | ~$0.002 |
| **Total DFS** | | **< $0.10 of the $1.00 cap** |
| Ahrefs | **BLOCKED this run** — see below | 0 units of the 20k cap |

Raw dumps: `docs/seo/data/dfs-money-overview.json`, `dfs-info-overview.json`, `serp-money.json`.

## ⚠️ Ahrefs blocker (needs your action)

`corgi-ahrefs --provider ahrefs` returns `AUTH_INVALID` on every **data** endpoint (keyword_overview, etc.) while the free `corgi-limits` endpoint returns 200. Root cause is in the limits payload:

```
units_limit_api_key:  10000
units_usage_api_key:  14593   ← over the per-key allocation
remaining_units:     385407   (workspace has plenty; the individual KEY is capped)
```

The workspace has 385k units free, but **this API key is capped at 10,000 units/period and has used 14,593**, so Ahrefs rejects its data calls. To unlock the parent-topic / traffic-potential / clicks data the `/topical-map` method wants:

- In the Ahrefs dashboard → API → raise this key's per-key unit limit above the workspace usage (or issue a fresh key), then re-run the keyword pull with `--provider ahrefs`.

Until then, DFS volumes (exact-match, undercounting) are the basis for scoring. The decisions hold regardless — the cluster is uniformly **KD≈0**, so coverage beats precise volume ranking.

## What the data said (headline)

- Money cluster: head terms `export google reviews` / `download google reviews` ≈ 50/mo each, **KD 0**, CPC $4–$7. Format/surface long-tail: 0–10/mo exact, KD 0, CPC up to $9.88. → low-volume, high-intent, trivially winnable. **Own the whole cluster.**
- Informational: a few higher-volume adjacent terms — `google review management` (1000), `google reviews api` (880, KD 7), `how to get more google reviews` (480), `how to report fake google reviews` (320) — plus many 0-vol on-topic how-tos. → blog covers core how-to + rides the adjacent terms for authority.
- SERP: 3 purpose-built competitors (exportcomments, outscraper, elfsight) + help threads/forums; **no dedicated landing page owns the format-named modifiers** → our L2 gap.
