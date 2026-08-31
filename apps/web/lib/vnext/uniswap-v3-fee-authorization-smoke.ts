import assert from "node:assert/strict";
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
import {
  createRmtExecutionV1Policy,
  normalizeInputSideRmtFee,
  normalizeOutputSideRmtFee
} from "./execution-fee-policy";
import {
  assertRmtUniswapV3FeeCalldata,
  createRmtUniswapV3FeeExecution,
  encodeRmtUniswapV3FeeExecution,
  RMT_UNISWAP_V3_PROVIDER_ID,
  rmtUniswapV3FeeExecutorAbi
} from "./uniswap-v3-fee-executor";
import {
  configuredVNextUniswapFeeExecutor,
  isVNextUniswapFeeRecipientEligible,
  isVNextUniswapFeeProofRecipient,
  ROBINHOOD_WETH_RUNTIME_HASH
} from "../server/vnext-uniswap-fee-executor";
import { settledVNextFeeExecution, type VNextExecutionRecord } from "./execution-recovery";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { VNEXT_LEGACY_V1_FEE } from "./execution-settlement";
import {
  authorizationPayloadHash,
  parseVNextAuthorizationPlan,
  type VNextAuthorizationPlan
} from "./authorization-plan";
import { vnextSpotTradeInstruction } from "./execution-authority";

const treasury = "0x1111111111111111111111111111111111111111";
const executor = "0x2222222222222222222222222222222222222222";
const trader = "0x3333333333333333333333333333333333333333";
const token = "0x4444444444444444444444444444444444444444";
const pool = "0x5555555555555555555555555555555555555555";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const usdgId = `eip155:4663/contract:${usdg.toLowerCase()}`;
const tokenId = `eip155:4663/contract:${token.toLowerCase()}`;
const runtimeHash = `0x${"a".repeat(64)}` as Hex;
const executionId = `0x${"b".repeat(64)}` as Hex;
const policy = createRmtExecutionV1Policy({
  treasury,
  chainId: 4_663,
  fromBlock: "123456",
  eligibleSettlementAssetIds: [usdgId]
});

const buyEconomics = normalizeInputSideRmtFee({
  policy,
  inputAssetId: usdgId,
  outputAssetId: tokenId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "100000000",
  providerGrossExpectedOutputAtomic: "1000000000000000000000",
  providerProtectedOutputAtomic: "990000000000000000000"
});
const buy = createRmtUniswapV3FeeExecution({
  executor,
  executorRuntimeHash: runtimeHash,
  executionId,
  policyId: policy.policyId,
  netEconomics: buyEconomics,
  trader,
  deadline: "1787000300",
  routerMinimumGrossOutputAtomic: buyEconomics.protectedUserNetOutputAtomic,
  route: { kind: 0, tokenIn: usdg, tokenOut: token, fee0: 3_000, fee1: 0, pool0: pool, pool1: zeroAddress }
});
const buyData = encodeRmtUniswapV3FeeExecution(buy);
assert.equal(assertRmtUniswapV3FeeCalldata(buyData, buy, buyEconomics), true);
assert.throws(() => assertRmtUniswapV3FeeCalldata(`${buyData.slice(0, -2)}01` as Hex, buy, buyEconomics), /calldata|authority/);
assert.throws(() => assertRmtUniswapV3FeeCalldata(buyData, { ...buy, treasury: token }, buyEconomics), /treasury/);
assert.throws(() => assertRmtUniswapV3FeeCalldata(buyData, { ...buy, route: { ...buy.route, fee0: 500 } }, buyEconomics), /route identity/);

const now = 1_787_000_000_000;
const approvalData = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [executor, BigInt(buy.userGrossInputAtomic)]
});
const feeEvidence: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3", status: "approval_required", chainId: 4_663,
  inputAsset: usdg, outputAsset: token, inputAmountAtomic: buy.userGrossInputAtomic,
  indicativeProtectedOutputFloorAtomic: buy.protectedUserNetOutputAtomic,
  expectedOutputAtomic: buy.providerGrossExpectedOutputAtomic,
  protectedOutputAtomic: buy.protectedUserNetOutputAtomic,
  recipient: trader, router: ROBINHOOD_SWAP_ROUTER_02, approvalSpender: executor,
  approvalRequired: true, sufficientBalance: true, allowanceAtomic: "0", balanceAtomic: buy.userGrossInputAtomic,
  route: "direct", fees: [3_000], pools: [pool], deadline: buy.deadline,
  calldataHash: keccak256(buyData), nextAction: "approval", nextActionTarget: usdg,
  nextActionCalldataHash: keccak256(approvalData), transactionValueAtomic: "0",
  nativeBalanceWei: "100000000000000000", gasPriceWei: "1000000000", feeCeilingWei: "3000000000",
  estimatedGasUnits: "50000", gasLimitUnits: "60000", estimatedNetworkCostWei: "180000000000000",
  estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null,
  networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null, gasState: "sufficient",
  routerRuntimeHash: `0x${"1".repeat(64)}`, factoryRuntimeHash: `0x${"2".repeat(64)}`,
  quoterRuntimeHash: `0x${"3".repeat(64)}`, exactSimulationPassed: false, userPaysGas: true,
  rmtFeeEnabled: true, settlementMode: VNEXT_LEGACY_V1_FEE, netEconomics: buyEconomics, feeExecution: buy,
  verifiedAtMs: now, expiresAtMs: Number(BigInt(buy.deadline) * 1_000n), authorizationReady: false
};
const feeExpected = {
  quoteRequestId: feeEvidence.sourceQuoteRequestId,
  inputAsset: usdg,
  outputAsset: token,
  inputAmountAtomic: buy.userGrossInputAtomic,
  provider: "uniswap-v3" as const,
  protectedOutputFloorAtomic: buy.protectedUserNetOutputAtomic,
  recipient: trader
};
assert.equal(parseVNextPreSignEvidence(feeEvidence, feeExpected, now + 1).rmtFeeEnabled, true);
assert.throws(() => parseVNextPreSignEvidence({ ...feeEvidence, approvalSpender: ROBINHOOD_SWAP_ROUTER_02 }, feeExpected, now + 1), /fee-executor economics/);
assert.throws(() => parseVNextPreSignEvidence({ ...feeEvidence, calldataHash: `0x${"9".repeat(64)}` }, feeExpected, now + 1), /fee-executor economics/);
assert.throws(() => parseVNextPreSignEvidence({ ...feeEvidence, feeExecution: { ...buy, treasury: token } }, feeExpected, now + 1), /treasury/);

function v1Plan(input: {
  kind: "erc20_approval" | "swap";
  evidence: VNextPreSignEvidence;
  target: Address;
  data: Hex;
  value: string;
}) {
  const unsigned = {
    planId: "33333333-3333-4333-8333-333333333333",
    sourceQuoteRequestId: input.evidence.sourceQuoteRequestId,
    sourceVerificationId: input.evidence.verificationId,
    provider: "uniswap-v3" as const,
    kind: input.kind,
    chainId: 4_663 as const,
    target: input.target,
    data: input.data,
    value: input.value,
    gasLimit: input.evidence.gasLimitUnits!,
    inputAsset: input.evidence.inputAsset,
    outputAsset: input.evidence.outputAsset,
    inputAmountAtomic: input.evidence.inputAmountAtomic,
    protectedOutputAtomic: input.evidence.protectedOutputAtomic,
    recipient: input.evidence.recipient,
    router: input.evidence.router,
    settlementMode: VNEXT_LEGACY_V1_FEE,
    netEconomics: input.evidence.netEconomics!,
    feeExecution: input.evidence.feeExecution!,
    deadline: input.evidence.deadline,
    preparedAtMs: now,
    expiresAtMs: now + 60_000,
    userAuthorizationRequired: true as const,
    serverSubmissionEnabled: false as const
  };
  return { ...unsigned, payloadHash: authorizationPayloadHash(unsigned) } as VNextAuthorizationPlan;
}

const approvalPlan = v1Plan({ kind: "erc20_approval", evidence: feeEvidence, target: usdg, data: approvalData, value: "0" });
assert.equal(parseVNextAuthorizationPlan(approvalPlan, feeEvidence, now + 1).settlementMode, VNEXT_LEGACY_V1_FEE);
assert.equal(vnextSpotTradeInstruction(approvalPlan).target, usdg);
assert.throws(() => parseVNextAuthorizationPlan({ ...approvalPlan, data: encodeFunctionData({
  abi: erc20Abi, functionName: "approve", args: [executor, BigInt(buy.userGrossInputAtomic) + 1n]
}) }, feeEvidence, now + 1), /inconsistent|approval|payload/);

const swapEvidence: VNextPreSignEvidence = {
  ...feeEvidence,
  status: "verified",
  approvalRequired: false,
  allowanceAtomic: buy.userGrossInputAtomic,
  exactSimulationPassed: true,
  nextAction: "swap",
  nextActionTarget: executor,
  nextActionCalldataHash: keccak256(buyData),
  calldataHash: keccak256(buyData)
};
const swapPlan = v1Plan({ kind: "swap", evidence: swapEvidence, target: executor, data: buyData, value: "0" });
assert.equal(parseVNextAuthorizationPlan(swapPlan, swapEvidence, now + 1).target, executor);
assert.equal(vnextSpotTradeInstruction(swapPlan).target, executor);
assert.throws(() => parseVNextAuthorizationPlan({ ...swapPlan, target: ROBINHOOD_SWAP_ROUTER_02 }, swapEvidence, now + 1), /inconsistent|fee-bearing|payload/);

const sellEconomics = normalizeOutputSideRmtFee({
  policy,
  inputAssetId: tokenId,
  outputAssetId: usdgId,
  feeAssetId: usdgId,
  settlementMode: "rmt-direct-executor-v1",
  userGrossInputAtomic: "1000000000000000000",
  providerGrossExpectedOutputAtomic: "100000000",
  providerProtectedOutputAtomic: "98000000"
});
const sell = createRmtUniswapV3FeeExecution({
  executor,
  executorRuntimeHash: runtimeHash,
  executionId: `0x${"c".repeat(64)}`,
  policyId: policy.policyId,
  netEconomics: sellEconomics,
  trader,
  deadline: "1787000300",
  routerMinimumGrossOutputAtomic: sellEconomics.providerProtectedOutputAtomic,
  route: { kind: 0, tokenIn: token, tokenOut: usdg, fee0: 3_000, fee1: 0, pool0: pool, pool1: zeroAddress }
});
assert.equal(assertRmtUniswapV3FeeCalldata(encodeRmtUniswapV3FeeExecution(sell), sell, sellEconomics), true);

assert.equal(configuredVNextUniswapFeeExecutor({} as NodeJS.ProcessEnv), null);
assert.throws(() => configuredVNextUniswapFeeExecutor({
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv), /both the policy and provider/);
const config = configuredVNextUniswapFeeExecutor({
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: runtimeHash,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: trader,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "123456",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: usdgId
} as unknown as NodeJS.ProcessEnv);
assert.equal(config?.executor, executor);
assert.equal(config?.policy.policyHash, policy.policyHash);
assert.equal(config?.proofWallet, trader);
assert.equal(config?.releaseScope, "proof-wallet");
assert.equal(isVNextUniswapFeeProofRecipient(config!, trader), true);
assert.equal(isVNextUniswapFeeProofRecipient(config!, token), false);
assert.equal(isVNextUniswapFeeRecipientEligible(config!, trader), true);
assert.equal(isVNextUniswapFeeRecipientEligible(config!, token), false);
assert.throws(() => configuredVNextUniswapFeeExecutor({
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: runtimeHash,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "123456",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: usdgId
} as unknown as NodeJS.ProcessEnv), /PROOF_WALLET/);
assert.throws(() => configuredVNextUniswapFeeExecutor({
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: runtimeHash,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: zeroAddress,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "123456",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: usdgId
} as unknown as NodeJS.ProcessEnv), /proof-wallet identity/);
assert.throws(() => configuredVNextUniswapFeeExecutor({
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: runtimeHash,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: trader,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "123456",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: "eip155:4663/contract:0x9999999999999999999999999999999999999999,USDC"
} as unknown as NodeJS.ProcessEnv), /asset registry/);

const record: VNextExecutionRecord = {
  schemaVersion: 1,
  chainId: 4_663,
  wallet: trader,
  kind: "swap",
  inputAsset: token,
  outputAsset: usdg,
  inputAmountAtomic: sell.userGrossInputAtomic,
  planId: "11111111-1111-4111-8111-111111111111",
  payloadHash: `0x${"d".repeat(64)}`,
  txHash: `0x${"e".repeat(64)}`,
  state: "submitted",
  submittedAtMs: now,
  updatedAtMs: now,
  feeSettlement: {
    executor,
    executionId: sell.executionId,
    policyIdHash: sell.policyIdHash,
    policyHash: sell.policyHash,
    policyVersion: sell.policyVersion,
    treasury,
    feeAsset: usdg,
    feeBps: sell.feeBps,
    feeSide: sell.feeSide,
    routeIdentity: sell.routeIdentity,
    providerInputAtomic: sell.providerInputAtomic,
    protectedUserNetOutputAtomic: sell.protectedUserNetOutputAtomic,
    maximumFeeAtomic: sell.maximumFeeAtomic
  }
};
const actualGross = 101_000_000n;
const actualFee = BigInt(sell.maximumFeeAtomic);
const actualNet = actualGross - actualFee;
const settlementDataParameters = parseAbiParameters(
  "bytes32 policyIdHash, uint256 policyVersion, bytes32 providerId, address router, bytes32 routeIdentity, address feeAsset, uint16 feeBps, uint8 feeSide, uint256 userGrossInput, uint256 providerInput, uint256 grossActualOutput, uint256 actualRmtFee, uint256 actualUserNetOutput, address treasury"
);
type SettlementEventValues = {
  emitter: Address;
  executionId: Hex;
  policyHash: Hex;
  trader: Address;
  policyIdHash: Hex;
  policyVersion: bigint;
  providerId: Hex;
  router: Address;
  routeIdentity: Hex;
  feeAsset: Address;
  feeBps: number;
  feeSide: number;
  userGrossInput: bigint;
  providerInput: bigint;
  grossActualOutput: bigint;
  actualRmtFee: bigint;
  actualUserNetOutput: bigint;
  treasury: Address;
};
const canonicalSettlementValues: SettlementEventValues = {
  emitter: executor,
  executionId: sell.executionId,
  policyHash: sell.policyHash,
  trader,
  policyIdHash: sell.policyIdHash,
  policyVersion: BigInt(sell.policyVersion),
  providerId: RMT_UNISWAP_V3_PROVIDER_ID,
  router: ROBINHOOD_SWAP_ROUTER_02,
  routeIdentity: sell.routeIdentity,
  feeAsset: usdg,
  feeBps: sell.feeBps,
  feeSide: 1,
  userGrossInput: BigInt(sell.userGrossInputAtomic),
  providerInput: BigInt(sell.providerInputAtomic),
  grossActualOutput: actualGross,
  actualRmtFee: actualFee,
  actualUserNetOutput: actualNet,
  treasury
};
function settlementLog(overrides: Partial<SettlementEventValues> = {}) {
  const values = { ...canonicalSettlementValues, ...overrides };
  const topics = encodeEventTopics({
    abi: rmtUniswapV3FeeExecutorAbi,
    eventName: "RMTUniswapV3FeeSettled",
    args: { executionId: values.executionId, policyHash: values.policyHash, trader: values.trader }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []);
  const data = encodeAbiParameters(settlementDataParameters, [
    values.policyIdHash, values.policyVersion, values.providerId, values.router,
    values.routeIdentity, values.feeAsset, values.feeBps, values.feeSide,
    values.userGrossInput, values.providerInput, values.grossActualOutput,
    values.actualRmtFee, values.actualUserNetOutput, values.treasury
  ]);
  return { address: values.emitter, topics, data };
}
const canonicalSettlementLog = settlementLog();
const settlement = settledVNextFeeExecution(record, [canonicalSettlementLog]);
assert.deepEqual(settlement, {
  outputAmountAtomic: actualNet.toString(),
  actualFeeAtomic: actualFee.toString(),
  grossActualOutputAtomic: actualGross.toString(),
  actualUserNetOutputAtomic: actualNet.toString()
});
assert.equal(settledVNextFeeExecution(record, [canonicalSettlementLog, canonicalSettlementLog]), null);
assert.equal(settledVNextFeeExecution({ ...record, wallet: token }, [canonicalSettlementLog]), null);
const settlementMutations: Partial<SettlementEventValues>[] = [
  { emitter: token },
  { executionId: `0x${"1".repeat(64)}` as Hex },
  { policyHash: `0x${"2".repeat(64)}` as Hex },
  { trader: token },
  { policyIdHash: `0x${"3".repeat(64)}` as Hex },
  { policyVersion: 2n },
  { providerId: `0x${"4".repeat(64)}` as Hex },
  { router: token },
  { routeIdentity: `0x${"5".repeat(64)}` as Hex },
  { feeAsset: token },
  { feeBps: 26 },
  { feeSide: 0 },
  { userGrossInput: canonicalSettlementValues.userGrossInput + 1n },
  { providerInput: canonicalSettlementValues.providerInput + 1n },
  { grossActualOutput: actualGross + 1n },
  { actualRmtFee: actualFee + 1n },
  { actualUserNetOutput: actualNet - 1n },
  { treasury: token }
];
settlementMutations.forEach((mutation) => {
  assert.equal(settledVNextFeeExecution(record, [settlementLog(mutation)]), null);
});

const buyRecord: VNextExecutionRecord = {
  ...record,
  inputAsset: usdg,
  outputAsset: token,
  inputAmountAtomic: buy.userGrossInputAtomic,
  feeSettlement: {
    executor,
    executionId: buy.executionId,
    policyIdHash: buy.policyIdHash,
    policyHash: buy.policyHash,
    policyVersion: buy.policyVersion,
    treasury,
    feeAsset: usdg,
    feeBps: buy.feeBps,
    feeSide: buy.feeSide,
    routeIdentity: buy.routeIdentity,
    providerInputAtomic: buy.providerInputAtomic,
    protectedUserNetOutputAtomic: buy.protectedUserNetOutputAtomic,
    maximumFeeAtomic: buy.maximumFeeAtomic
  }
};
const buyGrossOutput = BigInt(buy.providerGrossExpectedOutputAtomic);
const buyFee = BigInt(buy.maximumFeeAtomic);
const buySettlement = settlementLog({
  executionId: buy.executionId,
  policyHash: buy.policyHash,
  policyIdHash: buy.policyIdHash,
  routeIdentity: buy.routeIdentity,
  feeSide: 0,
  userGrossInput: BigInt(buy.userGrossInputAtomic),
  providerInput: BigInt(buy.providerInputAtomic),
  grossActualOutput: buyGrossOutput,
  actualRmtFee: buyFee,
  actualUserNetOutput: buyGrossOutput
});
assert.deepEqual(settledVNextFeeExecution(buyRecord, [buySettlement]), {
  outputAmountAtomic: buyGrossOutput.toString(),
  actualFeeAtomic: buyFee.toString(),
  grossActualOutputAtomic: buyGrossOutput.toString(),
  actualUserNetOutputAtomic: buyGrossOutput.toString()
});
assert.equal(settledVNextFeeExecution(buyRecord, [settlementLog({
  executionId: buy.executionId,
  policyHash: buy.policyHash,
  policyIdHash: buy.policyIdHash,
  routeIdentity: buy.routeIdentity,
  feeSide: 0,
  userGrossInput: BigInt(buy.userGrossInputAtomic),
  providerInput: BigInt(buy.providerInputAtomic),
  grossActualOutput: buyGrossOutput,
  actualRmtFee: buyFee,
  actualUserNetOutput: buyGrossOutput - 1n
})]), null);

assert.notEqual(ROBINHOOD_WETH, zeroAddress);
assert.equal(
  ROBINHOOD_WETH_RUNTIME_HASH,
  "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353"
);
console.log("RMT Uniswap V3 fee authorization, gate, and canonical settlement checks passed.");
