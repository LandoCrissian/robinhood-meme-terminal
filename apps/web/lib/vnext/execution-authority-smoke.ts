import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";
import { FEE_V2_SMOKE_SWAP_PLAN } from "./fee-v2-smoke-fixture";
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

const spotPlan = { ...FEE_V2_SMOKE_SWAP_PLAN, expiresAtMs: now + 30_000 };
const spotInstruction = vnextSpotTradeInstruction(spotPlan);
assert.equal(spotInstruction.purpose, "spot_trade");
assert.deepEqual(decideVNextExecutionAuthority({
  authority: { ...delegate, account: spotPlan.recipient },
  instruction: spotInstruction,
  nowMs: now
}), { status: "blocked", reason: "purpose_not_delegated" });
assert.throws(() => vnextSpotTradeInstruction({
  ...spotPlan,
  feeV2Economics: undefined,
  feeV2Authorization: undefined
}), /without complete V2 fee settlement/);

console.log("RMT VNext execution-authority boundary smoke checks passed.");
