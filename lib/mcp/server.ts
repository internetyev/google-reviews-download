// Minimal Model Context Protocol server core (L27.7) — delivery surface #3.
//
// Dependency-free by design (same posture as the KV cache, D-…): MCP stdio is
// just newline-delimited JSON-RPC 2.0, so we implement the three methods a
// tool server needs — `initialize`, `tools/list`, `tools/call` — without the
// SDK. `handleMcpRequest` is a pure async function over one JSON-RPC message;
// the stdio loop (mcp/bin.ts) is the only impure part. The single tool,
// `download_google_reviews`, is backed by the SAME provider/exporters as the
// web tool and HTTP API, so all three surfaces return identical data.

import type {
  GetReviewsResponse,
  PlaceMeta,
} from "@/lib/semanticforce/types";
import type { CachedReviewsPayload } from "@/lib/cache/reviews-cache";
import { formatReviewsAsCsv } from "@/lib/export/csv";
import { formatReviewsAsXlsx, XLSX_CONTENT_TYPE } from "@/lib/export/xlsx";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_NAME = "google-reviews-download";
export const MCP_SERVER_VERSION = "1.0.0";
export const MCP_MAX_LIMIT = 5000;

export const TOOL_NAME = "download_google_reviews";

export const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    "Download a Google business's reviews. Accepts a business name, a Google " +
    "Place ID / data_id, or a Google Maps URL, and returns the reviews as JSON, " +
    "CSV, or an XLSX workbook.",
  inputSchema: {
    type: "object",
    properties: {
      place: {
        type: "string",
        description:
          "Business name, Google Place ID (ChIJ…), data_id (0x…:0x…), or a Google Maps URL.",
      },
      format: {
        type: "string",
        enum: ["json", "csv", "xlsx"],
        default: "json",
        description: "Output format. Defaults to json.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MCP_MAX_LIMIT,
        description: "Max reviews to return (default: all, capped at 5000).",
      },
    },
    required: ["place"],
  },
} as const;

// --- JSON-RPC types (only what we use) ------------------------------------

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// --- Tool dependencies (injectable for offline tests) ---------------------

export type ReviewsToolDeps = {
  // Resolve a name / id / URL to a canonical data_id (+ optional place meta).
  resolve: (input: string) => Promise<{ dataId: string; place?: PlaceMeta }>;
  // Fetch reviews for a resolved id.
  getReviews: (args: {
    placeId: string;
    limit?: number;
  }) => Promise<GetReviewsResponse>;
  nowIso?: () => string;
};

type ToolContent =
  | { type: "text"; text: string }
  | {
      type: "resource";
      resource: { uri: string; mimeType: string; blob: string };
    };

export type ToolResult = { content: ToolContent[]; isError?: true };

/** Run the download tool. Pure given its deps — no global I/O. */
export async function runDownloadReviews(
  args: Record<string, unknown>,
  deps: ReviewsToolDeps,
): Promise<ToolResult> {
  const place = typeof args.place === "string" ? args.place.trim() : "";
  if (!place) {
    return toolError("Missing required argument: place (a name, Place ID, or Maps URL).");
  }
  const format = normaliseFormat(args.format);
  if (!format) {
    return toolError(`Unsupported format "${String(args.format)}". Use json, csv, or xlsx.`);
  }
  const limit = normaliseLimit(args.limit);
  if (limit === "invalid") {
    return toolError(`Invalid limit "${String(args.limit)}" — must be a positive integer.`);
  }

  let dataId: string;
  try {
    ({ dataId } = await deps.resolve(place));
  } catch (err) {
    return toolError(`Could not resolve "${place}": ${errMessage(err)}`);
  }

  let res: GetReviewsResponse;
  try {
    res = await deps.getReviews({ placeId: dataId, ...(limit != null ? { limit } : {}) });
  } catch (err) {
    return toolError(`Could not fetch reviews: ${errMessage(err)}`);
  }

  const reviews = limit != null ? res.reviews.slice(0, limit) : res.reviews;
  const payload: CachedReviewsPayload = {
    place: res.place,
    reviews,
    fetched_at: (deps.nowIso ?? defaultNowIso)(),
  };

  const summary =
    `Fetched ${reviews.length} review(s) for ${res.place.name || dataId}` +
    (res.place.rating_avg ? ` (${res.place.rating_avg}★, ${res.place.rating_count} total)` : "") +
    `.`;

  if (format === "json") {
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  }

  if (format === "csv") {
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: formatReviewsAsCsv(payload) },
      ],
    };
  }

  // xlsx — binary, returned as a base64 resource block.
  const bytes = formatReviewsAsXlsx(payload);
  const base64 = bytesToBase64(bytes);
  return {
    content: [
      { type: "text", text: `${summary} (XLSX, ${bytes.byteLength} bytes, base64-encoded below.)` },
      {
        type: "resource",
        resource: {
          uri: `reviews://${dataId}.xlsx`,
          mimeType: XLSX_CONTENT_TYPE,
          blob: base64,
        },
      },
    ],
  };
}

/**
 * Handle a single JSON-RPC message. Returns the response, or null for
 * notifications (messages without an `id`, e.g. `notifications/initialized`).
 */
export async function handleMcpRequest(
  req: JsonRpcRequest,
  deps: ReviewsToolDeps,
): Promise<JsonRpcResponse | null> {
  const isNotification = req.id === undefined || req.id === null;
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      });

    case "tools/list":
      return ok(id, { tools: [TOOL_DEFINITION] });

    case "tools/call": {
      const params = req.params ?? {};
      if (params.name !== TOOL_NAME) {
        return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      }
      const result = await runDownloadReviews(
        (params.arguments as Record<string, unknown>) ?? {},
        deps,
      );
      return ok(id, result);
    }

    default:
      // Notifications we don't act on (initialized, cancelled, …) → no reply.
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

// --- helpers --------------------------------------------------------------

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function normaliseFormat(raw: unknown): "json" | "csv" | "xlsx" | null {
  if (raw == null) return "json";
  const v = String(raw).toLowerCase();
  return v === "json" || v === "csv" || v === "xlsx" ? v : null;
}

function normaliseLimit(raw: unknown): number | undefined | "invalid" {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return "invalid";
  return Math.min(Math.floor(n), MCP_MAX_LIMIT);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function bytesToBase64(bytes: Uint8Array): string {
  // The MCP server runs in Node — Buffer is available.
  return Buffer.from(bytes).toString("base64");
}
