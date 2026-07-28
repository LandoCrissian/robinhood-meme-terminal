import assert from "node:assert/strict";
import {
  parseTradingTermsAcceptance,
  TRADING_TERMS_VERSION,
  tradingTermsAcceptanceRecord
} from "./trading-terms";

assert.equal(parseTradingTermsAcceptance(null), false);
assert.equal(parseTradingTermsAcceptance("not-json"), false);
assert.equal(parseTradingTermsAcceptance(JSON.stringify({ version: "old", acceptedAt: new Date().toISOString() })), false);
assert.equal(parseTradingTermsAcceptance(JSON.stringify({ version: TRADING_TERMS_VERSION, acceptedAt: "invalid" })), false);
assert.equal(parseTradingTermsAcceptance(tradingTermsAcceptanceRecord(new Date("2026-07-28T00:00:00.000Z"))), true);

console.log("Versioned one-time trading terms acceptance passed.");
