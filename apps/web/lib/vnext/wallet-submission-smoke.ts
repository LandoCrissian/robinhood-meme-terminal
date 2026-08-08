import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { prepareVNextWalletTransaction } from "./wallet-submission";

const now = 1_786_000_000_000;
const inputAsset = "0x1111111111111111111111111111111111111111";
const outputAsset = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROBINHOOD_SWAP_ROUTER_02, 1_000_000n] });
const evidence: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3", status: "approval_required", chainId: 4_663,
  inputAsset, outputAsset, inputAmountAtomic: "1000000", expectedOutputAtomic: "1000",
  protectedOutputAtomic: "990", recipient, router: ROBINHOOD_SWAP_ROUTER_02,
  approvalSpender: ROBINHOOD_SWAP_ROUTER_02, approvalRequired: true, sufficientBalance: true,
  allowanceAtomic: "0", balanceAtomic: "2000000", route: "direct", fees: [3_000],
  pools: ["0x4444444444444444444444444444444444444444"], deadline: "1786000300",
  calldataHash: `0x${"1".repeat(64)}`, nextAction: "approval", nextActionTarget: inputAsset,
  nextActionCalldataHash: keccak256(data), nativeBalanceWei: "1000000000000000",
  gasPriceWei: "1000000000", estimatedGasUnits: "50000", gasLimitUnits: "60000",
  estimatedNetworkCostWei: "60000000000000", gasState: "sufficient",
  routerRuntimeHash: `0x${"2".repeat(64)}`, factoryRuntimeHash: `0x${"3".repeat(64)}`,
  quoterRuntimeHash: `0x${"4".repeat(64)}`, exactSimulationPassed: false, userPaysGas: true,
  rmtFeeEnabled: false, verifiedAtMs: now - 1_000, expiresAtMs: now + 300_000, authorizationReady: false
};
const unsigned = {
  planId: "33333333-3333-4333-8333-333333333333",
  sourceQuoteRequestId: evidence.sourceQuoteRequestId, sourceVerificationId: evidence.verificationId,
  provider: "uniswap-v3" as const, kind: "erc20_approval" as const, chainId: 4_663 as const,
  target: inputAsset, data, value: "0" as const, gasLimit: "60000", inputAsset, outputAsset,
  inputAmountAtomic: "1000000", protectedOutputAtomic: "990", recipient,
  router: ROBINHOOD_SWAP_ROUTER_02, deadline: evidence.deadline,
  preparedAtMs: now, expiresAtMs: now + 60_000,
  userAuthorizationRequired: true as const, serverSubmissionEnabled: false as const
};
const plan: VNextAuthorizationPlan = { ...unsigned, payloadHash: authorizationPayloadHash(unsigned) };
const transaction = prepareVNextWalletTransaction({
  plan, evidence, connectedAddress: recipient, connectedChainId: 4_663, nowMs: now + 1
});
assert.equal(transaction.account, recipient);
assert.equal(transaction.chainId, 4_663);
assert.equal(transaction.to, inputAsset);
assert.equal(transaction.data, data);
assert.equal(transaction.value, 0n);
assert.equal(transaction.gas, 60_000n);
assert.throws(() => prepareVNextWalletTransaction({ plan, evidence, connectedAddress: recipient, connectedChainId: 1, nowMs: now + 1 }), /wrong chain/);
assert.throws(() => prepareVNextWalletTransaction({ plan, evidence, connectedAddress: outputAsset, connectedChainId: 4_663, nowMs: now + 1 }), /verified recipient/);
assert.throws(() => prepareVNextWalletTransaction({ plan, evidence, connectedAddress: recipient, connectedChainId: 4_663, nowMs: now + 60_001 }), /inconsistent authorization plan/);
assert.throws(() => prepareVNextWalletTransaction({ plan: { ...plan, gasLimit: "60001" }, evidence, connectedAddress: recipient, connectedChainId: 4_663, nowMs: now + 1 }));

const component = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("./wallet-submission.ts", import.meta.url), "utf8");
assert.match(component, /NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true"/);
assert.match(component, /useSendTransaction/);
assert.match(component, /prepareVNextWalletTransaction/);
assert.match(component, /recordSubmittedVNextExecution/);
assert.match(component, /findUnresolvedVNextExecution/);
assert.match(component, /autoRequest/);
assert.match(component, /automaticallyRequestedPlan/);
assert.match(component, /void requestWalletReview\(\)/);
assert.match(component, /Standard ERC-20 approvals have no onchain expiry/);
assert.match(component, /swap calldata enforces its onchain deadline and protected output/);
assert.match(helper, /parseVNextAuthorizationPlan/);
assert.match(helper, /connectedChainId !== ROBINHOOD_MAINNET_CHAIN_ID/);
assert.doesNotMatch(component, /fetch\s*\(|writeContract|signTypedData|PRIVATE_KEY|MNEMONIC/);
assert.doesNotMatch(helper, /fetch\s*\(|sendTransaction|writeContract|signTypedData/);

console.log("RMT VNext exact wallet-submission boundary smoke checks passed.");
