// GET /api/healthcheck
//
// Liveness probe for the SemanticForce dependency. Pings SF (via the shared
// client) with a known place and reports round-trip latency. Until L4.1
// wires real creds, `createSemanticForceClient()` falls back to the bundled
// fixtures when `SF_API_KEY` is unset, so this route also works mock-only —
// `mode` reflects which path actually ran. The probe deliberately requests a
// single review (`limit: 1`) to keep the fixture/HTTP round-trip cheap.
//
// Client-injection seam (L8.5 / D-048 / D-051): the request-handling logic
// lives in `handle(client?)`, which `GET` calls with no argument so the
// production path is byte-for-byte unchanged (it still constructs the client
// via `createSemanticForceClient()`). An optional `client` argument lets a
// caller supply a pre-built SemanticForceClient instead — used today by the
// route's own test suite to reach the `degraded` (client answers without a
// place) and `getReviews()`-throws → `down` branches that are unreachable
// through env alone (the FixtureClient always returns a place and never
// throws), and intended to also unblock an L4.1 live-path probe test. This
// is a reviewed production change, deliberately distinct from the
// vi.mock/test-hack approach D-048 rejected: the seam is real API surface,
// not a stub-only escape hatch, and the injected client still flows through
// the exact same status/latency/error-envelope logic as the constructed one.
import { NextResponse } from "next/server";
import { createSemanticForceClient } from "@/lib/semanticforce/client";
import { SemanticForceError } from "@/lib/semanticforce/types";
import type { SemanticForceClient } from "@/lib/semanticforce/types";

export const runtime = "edge";

// Stable fixture id (see lib/semanticforce/client.ts FIXTURES). When real
// creds are present this is still a valid SF place_id shape; L4.1 may swap
// it for a real well-known place and document any schema delta.
const PROBE_PLACE_ID = "MOCK_SMALL_001";

type HealthBody = {
  status: "ok" | "degraded" | "down";
  mode: "fixture" | "live";
  latency_ms: number;
  place_id: string;
  checked_at: string;
  error?: { code: string; message: string };
};

export async function GET() {
  return handle();
}

// Core probe logic. `injectedClient`, when present, replaces the constructed
// client and bypasses the init try/catch (an injected client is already
// built, so the misconfig-at-construction branch cannot apply to it). Every
// other path — status mapping, latency, error envelope, headers — is shared
// verbatim between the injected and constructed cases.
async function handle(injectedClient?: SemanticForceClient) {
  const mode: HealthBody["mode"] = process.env.SF_API_KEY ? "live" : "fixture";
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  let client: SemanticForceClient;
  if (injectedClient) {
    client = injectedClient;
  } else {
    try {
      client = createSemanticForceClient();
    } catch (err) {
      // Misconfiguration (e.g. SF_API_KEY set without SF_API_BASE) surfaces
      // here as a SemanticForceError — report it as "down" with a 503.
      const message = err instanceof Error ? err.message : "client init failed";
      const code = err instanceof SemanticForceError ? err.code : "unknown";
      return json(
        {
          status: "down",
          mode,
          latency_ms: Date.now() - startedAt,
          place_id: PROBE_PLACE_ID,
          checked_at: checkedAt,
          error: { code, message },
        },
        503,
      );
    }
  }

  try {
    const res = await client.getReviews({
      placeId: PROBE_PLACE_ID,
      limit: 1,
    });
    const latencyMs = Date.now() - startedAt;
    // A reachable SF that returns no place metadata is "degraded" — the
    // dependency answered but not usefully.
    const status: HealthBody["status"] = res.place ? "ok" : "degraded";
    return json(
      {
        status,
        mode,
        latency_ms: latencyMs,
        place_id: PROBE_PLACE_ID,
        checked_at: checkedAt,
      },
      status === "ok" ? 200 : 503,
    );
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const code = err instanceof SemanticForceError ? err.code : "unknown";
    const message = err instanceof Error ? err.message : "probe failed";
    return json(
      {
        status: "down",
        mode,
        latency_ms: latencyMs,
        place_id: PROBE_PLACE_ID,
        checked_at: checkedAt,
        error: { code, message },
      },
      503,
    );
  }
}

function json(body: HealthBody, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const __testing = { PROBE_PLACE_ID, handle };
