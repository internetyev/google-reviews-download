// Serves the machine-readable OpenAPI 3.1 contract for the public API (L27.6).
// GET /api/openapi → the spec as JSON. Static and cacheable; the spec is a
// compile-time constant (lib/api/openapi.ts), so no provider/runtime work.

import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/api/openapi";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      // The contract changes only on deploy — let clients/CDNs cache it.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
