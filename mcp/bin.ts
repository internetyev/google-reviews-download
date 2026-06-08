#!/usr/bin/env node
// MCP stdio entry point (L27.7). Reads newline-delimited JSON-RPC messages on
// stdin, dispatches each through the pure `handleMcpRequest`, and writes
// responses to stdout. Run it (Node ≥20, TS run natively or via tsx):
//
//     REVIEWS_PROVIDER=serpapi npx -y tsx mcp/bin.ts
//
// See mcp/README.md for wiring into Claude Desktop / Claude Code.

import * as readline from "node:readline";
import { handleMcpRequest, type ReviewsToolDeps } from "@/lib/mcp/server";
import { createReviewsProvider } from "@/lib/reviews/provider";
import { resolveToDataId } from "@/lib/serpapi/resolve";

// Load gitignored creds (.env.local) when present.
try {
  (process as NodeJS.Process & { loadEnvFile: (p?: string) => void }).loadEnvFile(
    ".env.local",
  );
} catch {
  // already in env, or older Node — rely on the ambient environment
}

const deps: ReviewsToolDeps = {
  resolve: (input) => resolveToDataId(input),
  getReviews: (args) => createReviewsProvider().getReviews(args),
};

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  handleMcpRequest(req, deps)
    .then((res) => {
      if (res) send(res);
    })
    .catch((err) => {
      send({
        jsonrpc: "2.0",
        id: req?.id ?? null,
        error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" },
      });
    });
});
