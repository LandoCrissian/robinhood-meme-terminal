import assert from "node:assert/strict";
import {
  consumeRmtTradeDraftRecovery,
  persistRmtTradeDraftRecovery,
  RMT_TRADE_DRAFT_RECOVERY_KEY,
  RMT_TRADE_DRAFT_RECOVERY_MAX_AGE_MS
} from "./trade-draft-recovery";
import { readFileSync } from "node:fs";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
    values
  };
}

const market = "0x1111111111111111111111111111111111111111";
const storage = memoryStorage();
assert.equal(persistRmtTradeDraftRecovery(storage, {
  amount: "999999.25",
  buyInputKey: "4663:contract:0x2222222222222222222222222222222222222222",
  marketAddress: market,
  savedAtMs: 1_000,
  sellOutputKey: "4663:native",
  side: "sell"
}), true);
assert.deepEqual(consumeRmtTradeDraftRecovery(storage, market, 2_000), {
  amount: "999999.25",
  buyInputKey: "4663:contract:0x2222222222222222222222222222222222222222",
  marketAddress: market,
  savedAtMs: 1_000,
  sellOutputKey: "4663:native",
  side: "sell"
}, "A controlled wallet-session reload restores the exact side, amount, and asset choices once.");
assert.equal(consumeRmtTradeDraftRecovery(storage, market, 2_000), undefined,
  "Recovered draft preferences are one-shot and never become trade authority.");

storage.values.set(RMT_TRADE_DRAFT_RECOVERY_KEY, JSON.stringify({ amount: "1", marketAddress: market, savedAtMs: 1_000, side: "buy" }));
assert.equal(consumeRmtTradeDraftRecovery(storage, "0x3333333333333333333333333333333333333333", 2_000), undefined,
  "A draft cannot cross into another selected token.");
storage.values.set(RMT_TRADE_DRAFT_RECOVERY_KEY, JSON.stringify({ amount: "1", marketAddress: market, savedAtMs: 1_000, side: "buy" }));
assert.equal(consumeRmtTradeDraftRecovery(storage, market, 1_000 + RMT_TRADE_DRAFT_RECOVERY_MAX_AGE_MS + 1), undefined,
  "Stale preferences are discarded rather than treated as current intent.");
storage.values.set(RMT_TRADE_DRAFT_RECOVERY_KEY, "not-json");
assert.equal(consumeRmtTradeDraftRecovery(storage, market, 2_000), undefined);
assert.equal(storage.values.has(RMT_TRADE_DRAFT_RECOVERY_KEY), false,
  "Malformed recovery input is removed before parsing and cannot loop across reloads.");
assert.equal(persistRmtTradeDraftRecovery({
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => { throw new Error("storage disabled"); }
}, {
  amount: "1",
  marketAddress: market,
  savedAtMs: 2_000,
  side: "buy"
}), false, "Unavailable session storage is a visible preservation failure, never a successful redirect handoff.");

const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(composer, /recoveredSideRequestNonce\.current = sideRequest\?\.nonce \?\? null;[\s\S]*setAmount\(recovered\.amount\)/,
  "A consumed draft must claim the mount-time route request before publishing its restored amount.");
assert.match(composer, /if \(recoveredSideRequestNonce\.current === sideRequest\.nonce\) \{\s*return;\s*\}[\s\S]*chooseSide\(sideRequest\.side\)/,
  "Strict Mode may replay the initial route effect, so its recovered nonce remains suppressed while a later nonce stays actionable.");
assert.doesNotMatch(composer, /recoveredSideRequestNonce\.current = null;[\s\S]{0,120}chooseSide\(sideRequest\.side\)/,
  "A replay of the same mount nonce must not regain authority to clear the recovered draft.");

console.log("Controlled wallet-session reload preserves only a bounded, one-shot trade draft preference.");
