# google-reviews-download

Give it a Google business — by **name**, **Place ID**, `data_id`, or Maps URL — and
get that business's reviews back as **JSON**, **CSV**, or **XLSX**. The same data is
reachable three ways:

1. **Web tool** — paste a business into the form, pick a format, download.
2. **HTTP API** — `GET /api/reviews?placeId=…&format=…`.
3. **MCP server** — the `download_google_reviews` tool for Claude Desktop / Claude Code.

All three share one provider layer and one set of exporters, so they return identical
data. The data source is pluggable via `REVIEWS_PROVIDER` (`serpapi` trial →
`semanticforce` production → `mock` offline) behind a stable contract — the response
shape never changes when the provider does.

---

## Quickstart

> Installs are a human step (the autonomous routine never runs `npm install`). Run these
> yourself once to work locally.

```bash
npm install
cp .env.example .env.local   # then set REVIEWS_PROVIDER + keys (see "Providers")
npm test                     # offline; runs against committed fixtures
```

With `REVIEWS_PROVIDER` unset or `mock`, every surface serves the offline fixtures — so
you can try all three below with **zero API quota spend**.

### 1. Web tool

```bash
npm run dev          # http://localhost:3000
```

Open the page, paste a business name or Place ID, choose JSON / CSV / XLSX, download.

### 2. HTTP API

```bash
# JSON, first 50 reviews (by Place ID)
curl "http://localhost:3000/api/reviews?placeId=ChIJ…&limit=50"

# By free-text business name (serpapi provider only)
curl "http://localhost:3000/api/reviews?placeId=Blue%20Bottle%20Coffee%20SF"

# CSV / XLSX downloads (-OJ honours the attachment filename)
curl -OJ "http://localhost:3000/api/reviews?placeId=ChIJ…&format=csv"
curl -OJ "http://localhost:3000/api/reviews?placeId=ChIJ…&format=xlsx&limit=200"

# The machine-readable contract
curl "http://localhost:3000/api/openapi"
```

Errors share one envelope — `{ "error": { "code", "message" } }` — and the route is
rate-limited to 10 req/min per IP (`429` + `Retry-After`). Full reference, headers, and
error table: [`docs/api.md`](docs/api.md).

### 3. MCP server

```bash
# Try it offline (mock provider, no quota)
npx -y tsx mcp/bin.ts

# Wire into Claude Code from the project root:
claude mcp add google-reviews-download -- npx -y tsx mcp/bin.ts
```

Then ask Claude to *"download the Google reviews for &lt;business&gt; as CSV"*. The tool
is `download_google_reviews(place, format?, limit?)`; `xlsx` comes back as a base64
resource block. Claude Desktop config + the full arg table: [`mcp/README.md`](mcp/README.md).

---

## Providers

Set in `.env.local` (gitignored; copy from [`.env.example`](.env.example)). The active
source is selected by `REVIEWS_PROVIDER`:

| `REVIEWS_PROVIDER` | Source | Credentials | Notes |
|--------------------|--------|-------------|-------|
| unset / `mock`     | Committed fixtures | none | Offline. Default for tests and demos. |
| `serpapi`          | SerpApi Google Maps | `SERPAPI_API_KEY` (or `_1`/`_2`/`_3`) | The current **trial** source. Free tier ≈ 250 searches/mo per key; the client rotates 1–3 keys (~750/mo). Name resolution and review pages both spend quota, so results are cached 24h. |
| `semanticforce`    | SemanticForce | `SF_API_KEY` (human-gated, L4.1) | The intended **production** source; swapped in later with no contract change. |

The provider boundary is `lib/semanticforce/types.ts` (`Review`, `PlaceMeta`); the SerpApi
client lives in `lib/serpapi/`. See [`docs/serpapi-reviews.md`](docs/serpapi-reviews.md)
for the captured upstream schema and [`docs/semanticforce-api.md`](docs/semanticforce-api.md)
for the production contract. The 24h review cache uses Vercel KV when linked, else a
process-local map (see `.env.example`).

---

## How it's built

EMD project targeting "google reviews download" + long-tail variants, built by an
autonomous Claude Code routine (see [`ROUTINE.md`](ROUTINE.md)). Next.js 15 · TypeScript ·
Tailwind · SheetJS (XLSX) · Vercel + KV.

- **What & why:** [`PLAN.md`](PLAN.md)
- **Roadmap:** [`ROADMAP.md`](ROADMAP.md)
- **Decisions (ADR log):** [`DECISIONS.md`](DECISIONS.md)
- **Spend ledger:** [`LEDGER.md`](LEDGER.md)
- **HTTP API reference:** [`docs/api.md`](docs/api.md)
- **MCP server:** [`mcp/README.md`](mcp/README.md)
- **SerpApi schema:** [`docs/serpapi-reviews.md`](docs/serpapi-reviews.md)
- **SemanticForce contract:** [`docs/semanticforce-api.md`](docs/semanticforce-api.md)
- **Mock fixtures:** [`mocks/serpapi/`](mocks/serpapi/) · [`mocks/semanticforce/`](mocks/semanticforce/)
</content>
