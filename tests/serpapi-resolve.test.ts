// Coverage for lib/serpapi/resolve.ts (L27.2) — name → data_id resolution.
//   1. classifyInput routes identifiers vs free-text names vs unparseable URLs.
//   2. pickBestPlace maps a google_maps search response → { dataId, PlaceMeta }.
//   3. resolvePlaceName / resolveToDataId drive the search through an injected
//      fetchImpl against the committed fixture — NO live calls.

import { describe, it, expect } from "vitest";
import mapsSearch from "@/mocks/serpapi/maps-search.json";
import {
  classifyInput,
  pickBestPlace,
  resolvePlaceName,
  resolveToDataId,
} from "@/lib/serpapi/resolve";
import { SemanticForceError } from "@/lib/semanticforce/types";

const EXPECTED_DATA_ID = "0x80858098babc2d4b:0xbeedd659cc698c92";

function jsonOk(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("classifyInput", () => {
  it("treats a 0x…:0x… data_id as an identifier (no search needed)", () => {
    const r = classifyInput(EXPECTED_DATA_ID);
    expect(r).toMatchObject({ kind: "place_id", dataId: EXPECTED_DATA_ID });
  });

  it("treats a ChIJ Place ID as an identifier", () => {
    const id = "ChIJN1t_tDeuEmsRUsoyG83frY4";
    const r = classifyInput(id);
    expect(r.kind).toBe("place_id");
  });

  it("extracts an identifier from a long Google Maps URL", () => {
    const url = `https://www.google.com/maps/place/Blue+Bottle/data=!4m7!3m6!1s${EXPECTED_DATA_ID}!8m2`;
    const r = classifyInput(url);
    expect(r).toMatchObject({ kind: "place_id", dataId: EXPECTED_DATA_ID });
  });

  it("treats free text as a business name to resolve", () => {
    const r = classifyInput("Blue Bottle Coffee San Francisco");
    expect(r).toEqual({ kind: "name", query: "Blue Bottle Coffee San Francisco" });
  });

  it("collapses internal whitespace in a name query", () => {
    const r = classifyInput("  Blue   Bottle\tCoffee \n");
    expect(r).toEqual({ kind: "name", query: "Blue Bottle Coffee" });
  });

  it("rejects a URL it cannot extract an id from (rather than searching it)", () => {
    expect(() => classifyInput("https://maps.app.goo.gl/abc123")).toThrow(
      SemanticForceError,
    );
  });

  it("rejects empty input", () => {
    expect(() => classifyInput("   ")).toThrow(SemanticForceError);
  });
});

describe("pickBestPlace", () => {
  it("maps the first local_results candidate to { dataId, PlaceMeta }", () => {
    const best = pickBestPlace(mapsSearch as never);
    expect(best).not.toBeNull();
    expect(best!.dataId).toBe(EXPECTED_DATA_ID);
    expect(best!.place.place_id).toBe(EXPECTED_DATA_ID);
    expect(best!.place.name).toBe("Blue Bottle Coffee");
    expect(best!.place.rating_avg).toBe(4.6);
    expect(best!.place.rating_count).toBe(891);
    expect(best!.place.address).toBe("315 Linden St, San Francisco, CA 94102");
  });

  it("prefers an exact place_results hit over local_results", () => {
    const best = pickBestPlace({
      place_results: { title: "Exact", data_id: "0xaaaa:0xbbbb", rating: 5, reviews: 3 },
      local_results: [{ title: "Other", data_id: "0xcccc:0xdddd" }],
    } as never);
    expect(best!.dataId).toBe("0xaaaa:0xbbbb");
    expect(best!.place.name).toBe("Exact");
  });

  it("skips candidates without a data_id", () => {
    const best = pickBestPlace({
      local_results: [{ title: "no id" }, { title: "has id", data_id: "0x1:0x2" }],
    } as never);
    expect(best!.dataId).toBe("0x1:0x2");
  });

  it("returns null when there is nothing usable", () => {
    expect(pickBestPlace({ local_results: [] } as never)).toBeNull();
    expect(pickBestPlace({} as never)).toBeNull();
  });
});

describe("resolvePlaceName", () => {
  it("resolves a name to a data_id via the search fixture", async () => {
    const out = await resolvePlaceName("Blue Bottle Coffee", {
      apiKeys: ["k1"],
      fetchImpl: jsonOk(mapsSearch),
    });
    expect(out.dataId).toBe(EXPECTED_DATA_ID);
    expect(out.place.name).toBe("Blue Bottle Coffee");
  });

  it("sends engine=google_maps&type=search&q=<name> with an api_key", async () => {
    let seen: URL | undefined;
    const fetchImpl = (async (url: URL) => {
      seen = new URL(url);
      return new Response(JSON.stringify(mapsSearch), { status: 200 });
    }) as unknown as typeof fetch;
    await resolvePlaceName("Blue Bottle", { apiKeys: ["k1"], fetchImpl });
    expect(seen!.searchParams.get("engine")).toBe("google_maps");
    expect(seen!.searchParams.get("type")).toBe("search");
    expect(seen!.searchParams.get("q")).toBe("Blue Bottle");
    expect(seen!.searchParams.get("api_key")).toBe("k1");
  });

  it("throws not_found when the search yields no place", async () => {
    await expect(
      resolvePlaceName("nonexistent zzz", {
        apiKeys: ["k1"],
        fetchImpl: jsonOk({ local_results: [] }),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("throws unauthorized when no keys are configured", async () => {
    await expect(
      resolvePlaceName("x", { apiKeys: [], fetchImpl: jsonOk(mapsSearch) }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("resolveToDataId", () => {
  it("skips the search call for an identifier (no fetch invoked)", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const out = await resolveToDataId(EXPECTED_DATA_ID, { apiKeys: ["k1"], fetchImpl });
    expect(out.dataId).toBe(EXPECTED_DATA_ID);
    expect(out.place).toBeUndefined();
    expect(called).toBe(false);
  });

  it("performs a search for a free-text name", async () => {
    const out = await resolveToDataId("Blue Bottle Coffee", {
      apiKeys: ["k1"],
      fetchImpl: jsonOk(mapsSearch),
    });
    expect(out.dataId).toBe(EXPECTED_DATA_ID);
    expect(out.place?.name).toBe("Blue Bottle Coffee");
  });
});
