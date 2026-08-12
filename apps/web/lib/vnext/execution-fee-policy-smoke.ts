import assert from "node:assert/strict";
import {
  RMT_EXECUTION_V1_DESCRIPTOR,
  assertRmtExecutionFeePolicy,
  assertRmtFeeCommitment,
  assertRmtFeeCommitmentMatchesPolicy,
  assertRmtNetExecutionEconomics,
  calculateRmtFeeFloor,
  createRmtExecutionFeePolicy,
  createRmtExecutionV1Policy,
  disabledRmtFeeCommitment,
  normalizeDisabledRmtFee,
  normalizeInputSideRmtFee,
  normalizeOutputSideRmtFee,
  type RmtExecutionFeePolicy,
  type RmtFeeCommitment
} from "./execution-fee-policy";

const fixtureTreasury = "0x1111111111111111111111111111111111111111";
const usdgId = "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const wethId = "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const tokenId = "eip155:4663/contract:0x3333333333333333333333333333333333333333";

assert.deepEqual(RMT_EXECUTION_V1_DESCRIPTOR, {
  policyId: "RMT_EXECUTION_V1",
  version: 1,
  feeBps: 25,
  allocation: { purpose: "rmt_operations", bps: 10_000 }
});

const policy = createRmtExecutionV1Policy({
  treasury: fixtureTreasury,
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: [wethId, usdgId]
});

assert.equal(assertRmtExecutionFeePolicy(policy), true);
assert.equal(policy.feeBps, 25);
assert.equal(policy.treasury, fixtureTreasury);
assert.deepEqual(policy.eligibleSettlementAssetIds, [wethId, usdgId].sort());
assert.equal(policy.allocation.purpose, "rmt_operations");
assert.equal(policy.allocation.bps, 10_000);
assert.match(policy.policyHash, /^0x[0-9a-f]{64}$/);

const reordered = createRmtExecutionV1Policy({
  treasury: fixtureTreasury,
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: [usdgId, wethId]
});
assert.equal(reordered.policyHash, policy.policyHash, "asset input order must not change canonical policy identity");

const laterBoundary = createRmtExecutionV1Policy({
  treasury: fixtureTreasury,
  chainId: 4_663,
  fromBlock: "123457",
  eligibleSettlementAssetIds: [usdgId, wethId]
});
assert.notEqual(laterBoundary.policyHash, policy.policyHash, "effective-boundary mutation must change policy identity");

const otherTreasury = createRmtExecutionV1Policy({
  treasury: "0x2222222222222222222222222222222222222222",
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: [usdgId, wethId]
});
assert.notEqual(otherTreasury.policyHash, policy.policyHash, "treasury substitution must change policy identity");

assert.throws(() => assertRmtExecutionFeePolicy({ ...policy, feeBps: 26 } as RmtExecutionFeePolicy), /policy hash/);
assert.throws(() => assertRmtExecutionFeePolicy({ ...policy, policyId: "RMT_EXECUTION_V2" } as RmtExecutionFeePolicy), /policy hash/);
assert.throws(() => assertRmtExecutionFeePolicy({ ...policy, version: 2 } as RmtExecutionFeePolicy), /policy hash/);
assert.throws(() => createRmtExecutionFeePolicy({
  policyId: "RMT_EXECUTION_V1",
  version: 1,
  feeBps: 25,
  treasury: "",
  effectiveBoundary: { chainId: 4_663, fromBlock: "123456", beforeBlock: null },
  eligibleSettlementAssetIds: [usdgId]
}), /treasury/);
assert.throws(() => createRmtExecutionV1Policy({
  treasury: "0x0000000000000000000000000000000000000000",
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: [usdgId]
}), /zero or a router sentinel/);
assert.throws(() => createRmtExecutionFeePolicy({
  policyId: "RMT_EXECUTION_V1",
  version: 1,
  feeBps: 0,
  treasury: fixtureTreasury,
  effectiveBoundary: { chainId: 4_663, fromBlock: "123456", beforeBlock: null },
  eligibleSettlementAssetIds: [usdgId]
}), /between 1 and 100/);
assert.throws(() => createRmtExecutionV1Policy({
  treasury: fixtureTreasury,
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: ["eip155:8453/contract:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"]
}), /policy chain/);
assert.throws(() => createRmtExecutionV1Policy({
  treasury: fixtureTreasury,
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: [usdgId, usdgId]
}), /unique/);

assert.equal(calculateRmtFeeFloor("100000000", 25), "250000");
assert.equal(calculateRmtFeeFloor("399", 25), "0", "tiny trades legitimately round to zero");
assert.equal(calculateRmtFeeFloor("400", 25), "1");

const buy = normalizeInputSideRmtFee({
  policy,
  inputAssetId: usdgId,
  outputAssetId: tokenId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "100000000",
  providerGrossExpectedOutputAtomic: "25000000000000000000000",
  providerProtectedOutputAtomic: "24500000000000000000000"
});
assert.equal(assertRmtNetExecutionEconomics(buy), true);
assert.equal(assertRmtFeeCommitmentMatchesPolicy(buy.rmtFee, policy), true);
assert.equal(buy.providerInputAtomic, "99750000");
assert.equal(buy.rmtFee.expectedFeeAtomic, "250000");
assert.equal(buy.rmtFee.maximumFeeAtomic, "250000");
assert.equal(buy.expectedUserNetOutputAtomic, buy.providerGrossExpectedOutputAtomic);
assert.equal(buy.protectedUserNetOutputAtomic, buy.providerProtectedOutputAtomic);

const sell = normalizeOutputSideRmtFee({
  policy,
  inputAssetId: tokenId,
  outputAssetId: usdgId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "1000000000000000000",
  providerGrossExpectedOutputAtomic: "100000000",
  providerProtectedOutputAtomic: "98000000"
});
assert.equal(assertRmtNetExecutionEconomics(sell), true);
assert.equal(sell.providerInputAtomic, sell.userGrossInputAtomic);
assert.equal(sell.rmtFee.expectedFeeAtomic, "250000");
assert.equal(sell.expectedUserNetOutputAtomic, "99750000");
assert.equal(sell.protectedUserNetOutputAtomic, "97755000");
assert.equal(BigInt(sell.expectedUserNetOutputAtomic) + BigInt(sell.rmtFee.expectedFeeAtomic), BigInt(sell.providerGrossExpectedOutputAtomic));

const tiny = normalizeOutputSideRmtFee({
  policy,
  inputAssetId: tokenId,
  outputAssetId: usdgId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "1",
  providerGrossExpectedOutputAtomic: "399",
  providerProtectedOutputAtomic: "1"
});
assert.equal(tiny.rmtFee.expectedFeeAtomic, "0");
assert.equal(tiny.expectedUserNetOutputAtomic, "399");
assert.equal(assertRmtNetExecutionEconomics(tiny), true);

const disabled = normalizeDisabledRmtFee({
  userGrossInputAtomic: "100000000",
  providerGrossExpectedOutputAtomic: "500000000000000000000",
  providerProtectedOutputAtomic: "490000000000000000000"
});
assert.equal(assertRmtNetExecutionEconomics(disabled), true);
assert.deepEqual(disabled.rmtFee, disabledRmtFeeCommitment());
assert.equal(disabled.userGrossInputAtomic, disabled.providerInputAtomic);
assert.equal(disabled.expectedUserNetOutputAtomic, disabled.providerGrossExpectedOutputAtomic);

assert.throws(() => normalizeInputSideRmtFee({
  policy,
  inputAssetId: usdgId,
  outputAssetId: tokenId,
  feeAssetId: tokenId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "100000000",
  providerGrossExpectedOutputAtomic: "1000",
  providerProtectedOutputAtomic: "900"
}), /input-side fee asset/);
assert.throws(() => normalizeInputSideRmtFee({
  policy,
  inputAssetId: usdgId,
  outputAssetId: tokenId,
  feeAssetId: wethId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "100000000",
  providerGrossExpectedOutputAtomic: "1000",
  providerProtectedOutputAtomic: "900"
}), /input-side fee asset/);
assert.throws(() => assertRmtNetExecutionEconomics({
  ...buy,
  providerInputAtomic: "99750001"
}), /provider input plus fee/);
assert.throws(() => assertRmtNetExecutionEconomics({
  ...sell,
  expectedUserNetOutputAtomic: "99750001"
}), /does not balance/);
assert.throws(() => assertRmtFeeCommitment({
  ...sell.rmtFee,
  maximumFeeAtomic: "249999"
} as RmtFeeCommitment), /authorized maximum/);
assert.throws(() => assertRmtFeeCommitmentMatchesPolicy({
  ...sell.rmtFee,
  treasury: "0x2222222222222222222222222222222222222222"
} as RmtFeeCommitment, policy), /exact policy/);
assert.throws(() => assertRmtNetExecutionEconomics({
  ...sell,
  rmtFee: { ...sell.rmtFee, feeBps: 24 } as RmtFeeCommitment
}), /output-side fee does not match policy math/);
assert.throws(() => normalizeOutputSideRmtFee({
  policy,
  inputAssetId: tokenId,
  outputAssetId: usdgId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "1",
  providerGrossExpectedOutputAtomic: "100",
  providerProtectedOutputAtomic: "101"
}), /protected provider output exceeds expected output/);
assert.throws(() => normalizeOutputSideRmtFee({
  policy,
  inputAssetId: tokenId,
  outputAssetId: usdgId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "1",
  providerGrossExpectedOutputAtomic: "0",
  providerProtectedOutputAtomic: "0"
}), /gross expected provider output must be positive/);

console.log("RMT VNext versioned execution-fee policy and net economics checks passed.");
