# SerpApi — Google reviews data source (TRIAL)

_Status: **ACTIVE — trial data source.** As of 2026-06-08 the project pivoted from a mock-only / SemanticForce-gated posture to using **SerpApi** for real Google reviews data now (see ADR D-084). SemanticForce remains the intended production source later; both live behind the same internal `ReviewsProvider` contract (`lib/semanticforce/types.ts` — `Review`, `PlaceMeta`, `GetReviewsResponse`)._

## Credentials

- Stored in the gitignored `.env.local` (never committed): `REVIEWS_PROVIDER=serpapi`, `SERPAPI_API_KEY` (+ `_1`/`_2`/`_3`).
- Source of truth: `~/Documents/PY/corgi/.env` (`SERPAPI_API_KEY_1..3`).
- Account: `andriy@terentyev.net`. **Free Plan: 250 searches/month per key.** 3 keys ⇒ ~750 searches/month total. Rate limit 250/hour. Rotate keys to stretch the trial quota; cache aggressively (24h KV, keyed by `data_id`).

## Two endpoints we use

SerpApi splits "find the place" from "get its reviews". One review download = **1 maps search (resolve) + N reviews pages** (8 reviews/page).

### 1. Resolve a business name → `data_id`

```
GET https://serpapi.com/search.json?engine=google_maps&type=search&q={business name}&api_key={key}
```

Response: `local_results[]` (or `place_results` for an exact match). Each carries:

| Field | Notes |
|-------|-------|
| `title` | business name |
| `data_id` | e.g. `0x80858098babc2d4b:0xbeedd659cc698c92` — the handle the reviews endpoint needs |
| `rating` | avg star rating (→ `PlaceMeta.rating_avg`) |
| `reviews` | total review count (→ `PlaceMeta.rating_count`) |
| `address`, `type`, `gps_coordinates` | place metadata |

A user-supplied `data_id` (or a Google Maps URL containing one) can skip this step. Fixture: `mocks/serpapi/maps-search.json`.

### 2. Fetch reviews for a `data_id`

```
GET https://serpapi.com/search.json?engine=google_maps_reviews&data_id={data_id}&api_key={key}
# pagination: &next_page_token={token}   (or &num= / &start= per SerpApi docs)
```

Top-level keys: `place_info`, `topics`, `reviews`, `serpapi_pagination`. Fixture: `mocks/serpapi/maps-reviews-page1.json`.

`place_info`: `{ title, address, rating, reviews, type }` → maps to `PlaceMeta`.

`serpapi_pagination`: `{ next, next_page_token }` — pass `next_page_token` back to fetch the next 8 reviews. Loop until the requested `limit` is reached or no token remains.

### Review object shape (real, from the fixture)

```jsonc
{
  "position": 1,
  "link": "https://www.google.com/maps/reviews/...",   // → Review.author_url? no — this is the review permalink
  "rating": 1.0,                                         // float 1..5 → round to int 1..5 for Review.rating
  "date": "5 months ago",                               // human-relative
  "iso_date": "2025-12-25T07:12:42Z",                  // → Review.published_at
  "iso_date_of_last_edit": "2025-12-25T07:13:34Z",
  "images": ["https://lh3.googleusercontent.com/..."],  // → Review.photos[].url
  "source": "Google",
  "review_id": "Ci9DQUlR...",                           // → Review.review_id
  "user": {
    "name": "Utsav Ahuja",                             // → Review.author_name
    "link": "https://www.google.com/maps/contrib/...", // → Review.author_url
    "contributor_id": "111525791018435463126",
    "thumbnail": "https://...",
    "local_guide": true,
    "reviews": 9,
    "photos": 1
  },
  "snippet": "I ordered a seasonal latte...",          // → Review.text
  "extracted_snippet": { "original": "...", "translated": "..." },
  "likes": 3,
  "response": { "date": "...", "iso_date": "...", "snippet": "..." }  // owner reply → Review.owner_response
}
```

## Mapping SerpApi → our internal types (`lib/semanticforce/types.ts`)

| Internal (`Review`) | SerpApi source |
|---------------------|----------------|
| `review_id` | `review.review_id` |
| `author_name` | `review.user.name` |
| `author_url` | `review.user.link` |
| `rating` (1..5 int) | `Math.round(review.rating)` |
| `text` | `review.snippet` (prefer `extracted_snippet.original` if present) |
| `language` | not directly given; optional — leave undefined or infer |
| `published_at` | `review.iso_date` |
| `photos[].url` | `review.images[]` |
| `owner_response` | `review.response` → `{ text: snippet, responded_at: iso_date }` |

| Internal (`PlaceMeta`) | SerpApi source |
|------------------------|----------------|
| `place_id` | the `data_id` (canonicalise via `lib/semanticforce/place-id.ts`) |
| `name` | `place_info.title` |
| `address` | `place_info.address` |
| `rating_avg` | `place_info.rating` |
| `rating_count` | `place_info.reviews` |
| `url` | the maps link |

## Quota discipline

- **Tests use the committed fixtures only — never live calls.**
- Cache every live result in KV keyed by canonical `data_id`, TTL 24h (reuse `lib/cache/reviews-cache.ts`).
- One "download 100 reviews" ≈ 1 resolve + ~13 reviews pages ≈ **14 searches**. At 750/mo that's ~53 full downloads/month on the free trial — fine for dev + demo, the reason SemanticForce is the production plan.
