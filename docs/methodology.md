# Methodology — google-reviews-download

_Status: design contract for Phase 1–3. Implementation lands incrementally (place-id normalisation in `lib/semanticforce/place-id.ts` at L2.2, pagination in `app/api/reviews/route.ts` at L2.2, KV caching in `lib/cache/reviews-cache.ts` at L2.3, rate-limiting at L2.8). When this doc disagrees with the code, the code is wrong._

The four contracts below are the interfaces the rest of the system depends on. They are written here so a leaf in Sprint 2 (cache, rate limit, pagination walker) does not have to re-derive them from scratch — and so a future maintainer can tell at a glance whether a change is a refactor or a contract break.

## 1. `place_id` normalisation

**Input the user can give us:**

- A raw Google Place ID — typically `ChIJ…` (27 chars), occasionally `EhJ…` / `GhIJ…` / `0x…:0x…` legacy variants, or a `MOCK_*` fixture id during dev.
- A `https://maps.google.com/...` URL containing `cid=…`, `ftid=…`, or `data=…!4m…!1s<place_id>`.
- A `https://maps.app.goo.gl/...` short link (we do **not** resolve these in v1; we surface "paste the long URL or the Place ID instead" in the UI — resolving short links would require a network round-trip per submit, which we are not paying for at MVP).
- A free-text business name (Phase 4 / L4.1, gated on confirming SF accepts a `name + locality` fallback).

**Normalisation pipeline (`lib/semanticforce/place-id.ts`, lands with L2.2):**

```
raw input
  → trim + collapse internal whitespace
  → if URL: extract place_id token (regex: ChIJ[\w-]{20,}|0x[0-9a-f]+:0x[0-9a-f]+|MOCK_[A-Z0-9_]+)
  → uppercase the prefix (chij → ChIJ); preserve the body verbatim (Google's IDs are case-sensitive after the prefix)
  → reject anything that does not match the regex above with a 400 + "could not extract a Place ID from that input"
  → output: { raw, slug }
     - raw  = the canonical Place ID we send to SemanticForce
     - slug = lowercase + non-alphanumeric → "-" + collapse repeats + trim "-"
              (used in URLs, cache keys, and filenames; ChIJ ids round-trip cleanly because they are already [A-Za-z0-9_-])
```

The `slug` exists so we can have stable, URL-safe keys without breaking on Google's mixed-case IDs. We keep `raw` because SF's API is case-sensitive on the body of the ID and we do not want a normalised slug to silently mismatch on the upstream side.

We do **not** geocode, do **not** call Google Maps to validate, and do **not** try to "guess" a Place ID from a business name in v1. The single supported failure mode is "could not extract a Place ID" → 400 with a one-line hint.

## 2. Pagination

SF returns one `next_cursor` per page. The cursor is **opaque** to us in HTTP mode — we never inspect it, base64-decode it, or carry state across requests. In fixture mode the cursor encodes `{offset:N}` as base64 JSON (see D-015) so the fixture client can slice the in-memory array; this is an implementation detail of the fixture path and callers must not rely on it.

**Walker (in `app/api/reviews/route.ts`, L2.2):**

```
acc = []
cursor = undefined
do
  page = client.getReviews({ placeId, limit: 100, after: cursor })
  acc.push(...page.reviews)
  cursor = page.next_cursor
  if acc.length >= HARD_CAP_REVIEWS or pages_walked >= HARD_CAP_PAGES then break
while cursor
```

- `limit` is always sent as `100` (the documented max) when walking — the per-request `limit` query param the user can send only caps the **final** response length, not the per-page fetch size. Walking with `limit: 100` minimises round-trips.
- `HARD_CAP_REVIEWS = 5_000` and `HARD_CAP_PAGES = 50` are belt-and-braces against a runaway upstream (or a busted cursor that loops). If we hit either cap we return what we have plus a `truncated: true` field on the API response; the UI surfaces this. Five thousand is well above the largest real Google Place we have observed (sub-2k) and twenty-five times our largest fixture; if we ever legitimately hit it we will revisit.
- We do **not** parallelise pages. SF is the rate-limiting dimension, not our compute. Sequential walking gives us trivially correct ordering and respects upstream backpressure.
- If `client.getReviews` throws `SemanticForceError("rate_limited")` mid-walk we surface a 429 with the already-collected reviews as `partial: Review[]` and a `retry_after_s` hint when SF supplies one.

## 3. Cache keys

**Key shape:** `gr:reviews:v1:<slug>` in Vercel KV, where `<slug>` is the normalised slug from §1. Examples:

```
gr:reviews:v1:chijn1t-tdeuemsrusoyg83fry4
gr:reviews:v1:mock-large-001
```

**Key parts, why each is there:**

- `gr:` — namespace prefix so KV stays sharable with other small projects on the same account if it ever comes to that.
- `reviews:` — sub-namespace; future "place metadata only" or "summary" caches get sibling sub-namespaces, never collide.
- `v1:` — schema version. Bump to `v2:` if we change the cached payload shape; old keys will then expire on their own TTL rather than serve stale-shape data into a new code path. This is cheaper than writing a migration and avoids a flag-day deploy.
- `<slug>` — the normalised slug, never the raw mixed-case ID. Two users pasting the same Place ID with different surrounding URL noise hit the same cache entry.

**Value:** the full assembled payload from the pagination walker — `{ place, reviews, fetched_at, truncated? }` — JSON-stringified. We do **not** cache per-page slices; the API response shape the UI consumes is the assembled list, so caching at the assembled level keeps cache code in one spot and means a cache hit is one KV read with no post-processing.

**TTL:** 24 hours (D-007). Reviews are slow-changing; SMB owners pulling a backup do not need sub-day freshness. A force-refresh button is **not** in scope for v1 — pulling 24h after the last fetch is the only escape hatch. If real-world feedback proves this wrong we add `?refresh=1` later; we are not pre-building it.

**What is NOT cached:**

- Errors. A `rate_limited` or `upstream_error` is never written to KV — we want the next request to retry against SF, not return the stale failure.
- Partial walks (`truncated: true` due to mid-walk rate-limit). Same reason: the next request should try again, not inherit a partial result.
- The per-format export bytes. CSV/JSON/XLSX are derived from the cached `reviews` array on every request; the formats are cheap to render and caching three variants per place would triple our KV footprint for no measurable latency win.

## 4. Rate limiting

**Where it lives:** an edge middleware (`middleware.ts`, L2.8) that runs in front of `app/api/reviews/route.ts`. The static SEO pages and the home page are not rate-limited — those are static / cached at the edge and have no upstream cost.

**Algorithm:** in-memory token bucket per (IP, route). 10 tokens, refill 10/min (i.e. one token every 6s, burst of 10). Implementation is a `Map<string, { tokens: number; updated_at: number }>`; entries older than 10 minutes are evicted on the next read for the same key.

This is intentionally simple. We are not running KV-backed distributed rate-limiting in v1 because:

1. Vercel's edge runtime gives us per-region in-memory state that survives across requests in the same region/instance — good enough for a single-purpose tool that has not had a viral moment yet.
2. A KV-backed limiter is one round-trip per request; that doubles our hot-path latency for a problem we do not yet have.
3. When abuse appears we swap the in-memory bucket for a KV-backed `INCR` + TTL pattern at the same interface — that is a one-leaf change in Sprint 2 if needed, not an architectural pivot.

**Limits:**

| Route | Limit | Rationale |
|-------|-------|-----------|
| `POST/GET /api/reviews` | 10/min/IP, burst 10 | One submit ≈ one walked place; 10 distinct places per minute is well above any honest user, well below a scrape attempt. |
| Everything else | not rate-limited at the app layer | Static and cached; Vercel's platform-level DDoS protection is sufficient. |

**Identity:** the bucket key is `${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.ip ?? "unknown"}:${route}`. We use the leftmost X-Forwarded-For entry (the original client) and fall back to the framework-provided IP. We do **not** use cookies or signed tokens for identity at MVP — there are no accounts.

**On limit exceeded:** return `429` with `Retry-After: 6` (one token's worth) and a JSON body `{ "error": { "code": "rate_limited", "message": "Too many requests. Try again in a few seconds." } }` — the same envelope shape `SemanticForceError` produces, so the UI handles upstream-rate-limited and our-rate-limited identically.

**Anti-bypass:** none beyond IP. We are not playing the cat-and-mouse game at this scale. If a determined scraper rotates IPs we accept the cost (which is real money — see LEDGER + the SF cache); the response is "tighten the limit, raise the cache hit rate," not "build a fingerprinting layer."

## Out of scope for this doc

Re-derive in a future doc when the question becomes concrete:

- Per-account quotas / pricing tiers (no accounts in v1)
- Webhook-driven cache invalidation (we do not have webhook signal from SF; 24h TTL is the escape hatch)
- Multi-region cache pinning (single Vercel region is fine until it isn't)
- A second data source as a fallback when SF is down (single-vendor risk accepted at MVP; D-002)
