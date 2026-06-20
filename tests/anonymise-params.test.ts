// Coverage for the anonymisation query-param parser (Phase 36, L36.2):
// `parseAnonymiseOptions(URLSearchParams) -> AnonymiseOptions`, the shared
// single source of truth (de-drift, L28.2/D-095) that both /api/reviews and
// (L36.3) the web preview use to turn redaction params into the pure layer's
// options bag. The load-bearing contracts a consumer depends on:
//   - absent/blank/unrecognised → `{}` (identity: no redaction);
//   - each granular flag (`mask_author`/`drop_author_url`/`drop_photos`) sets
//     exactly its one option, and only when explicitly truthy;
//   - the `anonymize` umbrella (and its `anonymise` alias) turns on all three;
//   - umbrella + granular OR together;
//   - only truthy tokens (1/true/yes) count — never a 400, never accidental
//     redaction from a blank value (the web form's "off" checkbox sends nothing).

import { describe, it, expect } from "vitest";
import { parseAnonymiseOptions } from "@/lib/reviews/anonymise-params";

function parse(query: string) {
  return parseAnonymiseOptions(new URLSearchParams(query));
}

describe("parseAnonymiseOptions — identity (no redaction)", () => {
  it("returns {} for an empty query", () => {
    expect(parse("")).toEqual({});
  });

  it("returns {} for blank flag values (web form 'off')", () => {
    expect(parse("anonymize=&mask_author=&drop_photos=")).toEqual({});
  });

  it("returns {} for non-truthy tokens (0/false/no/garbage)", () => {
    expect(parse("anonymize=0")).toEqual({});
    expect(parse("mask_author=false")).toEqual({});
    expect(parse("drop_photos=no")).toEqual({});
    expect(parse("drop_author_url=banana")).toEqual({});
  });
});

describe("parseAnonymiseOptions — granular flags", () => {
  it("mask_author sets only maskAuthorName", () => {
    expect(parse("mask_author=1")).toEqual({ maskAuthorName: true });
  });

  it("drop_author_url sets only dropAuthorUrl", () => {
    expect(parse("drop_author_url=true")).toEqual({ dropAuthorUrl: true });
  });

  it("drop_photos sets only dropPhotos", () => {
    expect(parse("drop_photos=yes")).toEqual({ dropPhotos: true });
  });

  it("combines two granular flags without enabling the third", () => {
    expect(parse("mask_author=1&drop_photos=1")).toEqual({
      maskAuthorName: true,
      dropPhotos: true,
    });
  });

  it("accepts truthy tokens case-insensitively with surrounding space", () => {
    expect(parse("mask_author=%20YES%20")).toEqual({ maskAuthorName: true });
  });
});

describe("parseAnonymiseOptions — umbrella", () => {
  it("anonymize=1 turns on all three redactions", () => {
    expect(parse("anonymize=1")).toEqual({
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
  });

  it("accepts the `anonymise` (en-GB) alias", () => {
    expect(parse("anonymise=true")).toEqual({
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
  });

  it("ORs with granular flags (already-all-on stays all-on)", () => {
    expect(parse("anonymize=1&mask_author=1")).toEqual({
      maskAuthorName: true,
      dropAuthorUrl: true,
      dropPhotos: true,
    });
  });
});
