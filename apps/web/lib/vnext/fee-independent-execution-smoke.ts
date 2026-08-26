import assert from "node:assert/strict";
import { encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { requireAuthenticatedTradeWallet } from "../server/rmt-trade-identity";
import { authorizationPayloadHash, parseVNextAuthorizationPlan, type VNextAuthorizationPlan } from "./authorization-plan";
import {
  DIRECT_SMOKE_APPROVAL_EVIDENCE,
  DIRECT_SMOKE_APPROVAL_PLAN,
  DIRECT_SMOKE_INPUT,
  DIRECT_SMOKE_NOW_MS,
  DIRECT_SMOKE_RECIPIENT,
  DIRECT_SMOKE_SWAP_EVIDENCE,
  DIRECT_SMOKE_SWAP_PLAN
} from "./direct-no-rmt-fee-smoke-fixture";
import { vnextSpotTradeInstruction } from "./execution-authority";
import { VNEXT_DIRECT_NO_RMT_FEE } from "./execution-settlement";
import { FEE_V2_SMOKE_SWAP_EVIDENCE, FEE_V2_SMOKE_SWAP_PLAN } from "./fee-v2-smoke-fixture";
import { prepareVNextWalletTransaction } from "./wallet-submission";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY } from "./provider-fee-settlement";
import { vNextUniswapV4Adapter } from "../server/vnext-uniswap-v4-adapter";

function rehash(plan: VNextAuthorizationPlan, change: Partial<VNextAuthorizationPlan>) {
  const changed = { ...plan, ...change };
  return { ...changed, payloadHash: authorizationPayloadHash(changed) };
}

async function run() {
const direct = parseVNextAuthorizationPlan(DIRECT_SMOKE_SWAP_PLAN, DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1);
assert.equal(direct.settlementMode, VNEXT_DIRECT_NO_RMT_FEE, "fee-free verified trade reaches wallet authorization");
assert.equal(direct.directNoRmtFee?.userGrossInputAtomic, direct.directNoRmtFee?.providerInputAtomic, "gross input remains exact");
assert.equal(direct.directNoRmtFee?.rmtFeeAtomic, "0");
assert.equal(direct.directNoRmtFee?.treasuryTransferAtomic, "0");
assert.equal(direct.directNoRmtFee?.feeRecipient, null);
assert.equal(direct.directNoRmtFee?.feePolicyRequired, false);
assert.equal(direct.directNoRmtFee?.feeExecutorRequired, false);
assert.equal(direct.feeV2Economics, undefined, "DIRECT_NO_RMT_FEE requires no V2 economics");
assert.equal(direct.feeV2Authorization, undefined, "DIRECT_NO_RMT_FEE requires no V2 authorization");

const instruction = vnextSpotTradeInstruction(direct);
assert.equal(instruction.target.toLowerCase(), direct.router.toLowerCase());
const walletTransaction = prepareVNextWalletTransaction({
  plan: direct,
  evidence: DIRECT_SMOKE_SWAP_EVIDENCE,
  connectedAddress: DIRECT_SMOKE_RECIPIENT,
  connectedChainId: 4_663,
  nowMs: DIRECT_SMOKE_NOW_MS + 1
});
assert.equal(walletTransaction.to.toLowerCase(), direct.router.toLowerCase());

assert.throws(() => parseVNextAuthorizationPlan(rehash(direct, {
  recipient: "0x9999999999999999999999999999999999999999"
}), DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /inconsistent authorization plan/);
assert.throws(() => parseVNextAuthorizationPlan(rehash(direct, {
  inputAmountAtomic: "999999"
}), DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /inconsistent authorization plan/);
assert.throws(() => parseVNextAuthorizationPlan(rehash(direct, {
  protectedOutputAtomic: "989"
}), DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /inconsistent authorization plan/);
assert.throws(() => parseVNextAuthorizationPlan(rehash(direct, {
  deadline: "1786000299"
}), DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /inconsistent authorization plan/);
assert.throws(() => parseVNextAuthorizationPlan(rehash(direct, {
  target: "0x9999999999999999999999999999999999999999"
}), DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /DIRECT_NO_RMT_FEE|fee-free swap plan/);
assert.throws(() => parseVNextAuthorizationPlan(rehash(direct, {
  data: "0xdeadbeef"
}), DIRECT_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /DIRECT_NO_RMT_FEE|fee-free swap plan/);
assert.throws(() => parseVNextAuthorizationPlan(direct, {
  ...DIRECT_SMOKE_SWAP_EVIDENCE,
  calldataHash: `0x${"9".repeat(64)}`
}, DIRECT_SMOKE_NOW_MS + 1), /DIRECT_NO_RMT_FEE|fee-free swap plan/);

const expandedApproval = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [DIRECT_SMOKE_APPROVAL_EVIDENCE.router as `0x${string}`, 1_000_001n]
});
assert.throws(() => parseVNextAuthorizationPlan(rehash(DIRECT_SMOKE_APPROVAL_PLAN, {
  data: expandedApproval
}), {
  ...DIRECT_SMOKE_APPROVAL_EVIDENCE,
  nextActionCalldataHash: keccak256(expandedApproval)
}, DIRECT_SMOKE_NOW_MS + 1));
assert.throws(() => parseVNextAuthorizationPlan(rehash(DIRECT_SMOKE_APPROVAL_PLAN, {
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: ["0x9999999999999999999999999999999999999999", 1_000_000n]
  })
}), DIRECT_SMOKE_APPROVAL_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1));

assert.throws(() => parseVNextAuthorizationPlan(direct, DIRECT_SMOKE_SWAP_EVIDENCE, direct.expiresAtMs), /inconsistent authorization plan/);
assert.throws(() => prepareVNextWalletTransaction({
  plan: direct,
  evidence: DIRECT_SMOKE_SWAP_EVIDENCE,
  connectedAddress: DIRECT_SMOKE_RECIPIENT,
  connectedChainId: 1,
  nowMs: DIRECT_SMOKE_NOW_MS + 1
}), /wrong chain/);
await assert.rejects(() => requireAuthenticatedTradeWallet(
  new Request("https://rmtlaunch.fun/api/vnext/authorize", { method: "POST" }),
  DIRECT_SMOKE_RECIPIENT
), /Sign in to RMT/);
assert.throws(() => vnextSpotTradeInstruction(rehash(direct, {
  target: "0x9999999999999999999999999999999999999999"
})), /DIRECT_NO_RMT_FEE|fee-free spot execution authority/);
assert.throws(() => vnextSpotTradeInstruction({
  ...direct,
  data: "0xdeadbeef"
}), /DIRECT_NO_RMT_FEE|fee-free spot execution authority/);
assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_SWAP_PLAN,
  feeV2Economics: undefined,
  feeV2Authorization: undefined
}, FEE_V2_SMOKE_SWAP_EVIDENCE, DIRECT_SMOKE_NOW_MS + 1), /without complete V2 fee authority/);
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v4"].state, "QUOTE_ONLY");
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v4"].walletCodecImplemented, true);
assert.equal(vNextUniswapV4Adapter.capabilities.walletAuthorization, true);
assert.equal(vNextUniswapV4Adapter.capabilities.strictVerification, true);

console.log("RMT fee-independent execution and adversarial binding checks passed.");
}

void run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
