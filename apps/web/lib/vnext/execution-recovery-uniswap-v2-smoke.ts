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
import { confirmedVNextFeePresentation } from "./confirmed-fee-receipt";
import { createRmtExecutionFeeV2Policy, normalizeRmtExecutionFeeV2Input } from "./execution-fee-policy-v2";
import {
  isVNextPlanRecoveryAdmissible,
  normalizeVNextExecutionJournal,
  promoteVNextWalletRequestToSubmitted,
  readVNextExecutionJournal,
  recordPreparedVNextWalletRequest,
  resolveVNextExecution,
  settledVNextFeeExecutionV2,
  transitionVNextWalletRequest,
  type VNextExecutionRecord,
  type VNextExecutionStorage
} from "./execution-recovery";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";
import { bindVNextAtomicFeeAuthorization, type VNextAtomicFeeSettlementProof } from "./provider-fee-settlement";
import { ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { ROBINHOOD_UNISWAP_V2_ROUTER } from "./uniswap-v2-authorization-codec";
import {
  createRmtUniswapV2FeeExecutionV2,
  decodeRmtUniswapV2FeeAuthorizationV2,
  encodeRmtUniswapV2FeeExecutionV2,
  RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
  RMT_UNISWAP_V2_V2_POLICY_HASH,
  RMT_UNISWAP_V2_V2_PROVIDER_ID,
  RMT_UNISWAP_V2_V2_TREASURY,
  rmtUniswapV2FeeExecutorV2Abi,
  type RmtUniswapV2FeeRouteV2
} from "./uniswap-v2-fee-executor-v2";
import {
  RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
  RMT_UNISWAP_V3_V2_POLICY_ID_HASH,
  RMT_UNISWAP_V3_V2_PROVIDER_ID,
  rmtUniswapV3FeeExecutorV2Abi
} from "./uniswap-v3-fee-executor-v2";

const now = 1_788_300_000_000;
const wallet = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA" as Address;
const pons = "0x39dBED3a2bd333467115dE45665cC57F813C4571" as Address;
const inputToken = "0x2222222222222222222222222222222222222222" as Address;
const outputToken = "0x3333333333333333333333333333333333333333" as Address;
const pair0 = "0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4" as Address;
const pair1 = "0x6666666666666666666666666666666666666666" as Address;
const policy = createRmtExecutionFeeV2Policy({ treasury: RMT_UNISWAP_V2_V2_TREASURY, fromBlock: "51296658" });
assert.equal(policy.policyHash, RMT_UNISWAP_V2_V2_POLICY_HASH);

function memoryStorage(): VNextExecutionStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

function assetId(asset: Address) {
  return asset === zeroAddress ? "eip155:4663/native" : `eip155:4663/contract:${asset.toLowerCase()}`;
}

function fixture(inputAsset: Address, outputAsset: Address, route: RmtUniswapV2FeeRouteV2, digit: string) {
  const economics = normalizeRmtExecutionFeeV2Input({
    policy,
    inputAssetId: assetId(inputAsset),
    outputAssetId: assetId(outputAsset),
    userGrossInputAtomic: "1000000",
    providerGrossExpectedOutputAtomic: "1000",
    providerProtectedOutputAtomic: "900",
    settlementMode: "v2-atomic-input-fee"
  });
  const execution = createRmtUniswapV2FeeExecutionV2({
    executor: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
    executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
    executionId: `0x${digit.repeat(64)}` as Hex,
    economics,
    trader: wallet,
    inputAsset,
    outputAsset,
    deadline: "1788300240",
    route
  });
  const data = encodeRmtUniswapV2FeeExecutionV2(execution);
  const proof: VNextAtomicFeeSettlementProof = {
    verificationState: "verified_atomic",
    provider: "uniswap-v2",
    settlementMode: "v2-atomic-input-fee",
    implementationId: RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
    executionTarget: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
    providerTarget: ROBINHOOD_UNISWAP_V2_ROUTER,
    calldataHash: keccak256(data),
    executionId: execution.executionId,
    recipient: wallet,
    deadline: execution.deadline,
    atomicFeeSettlement: true,
    revertsAtomically: true
  };
  const authorization = bindVNextAtomicFeeAuthorization({ economics, proof });
  const withoutHash: Omit<VNextAuthorizationPlan, "payloadHash"> = {
    planId: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    sourceQuoteRequestId: "11111111-1111-4111-8111-111111111111",
    sourceVerificationId: "22222222-2222-4222-8222-222222222222",
    provider: "uniswap-v2",
    kind: "swap",
    chainId: 4_663,
    target: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
    data,
    value: inputAsset === zeroAddress ? economics.userGrossInputAtomic : "0",
    gasLimit: "180000",
    inputAsset,
    outputAsset,
    inputAmountAtomic: economics.userGrossInputAtomic,
    protectedOutputAtomic: economics.providerProtectedOutputAtomic,
    recipient: wallet,
    router: ROBINHOOD_UNISWAP_V2_ROUTER,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    feeV2Economics: economics,
    feeV2Authorization: authorization,
    deadline: execution.deadline,
    preparedAtMs: now,
    expiresAtMs: now + 60_000,
    userAuthorizationRequired: true,
    serverSubmissionEnabled: false
  };
  return { economics, execution, plan: { ...withoutHash, payloadHash: authorizationPayloadHash(withoutHash) } as VNextAuthorizationPlan };
}

const nativeDirect = fixture(zeroAddress, pons, {
  kind: 0, tokenIn: ROBINHOOD_WETH_ADDRESS, tokenOut: pons, pair0, pair1: zeroAddress
}, "3");
const erc20Direct = fixture(inputToken, outputToken, {
  kind: 0, tokenIn: inputToken, tokenOut: outputToken, pair0, pair1: zeroAddress
}, "4");
const wethHop = fixture(inputToken, outputToken, {
  kind: 1, tokenIn: inputToken, tokenOut: outputToken, pair0, pair1
}, "5");

for (const target of [nativeDirect, erc20Direct, wethHop]) {
  assert.equal(isVNextPlanRecoveryAdmissible(target.plan, wallet), true);
  const decoded = decodeRmtUniswapV2FeeAuthorizationV2(target.plan.data);
  assert.equal(decoded.authorization.executionId, target.execution.executionId);
  assert.equal(decoded.route.pair0, target.execution.route.pair0);
  assert.equal(decoded.route.pair1, target.execution.route.pair1);
  assert.throws(() => decodeRmtUniswapV2FeeAuthorizationV2(`${target.plan.data}00` as Hex), /noncanonical/);
}

const approvalData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR, 1_000_000n] });
const approvalWithoutHash = { ...erc20Direct.plan, planId: "66666666-6666-4666-8666-666666666666", kind: "erc20_approval" as const, target: inputToken, data: approvalData, value: "0" };
const approval = { ...approvalWithoutHash, payloadHash: authorizationPayloadHash(approvalWithoutHash) };
assert.equal(isVNextPlanRecoveryAdmissible(approval, wallet), true);
assert.equal(isVNextPlanRecoveryAdmissible({ ...approval, target: ROBINHOOD_UNISWAP_V2_ROUTER }, wallet), false);

const storage = memoryStorage();
const requestId = "77777777-7777-4777-8777-777777777777";
assert.equal(recordPreparedVNextWalletRequest({
  requestId, wallet, plan: nativeDirect.plan, walletNonceBeforeRequest: 9n,
  requestBlockNumber: 52_200_000n, requestBlockHash: `0x${"a".repeat(64)}`
}, storage, now)?.state, "PREPARED");
assert.equal(transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", storage, now + 1)?.state, "PROMPT_REQUESTED");
assert.equal(transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", storage, now + 2)?.state, "PROVIDER_PENDING");
const txHash = `0x${"b".repeat(64)}`;
const record = promoteVNextWalletRequestToSubmitted({ requestId, wallet, plan: nativeDirect.plan, txHash }, storage, now + 3);
assert(record?.feeV2Settlement);
assert.equal(record.provider, "uniswap-v2");
assert.equal(record.feeV2Settlement.implementationId, RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID);
assert.equal(record.feeV2Settlement.providerId, RMT_UNISWAP_V2_V2_PROVIDER_ID);
assert.equal(record.feeV2Settlement.providerTarget, ROBINHOOD_UNISWAP_V2_ROUTER);
assert.equal(record.feeV2Settlement.executor, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
assert.equal(readVNextExecutionJournal(storage, now + 4)[0]?.provider, "uniswap-v2");

const eventDataParameters = parseAbiParameters(
  "bytes32 policyIdHash, uint256 policyVersion, bytes32 providerId, address router, bytes32 routeIdentity, address requestedInputAsset, address requestedOutputAsset, address feeAsset, uint16 feeBps, uint8 feeSide, uint256 userGrossInput, uint256 providerInput, uint256 actualProviderOutput, uint256 actualRmtFee, address treasury"
);
type SettlementValues = {
  emitter: Address; executionId: Hex; policyHash: Hex; trader: Address; policyIdHash: Hex;
  policyVersion: bigint; providerId: Hex; router: Address; routeIdentity: Hex;
  requestedInputAsset: Address; requestedOutputAsset: Address; feeAsset: Address;
  feeBps: number; feeSide: number; userGrossInput: bigint; providerInput: bigint;
  actualProviderOutput: bigint; actualRmtFee: bigint; treasury: Address;
};
function settlementLog(overrides: Partial<SettlementValues> = {}) {
  const values: SettlementValues = {
    emitter: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
    executionId: nativeDirect.execution.executionId,
    policyHash: nativeDirect.execution.policyHash,
    trader: wallet,
    policyIdHash: nativeDirect.execution.policyIdHash,
    policyVersion: 2n,
    providerId: RMT_UNISWAP_V2_V2_PROVIDER_ID,
    router: ROBINHOOD_UNISWAP_V2_ROUTER,
    routeIdentity: nativeDirect.execution.routeIdentity,
    requestedInputAsset: zeroAddress,
    requestedOutputAsset: pons,
    feeAsset: zeroAddress,
    feeBps: 25,
    feeSide: 0,
    userGrossInput: 1_000_000n,
    providerInput: 997_500n,
    actualProviderOutput: 950n,
    actualRmtFee: 2_500n,
    treasury: RMT_UNISWAP_V2_V2_TREASURY,
    ...overrides
  };
  return {
    address: values.emitter as Address,
    topics: encodeEventTopics({
      abi: rmtUniswapV2FeeExecutorV2Abi,
      eventName: "RMTUniswapV2FeeSettledV2",
      args: { executionId: values.executionId, policyHash: values.policyHash, trader: values.trader }
    }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []),
    data: encodeAbiParameters(eventDataParameters, [
      values.policyIdHash, values.policyVersion, values.providerId, values.router, values.routeIdentity,
      values.requestedInputAsset, values.requestedOutputAsset, values.feeAsset, values.feeBps, values.feeSide,
      values.userGrossInput, values.providerInput, values.actualProviderOutput, values.actualRmtFee, values.treasury
    ])
  };
}

const exactLog = settlementLog();
const settled = settledVNextFeeExecutionV2(record, [exactLog]);
assert.deepEqual(settled, { outputAmountAtomic: "950", actualRmtFeeAtomic: "2500", actualProviderOutputAtomic: "950" });
const settlementMutations: Partial<SettlementValues>[] = [
  { emitter: inputToken }, { router: ROBINHOOD_SWAP_ROUTER_02 }, { providerId: RMT_UNISWAP_V3_V2_PROVIDER_ID },
  { actualProviderOutput: 899n }, { actualRmtFee: 2_499n }, { treasury: inputToken },
  { executionId: `0x${"9".repeat(64)}` as Hex }, { routeIdentity: `0x${"8".repeat(64)}` as Hex }
];
for (const mutation of settlementMutations) {
  assert.equal(settledVNextFeeExecutionV2(record, [settlementLog(mutation)]), null);
}

const v3Expected: VNextExecutionRecord = {
  ...record,
  provider: "uniswap-v3",
  feeV2Settlement: {
    ...record.feeV2Settlement,
    provider: "uniswap-v3",
    implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    providerId: RMT_UNISWAP_V3_V2_PROVIDER_ID,
    policyIdHash: RMT_UNISWAP_V3_V2_POLICY_ID_HASH
  }
};
assert.equal(settledVNextFeeExecutionV2(v3Expected, [exactLog]), null, "a V2 event cannot settle a V3 record");
const v3EventLog = {
  ...exactLog,
  topics: encodeEventTopics({
    abi: rmtUniswapV3FeeExecutorV2Abi,
    eventName: "RMTUniswapV3FeeSettledV2",
    args: {
      executionId: nativeDirect.execution.executionId,
      policyHash: nativeDirect.execution.policyHash,
      trader: wallet
    }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : [])
};
assert.equal(settledVNextFeeExecutionV2(record, [v3EventLog]), null, "a V3 event cannot settle a V2 record");

const confirmed = resolveVNextExecution(txHash, "confirmed", storage, now + 5, settled!);
assert.equal(confirmed?.state, "confirmed");
assert.equal(confirmed?.outputAmountAtomic, "950");
assert.equal(confirmed?.feeV2Settlement?.actualRmtFeeAtomic, "2500");
assert.deepEqual(confirmedVNextFeePresentation({
  record: confirmed, inputDecimals: 18, outputDecimals: 18, inputSymbol: "ETH", outputSymbol: "PONS"
}), { state: "settled", display: "0.0000000000000025 ETH · 0.25%" });

const normalized = (candidate: VNextExecutionRecord) => normalizeVNextExecutionJournal([candidate], now + 6).length;
assert.equal(normalized({ ...record, feeV2Settlement: { ...record.feeV2Settlement, implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID } }), 0);
assert.equal(normalized({ ...record, feeV2Settlement: { ...record.feeV2Settlement, providerId: RMT_UNISWAP_V3_V2_PROVIDER_ID } }), 0);
assert.equal(normalized({ ...record, feeV2Settlement: { ...record.feeV2Settlement, providerTarget: ROBINHOOD_SWAP_ROUTER_02 } }), 0);
assert.equal(normalized({ ...record, feeV2Settlement: { ...record.feeV2Settlement, treasury: inputToken } }), 0);
assert.equal(normalized(v3Expected), 1, "the existing V3 recovery record remains admitted");
assert.equal(normalized({ ...v3Expected, feeV2Settlement: { ...v3Expected.feeV2Settlement!, implementationId: RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID } }), 0);
assert.equal(normalized({ ...v3Expected, feeV2Settlement: { ...v3Expected.feeV2Settlement!, providerId: RMT_UNISWAP_V2_V2_PROVIDER_ID } }), 0);
assert.equal(normalized({ ...v3Expected, feeV2Settlement: { ...v3Expected.feeV2Settlement!, providerTarget: ROBINHOOD_UNISWAP_V2_ROUTER } }), 0);

for (const mutation of [
  { feeV2Authorization: { ...nativeDirect.plan.feeV2Authorization!, executionId: `0x${"1".repeat(64)}` as Hex } },
  { feeV2Authorization: { ...nativeDirect.plan.feeV2Authorization!, implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID } },
  { feeV2Economics: { ...nativeDirect.plan.feeV2Economics!, treasury: inputToken } },
  { feeV2Economics: { ...nativeDirect.plan.feeV2Economics!, expectedFeeAtomic: "2499" } },
  { feeV2Economics: { ...nativeDirect.plan.feeV2Economics!, providerInputAtomic: "997501" } },
  { inputAmountAtomic: "1000001" },
  { protectedOutputAtomic: "901" },
  { data: erc20Direct.plan.data },
  { router: ROBINHOOD_SWAP_ROUTER_02 }
]) assert.equal(isVNextPlanRecoveryAdmissible({ ...nativeDirect.plan, ...mutation } as VNextAuthorizationPlan, wallet), false);

const inadmissibleStorage = memoryStorage();
assert.equal(recordPreparedVNextWalletRequest({
  requestId: "88888888-8888-4888-8888-888888888888", wallet,
  plan: { ...nativeDirect.plan, router: ROBINHOOD_SWAP_ROUTER_02 }, walletNonceBeforeRequest: 10n,
  requestBlockNumber: 52_200_001n
}, inadmissibleStorage, now), null);
const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const openBoundary = walletReview.slice(walletReview.indexOf("function openPreparedWalletRequest"), walletReview.indexOf("const prepareWalletReview"));
const prepareBoundary = walletReview.slice(walletReview.indexOf("const prepareWalletReview"), walletReview.indexOf("const reopenSelectedWallet"));
assert(openBoundary.indexOf("isVNextPlanRecoveryAdmissible(plan, address)") < openBoundary.indexOf("invokeVNextExternalWalletRequest"));
assert(prepareBoundary.indexOf("isVNextPlanRecoveryAdmissible(plan, address)") < prepareBoundary.indexOf("recordPreparedVNextWalletRequest({"));

console.log("RMT Uniswap V2 exact plan recovery, durable wallet lifecycle, settlement reconciliation, and fail-closed admission checks passed.");
