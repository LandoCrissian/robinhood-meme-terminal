import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";
import {
  normalizeVNextExecutionJournal,
  readVNextExecutionJournal,
  recordSubmittedVNextExecution,
  resolveVNextExecution,
  settledVNextFeeExecutionV2,
  settledVNextOutputAtomic,
  vNextExecutionProviderLabel,
  type VNextExecutionRecord,
  type VNextExecutionStorage
} from "./execution-recovery";
import { createRmtExecutionFeeV2Policy, normalizeRmtExecutionFeeV2Input } from "./execution-fee-policy-v2";
import { bindVNextAtomicFeeAuthorization, type VNextAtomicFeeSettlementProof } from "./provider-fee-settlement";
import {
  createRmtUniswapV3FeeExecutionV2,
  encodeRmtUniswapV3FeeExecutionV2,
  RMT_UNISWAP_V3_V2_PROVIDER_ID,
  rmtUniswapV3FeeExecutorV2Abi
} from "./uniswap-v3-fee-executor-v2";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";

const now = 1_786_100_000_000;
const wallet = "0x1111111111111111111111111111111111111111" as Address;
const inputAsset = "0x2222222222222222222222222222222222222222" as Address;
const outputAsset = "0x3333333333333333333333333333333333333333" as Address;
const executor = "0x4444444444444444444444444444444444444444" as Address;
const treasury = "0x5555555555555555555555555555555555555555" as Address;
const pool = "0x6666666666666666666666666666666666666666" as Address;
const executionId = `0x${"7".repeat(64)}` as Hex;
const runtimeHash = `0x${"8".repeat(64)}` as Hex;
const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "40000000" });

function memoryStorage(): VNextExecutionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
}

function fixture(requestedOutputAsset: Address, id: Hex) {
  const outputId = requestedOutputAsset === zeroAddress
    ? "eip155:4663/native"
    : `eip155:4663/contract:${requestedOutputAsset.toLowerCase()}`;
  const economics = normalizeRmtExecutionFeeV2Input({
    policy,
    inputAssetId: `eip155:4663/contract:${inputAsset.toLowerCase()}`,
    outputAssetId: outputId,
    userGrossInputAtomic: "1000000",
    providerGrossExpectedOutputAtomic: "1000",
    providerProtectedOutputAtomic: "900",
    settlementMode: "v2-atomic-input-fee"
  });
  const execution = createRmtUniswapV3FeeExecutionV2({
    executor,
    executorRuntimeHash: runtimeHash,
    executionId: id,
    economics,
    trader: wallet,
    inputAsset,
    outputAsset: requestedOutputAsset,
    deadline: "1786100300",
    route: {
      kind: 0,
      tokenIn: inputAsset,
      tokenOut: requestedOutputAsset === zeroAddress ? ROBINHOOD_WETH : requestedOutputAsset,
      fee0: 3_000,
      fee1: 0,
      pool0: pool,
      pool1: zeroAddress
    }
  });
  const data = encodeRmtUniswapV3FeeExecutionV2(execution);
  const proof: VNextAtomicFeeSettlementProof = {
    verificationState: "verified_atomic",
    provider: "uniswap-v3",
    settlementMode: "v2-atomic-input-fee",
    implementationId: "rmt-uniswap-v3-fee-executor-v2",
    executionTarget: executor,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    calldataHash: keccak256(data),
    executionId: id,
    recipient: wallet,
    deadline: execution.deadline,
    atomicFeeSettlement: true,
    revertsAtomically: true
  };
  const authorization = bindVNextAtomicFeeAuthorization({ economics, proof });
  const withoutHash: Omit<VNextAuthorizationPlan, "payloadHash"> = {
    planId: requestedOutputAsset === zeroAddress
      ? "22222222-2222-4222-8222-222222222222"
      : "11111111-1111-4111-8111-111111111111",
    sourceQuoteRequestId: "33333333-3333-4333-8333-333333333333",
    sourceVerificationId: "44444444-4444-4444-8444-444444444444",
    provider: "uniswap-v3",
    kind: "swap",
    chainId: 4_663,
    target: executor,
    data,
    value: "0",
    gasLimit: "120000",
    inputAsset,
    outputAsset: requestedOutputAsset,
    inputAmountAtomic: economics.userGrossInputAtomic,
    protectedOutputAtomic: economics.providerProtectedOutputAtomic,
    recipient: wallet,
    router: ROBINHOOD_SWAP_ROUTER_02,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    feeV2Economics: economics,
    feeV2Authorization: authorization,
    deadline: execution.deadline,
    preparedAtMs: now,
    expiresAtMs: now + 60_000,
    userAuthorizationRequired: true,
    serverSubmissionEnabled: false
  };
  const plan: VNextAuthorizationPlan = { ...withoutHash, payloadHash: authorizationPayloadHash(withoutHash) };
  return { economics, execution, plan };
}

const erc20 = fixture(outputAsset, executionId);
const storage = memoryStorage();
const txHash = `0x${"9".repeat(64)}` as Hex;
const record = recordSubmittedVNextExecution({ wallet, plan: erc20.plan, txHash }, storage, now);
assert(record?.feeV2Settlement, "V2 swaps must persist exact settlement authority");
assert.equal(record.provider, "uniswap-v3");
assert.equal(record.feeV2Settlement.executionId, erc20.execution.executionId);
assert.equal(record.feeV2Settlement.routeIdentity, erc20.execution.routeIdentity);
assert.equal(record.feeV2Settlement.calldataHash, keccak256(erc20.plan.data));
assert.equal(record.feeV2Settlement.expectedFeeAtomic, "2500");
assert.equal(record.feeSettlement, undefined);
assert.equal(vNextExecutionProviderLabel(record.provider), "Uniswap V3");
assert.equal(recordSubmittedVNextExecution({
  wallet,
  plan: { ...erc20.plan, payloadHash: `0x${"f".repeat(64)}` },
  txHash: `0x${"1".repeat(64)}`
}, memoryStorage(), now), null, "changed wallet payload authority must not enter the V2 journal");
assert.equal(recordSubmittedVNextExecution({
  wallet,
  plan: {
    ...erc20.plan,
    feeV2Authorization: { ...erc20.plan.feeV2Authorization!, implementationId: "wrong-executor" }
  },
  txHash: `0x${"2".repeat(64)}`
}, memoryStorage(), now), null, "unknown settlement implementation must not enter the V2 journal");

const approvalData = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [executor, 1_000_000n]
});
const approvalWithoutHash = {
  ...erc20.plan,
  planId: "55555555-5555-4555-8555-555555555555",
  kind: "erc20_approval" as const,
  target: inputAsset,
  data: approvalData,
  value: "0"
};
const approvalPlan = {
  ...approvalWithoutHash,
  payloadHash: authorizationPayloadHash(approvalWithoutHash)
};
const approvalRecord = recordSubmittedVNextExecution({
  wallet,
  plan: approvalPlan,
  txHash: `0x${"a".repeat(64)}`
}, memoryStorage(), now);
assert.equal(approvalRecord?.feeV2Settlement, undefined, "approval receipts never settle the planned V2 fee");
assert.equal(approvalRecord?.feeSettlement, undefined);

type EventValues = {
  emitter: Address;
  executionId: Hex;
  policyHash: Hex;
  trader: Address;
  policyIdHash: Hex;
  policyVersion: bigint;
  providerId: Hex;
  router: Address;
  routeIdentity: Hex;
  requestedInputAsset: Address;
  requestedOutputAsset: Address;
  feeAsset: Address;
  feeBps: number;
  feeSide: number;
  userGrossInput: bigint;
  providerInput: bigint;
  actualProviderOutput: bigint;
  actualRmtFee: bigint;
  treasury: Address;
};
const eventDataParameters = parseAbiParameters(
  "bytes32 policyIdHash, uint256 policyVersion, bytes32 providerId, address router, bytes32 routeIdentity, address requestedInputAsset, address requestedOutputAsset, address feeAsset, uint16 feeBps, uint8 feeSide, uint256 userGrossInput, uint256 providerInput, uint256 actualProviderOutput, uint256 actualRmtFee, address treasury"
);

function eventValues(target: typeof erc20): EventValues {
  return {
    emitter: executor,
    executionId: target.execution.executionId,
    policyHash: target.execution.policyHash,
    trader: wallet,
    policyIdHash: target.execution.policyIdHash,
    policyVersion: 2n,
    providerId: RMT_UNISWAP_V3_V2_PROVIDER_ID,
    router: ROBINHOOD_SWAP_ROUTER_02,
    routeIdentity: target.execution.routeIdentity,
    requestedInputAsset: inputAsset,
    requestedOutputAsset: target.execution.requestedOutputAsset,
    feeAsset: inputAsset,
    feeBps: 25,
    feeSide: 0,
    userGrossInput: 1_000_000n,
    providerInput: 997_500n,
    actualProviderOutput: 950n,
    actualRmtFee: 2_500n,
    treasury
  };
}

function settlementLog(target: typeof erc20, overrides: Partial<EventValues> = {}) {
  const values = { ...eventValues(target), ...overrides };
  const topics = encodeEventTopics({
    abi: rmtUniswapV3FeeExecutorV2Abi,
    eventName: "RMTUniswapV3FeeSettledV2",
    args: { executionId: values.executionId, policyHash: values.policyHash, trader: values.trader }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []);
  const data = encodeAbiParameters(eventDataParameters, [
    values.policyIdHash,
    values.policyVersion,
    values.providerId,
    values.router,
    values.routeIdentity,
    values.requestedInputAsset,
    values.requestedOutputAsset,
    values.feeAsset,
    values.feeBps,
    values.feeSide,
    values.userGrossInput,
    values.providerInput,
    values.actualProviderOutput,
    values.actualRmtFee,
    values.treasury
  ]);
  return { address: values.emitter, topics, data };
}

const canonicalLog = settlementLog(erc20);
const settled = settledVNextFeeExecutionV2(record, [canonicalLog]);
assert.deepEqual(settled, {
  outputAmountAtomic: "950",
  actualRmtFeeAtomic: "2500",
  actualProviderOutputAtomic: "950"
});
assert.equal(settledVNextFeeExecutionV2(record, []), null);
assert.equal(settledVNextFeeExecutionV2(record, [canonicalLog, canonicalLog]), null);
assert.equal(settledVNextFeeExecutionV2(record, [{ ...canonicalLog, data: "0x" }]), null);

const badAddress = "0x7777777777777777777777777777777777777777" as Address;
const mutations: Partial<EventValues>[] = [
  { emitter: badAddress },
  { executionId: `0x${"1".repeat(64)}` as Hex },
  { policyHash: `0x${"2".repeat(64)}` as Hex },
  { trader: badAddress },
  { policyIdHash: `0x${"3".repeat(64)}` as Hex },
  { policyVersion: 1n },
  { providerId: `0x${"4".repeat(64)}` as Hex },
  { router: badAddress },
  { routeIdentity: `0x${"5".repeat(64)}` as Hex },
  { requestedInputAsset: badAddress },
  { requestedOutputAsset: badAddress },
  { feeAsset: badAddress },
  { feeBps: 24 },
  { feeSide: 1 },
  { userGrossInput: 1_000_001n },
  { providerInput: 997_499n },
  { actualProviderOutput: 899n },
  { actualRmtFee: 2_499n },
  { treasury: badAddress }
];
mutations.forEach((mutation) => {
  assert.equal(settledVNextFeeExecutionV2(record, [settlementLog(erc20, mutation)]), null);
});

const transferAbi = [{
  type: "event", name: "Transfer", anonymous: false,
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" }
  ]
}] as const;
const transferOnlyLog = {
  address: outputAsset,
  topics: encodeEventTopics({
    abi: transferAbi,
    eventName: "Transfer",
    args: { from: executor, to: wallet }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []),
  data: encodeAbiParameters([{ type: "uint256" }], [950n])
};
assert.equal(settledVNextOutputAtomic(record, [transferOnlyLog]), null, "V2 cannot confirm from transfers alone");
assert.equal(resolveVNextExecution(txHash, "confirmed", storage, now + 1, { outputAmountAtomic: "950" }), null,
  "V2 cannot resolve without the exact settlement result");
const resolved = resolveVNextExecution(txHash, "confirmed", storage, now + 2, {
  outputAmountAtomic: "950",
  actualRmtFeeAtomic: "2500",
  actualProviderOutputAtomic: "950"
});
assert.equal(resolved?.outputAmountAtomic, "950");
assert.equal(resolved?.feeV2Settlement?.actualRmtFeeAtomic, "2500");
assert.equal(resolved?.feeV2Settlement?.actualProviderOutputAtomic, "950");
assert.equal(readVNextExecutionJournal(storage, now + 3)[0]?.provider, "uniswap-v3");
assert.equal(readVNextExecutionJournal(storage, now + 3)[0]?.feeV2Settlement?.actualRmtFeeAtomic, "2500");

const native = fixture(zeroAddress, `0x${"b".repeat(64)}` as Hex);
const nativeRecord = recordSubmittedVNextExecution({
  wallet,
  plan: native.plan,
  txHash: `0x${"c".repeat(64)}`
}, memoryStorage(), now)!;
assert.deepEqual(settledVNextFeeExecutionV2(nativeRecord, [settlementLog(native)]), {
  outputAmountAtomic: "950",
  actualRmtFeeAtomic: "2500",
  actualProviderOutputAtomic: "950"
});
const withdrawalAbi = [{
  type: "event", name: "Withdrawal", anonymous: false,
  inputs: [
    { indexed: true, name: "src", type: "address" },
    { indexed: false, name: "wad", type: "uint256" }
  ]
}] as const;
const oldWithdrawalLog = {
  address: ROBINHOOD_WETH,
  topics: encodeEventTopics({
    abi: withdrawalAbi,
    eventName: "Withdrawal",
    args: { src: ROBINHOOD_SWAP_ROUTER_02 }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []),
  data: encodeAbiParameters([{ type: "uint256" }], [950n])
};
assert.equal(settledVNextOutputAtomic(nativeRecord, [oldWithdrawalLog]), null,
  "V2 native output cannot use the historical Router02 WETH heuristic");

const oldRecord: VNextExecutionRecord = {
  schemaVersion: 1,
  chainId: 4_663,
  wallet,
  kind: "swap",
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000",
  planId: "66666666-6666-4666-8666-666666666666",
  payloadHash: `0x${"d".repeat(64)}`,
  txHash: `0x${"e".repeat(64)}`,
  state: "submitted",
  submittedAtMs: now,
  updatedAtMs: now
};
assert.equal(normalizeVNextExecutionJournal([oldRecord], now)[0]?.provider, undefined,
  "journals created before provider persistence must remain valid");

const hook = readFileSync(new URL("../../app/vnext/use-vnext-execution-recovery.ts", import.meta.url), "utf8");
const receipt = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const feeReceipt = readFileSync(new URL("./confirmed-fee-receipt.ts", import.meta.url), "utf8");
const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
assert.match(hook, /settledVNextFeeExecutionV2/);
assert.match(hook, /record\.feeV2Settlement && !feeV2Settlement/);
assert.match(receipt, /confirmedVNextFeePresentation/);
assert.match(feeReceipt, /feeV2Settlement\.actualRmtFeeAtomic/);
assert.match(receipt, /vNextExecutionProviderLabel/);
assert.match(walletReview, /Open RMT V2 fee treasury in Robinhood Chain explorer/);
assert.match(walletReview, /Open RMT V2 executor in Robinhood Chain explorer/);

console.log("RMT V2 execution journal, exact fee-event reconciliation, native output, and receipt authority checks passed.");
