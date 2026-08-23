import assert from "node:assert/strict";
import {
  RMT_EXECUTION_V2_TREASURY,
  assertRmtExecutionFeeV2EconomicsMatchesPolicy,
  assertRmtExecutionFeeV2Policy,
  calculateRmtExecutionFeeV2Floor,
  configuredRmtExecutionFeeV2Policy,
  createRmtExecutionFeeV2Policy,
  normalizeRmtExecutionFeeV2Input,
  plannedRmtExecutionFeeV2ForWalletAction,
  settledRmtExecutionFeeV2,
  type RmtExecutionFeeV2Economics,
  type RmtExecutionFeeV2Policy
} from "./execution-fee-policy-v2";
import { createRmtExecutionV1Policy, RMT_EXECUTION_V1_DESCRIPTOR } from "./execution-fee-policy";

const inputAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const outputAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const policy = createRmtExecutionFeeV2Policy({
  treasury: RMT_EXECUTION_V2_TREASURY,
  fromBlock: "40000000"
});

assert.equal(policy.policyId, "RMT_EXECUTION_V2");
assert.equal(policy.version, 2);
assert.equal(policy.chainId, 4_663);
assert.equal(policy.feeBps, 25);
assert.equal(policy.allowedSettlementModes[0], "v2-atomic-input-fee");
assert.equal(assertRmtExecutionFeeV2Policy(policy), true);
assert.equal("eligibleSettlementAssetIds" in policy, false, "V2 must not contain a static per-token allowlist");

const economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId,
  outputAssetId,
  userGrossInputAtomic: "1000000",
  providerGrossExpectedOutputAtomic: "2000000",
  providerProtectedOutputAtomic: "1900000",
  settlementMode: "v2-atomic-input-fee"
});
assert.equal(economics.feeBasisAtomic, "1000000");
assert.equal(economics.expectedFeeAtomic, "2500");
assert.equal(economics.maximumFeeAtomic, "2500");
assert.equal(economics.providerInputAtomic, "997500");
assert.equal(economics.protectedUserNetOutputAtomic, "1900000");
assert.equal(assertRmtExecutionFeeV2EconomicsMatchesPolicy(economics, policy), true);

const newTokenEconomics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: "eip155:4663/contract:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  outputAssetId: "eip155:4663/contract:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  userGrossInputAtomic: "400",
  providerGrossExpectedOutputAtomic: "1",
  providerProtectedOutputAtomic: "1",
  settlementMode: "v2-atomic-input-fee"
});
assert.equal(newTokenEconomics.expectedFeeAtomic, "1", "new standard tokens require no static allowlist mutation");

assert.equal(calculateRmtExecutionFeeV2Floor("399"), "0");
const zeroFee = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId,
  outputAssetId,
  userGrossInputAtomic: "399",
  providerGrossExpectedOutputAtomic: "1",
  providerProtectedOutputAtomic: "1",
  settlementMode: "v2-atomic-input-fee"
});
assert.equal(zeroFee.expectedFeeAtomic, "0");
assert.equal(zeroFee.providerInputAtomic, "399");
assert.equal(plannedRmtExecutionFeeV2ForWalletAction("erc20_approval", economics), "0");
assert.equal(plannedRmtExecutionFeeV2ForWalletAction("swap", economics), "2500");
assert.equal(settledRmtExecutionFeeV2({ receiptStatus: "reverted", atomicSettlementVerified: false, expectedFeeAtomic: "2500" }), "0");
assert.equal(settledRmtExecutionFeeV2({ receiptStatus: "failed", atomicSettlementVerified: false, expectedFeeAtomic: "2500" }), "0");
assert.equal(settledRmtExecutionFeeV2({ receiptStatus: "not_submitted", atomicSettlementVerified: false, expectedFeeAtomic: "2500" }), "0");
assert.equal(settledRmtExecutionFeeV2({ receiptStatus: "success", atomicSettlementVerified: true, expectedFeeAtomic: "2500" }), "2500");
assert.throws(() => settledRmtExecutionFeeV2({ receiptStatus: "success", atomicSettlementVerified: false, expectedFeeAtomic: "2500" }), /verified atomic/);

function mutatedEconomics(field: keyof RmtExecutionFeeV2Economics, value: unknown) {
  assert.throws(() => assertRmtExecutionFeeV2EconomicsMatchesPolicy({ ...economics, [field]: value } as RmtExecutionFeeV2Economics, policy));
}
mutatedEconomics("userGrossInputAtomic", "1000001");
mutatedEconomics("feeBasisAtomic", "999999");
mutatedEconomics("providerInputAtomic", "997501");
mutatedEconomics("expectedFeeAtomic", "2499");
mutatedEconomics("maximumFeeAtomic", "2501");
mutatedEconomics("feeAsset", outputAssetId);
mutatedEconomics("feeBps", 24);
mutatedEconomics("settlementMode", "v2-atomic-output-fee");
mutatedEconomics("treasury", "0x3333333333333333333333333333333333333333");
mutatedEconomics("policyVersion", 3);
mutatedEconomics("policyHash", `0x${"1".repeat(64)}`);

assert.throws(() => createRmtExecutionFeeV2Policy({ treasury: "0x3333333333333333333333333333333333333333", fromBlock: "40000000" }), /treasury changed/);
assert.throws(() => assertRmtExecutionFeeV2Policy({ ...policy, chainId: 1 } as unknown as RmtExecutionFeeV2Policy), /chain changed/);
assert.throws(() => assertRmtExecutionFeeV2Policy({ ...policy, version: 3 } as unknown as RmtExecutionFeeV2Policy), /version changed/);
assert.throws(() => assertRmtExecutionFeeV2Policy({ ...policy, policyHash: `0x${"2".repeat(64)}` }), /policy hash/);

assert.equal(configuredRmtExecutionFeeV2Policy({} as NodeJS.ProcessEnv), null);
assert.equal(configuredRmtExecutionFeeV2Policy({ RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED: "false" } as unknown as NodeJS.ProcessEnv), null);
assert.throws(() => configuredRmtExecutionFeeV2Policy({ RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED: "TRUE" } as unknown as NodeJS.ProcessEnv), /exact lowercase/);
assert.throws(() => configuredRmtExecutionFeeV2Policy({ RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED: "true" } as unknown as NodeJS.ProcessEnv), /treasury/);
assert.equal(configuredRmtExecutionFeeV2Policy({
  RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED: "true",
  RMT_VNEXT_EXECUTION_V2_TREASURY: RMT_EXECUTION_V2_TREASURY,
  RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK: "40000000",
  RMT_VNEXT_EXECUTION_V2_POLICY_HASH: policy.policyHash
} as unknown as NodeJS.ProcessEnv)?.policyHash, policy.policyHash);

const v1 = createRmtExecutionV1Policy({
  treasury: RMT_EXECUTION_V2_TREASURY,
  chainId: 4_663,
  fromBlock: "35041945",
  eligibleSettlementAssetIds: [
    "eip155:4663/native",
    "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168"
  ]
});
assert.equal(RMT_EXECUTION_V1_DESCRIPTOR.policyId, "RMT_EXECUTION_V1");
assert.equal(v1.policyHash, "0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141", "V1 history and policy hash must remain unchanged");

console.log("RMT universal execution fee V2 policy foundation smoke checks passed.");
