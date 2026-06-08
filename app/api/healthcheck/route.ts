// GET /api/healthcheck
//
// Liveness probe for the ACTIVE reviews provider (L29.1). Reports which
// provider is configured (`REVIEWS_PROVIDER`), whether it's the offline fixture
// path or a live source (`mode`), round-trip latency, and a status.
//
// Quota guard (L29.1 / D-098): a live provider (serpapi/semanticforce) would
// spend real API quota on every healthcheck if the probe did a `getReviews`
// round-trip — and uptime monitors hit this endpoint often. So for a live
// provider a successfully-CONSTRUCTED client (creds present) is reported "ok"
// WITHOUT a live fetch; only the fixture (`mock`) provider does the free
// round-trip that exercises the whole pipeline. An injected client (tests)
// always does the round-trip, since it can't spend real quota.
//
// Client-injection seam (L8.5 / D-048): the logic lives in `handle(client?)`,
// which `GET` calls with no argument so the production path constructs the
// client via `createReviewsProvider()`. An optional `client` lets the test
// suite reach the `degraded`/throw → `down` branches the FixtureClient can't
// produce. The injected client flows through the identical status/latency/
// error-envelope logic as a constructed one.
import { NextResponse } from "next/server";
import {
  createReviewsProvider,
  resolveProviderName,
  type ReviewsProviderName,
} from "@/lib/reviews/provider";
import { SemanticForceError } from "@/lib/semanticforce/types";
import type { SemanticForceClient } from "@/lib/semanticforce/types";

export const runtime = "edge";

// Stable fixture id (see lib/semanticforce/client.ts FIXTURES) used for the
// fixture-mode round-trip. Live providers don't actually fetch it (quota guard).
const PROBE_PLACE_ID = "MOCK_SMALL_001";

type HealthBody = {
  status: "ok" | "degraded" | "down";
  provider: ReviewsProviderName;
  mode: "fixture" | "live";
  latency_ms: number;
  place_id: string;
  checked_at: string;
  error?: { code: string; message: string };
};

export async function GET() {
  return handle();
}

async function handle(injectedClient?: SemanticForceClient) {
  const provider = resolveProviderName(process.env.REVIEWS_PROVIDER);
  const mode: HealthBody["mode"] = provider === "mock" ? "fixture" : "live";
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  const base = { provider, mode, place_id: PROBE_PLACE_ID, checked_at: checkedAt };
  const down = (err: unknown) =>
    json(
      {
        status: "down",
        ...base,
        latency_ms: Date.now() - startedAt,
        error: {
          code: err instanceof SemanticForceError ? err.code : "unknown",
          message: err instanceof Error ? err.message : "probe failed",
        },
      },
      503,
    );

  let client: SemanticForceClient;
  if (injectedClient) {
    client = injectedClient;
  } else {
    try {
      // Constructing the provider validates its config (e.g. SerpApi keys
      // present, SemanticForce base set) — a misconfig throws here → down.
      client = createReviewsProvider();
    } catch (err) {
      return down(err);
    }
  }

  // Quota guard: only fetch for the fixture path (free) or an injected client
  // (tests). A live provider that constructed successfully is reported ok
  // without spending an upstream call.
  const doFetch = injectedClient != null || provider === "mock";
  if (!doFetch) {
    return json({ status: "ok", ...base, latency_ms: Date.now() - startedAt }, 200);
  }

  try {
    const res = await client.getReviews({ placeId: PROBE_PLACE_ID, limit: 1 });
    const latencyMs = Date.now() - startedAt;
    // A reachable provider that returns no place metadata is "degraded" — it
    // answered but not usefully.
    const status: HealthBody["status"] = res.place ? "ok" : "degraded";
    return json(
      { status, ...base, latency_ms: latencyMs },
      status === "ok" ? 200 : 503,
    );
  } catch (err) {
    return down(err);
  }
}

function json(body: HealthBody, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const __testing = { PROBE_PLACE_ID, handle };
