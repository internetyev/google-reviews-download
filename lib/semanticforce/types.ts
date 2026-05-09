export type PlaceMeta = {
  place_id: string;
  name: string;
  address?: string;
  rating_avg: number;
  rating_count: number;
  url?: string;
};

export type ReviewPhoto = {
  url: string;
  width?: number;
  height?: number;
};

export type OwnerResponse = {
  text: string;
  responded_at: string;
};

export type Review = {
  review_id: string;
  author_name: string;
  author_url?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  language?: string;
  published_at: string;
  photos?: ReviewPhoto[];
  owner_response?: OwnerResponse;
};

export type GetReviewsArgs = {
  placeId: string;
  limit?: number;
  after?: string;
};

export type GetReviewsResponse = {
  place: PlaceMeta;
  reviews: Review[];
  next_cursor?: string;
};

export type SemanticForceErrorCode =
  | "rate_limited"
  | "not_found"
  | "unauthorized"
  | "bad_request"
  | "upstream_error"
  | "unknown";

export class SemanticForceError extends Error {
  readonly code: SemanticForceErrorCode;
  readonly status?: number;

  constructor(code: SemanticForceErrorCode, message: string, status?: number) {
    super(message);
    this.name = "SemanticForceError";
    this.code = code;
    this.status = status;
  }
}

export interface SemanticForceClient {
  getReviews(args: GetReviewsArgs): Promise<GetReviewsResponse>;
}
