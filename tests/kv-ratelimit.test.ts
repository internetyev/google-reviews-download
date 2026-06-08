// Coverage for the L28.4 KV-backed rate limiter (lib/ratelimit/kv-bucket.ts)
// and the shared token-bucket core. All offline — the KV REST transport is a
// stub Map. The limiter must enforce the same 10/min bucket ACROSS the shared
// store (the whole point — cross-instance), refill over time, isolate keys,
// and FAIL OPEN when KV errors (never block traffic on a cache hiccup).

import { describe, it, expect } from "vitest";
import { createKvRateLimiter, RATELIMIT_KEY_PREFIX } from "@/lib/ratelimit/kv-bucket";
import {
  applyConsume,
  BUCKET_CAPACITY,
  RETRY_AFTER_SECONDS,
} from "@/lib/ratelimit/token-bucket";

// Minimal Vercel-KV REST stub backed by one shared Map (models cross-instance
// shared state). Optionally fails to model a KV outage.
function kvStub(opts: { fail?: boolean } = {}) {
  const store = new Map<string, string>();
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    if (opts.fail) throw new Error("KV down");
    const [op, key, value] = JSON.parse(String(init?.body)) as string[];
    if (op === "SET") {
      store.set(key, value);
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    }
    return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200 });
  }) as unknown as typeof fetch;
  return { store, fetchImpl };
}

describe("applyConsume — token-bucket core", () => {
  it("starts full and spends one per call", () => {
    let b = applyConsume(null, 0);
    expect(b.allowed).toBe(true);
    expect(b.next.tokens).toBe(BUCKET_CAPACITY - 1);
  });

  it("denies when empty and records the refilled timestamp", () => {
    const empty = { tokens: 0.5, updated_at: 1000 };
    const r = applyConsume(empty, 1000);
    expect(r.allowed).toBe(false);
    expect(r.next.updated_at).toBe(1000);
  });
});

describe("createKvRateLimiter", () => {
  it("allows exactly BUCKET_CAPACITY in a burst, then denies (shared store)", async () => {
    const { fetchImpl } = kvStub();
    const rl = createKvRateLimiter({ url: "https://kv.example", token: "t", fetchImpl });
    const now = 1_700_000_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) {
      expect(await rl.consume("1.2.3.4:/api/reviews", now)).toBe(true);
    }
    expect(await rl.consume("1.2.3.4:/api/reviews", now)).toBe(false);
  });

  it("refills one token after RETRY_AFTER_SECONDS", async () => {
    const { fetchImpl } = kvStub();
    const rl = createKvRateLimiter({ url: "https://kv.example", token: "t", fetchImpl });
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) await rl.consume("k", t0);
    expect(await rl.consume("k", t0)).toBe(false);
    // one token's worth of time later → allowed again
    expect(await rl.consume("k", t0 + RETRY_AFTER_SECONDS * 1000)).toBe(true);
  });

  it("isolates buckets per key", async () => {
    const { fetchImpl } = kvStub();
    const rl = createKvRateLimiter({ url: "https://kv.example", token: "t", fetchImpl });
    const now = 1_700_000_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) await rl.consume("a", now);
    expect(await rl.consume("a", now)).toBe(false);
    expect(await rl.consume("b", now)).toBe(true); // different key, fresh
  });

  it("namespaces keys under the ratelimit prefix", async () => {
    const { store, fetchImpl } = kvStub();
    const rl = createKvRateLimiter({ url: "https://kv.example", token: "t", fetchImpl });
    await rl.consume("9.9.9.9:/api/reviews", 0);
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(`${RATELIMIT_KEY_PREFIX}9.9.9.9:/api/reviews`);
  });

  it("FAILS OPEN: a KV outage allows the request rather than blocking it", async () => {
    const { fetchImpl } = kvStub({ fail: true });
    const rl = createKvRateLimiter({ url: "https://kv.example", token: "t", fetchImpl });
    // Even hammered, every call is allowed while KV is down.
    for (let i = 0; i < BUCKET_CAPACITY + 5; i++) {
      expect(await rl.consume("k", 0)).toBe(true);
    }
  });
});
