import assert from "node:assert/strict";
import { parsePrivyFundingConfig } from "./privy-funding";

const sandbox = parsePrivyFundingConfig({
  appId: "app_test",
  enabled: "true"
});

assert.deepEqual(sandbox, {
  enabled: true,
  chain: "eip155:4663",
  asset: "eth",
  defaultAmount: "50",
  environment: "sandbox"
});

const production = parsePrivyFundingConfig({
  appId: "app_live",
  enabled: "true",
  chainId: "4663",
  asset: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  defaultAmount: "100",
  environment: "production"
});

assert.equal(production.enabled, true);
assert.equal(production.environment, "production");
assert.equal(production.chain, "eip155:4663");

assert.equal(parsePrivyFundingConfig({ enabled: "true" }).enabled, false);
assert.equal(parsePrivyFundingConfig({ appId: "app", enabled: "false" }).enabled, false);
assert.throws(() => parsePrivyFundingConfig({ chainId: "0" }), /positive EVM chain ID/);
assert.throws(() => parsePrivyFundingConfig({ asset: "not a token!" }), /token symbol/);
assert.throws(() => parsePrivyFundingConfig({ defaultAmount: "0" }), /between 1 and 10,000/);

console.log("Privy funding configuration smoke tests passed.");
