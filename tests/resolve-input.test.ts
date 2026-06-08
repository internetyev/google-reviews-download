// Coverage for the shared id-or-name resolver (lib/reviews/resolve-input.ts,
// L28.2) used by BOTH /api/reviews and the web preview. Offline — the name
// resolver is injected. The contract: parseable ids bypass resolution; names
// resolve only on the serpapi provider (else PlaceIdParseError); upstream
// resolver errors propagate as-is.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveInputToNormalised,
  inputNameSlug,
} from "@/lib/reviews/resolve-input";
import { PlaceIdParseError } from "@/lib/semanticforce/place-id";
import { SemanticForceError } from "@/lib/semanticforce/types";

const REAL_DATA_ID = "0x80858098babc2d4b:0xbeedd659cc698c92";

describe("inputNameSlug", () => {
  it("normalises case, whitespace, and punctuation", () => {
    expect(inputNameSlug("  Blue Bottle Coffee!! ")).toBe("blue-bottle-coffee");
    expect(inputNameSlug("Joe's Café — Downtown")).toBe("joe-s-caf-downtown");
  });
});

describe("resolveInputToNormalised", () => {
  let savedKv: string | undefined;
  beforeEach(() => {
    savedKv = process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_URL; // memory cache, deterministic
  });
  afterEach(() => {
    if (savedKv === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = savedKv;
  });

  it("normalises a parseable id WITHOUT calling the resolver", async () => {
    let called = false;
    const out = await resolveInputToNormalised(REAL_DATA_ID, {
      providerName: "serpapi",
      resolve: async () => {
        called = true;
        return { dataId: "x" };
      },
    });
    expect(out.raw).toBe(REAL_DATA_ID);
    expect(called).toBe(false);
  });

  it("resolves a business name on the serpapi provider", async () => {
    const out = await resolveInputToNormalised("Blue Bottle Coffee", {
      providerName: "serpapi",
      resolve: async (input) => {
        expect(input).toBe("Blue Bottle Coffee");
        return { dataId: REAL_DATA_ID };
      },
    });
    // normalisePlaceId lowercases the 0x data_id → canonical raw
    expect(out.raw).toBe(REAL_DATA_ID);
  });

  it("throws PlaceIdParseError for a name when the provider is not serpapi", async () => {
    let called = false;
    await expect(
      resolveInputToNormalised("Some Business", {
        providerName: "mock",
        resolve: async () => {
          called = true;
          return { dataId: REAL_DATA_ID };
        },
      }),
    ).rejects.toBeInstanceOf(PlaceIdParseError);
    expect(called).toBe(false); // gate runs before any resolver call
  });

  it("propagates a resolver SemanticForceError (e.g. not_found)", async () => {
    await expect(
      resolveInputToNormalised("zzz nonexistent", {
        providerName: "serpapi",
        resolve: async () => {
          throw new SemanticForceError("not_found", "No place found");
        },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
