# Deploy guide (config only — the deploy click is human-gated)

This documents how to deploy the three surfaces (web tool · HTTP API · MCP
server). The **actual deploy is human-gated** (L5.2): the routine prepares config
and this manifest; a human links the data/KV creds and clicks deploy. `vercel.json`
sets `git.deploymentEnabled.main = false` so a push to `main` never auto-deploys —
the human triggers each deploy intentionally.

## Target

**Vercel** (Next.js 15 App Router with API routes + edge middleware). The web
tool and HTTP API deploy as one Next app; the **MCP server runs separately** as a
local stdio process (`mcp/bin.ts`, see `mcp/README.md`) — it is not part of the
web deploy. (Cloudflare Pages is viable too via `@cloudflare/next-on-pages`, but
the route runtimes and KV bindings below are written for Vercel; switching is a
follow-up, not part of this config.)

## Environment variable manifest

Set these in the Vercel project (Settings → Environment Variables), or locally in
`.env.local` (gitignored). Template: [`.env.example`](../.env.example).

| Variable | Required? | Set by | Purpose |
|----------|-----------|--------|---------|
| `REVIEWS_PROVIDER` | Recommended | human | `serpapi` \| `semanticforce` \| `mock`. Unset → `mock` (offline fixtures). Prod trial = `serpapi`. |
| `SERPAPI_API_KEY` (+ `_1`/`_2`/`_3`) | If `serpapi` | human | SerpApi keys; the client rotates them (250/mo each). At least one required when the provider is `serpapi`. |
| `SF_API_KEY` | If `semanticforce` | human (Phase 4) | SemanticForce key. Leave blank until the production swap. |
| `SF_API_BASE` | If `semanticforce` | human | SemanticForce API base URL. |
| `KV_REST_API_URL` | Recommended for prod | `vercel env pull` | Vercel KV REST endpoint — the 24h review cache. |
| `KV_REST_API_TOKEN` | Recommended for prod | `vercel env pull` | Vercel KV REST token. |
| `NEXT_PUBLIC_SITE_URL` | Recommended | human | Deployed origin, no trailing slash. Drives `robots.txt` + `sitemap.xml`. Falls back to `https://googlereviewsdownload.com`. |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Optional | human | Enables the Plausible analytics snippet when set. |

**Provider × creds matrix**

| `REVIEWS_PROVIDER` | Needs | Behaviour |
|--------------------|-------|-----------|
| unset / `mock` | nothing | Serves committed fixtures — safe default, zero quota. |
| `serpapi` | ≥1 `SERPAPI_API_KEY*` | Live SerpApi (trial). Without a key the client throws `unauthorized`. |
| `semanticforce` | `SF_API_KEY` + `SF_API_BASE` | Live SemanticForce (intended production). |

**Quota note:** with `serpapi`, the 24h KV cache is what protects the ~750/mo
trial quota — link a KV store before sending real traffic, or repeat downloads
will burn searches. The preview path is cached separately (D-089).

## Runtime notes

- Edge routes: `app/api/healthcheck`, `app/api/openapi`, and the rate-limit
  middleware (`middleware.ts`, scoped to `/api/reviews`).
- `app/api/reviews` runs on the Node runtime (it streams CSV/XLSX bytes).
- The 10 req/min/IP rate limit is in-process (token bucket); for multi-instance
  prod, a shared limiter (KV-backed) is a future hardening item.

## Pre-deploy checklist (config level)

The full human sign-off lives in [`launch-checklist.md`](launch-checklist.md).
Config-level items this leaf covers:

- [ ] `.env.example` lists every variable the code reads (provider, SerpApi, SF, KV, site, analytics). ✔ (this leaf)
- [ ] `vercel.json` present; `main` auto-deploy disabled. ✔ (this leaf)
- [ ] `REVIEWS_PROVIDER` chosen for the environment, and its required creds set.
- [ ] KV store linked (`vercel env pull`) so the cache is cross-instance.
- [ ] `NEXT_PUBLIC_SITE_URL` set to the real origin so `robots`/`sitemap` are correct.
- [ ] `npx tsc --noEmit` and `npx vitest run` green on the launch machine.
- [ ] (human) `npm run build` succeeds; review bundle sizes.
- [ ] (human) Smoke `/api/healthcheck` and `/api/openapi` on the preview deploy.

## Human-gated steps (not done by the routine)

1. Pick + buy the domain (L5.1).
2. Create the Vercel project, set env vars above, link a KV store.
3. Add the SerpApi keys (or SemanticForce creds for production).
4. Trigger the deploy; verify the web form, a real `/api/reviews` download, and
   the MCP server (`mcp/README.md`).
