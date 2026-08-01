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
import { clearTradeQuoteCache, requestTradeQuote } from "./trade-quote-client";
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
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ quoteOut: "2" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    clearTradeQuoteCache();
    const body = { amountIn: "1", side: "buy" };
    const [first, second] = await Promise.all([
      requestTradeQuote("/quote", body, 1_000),
      requestTradeQuote("/quote", body, 1_001)
    ]);
    assert.equal(calls, 1);
    assert.equal(first.ok, true);
    assert.deepEqual(second.payload, { quoteOut: "2" });

    await requestTradeQuote("/quote", body, 3_000);
    assert.equal(calls, 2);
  } finally {
    clearTradeQuoteCache();
    globalThis.fetch = originalFetch;
  }
}

void run().then(() => console.log("trade speed smoke passed"));
