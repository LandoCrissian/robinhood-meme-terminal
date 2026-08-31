import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import {
  findUnresolvedVNextExecution,
  normalizeVNextExecutionJournal,
  readVNextExecutionJournal,
  readVNextWalletRequestJournal,
  recordPreparedVNextWalletRequest,
  recordSubmittedVNextExecution,
  resolveVNextExecution,
  settledVNextOutputAtomic,
  VNEXT_EXECUTION_STORAGE_KEY,
  type VNextExecutionStorage
} from "./execution-recovery";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, zeroAddress, type Hex } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";
import { createRmtExecutionV1Policy, normalizeInputSideRmtFee } from "./execution-fee-policy";
import { createRmtUniswapV3FeeExecution, encodeRmtUniswapV3FeeExecution } from "./uniswap-v3-fee-executor";
import { RMT_UNISWAP_V3_FEE_MAINNET_PROOF } from "./uniswap-v3-fee-mainnet-proof";
import { VNEXT_LEGACY_V1_FEE } from "./execution-settlement";
import { ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";
import { DIRECT_SMOKE_RECIPIENT, DIRECT_SMOKE_SWAP_PLAN } from "./direct-no-rmt-fee-smoke-fixture";
import { FEE_V2_SMOKE_RECIPIENT, FEE_V2_SMOKE_SWAP_PLAN } from "./fee-v2-smoke-fixture";

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

const makeStorage = () => {
  const stored = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); }
    } satisfies VNextExecutionStorage,
    stored
  };
};
const v1Output = getAddress("0x6666666666666666666666666666666666666666");
const v1Pool = getAddress("0x7777777777777777777777777777777777777777");
const v1Policy = createRmtExecutionV1Policy({
  treasury: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.treasury,
  chainId: 4_663,
  fromBlock: "35041945",
  eligibleSettlementAssetIds: [
    "eip155:4663/native",
    `eip155:4663/contract:${ROBINHOOD_WETH_ADDRESS.toLowerCase()}`,
    "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168"
  ]
});
const v1Economics = normalizeInputSideRmtFee({
  policy: v1Policy,
  inputAssetId: "eip155:4663/native",
  outputAssetId: `eip155:4663/contract:${v1Output.toLowerCase()}`,
  feeAssetId: "eip155:4663/native",
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "100000000000000",
  providerGrossExpectedOutputAtomic: "1000000",
  providerProtectedOutputAtomic: "990000"
});
const v1Deadline = (BigInt(now) / 1_000n + 240n).toString();
const v1Execution = createRmtUniswapV3FeeExecution({
  executor: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor,
  executorRuntimeHash: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash,
  executionId: `0x${"8".repeat(64)}`,
  policyId: v1Policy.policyId,
  netEconomics: v1Economics,
  trader: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader,
  deadline: v1Deadline,
  routerMinimumGrossOutputAtomic: v1Economics.protectedUserNetOutputAtomic,
  route: {
    kind: 0,
    tokenIn: getAddress(ROBINHOOD_WETH_ADDRESS),
    tokenOut: v1Output,
    fee0: 3_000,
    fee1: 0,
    pool0: v1Pool,
    pool1: zeroAddress
  }
});
const v1Data = encodeRmtUniswapV3FeeExecution(v1Execution);
const v1UnsignedPlan = {
  planId: "88888888-8888-4888-8888-888888888888",
  sourceQuoteRequestId: "99999999-9999-4999-8999-999999999999",
  sourceVerificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider: "uniswap-v3" as const,
  kind: "swap" as const,
  chainId: 4_663 as const,
  target: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor,
  data: v1Data,
  value: v1Economics.userGrossInputAtomic,
  gasLimit: "300000",
  inputAsset: zeroAddress,
  outputAsset: v1Output,
  inputAmountAtomic: v1Economics.userGrossInputAtomic,
  protectedOutputAtomic: v1Economics.protectedUserNetOutputAtomic,
  recipient: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader,
  router: ROBINHOOD_SWAP_ROUTER_02,
  settlementMode: VNEXT_LEGACY_V1_FEE,
  netEconomics: v1Economics,
  feeExecution: v1Execution,
  deadline: v1Deadline,
  preparedAtMs: now,
  expiresAtMs: now + 60_000,
  userAuthorizationRequired: true as const,
  serverSubmissionEnabled: false as const
};
const withPayloadHash = (candidate: Omit<VNextAuthorizationPlan, "payloadHash">): VNextAuthorizationPlan => ({
  ...candidate,
  payloadHash: authorizationPayloadHash(candidate)
});
const v1Plan = withPayloadHash(v1UnsignedPlan);
const requestBlockEvidence = {
  walletNonceBeforeRequest: 197n,
  requestBlockNumber: 37_772_345n,
  requestBlockHash: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.blockHash
};
const recordV1 = (candidate: VNextAuthorizationPlan, requestId: string, candidateWallet = RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader) => {
  const target = makeStorage();
  return {
    target,
    record: recordPreparedVNextWalletRequest({
      requestId,
      wallet: candidateWallet,
      plan: candidate,
      ...requestBlockEvidence
    }, target.storage, now)
  };
};

const preparedV1 = recordV1(v1Plan, "10000000-0000-4000-8000-000000000001");
assert.equal(preparedV1.record?.state, "PREPARED");
assert.equal(preparedV1.record?.target, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor);
assert.equal(preparedV1.record?.calldataHash, keccak256(v1Data));
const rereadV1 = readVNextWalletRequestJournal(preparedV1.target.storage, now)[0];
assert.equal(rereadV1?.state, "PREPARED");
assert.equal(rereadV1?.calldataHash, keccak256(v1Data));
assert.equal(rereadV1?.recoveryPlan?.feeExecution?.executionId, v1Execution.executionId);
assert.equal(rereadV1?.recoveryPlan?.data, v1Data);

const mutatedData = `${v1Data.slice(0, -2)}${v1Data.endsWith("00") ? "01" : "00"}` as Hex;
assert.equal(recordV1(withPayloadHash({ ...v1UnsignedPlan, data: mutatedData }), "10000000-0000-4000-8000-000000000002").record, null);
const wrongExecutor = getAddress("0x9999999999999999999999999999999999999999");
assert.equal(recordV1(withPayloadHash({
  ...v1UnsignedPlan,
  target: wrongExecutor,
  feeExecution: { ...v1Execution, executor: wrongExecutor }
}), "10000000-0000-4000-8000-000000000003").record, null);
assert.equal(recordV1(withPayloadHash({
  ...v1UnsignedPlan,
  feeExecution: { ...v1Execution, executionId: `0x${"9".repeat(64)}` }
}), "10000000-0000-4000-8000-000000000004").record, null);
assert.equal(recordV1(withPayloadHash({
  ...v1UnsignedPlan,
  feeExecution: { ...v1Execution, feeBps: 26 }
}), "10000000-0000-4000-8000-000000000005").record, null);
assert.equal(recordV1(withPayloadHash({
  ...v1UnsignedPlan,
  feeExecution: { ...v1Execution, treasury: v1Output }
}), "10000000-0000-4000-8000-000000000006").record, null);
assert.equal(recordV1(withPayloadHash({
  ...v1UnsignedPlan,
  recipient: v1Output
}), "10000000-0000-4000-8000-000000000007").record, null);

const directJournal = makeStorage();
assert.equal(recordPreparedVNextWalletRequest({
  requestId: "10000000-0000-4000-8000-000000000008",
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: DIRECT_SMOKE_SWAP_PLAN,
  walletNonceBeforeRequest: 1n,
  requestBlockNumber: 1n
}, directJournal.storage, now)?.state, "PREPARED");
const v2Journal = makeStorage();
assert.equal(recordPreparedVNextWalletRequest({
  requestId: "10000000-0000-4000-8000-000000000009",
  wallet: FEE_V2_SMOKE_RECIPIENT,
  plan: FEE_V2_SMOKE_SWAP_PLAN,
  walletNonceBeforeRequest: 1n,
  requestBlockNumber: 1n
}, v2Journal.storage, now)?.state, "PREPARED");

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
