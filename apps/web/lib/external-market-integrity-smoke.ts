import assert from "node:assert/strict";
import { isNonzeroEvmAddress, selectExternalPairBaseToken } from "./external-market-identity";

const syntheticAddress = (character: string) => "0x" + character.repeat(40);
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

console.info("External market address integrity validation passed");
