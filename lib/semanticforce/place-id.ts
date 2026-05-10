// Place-ID normalisation per docs/methodology.md §1.
//
// Accepts: a raw Google Place ID (ChIJ…), legacy 0x…:0x… hex pair,
// MOCK_* fixture id, or a Google Maps URL containing one of those tokens.
// Rejects: anything else (including maps.app.goo.gl short links — D-018).
//
// Output: { raw, slug }
//   raw  = canonical case-sensitive ID we send to SemanticForce
//   slug = lowercase URL-safe key for cache keys, share URLs, filenames

export type NormalisedPlaceId = {
  raw: string;
  slug: string;
};

export class PlaceIdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceIdParseError";
  }
}

const PLACE_ID_PATTERN =
  /(ChIJ[\w-]{20,}|0x[0-9a-fA-F]+:0x[0-9a-fA-F]+|MOCK_[A-Z0-9_]+)/i;

const SHORT_LINK_HOSTS = ["maps.app.goo.gl", "goo.gl"];

export function normalisePlaceId(input: unknown): NormalisedPlaceId {
  if (typeof input !== "string") {
    throw new PlaceIdParseError("place_id must be a string");
  }

  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new PlaceIdParseError("place_id is empty");
  }

  if (SHORT_LINK_HOSTS.some((h) => trimmed.includes(h))) {
    throw new PlaceIdParseError(
      "Short Google Maps links (maps.app.goo.gl) are not supported — paste the long URL or the Place ID instead.",
    );
  }

  const match = trimmed.match(PLACE_ID_PATTERN);
  if (!match) {
    throw new PlaceIdParseError(
      "could not extract a Place ID from that input",
    );
  }

  const raw = canonicalisePrefix(match[1]);
  const slug = slugify(raw);
  return { raw, slug };
}

function canonicalisePrefix(token: string): string {
  if (/^chij/i.test(token)) {
    return "ChIJ" + token.slice(4);
  }
  if (/^0x/i.test(token)) {
    return token.toLowerCase();
  }
  if (/^mock_/i.test(token)) {
    return token.toUpperCase();
  }
  return token;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const __testing = {
  PLACE_ID_PATTERN,
  canonicalisePrefix,
  slugify,
};
