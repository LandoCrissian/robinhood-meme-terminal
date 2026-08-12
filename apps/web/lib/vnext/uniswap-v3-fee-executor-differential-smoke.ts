import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, stringToHex } from "viem";
import { calculateRmtFeeFloor, createRmtExecutionV1Policy } from "./execution-fee-policy";

type Fixture = {
  policy: {
    policyId: string;
    policyIdHash: `0x${string}`;
    version: number;
    feeBps: number;
    treasury: `0x${string}`;
    chainId: number;
    fromBlock: string;
    beforeBlock: string | null;
    eligibleSettlementAssetIds: string[];
    policyHash: `0x${string}`;
  };
  feeVectors: Array<{ amount: number; feeBps: number; fee: number }>;
};

const fixture = JSON.parse(readFileSync(
  new URL("../../../../packages/contracts/test/fixtures/rmt-uniswap-v3-fee-v1.json", import.meta.url),
  "utf8"
)) as Fixture;

const policy = createRmtExecutionV1Policy({
  treasury: fixture.policy.treasury,
  chainId: fixture.policy.chainId,
  fromBlock: fixture.policy.fromBlock,
  beforeBlock: fixture.policy.beforeBlock,
  eligibleSettlementAssetIds: fixture.policy.eligibleSettlementAssetIds
});

assert.equal(policy.policyId, fixture.policy.policyId);
assert.equal(policy.version, fixture.policy.version);
assert.equal(policy.feeBps, fixture.policy.feeBps);
assert.equal(policy.policyHash, fixture.policy.policyHash);
assert.equal(keccak256(stringToHex(policy.policyId)), fixture.policy.policyIdHash);

for (const vector of fixture.feeVectors) {
  assert.equal(calculateRmtFeeFloor(String(vector.amount), vector.feeBps), String(vector.fee));
}

console.log("Uniswap V3 executor policy identity and fee-floor vectors match the canonical TypeScript domain.");
