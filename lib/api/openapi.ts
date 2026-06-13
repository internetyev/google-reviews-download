// OpenAPI 3.1 description of the public HTTP API (L27.6).
//
// Single source of truth for the `/api/reviews` contract — served at
// `/api/openapi` (the API self-describes) and mirrored in human form in
// `docs/api.md`. Kept as a typed object (not a YAML file) so it ships with the
// bundle, needs no parser, and is unit-testable.
//
// The shapes mirror lib/semanticforce/types.ts (Review/PlaceMeta) and the
// envelopes/headers emitted by app/api/reviews/route.ts + middleware.ts.

export const API_VERSION = "1.0.0";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Google Reviews Download API",
    version: API_VERSION,
    description:
      "Download a Google business's reviews as JSON, CSV, or XLSX. Backed by a " +
      "pluggable reviews provider (SerpApi trial → SemanticForce) behind a stable contract.",
  },
  paths: {
    "/api/reviews": {
      get: {
        operationId: "getReviews",
        summary: "Download reviews for a place in JSON, CSV, or XLSX.",
        description:
          "Resolves `placeId` to a canonical id, walks the provider's reviews, " +
          "caches the full walk (24h) and returns the requested format. " +
          "Rate-limited to 10 requests/minute per IP.",
        parameters: [
          {
            name: "placeId",
            in: "query",
            required: true,
            description:
              "A Google Place ID (ChIJ…), legacy data_id (0x…:0x…), a MOCK_* " +
              "fixture id, a Google Maps URL containing one, OR a free-text " +
              "business name (resolved via Google Maps search — serpapi provider only).",
            schema: { type: "string" },
            example: "0x80858098babc2d4b:0xbeedd659cc698c92",
          },
          {
            name: "format",
            in: "query",
            required: false,
            description: "Output format (case-insensitive). Defaults to json.",
            schema: { type: "string", enum: ["json", "csv", "xlsx"], default: "json" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description:
              "Max reviews to return; trims JSON array and file rows. Positive " +
              "integer, capped at 5000. The cache always holds the full walk.",
            schema: { type: "integer", minimum: 1, maximum: 5000 },
          },
        ],
        responses: {
          "200": {
            description:
              "Reviews payload. `X-Cache: HIT|MISS` indicates a cache hit. " +
              "CSV/XLSX carry a `Content-Disposition` attachment filename.",
            headers: {
              "X-Cache": {
                description: "HIT when served from the 24h cache, else MISS.",
                schema: { type: "string", enum: ["HIT", "MISS"] },
              },
              "Content-Disposition": {
                description: "attachment; filename=… (csv/xlsx only).",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReviewsResponse" },
              },
              "text/csv": { schema: { type: "string" } },
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "400": {
            description:
              "bad_request — missing placeId, unsupported format, invalid limit, " +
              "or an unparseable placeId.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "401": {
            description: "unauthorized — provider rejected the credentials.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "404": {
            description: "not_found — no place/reviews for that id.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "429": {
            description:
              "rate_limited — exceeded 10 req/min/IP (middleware) or the upstream " +
              "rate-limited mid-walk. Carries a `Retry-After` (seconds) header.",
            headers: {
              "Retry-After": {
                description: "Seconds to wait before retrying.",
                schema: { type: "integer" },
              },
            },
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "502": {
            description: "upstream_error — the reviews provider failed.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                enum: [
                  "bad_request",
                  "unauthorized",
                  "not_found",
                  "rate_limited",
                  "upstream_error",
                  "unknown",
                ],
              },
              message: { type: "string" },
            },
          },
        },
      },
      PlaceMeta: {
        type: "object",
        required: ["place_id", "name", "rating_avg", "rating_count"],
        properties: {
          place_id: { type: "string" },
          name: { type: "string" },
          address: { type: "string" },
          rating_avg: { type: "number" },
          rating_count: { type: "integer" },
          url: { type: "string" },
        },
      },
      Review: {
        type: "object",
        required: ["review_id", "author_name", "rating", "text", "published_at"],
        properties: {
          review_id: { type: "string" },
          author_name: { type: "string" },
          author_url: { type: "string" },
          rating: { type: "integer", minimum: 1, maximum: 5 },
          text: { type: "string" },
          language: { type: "string" },
          published_at: { type: "string", format: "date-time" },
          photos: {
            type: "array",
            items: {
              type: "object",
              required: ["url"],
              properties: {
                url: { type: "string" },
                width: { type: "integer" },
                height: { type: "integer" },
              },
            },
          },
          owner_response: {
            type: "object",
            required: ["text", "responded_at"],
            properties: {
              text: { type: "string" },
              responded_at: { type: "string", format: "date-time" },
            },
          },
        },
      },
      ReviewsResponse: {
        type: "object",
        required: ["place", "reviews", "fetched_at"],
        properties: {
          place: { $ref: "#/components/schemas/PlaceMeta" },
          reviews: { type: "array", items: { $ref: "#/components/schemas/Review" } },
          fetched_at: { type: "string", format: "date-time" },
          truncated: {
            type: "boolean",
            description: "Present and true when the walk hit the 5000-review hard cap.",
          },
        },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
