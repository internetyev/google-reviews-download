# HTTP API — `/api/reviews`

Download a Google business's reviews as **JSON**, **CSV**, or **XLSX**. This is
delivery surface #2 of three (web tool · HTTP API · MCP server). The data source
is pluggable (`REVIEWS_PROVIDER`: SerpApi trial → SemanticForce) behind a stable
contract, so the response shape never changes when the provider does.

A machine-readable **OpenAPI 3.1** description of everything below is served at
[`/api/openapi`](/api/openapi) (and lives in `lib/api/openapi.ts`).

---

## `GET /api/reviews`

### Query parameters

| Param     | Required | Default | Notes |
|-----------|----------|---------|-------|
| `placeId` | yes      | —       | A Google Place ID (`ChIJ…`), legacy `data_id` (`0x…:0x…`), a `MOCK_*` fixture id, a Google Maps URL containing one, **or a free-text business name**. Short `maps.app.goo.gl` links are rejected — paste the long URL or the id. ¹ |
| `format`  | no       | `json`  | One of `json` \| `csv` \| `xlsx` (case-insensitive). |
| `limit`   | no       | all     | Positive integer, capped at **5000**. Trims the JSON array and the CSV/XLSX rows. The 24h cache always holds the full walk, so a later larger `limit` is served from cache. |

¹ A free-text **business name** is resolved to a `data_id` via Google Maps
search (`lib/serpapi/resolve.ts`, `engine=google_maps`) — **serpapi provider
only** (other providers return `400` for a name). The name→`data_id` mapping is
cached (24h) so a repeat name lookup doesn't spend another search.

### Success — `200`

**`format=json`** → `application/json`:

```jsonc
{
  "place": {
    "place_id": "0x80858098babc2d4b:0xbeedd659cc698c92",
    "name": "Blue Bottle Coffee",
    "address": "315 Linden St, San Francisco, CA 94102",
    "rating_avg": 4.6,
    "rating_count": 891
  },
  "reviews": [
    {
      "review_id": "Ci9DQUlR…",
      "author_name": "Utsav Ahuja",
      "author_url": "https://www.google.com/maps/contrib/…",
      "rating": 1,
      "text": "I ordered a seasonal latte…",
      "published_at": "2025-12-25T07:12:42Z",
      "photos": [{ "url": "https://lh3.googleusercontent.com/…" }]
    }
  ],
  "fetched_at": "2026-06-08T01:48:39.000Z",
  "truncated": true            // present only if the 5000-review hard cap was hit
}
```

**`format=csv`** → `text/csv; charset=utf-8`, Excel-safe (UTF-8 BOM, CRLF,
all fields quoted). **`format=xlsx`** → an `.xlsx` workbook (one row per review,
frozen header).

Response headers:

| Header                | When        | Value |
|-----------------------|-------------|-------|
| `X-Cache`             | always      | `HIT` (served from the 24h cache) or `MISS`. |
| `Content-Disposition` | csv / xlsx  | `attachment; filename="google-reviews-<slug>-<YYYYMMDD>.<ext>"` |

### Error envelope — `4xx` / `5xx`

Every error is JSON of the same shape:

```json
{ "error": { "code": "bad_request", "message": "Missing required query param: placeId" } }
```

| Status | `code`           | Cause |
|--------|------------------|-------|
| 400    | `bad_request`    | Missing `placeId`, unsupported `format`, invalid `limit`, or unparseable `placeId`. |
| 401    | `unauthorized`   | Provider rejected the credentials. |
| 404    | `not_found`      | No place / reviews for that id. |
| 429    | `rate_limited`   | Exceeded the rate limit, or upstream rate-limited mid-walk. Carries `Retry-After`. |
| 502    | `upstream_error` | The reviews provider failed. |
| 500    | `unknown`        | Unexpected error. |

### Rate limiting

A token-bucket edge middleware fronts `/api/reviews`: **10 requests/minute per
IP** (burst 10). On exceed it returns **`429`** with **`Retry-After: 6`**. The IP
is taken from `x-forwarded-for` (leftmost) → `x-real-ip` → `"unknown"`.

---

## Examples

```bash
# JSON, first 50 reviews
curl "https://<host>/api/reviews?placeId=0x80858098babc2d4b:0xbeedd659cc698c92&limit=50"

# CSV download
curl -OJ "https://<host>/api/reviews?placeId=ChIJ…&format=csv"

# XLSX download
curl -OJ "https://<host>/api/reviews?placeId=ChIJ…&format=xlsx&limit=200"

# The contract itself
curl "https://<host>/api/openapi"
```
