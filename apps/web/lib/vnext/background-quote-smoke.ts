import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VNextQuoteResponse } from "./quote-observation";
import {
  isVNextQuoteReusableForTrade,
  VNEXT_BACKGROUND_QUOTE_REFRESH_MS,
  VNEXT_TRADE_QUOTE_MAX_AGE_MS
} from "./background-quote";

const now = 1_786_000_000_000;
const response = {
  attempts: [{
    provider: "uniswap-v3",
    status: "indicative",
    strictVerificationAvailable: true,
    protectedOutputAtomic: "990",
    quotedAtMs: now - 1_000,
    expiresAtMs: now + 29_000,
    latencyMs: 100
  }]
} as VNextQuoteResponse;

assert.equal(VNEXT_BACKGROUND_QUOTE_REFRESH_MS, 4_000);
assert.equal(isVNextQuoteReusableForTrade(response, now), true);
assert.equal(isVNextQuoteReusableForTrade({
  ...response,
  attempts: [{ ...response.attempts[0], quotedAtMs: now - VNEXT_TRADE_QUOTE_MAX_AGE_MS - 1 }]
} as VNextQuoteResponse, now), false);
assert.equal(isVNextQuoteReusableForTrade({
  ...response,
  attempts: [{ ...response.attempts[0], expiresAtMs: now + 4_999 }]
} as VNextQuoteResponse, now), false);
assert.equal(isVNextQuoteReusableForTrade({
  ...response,
  attempts: [{ ...response.attempts[0], strictVerificationAvailable: false }]
} as VNextQuoteResponse, now), false);

const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(composer, /backgroundQuoteEpoch/);
assert.match(composer, /backgroundQuoteImmediate/);
assert.match(composer, /VNEXT_BACKGROUND_QUOTE_REFRESH_MS/);
assert.match(composer, /lastReadyQuote\.current = freshQuote/);
assert.match(composer, /isVNextQuoteReusableForTrade/);
const continuation = composer.slice(composer.indexOf("const continueTrading"), composer.indexOf("return (", composer.indexOf("const continueTrading")));
assert.match(continuation, /clearTradeQuoteCache\(\)/);
assert.match(continuation, /setQuoteState\(\{ state: "loading" \}\)/);
assert.match(continuation, /setVerificationState\(\{ state: "idle" \}\)/);
assert.match(continuation, /setAuthorizationState\(\{ state: "idle" \}\)/);
assert.match(continuation, /backgroundQuoteImmediate\.current = true/);
assert.doesNotMatch(continuation, /requestAuthorizationPlan|sendTransaction|writeContract|signTypedData/);
assert.doesNotMatch(composer, /setInterval/);

console.log("RMT VNext quiet background quote refresh smoke checks passed.");
