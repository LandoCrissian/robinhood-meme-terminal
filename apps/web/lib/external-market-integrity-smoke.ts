import assert from "node:assert/strict";
import { selectPreferredLifecycleMarket } from "./external-market";
import { isNonzeroEvmAddress, selectExternalPairBaseToken } from "./external-market-identity";

const syntheticAddress = (character: string) => ("0x" + character.repeat(40)) as `0x${string}`;
const zero = { address: "0x0000000000000000000000000000000000000000", name: "Ether" };
const wrappedNative = { address: syntheticAddress("a"), name: "Wrapped Ether" };
const external = { address: syntheticAddress("b"), name: "External token" };
const excluded = new Set([wrappedNative.address.toLowerCase()]);

assert.equal(isNonzeroEvmAddress(zero.address), false, "The native zero-address sentinel is not an ERC-20 trade target");
assert.equal(isNonzeroEvmAddress(external.address), true);
assert.equal(isNonzeroEvmAddress("0x1234"), false);
assert.equal(isNonzeroEvmAddress("NATIVE"), false);

assert.equal(
  selectExternalPairBaseToken(external, wrappedNative, excluded),
  external,
  "An eligible external base quoted against a canonical market asset may be ranked"
);
assert.equal(
  selectExternalPairBaseToken(zero, external, excluded),
  undefined,
  "A zero-address base must not transfer its price and valuation metrics to the quote token"
);
assert.equal(
  selectExternalPairBaseToken(wrappedNative, external, excluded),
  undefined,
  "A canonical base must not transfer its price and valuation metrics to an external quote token"
);
assert.equal(
  selectExternalPairBaseToken({ address: "not-an-address", name: "Malformed" }, wrappedNative, excluded),
  undefined,
  "Malformed base-token metadata must fail closed"
);
assert.equal(
  selectExternalPairBaseToken(external, { address: syntheticAddress("c"), name: "Unknown quote" }, excluded),
  undefined,
  "An unrecognized quote asset must fail closed"
);

const curveMarket = {
  venue: {
    kind: "external-launchpad",
    sourceId: "circus",
    market: syntheticAddress("b"),
    execution: "read-only"
  } as const,
  liquidityUsd: 50_000,
  momentumScore: 99,
  pairAddress: syntheticAddress("c")
};
const dexMarket = {
  venue: {
    kind: "dex",
    dexId: "uniswap",
    pairAddress: syntheticAddress("d"),
    url: "https://dexscreener.com/robinhood/" + syntheticAddress("d"),
    execution: "read-only"
  } as const,
  liquidityUsd: 5_000,
  momentumScore: 40,
  pairAddress: syntheticAddress("d")
};
assert.equal(
  selectPreferredLifecycleMarket(curveMarket, dexMarket),
  dexMarket,
  "A DEX market must replace a stale curve record after graduation"
);
assert.equal(
  selectPreferredLifecycleMarket(dexMarket, curveMarket),
  dexMarket,
  "A delayed curve snapshot must never replace a discovered DEX market"
);

console.info("External market address integrity validation passed");
