import assert from "node:assert/strict";
import {
  quoteDebounceMs,
  quoteRefreshMs,
  quoteRequestKey,
  SPEED_QUOTE_DEBOUNCE_MS,
  SPEED_QUOTE_REFRESH_MS,
  STANDARD_QUOTE_DEBOUNCE_MS,
  STANDARD_QUOTE_REFRESH_MS
} from "./trade-speed";
import {
  clearTradeQuoteCache,
  requestTradeQuote,
  TradeQuoteRequestError
} from "./trade-quote-client";
import { normalizeTradePreferences } from "./trade-preferences";

assert.equal(quoteDebounceMs("speed"), SPEED_QUOTE_DEBOUNCE_MS);
assert.equal(quoteDebounceMs("standard"), STANDARD_QUOTE_DEBOUNCE_MS);
assert.equal(quoteRefreshMs("speed"), SPEED_QUOTE_REFRESH_MS);
assert.equal(quoteRefreshMs("standard"), STANDARD_QUOTE_REFRESH_MS);
assert.equal(normalizeTradePreferences(null).preparationMode, "speed");
assert.equal(normalizeTradePreferences({
  buyAmounts: ["0.01", "0.02", "0.03"],
  routePreference: "automatic",
  maxPriceImpactBps: 100,
  preparationMode: "standard"
}).preparationMode, "standard");
assert.equal(
  quoteRequestKey("/quote", { amountIn: "1", side: "buy" }),
  quoteRequestKey("/quote", { amountIn: "1", side: "buy" })
);

async function run() {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let lastIdentityToken = "";
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    lastIdentityToken = new Headers(init?.headers).get("privy-id-token") ?? "";
    return new Response(JSON.stringify({ quoteOut: "2" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    clearTradeQuoteCache();
    const body = { amountIn: "1", side: "buy" };
    const [first, second] = await Promise.all([
      requestTradeQuote("/quote", body, { identityScope: "did:privy:test", identityToken: "identity-token", now: 1_000 }),
      requestTradeQuote("/quote", body, { identityScope: "did:privy:test", identityToken: "identity-token", now: 1_001 })
    ]);
    assert.equal(calls, 1);
    assert.equal(lastIdentityToken, "identity-token");
    assert.equal(first.ok, true);
    assert.equal(first.attempts, 1);
    assert.deepEqual(second.payload, { quoteOut: "2" });

    await requestTradeQuote("/quote", body, {
      identityScope: "did:privy:another-trader",
      identityToken: "another-identity-token",
      now: 1_002
    });
    assert.equal(calls, 2);
    assert.equal(lastIdentityToken, "another-identity-token");

    await requestTradeQuote("/quote", body, { identityScope: "did:privy:test", identityToken: "identity-token", now: 3_000 });
    assert.equal(calls, 3);

    clearTradeQuoteCache();
    let retryCalls = 0;
    globalThis.fetch = (async () => {
      retryCalls += 1;
      return new Response(JSON.stringify(retryCalls === 1
        ? { error: "temporary upstream failure" }
        : { quoteOut: "3" }), {
        status: retryCalls === 1 ? 503 : 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;
    const retried = await requestTradeQuote("/retry-quote", body, {
      identityScope: "did:privy:retry",
      maxAttempts: 2,
      retryDelayMs: 0,
      timeoutMs: 1_000,
      now: 5_000
    });
    assert.equal(retryCalls, 2);
    assert.equal(retried.ok, true);
    assert.equal(retried.attempts, 2);
    assert.deepEqual(retried.payload, { quoteOut: "3" });

    clearTradeQuoteCache();
    globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })) as typeof fetch;
    await assert.rejects(
      requestTradeQuote("/timeout-quote", body, {
        identityScope: "did:privy:timeout",
        maxAttempts: 1,
        timeoutMs: 10,
        now: 8_000
      }),
      (error: unknown) => error instanceof TradeQuoteRequestError && error.code === "timeout" && error.attempts === 1
    );
  } finally {
    clearTradeQuoteCache();
    globalThis.fetch = originalFetch;
  }
}

void run().then(() => console.log("trade speed smoke passed"));
