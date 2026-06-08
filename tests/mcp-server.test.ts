// Coverage for the L27.7 MCP server core (lib/mcp/server.ts). All offline —
// the tool's provider/resolver are injected. Three things matter and a silent
// break in any is a real bug: the JSON-RPC dispatch (initialize/list/call/
// unknown/notification), the tool's format handling (json/csv/xlsx + errors),
// and that the data flowing out is the SAME provider data the other surfaces use.

import { describe, it, expect } from "vitest";
import reviewsPage1 from "@/mocks/serpapi/maps-reviews-page1.json";
import {
  handleMcpRequest,
  runDownloadReviews,
  TOOL_NAME,
  TOOL_DEFINITION,
  MCP_PROTOCOL_VERSION,
  type ReviewsToolDeps,
} from "@/lib/mcp/server";
import { mapReviewsPage } from "@/lib/serpapi/client";

const DATA_ID = "0x80858098babc2d4b:0xbeedd659cc698c92";
const mapped = mapReviewsPage(reviewsPage1 as never, DATA_ID);

// Injected deps: resolve echoes an id, getReviews serves the mapped fixture.
const deps: ReviewsToolDeps = {
  resolve: async (input) => ({ dataId: input.includes(":") ? input : DATA_ID }),
  getReviews: async ({ limit }) => ({
    place: mapped.place,
    reviews: limit != null ? mapped.reviews.slice(0, limit) : mapped.reviews,
  }),
  nowIso: () => "2026-06-08T00:00:00.000Z",
};

function rpc(method: string, params?: Record<string, unknown>, id: number | null = 1) {
  return { jsonrpc: "2.0" as const, id, method, ...(params ? { params } : {}) };
}

describe("handleMcpRequest — JSON-RPC dispatch", () => {
  it("initialize returns the protocol version + serverInfo", async () => {
    const res = await handleMcpRequest(rpc("initialize"), deps);
    expect(res?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "google-reviews-download" },
    });
  });

  it("tools/list advertises download_google_reviews with a place-required schema", async () => {
    const res = await handleMcpRequest(rpc("tools/list"), deps);
    const tools = (res?.result as { tools: typeof TOOL_DEFINITION[] }).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe(TOOL_NAME);
    expect(tools[0].inputSchema.required).toContain("place");
    expect(tools[0].inputSchema.properties.format.enum).toEqual(["json", "csv", "xlsx"]);
  });

  it("an unknown method gets JSON-RPC -32601", async () => {
    const res = await handleMcpRequest(rpc("does/not/exist"), deps);
    expect(res?.error?.code).toBe(-32601);
  });

  it("a notification (no id) returns null (no reply)", async () => {
    const res = await handleMcpRequest(rpc("notifications/initialized", undefined, null), deps);
    expect(res).toBeNull();
  });

  it("tools/call with an unknown tool name → -32602", async () => {
    const res = await handleMcpRequest(rpc("tools/call", { name: "nope", arguments: {} }), deps);
    expect(res?.error?.code).toBe(-32602);
  });
});

describe("runDownloadReviews — the tool", () => {
  it("returns JSON content with the real reviews by default", async () => {
    const out = await runDownloadReviews({ place: DATA_ID }, deps);
    expect(out.isError).toBeUndefined();
    const json = out.content.find((c) => c.type === "text" && c.text.startsWith("{"));
    expect(json && "text" in json && json.text).toContain(mapped.reviews[0].author_name);
    const parsed = JSON.parse((json as { text: string }).text);
    expect(parsed.reviews.length).toBe(mapped.reviews.length);
    expect(parsed.place.place_id).toBe(DATA_ID);
  });

  it("honours limit and format=csv", async () => {
    const out = await runDownloadReviews({ place: DATA_ID, format: "csv", limit: 3 }, deps);
    // The summary reports the trimmed count (CSV fields can carry embedded
    // newlines under QUOTE_ALL, so a naive line-count is unreliable — assert
    // the trimmed count via the summary instead).
    const summary = out.content[0] as { text: string };
    expect(summary.text).toContain("Fetched 3 review(s)");
    const csv = out.content[1] as { text: string };
    expect(csv.text).toContain(mapped.reviews[0].author_name);
  });

  it("format=xlsx returns a base64 resource block", async () => {
    const out = await runDownloadReviews({ place: DATA_ID, format: "xlsx" }, deps);
    const resource = out.content.find((c) => c.type === "resource");
    expect(resource).toBeTruthy();
    if (resource && resource.type === "resource") {
      expect(resource.resource.mimeType).toContain("spreadsheetml");
      expect(resource.resource.blob.length).toBeGreaterThan(0);
      // valid base64 → decodes to the XLSX zip magic "PK"
      expect(Buffer.from(resource.resource.blob, "base64").subarray(0, 2).toString()).toBe("PK");
    }
  });

  it("missing place → tool error (isError, not a throw)", async () => {
    const out = await runDownloadReviews({}, deps);
    expect(out.isError).toBe(true);
    expect(out.content[0]).toMatchObject({ type: "text" });
  });

  it("unsupported format → tool error", async () => {
    const out = await runDownloadReviews({ place: DATA_ID, format: "pdf" }, deps);
    expect(out.isError).toBe(true);
  });

  it("surfaces a provider failure as a tool error", async () => {
    const failing: ReviewsToolDeps = {
      ...deps,
      getReviews: async () => {
        throw new Error("upstream boom");
      },
    };
    const out = await runDownloadReviews({ place: DATA_ID }, failing);
    expect(out.isError).toBe(true);
    expect(out.content[0]).toMatchObject({ type: "text" });
  });
});
