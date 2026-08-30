import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VNextAuthorizationPlan } from "./authorization-plan";
import {
  findUnresolvedVNextExecution,
  normalizeVNextExecutionJournal,
  readVNextExecutionJournal,
  recordSubmittedVNextExecution,
  resolveVNextExecution,
  settledVNextOutputAtomic,
  VNEXT_EXECUTION_STORAGE_KEY,
  type VNextExecutionStorage
} from "./execution-recovery";
import { encodeAbiParameters, encodeEventTopics, zeroAddress, type Hex } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";

const wallet = "0x1111111111111111111111111111111111111111";
const inputAsset = "0x2222222222222222222222222222222222222222";
const outputAsset = "0x3333333333333333333333333333333333333333";
const now = 1_786_000_000_000;
const plan = {
  planId: "11111111-1111-4111-8111-111111111111",
  kind: "swap", recipient: wallet, inputAsset, outputAsset, inputAmountAtomic: "1000000",
  payloadHash: `0x${"a".repeat(64)}`
} as VNextAuthorizationPlan;
const txHash = `0x${"b".repeat(64)}`;
const secondHash = `0x${"c".repeat(64)}`;
const values = new Map<string, string>();
const storage: VNextExecutionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); }
};

const submitted = recordSubmittedVNextExecution({ wallet, plan, txHash }, storage, now);
assert.equal(submitted?.state, "submitted");
assert.equal(submitted?.txHash, txHash);
assert.equal(findUnresolvedVNextExecution(wallet, storage, now + 1)?.txHash, txHash);
assert.equal(recordSubmittedVNextExecution({ wallet, plan, txHash }, storage, now + 1)?.txHash, txHash);
assert.doesNotMatch(values.get(VNEXT_EXECUTION_STORAGE_KEY) ?? "", /calldata|0x1234/);
assert.equal(resolveVNextExecution(txHash, "confirmed", storage, now + 2)?.state, "confirmed");
assert.equal(findUnresolvedVNextExecution(wallet, storage, now + 3), null);
assert.equal(recordSubmittedVNextExecution({ wallet, plan: { ...plan, planId: "22222222-2222-4222-8222-222222222222" }, txHash: secondHash }, storage, now + 3)?.state, "submitted");
assert.equal(resolveVNextExecution(secondHash, "reverted", storage, now + 4)?.state, "reverted");
assert.equal(readVNextExecutionJournal(storage, now + 5).length, 2);
assert.deepEqual(normalizeVNextExecutionJournal([{ bad: true }], now), []);
assert.equal(recordSubmittedVNextExecution({ wallet: outputAsset, plan, txHash }, storage, now), null);

const swapRecord = { ...submitted!, kind: "swap" as const };
const transferTopics = encodeEventTopics({
  abi: [{ type: "event", name: "Transfer", anonymous: false, inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" }
  ] }] as const,
  eventName: "Transfer",
  args: { from: inputAsset, to: wallet }
});
const outputLog = (value: bigint, address = outputAsset) => ({
  address,
  topics: transferTopics.flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []),
  data: encodeAbiParameters([{ type: "uint256" }], [value])
});
assert.equal(settledVNextOutputAtomic(swapRecord, [outputLog(700n), outputLog(300n)]), "1000");
assert.equal(settledVNextOutputAtomic(swapRecord, [outputLog(1000n, inputAsset)]), null);
assert.equal(settledVNextOutputAtomic({ ...swapRecord, kind: "erc20_approval" }, [outputLog(1000n)]), null);

const feeCommitment = {
  executor: "0x4444444444444444444444444444444444444444",
  executionId: `0x${"4".repeat(64)}`,
  policyIdHash: `0x${"5".repeat(64)}`,
  policyHash: `0x${"6".repeat(64)}`,
  policyVersion: 1,
  treasury: "0x5555555555555555555555555555555555555555",
  feeAsset: inputAsset,
  feeBps: 25,
  feeSide: "input" as const,
  routeIdentity: `0x${"7".repeat(64)}`,
  providerInputAtomic: "997500",
  protectedUserNetOutputAtomic: "990",
  maximumFeeAtomic: "2500"
};
const approvalWithFutureFee = {
  ...plan,
  kind: "erc20_approval" as const,
  feeExecution: feeCommitment
} as VNextAuthorizationPlan;
const approvalStorageValues = new Map<string, string>();
const approvalStorage: VNextExecutionStorage = {
  getItem: (key) => approvalStorageValues.get(key) ?? null,
  setItem: (key, value) => { approvalStorageValues.set(key, value); }
};
const approvalRecord = recordSubmittedVNextExecution({ wallet, plan: approvalWithFutureFee, txHash }, approvalStorage, now);
assert.equal(approvalRecord?.kind, "erc20_approval");
assert.equal(approvalRecord?.feeSettlement, undefined, "approval recovery must not expect a swap settlement event");

const legacyApprovalRecord = {
  ...approvalRecord!,
  feeSettlement: feeCommitment
};
assert.equal(normalizeVNextExecutionJournal([legacyApprovalRecord], now)[0]?.feeSettlement, undefined,
  "legacy approval records must retain receipt recovery while dropping swap-only fee metadata");
const withdrawalTopics = encodeEventTopics({
  abi: [{ type: "event", name: "Withdrawal", anonymous: false, inputs: [
    { indexed: true, name: "src", type: "address" },
    { indexed: false, name: "wad", type: "uint256" }
  ] }] as const,
  eventName: "Withdrawal",
  args: { src: ROBINHOOD_SWAP_ROUTER_02 }
});
const withdrawalLog = (value: bigint, address = ROBINHOOD_WETH, src = ROBINHOOD_SWAP_ROUTER_02) => ({
  address,
  topics: encodeEventTopics({
    abi: [{ type: "event", name: "Withdrawal", anonymous: false, inputs: [
      { indexed: true, name: "src", type: "address" },
      { indexed: false, name: "wad", type: "uint256" }
    ] }] as const,
    eventName: "Withdrawal",
    args: { src }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []),
  data: encodeAbiParameters([{ type: "uint256" }], [value])
});
assert.equal(withdrawalTopics.length, 2);
const nativeSwapRecord = { ...swapRecord, outputAsset: zeroAddress };
assert.equal(settledVNextOutputAtomic(nativeSwapRecord, [withdrawalLog(1_234n)]), "1234");
assert.equal(settledVNextOutputAtomic(nativeSwapRecord, [withdrawalLog(700n), withdrawalLog(300n)]), null);
assert.equal(settledVNextOutputAtomic(nativeSwapRecord, [withdrawalLog(1_234n, inputAsset)]), null);
assert.equal(settledVNextOutputAtomic(nativeSwapRecord, [withdrawalLog(1_234n, ROBINHOOD_WETH, inputAsset)]), null);

const settledValues = new Map<string, string>();
const settledStorage: VNextExecutionStorage = { getItem: (key) => settledValues.get(key) ?? null, setItem: (key, value) => { settledValues.set(key, value); } };
recordSubmittedVNextExecution({ wallet, plan: { ...plan, kind: "swap" }, txHash }, settledStorage, now);
assert.equal(resolveVNextExecution(txHash, "confirmed", settledStorage, now + 1, { outputAmountAtomic: "1000" })?.outputAmountAtomic, "1000");
assert.equal(readVNextExecutionJournal(settledStorage, now + 2)[0]?.outputAmountAtomic, "1000");
assert.equal(resolveVNextExecution(txHash, "confirmed", settledStorage, now + 3, { outputAmountAtomic: "0" }), null);

const oldValues = new Map<string, string>();
const oldStorage: VNextExecutionStorage = { getItem: (key) => oldValues.get(key) ?? null, setItem: (key, value) => { oldValues.set(key, value); } };
recordSubmittedVNextExecution({ wallet, plan, txHash }, oldStorage, now - 24 * 60 * 60 * 1_000 - 1);
assert.equal(findUnresolvedVNextExecution(wallet, oldStorage, now), null);

const hook = readFileSync(new URL("../../app/vnext/use-vnext-execution-recovery.ts", import.meta.url), "utf8");
const banner = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const spendBalance = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
assert.match(hook, /useWaitForTransactionReceipt/);
assert.match(hook, /resolveVNextExecution/);
assert.match(hook, /settledVNextOutputAtomic/);
assert.match(hook, /record\.kind === "swap" && record\.feeSettlement/);
assert.match(hook, /receipt\.data\.transactionHash\.toLowerCase\(\) !== record\.txHash\.toLowerCase\(\)/);
assert.match(hook, /VNEXT_EXECUTION_STORAGE_KEY/);
assert.match(banner, /Do not resubmit/);
assert.match(walletReview, /findUnresolvedVNextExecution/);
assert.match(walletReview, /recordPreparedVNextWalletRequest/);
assert.match(walletReview, /PROMPT_REQUESTED/);
assert.match(walletReview, /promoteVNextWalletRequestToSubmitted/);
assert.doesNotMatch(walletReview, /autoRequest/);
assert.match(spendBalance, /executionRecord\.state !== "confirmed"/);
assert.match(spendBalance, /SETTLEMENT_BALANCE_REFRESH_DELAYS_MS/);
assert.match(spendBalance, /void refreshBalances\.current\(false\)/);
assert.match(banner, /record\.outputAmountAtomic/);
assert.doesNotMatch(hook, /sendTransaction|writeContract|signTypedData/);
assert.doesNotMatch(banner, /sendTransaction|writeContract|signTypedData/);

console.log("RMT VNext transaction recovery and balance-refresh smoke checks passed.");
