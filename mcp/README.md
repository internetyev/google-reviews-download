# MCP server — `download_google_reviews`

Delivery surface #3 (web tool · HTTP API · **MCP server**). Exposes one tool,
`download_google_reviews`, backed by the same provider and exporters as the web
tool and HTTP API, so all three return identical data.

## The tool

`download_google_reviews(place, format?, limit?)`

| Arg      | Type   | Notes |
|----------|--------|-------|
| `place`  | string | Business name, Google Place ID (`ChIJ…`), `data_id` (`0x…:0x…`), or a Google Maps URL. |
| `format` | enum   | `json` (default) · `csv` · `xlsx`. |
| `limit`  | integer | Max reviews, capped at 5000. |

- **json / csv** → returned as text content.
- **xlsx** → returned as a base64 `resource` block (`mimeType` =
  `…spreadsheetml.sheet`), so the client can save the workbook.

## Run it

The server speaks MCP over stdio (newline-delimited JSON-RPC 2.0). Node ≥20; TS
runs natively on Node ≥22.6, otherwise via `tsx`:

```bash
REVIEWS_PROVIDER=serpapi npx -y tsx mcp/bin.ts
```

Credentials are read from the gitignored `.env.local` (`REVIEWS_PROVIDER`,
`SERPAPI_API_KEY[_1..3]`). With `REVIEWS_PROVIDER` unset it serves the offline
fixtures (`mock`) — handy for trying the tool with zero quota spend.

## Wire into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "google-reviews-download": {
      "command": "npx",
      "args": ["-y", "tsx", "mcp/bin.ts"],
      "cwd": "/absolute/path/to/google-reviews-download",
      "env": { "REVIEWS_PROVIDER": "serpapi" }
    }
  }
}
```

## Wire into Claude Code

```bash
claude mcp add google-reviews-download -- npx -y tsx mcp/bin.ts
```

(run from the project root, or pass `--cwd`). Then ask Claude to
"download the Google reviews for &lt;business&gt; as CSV".

## Protocol

Implements `initialize`, `tools/list`, and `tools/call`. The protocol logic is
the pure `handleMcpRequest` in `lib/mcp/server.ts` (unit-tested offline in
`tests/mcp-server.test.ts`); `mcp/bin.ts` is the thin stdio loop.
