// Coverage for the L27.6 OpenAPI contract (lib/api/openapi.ts) + the route that
// serves it (app/api/openapi/route.ts). The spec is the public contract, so the
// load-bearing checks are: it documents the real params/formats the route
// accepts, the real error codes the route emits, and the route serves it as
// cacheable JSON. The format/error-code lists are cross-checked against the
// route's own __testing exports so the doc can't silently drift from the code.

import { describe, it, expect } from "vitest";
import { openApiSpec, API_VERSION } from "@/lib/api/openapi";
import { GET as openapiGET } from "@/app/api/openapi/route";
import { __testing as routeTesting } from "@/app/api/reviews/route";

describe("openApiSpec", () => {
  const op = openApiSpec.paths["/api/reviews"].get;

  it("is OpenAPI 3.1 with a version", () => {
    expect(openApiSpec.openapi).toBe("3.1.0");
    expect(openApiSpec.info.version).toBe(API_VERSION);
  });

  it("documents the three query params the route reads", () => {
    const names = op.parameters.map((p) => p.name);
    expect(names).toEqual(["placeId", "format", "limit"]);
    const placeId = op.parameters.find((p) => p.name === "placeId");
    expect(placeId?.required).toBe(true);
  });

  it("documents exactly the formats the route supports", () => {
    const formatParam = op.parameters.find((p) => p.name === "format");
    const documented = [...(formatParam?.schema.enum ?? [])].sort();
    const supported = [...routeTesting.SUPPORTED_FORMATS].sort();
    expect(documented).toEqual(supported);
  });

  it("caps documented limit at the route's HARD_CAP_REVIEWS", () => {
    const limitParam = op.parameters.find((p) => p.name === "limit");
    expect(limitParam?.schema.maximum).toBe(routeTesting.HARD_CAP_REVIEWS);
  });

  it("documents 200 plus every error status the route can return", () => {
    const codes = Object.keys(op.responses);
    for (const expected of ["200", "400", "401", "404", "429", "502"]) {
      expect(codes).toContain(expected);
    }
  });

  it("defines an Error envelope matching { error: { code, message } }", () => {
    const err = openApiSpec.components.schemas.Error;
    expect(err.properties.error.required).toEqual(["code", "message"]);
    const codes = err.properties.error.properties.code.enum;
    for (const c of ["bad_request", "unauthorized", "not_found", "rate_limited"]) {
      expect(codes).toContain(c);
    }
  });

  it("the 429 response documents a Retry-After header", () => {
    expect(op.responses["429"].headers).toHaveProperty("Retry-After");
  });
});

describe("GET /api/openapi", () => {
  it("serves the spec as cacheable JSON", async () => {
    const res = await openapiGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age");
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths["/api/reviews"]).toBeTruthy();
  });
});
