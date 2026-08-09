import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";
import type { VNextAuthorizationPlan } from "./authorization-plan";
import {
  decideVNextExecutionAuthority,
  vnextSpotTradeInstruction,
  type VNextExecutionAuthority,
  type VNextExecutionInstruction
} from "./execution-authority";

const now = 1_800_000_000_000;
const wallet = "0x1111111111111111111111111111111111111111";
const executor = "0x2222222222222222222222222222222222222222";
const guardSelector = toFunctionSelector("executeV3Exit((address,uint24,uint256,uint256,uint16,uint256,bytes32))");
const guardInstruction: VNextExecutionInstruction = {
  purpose: "position_guard_exit",
  chainId: 4_663,
  account: wallet,
  target: executor,
  data: `${guardSelector}${"00".repeat(32)}`,
  valueAtomic: "0",
  payloadHash: `0x${"a".repeat(64)}`,
  expiresAtMs: now + 30_000
};
const delegate: VNextExecutionAuthority = {
  mode: "bounded_privy_delegate",
  chainId: 4_663,
  account: wallet,
  executor,
  functionSelector: guardSelector,
  signerId: "signer_12345678",
  policyId: "policy_12345678",
  expiresAtMs: now + 60_000,
  purpose: "position_guard_exit"
};

assert.equal(decideVNextExecutionAuthority({ authority: delegate, instruction: guardInstruction, nowMs: now }).status, "delegated_submission_ready");
assert.deepEqual(decideVNextExecutionAuthority({
  authority: { mode: "interactive_wallet", chainId: 4_663, account: wallet },
  instruction: guardInstruction,
  nowMs: now
}), { status: "wallet_confirmation_required", account: wallet });
assert.equal(decideVNextExecutionAuthority({
  authority: delegate,
  instruction: { ...guardInstruction, purpose: "spot_trade" },
  nowMs: now
}).status, "blocked");
assert.deepEqual(decideVNextExecutionAuthority({
  authority: delegate,
  instruction: { ...guardInstruction, target: "0x3333333333333333333333333333333333333333" },
  nowMs: now
}), { status: "blocked", reason: "executor_mismatch" });
assert.deepEqual(decideVNextExecutionAuthority({
  authority: delegate,
  instruction: { ...guardInstruction, data: `0xdeadbeef${"00".repeat(32)}` },
  nowMs: now
}), { status: "blocked", reason: "function_not_delegated" });
assert.deepEqual(decideVNextExecutionAuthority({
  authority: delegate,
  instruction: { ...guardInstruction, valueAtomic: "1" },
  nowMs: now
}), { status: "blocked", reason: "native_value_not_delegated" });
assert.deepEqual(decideVNextExecutionAuthority({
  authority: { ...delegate, expiresAtMs: now + 20_000 },
  instruction: guardInstruction,
  nowMs: now
}), { status: "blocked", reason: "delegation_expired" });

const spotPlan = {
  planId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  sourceVerificationId: "33333333-3333-4333-8333-333333333333",
  provider: "uniswap-v3",
  kind: "swap",
  chainId: 4_663,
  target: "0x4444444444444444444444444444444444444444",
  data: `0x12345678${"00".repeat(32)}`,
  value: "0",
  gasLimit: "100000",
  payloadHash: `0x${"b".repeat(64)}`,
  inputAsset: "0x5555555555555555555555555555555555555555",
  outputAsset: "0x6666666666666666666666666666666666666666",
  inputAmountAtomic: "100",
  protectedOutputAtomic: "95",
  recipient: wallet,
  router: "0x4444444444444444444444444444444444444444",
  deadline: "1800000060",
  preparedAtMs: now,
  expiresAtMs: now + 30_000,
  userAuthorizationRequired: true,
  serverSubmissionEnabled: false
} satisfies VNextAuthorizationPlan;
const spotInstruction = vnextSpotTradeInstruction(spotPlan);
assert.equal(spotInstruction.purpose, "spot_trade");
assert.deepEqual(decideVNextExecutionAuthority({
  authority: delegate,
  instruction: spotInstruction,
  nowMs: now
}), { status: "blocked", reason: "purpose_not_delegated" });

console.log("RMT VNext execution-authority boundary smoke checks passed.");
