import assert from "node:assert/strict";
import { parsePrivyFundingConfig } from "./privy-funding";

const sandbox = parsePrivyFundingConfig({
  appId: "x".repeat(25),
  enabled: "true"
});

assert.deepEqual(sandbox, {
  enabled: true,
  chain: "eip155:4663",
  asset: "0x0000000000000000000000000000000000000000",
  assetLabel: "ETH",
  defaultAmount: "50",
  environment: "sandbox"
});

const production = parsePrivyFundingConfig({
  appId: "p".repeat(25),
  enabled: "true",
  chainId: "4663",
  asset: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  defaultAmount: "100",
  environment: "production"
});

assert.equal(production.enabled, true);
assert.equal(production.environment, "production");
assert.equal(production.chain, "eip155:4663");
assert.equal(production.assetLabel, "0x0Bd7…AD73");

assert.equal(parsePrivyFundingConfig({ enabled: "true" }).enabled, false);
assert.equal(parsePrivyFundingConfig({ appId: "invalid", enabled: "true" }).enabled, false);
assert.throws(() => parsePrivyFundingConfig({ chainId: "0" }), /positive EVM chain ID/);
assert.throws(() => parsePrivyFundingConfig({ asset: "eth" }), /exact destination token address/);
assert.throws(() => parsePrivyFundingConfig({ defaultAmount: "0" }), /between 1 and 10,000/);

console.log("Privy funding configuration smoke tests passed.");
