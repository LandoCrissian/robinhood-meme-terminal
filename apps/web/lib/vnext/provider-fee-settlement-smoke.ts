import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  createRmtExecutionFeeV2Policy,
  normalizeRmtExecutionFeeV2Input
} from "./execution-fee-policy-v2";
import {
  VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY,
  assertVNextWalletFeeAdmission,
  bindVNextAtomicFeeAuthorization,
  hasVNextWalletAuthorizationCodec,
  isVNextWalletFeeSettlementAdmitted,
  type VNextAdmittedFeeSettlement,
  type VNextAtomicFeeSettlementProof
} from "./provider-fee-settlement";

const providers = ["sushi", "uniswap-v3", "uniswap-v4", "uniswapx", "zero-x-swap", "zero-x-gasless", "up-v2", "up-cl"] as const;
for (const provider of providers) {
  assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY[provider].state, "QUOTE_ONLY");
  assert.equal(isVNextWalletFeeSettlementAdmitted(provider), false);
}
assert.equal(hasVNextWalletAuthorizationCodec("uniswap-v3"), true);
assert.equal(hasVNextWalletAuthorizationCodec("uniswap-v4"), false, "V4 remains quote-only without a wallet codec");
assert.equal(hasVNextWalletAuthorizationCodec("up-v2"), true);
assert.equal(hasVNextWalletAuthorizationCodec("up-cl"), true);
assert.equal(hasVNextWalletAuthorizationCodec("sushi"), false, "PR #427 remains separate and draft");

const policy = createRmtExecutionFeeV2Policy({ treasury: getAddress("0x7777777777777777777777777777777777777777"), fromBlock: "40000000" });
const economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: "eip155:4663/contract:0x1111111111111111111111111111111111111111",
  outputAssetId: "eip155:4663/contract:0x2222222222222222222222222222222222222222",
  userGrossInputAtomic: "1000000",
  providerGrossExpectedOutputAtomic: "2000000",
  providerProtectedOutputAtomic: "1900000",
  settlementMode: "v2-atomic-input-fee"
});
const capability: VNextAdmittedFeeSettlement = {
  state: "V2_ATOMIC_INPUT_FEE",
  requiredMode: "v2-atomic-input-fee",
  implementationId: "test-atomic-input-fee-v2",
  walletCodecImplemented: true,
  currentSettlement: "test-only",
  requiredImplementation: "test-only"
};
const proof: VNextAtomicFeeSettlementProof = {
  verificationState: "verified_atomic",
  provider: "uniswap-v3",
  settlementMode: "v2-atomic-input-fee",
  implementationId: capability.implementationId,
  executionTarget: getAddress("0x3333333333333333333333333333333333333333"),
  providerTarget: getAddress("0x4444444444444444444444444444444444444444"),
  calldataHash: `0x${"1".repeat(64)}`,
  executionId: `0x${"2".repeat(64)}`,
  recipient: getAddress("0x5555555555555555555555555555555555555555"),
  deadline: "1800000060",
  atomicFeeSettlement: true,
  revertsAtomically: true
};
const authorization = bindVNextAtomicFeeAuthorization({ economics, proof });

assert.equal(assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: proof, authorization, capability
}), true);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: proof, authorization
}), /no admitted V2/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy: null, economics, verification: proof, authorization, capability
}), /active V2 policy/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics: null, verification: proof, authorization, capability
}), /commitment is missing/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: null, authorization, capability
}), /proof is missing/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: proof, authorization: null, capability
}), /binding is missing/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: { ...proof, providerTarget: proof.executionTarget }, authorization, capability
}), /provider target changed/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: proof,
  authorization: { ...authorization, expectedFeeAtomic: "2499" }, capability
}), /expectedFeeAtomic changed/);
assert.throws(() => assertVNextWalletFeeAdmission({
  provider: "uniswap-v3", policy, economics, verification: { ...proof, atomicFeeSettlement: false as true }, authorization, capability
}), /not proven atomic/);

console.log("RMT provider V2 fee-settlement admission foundation smoke checks passed.");
