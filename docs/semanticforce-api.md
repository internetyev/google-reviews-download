# SemanticForce API — current best-guess contract

_Status: **MOCK-FIRST**. We do not have real credentials yet. This document is the contract our code depends on; when real creds arrive (Phase 4, L4.1) we adapt the client internally to match SF's actual schema and leave callers untouched._

## Auth

- Header: `Authorization: Bearer ${SF_API_KEY}`
- Base URL: `${SF_API_BASE}` (e.g. `https://api.semanticforce.net/v1` — placeholder)

If `SF_API_KEY` is unset, the client returns **fixture data** from `mocks/semanticforce/*.json` instead of making a network call.

## Endpoint we depend on

```
GET /reviews?place_id={id}&limit={n}&after={cursor}
```

### Query parameters

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `place_id` | string | yes | Google Place ID. May also accept a business name with a separate `near` param — TBD when real creds land. |
| `limit` | int | no | 1..100, default 50. |
| `after` | string | no | Pagination cursor returned by a previous call. |

### Response (200 OK)

```json
{
  "place": {
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "name": "Joe's Coffee",
    "address": "123 Main St, Anytown",
    "rating_avg": 4.6,
    "rating_count": 248,
    "url": "https://maps.google.com/?cid=12345"
  },
  "reviews": [
    {
      "review_id": "AbcDef123",
      "author_name": "Maria S.",
      "author_url": "https://maps.google.com/contrib/...",
      "rating": 5,
      "text": "Best flat white in town.",
      "language": "en",
      "published_at": "2026-04-15T09:42:00Z",
      "photos": [
        { "url": "https://...", "width": 1024, "height": 768 }
      ],
      "owner_response": {
        "text": "Thanks Maria!",
        "responded_at": "2026-04-15T11:02:00Z"
      }
    }
  ],
  "next_cursor": "eyJvZmZzZXQiOjUwfQ=="
}
```

### Error envelope (4xx / 5xx)

```json
{ "error": { "code": "rate_limited", "message": "..." } }
```

## Our typed surface (`lib/semanticforce/types.ts`)

```ts
export type PlaceMeta = {
  place_id: string;
  name: string;
  address?: string;
  rating_avg: number;
  rating_count: number;
  url?: string;
};

export type Review = {
  review_id: string;
  author_name: string;
  author_url?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  language?: string;
  published_at: string;            // ISO 8601 UTC
  photos?: { url: string; width?: number; height?: number }[];
  owner_response?: { text: string; responded_at: string };
};

export type GetReviewsResponse = {
  place: PlaceMeta;
  reviews: Review[];
  next_cursor?: string;
};

export interface SemanticForceClient {
  getReviews(args: { placeId: string; limit?: number; after?: string }): Promise<GetReviewsResponse>;
}
```

## Cache key

`reviews:${normalised_place_id}` — TTL 24h in Vercel KV. Pagination is **not** cached separately; we always cache the full assembled list per `place_id` (caller in `app/api/reviews/route.ts` walks `next_cursor` and stores the joined array).

## Open questions (resolve in L4.1)

- Does SF accept business name + locality as a fallback to `place_id`? If yes, expose `getReviews({name, locality})` overload.
- What is SF's rate-limit signalling — header, body field, both?
- Does SF expose owner-response timestamps reliably, or do we need a separate endpoint?
- What is the maximum `limit`? Current guess: 100.

These do not block Phase 1–3 work because the client is mocked.
