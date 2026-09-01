import { writeFile } from "node:fs/promises";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { authorizationPayloadHash, parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "./authorization-plan";
import { normalizeDisabledRmtFee } from "./execution-fee-policy";
import { createRmtExecutionFeeV2Policy, normalizeRmtExecutionFeeV2Input } from "./execution-fee-policy-v2";
import { bindVNextAtomicFeeAuthorization, type VNextAtomicFeeSettlementProof } from "./provider-fee-settlement";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { parseVNextQuoteResponse } from "./quote-observation";
import { ROBINHOOD_NATIVE_ASSET_ADDRESS, ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";
import {
  createRmtUniswapV3FeeExecutionV2,
  encodeRmtUniswapV3FeeExecutionV2,
  RMT_UNISWAP_V3_V2_PROVIDER_ID,
  rmtUniswapV3FeeExecutorV2Abi
} from "./uniswap-v3-fee-executor-v2";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import {
  MAX_UINT160,
  PERMIT2_ADDRESS,
  ROBINHOOD_UNIVERSAL_ROUTER
} from "../uniswap-v4";
import {
  prepareVNextUniswapV4Authorization,
  type VNextUniswapV4ExecutionDependencies
} from "../server/vnext-uniswap-v4-execution";
import type { VNextCanonicalMarketInventoryResult } from "../server/vnext-market-indexer";
import {
  directExecutionBinding,
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE
} from "./execution-settlement";

const wallet = "0x3333333333333333333333333333333333333333" as Address;
const token = "0x0000000000000000000000000000000000001001" as Address;
const executor = "0x5555555555555555555555555555555555555555" as Address;
const treasury = "0x7777777777777777777777777777777777777777" as Address;
const pool = "0x6666666666666666666666666666666666666666" as Address;
const runtimeHash = `0x${"8".repeat(64)}` as Hex;
const v2VerificationCommitment = "v1.browser_acceptance_fixture.browser_acceptance_fixture";
const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "40000000" });
const generatedAtMs = Date.now();
const deadline = Math.floor((generatedAtMs + 300_000) / 1_000).toString();
const walletPlanExpiresAt = (onchainDeadline: string | bigint) => Math.min(
  generatedAtMs + 60_000,
  Number(BigInt(onchainDeadline) * 1_000n) - 180_000
);

const v4Token = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");
const v4Hooks = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
const v4PoolId = "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3" as Hex;
const v4QuoteBlockHash = `0x${"5".repeat(64)}` as Hex;
const v4SimulationBlockHash = `0x${"6".repeat(64)}` as Hex;
const v4PoolKey = {
  currency0: zeroAddress,
  currency1: v4Token,
  fee: 0,
  tickSpacing: 200,
  hooks: v4Hooks
};

function uuid(seed: string) {
  return `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`;
}

function buildScenario(input: {
  idSeed: string;
  inputAsset: Address;
  inputAssetId: string;
  grossInput: string;
  inputDecimals: number;
  expectedOutput: string;
  protectedOutput: string;
  native: boolean;
}) {
  const economics = normalizeRmtExecutionFeeV2Input({
    policy,
    inputAssetId: input.inputAssetId,
    outputAssetId: `eip155:4663/contract:${token.toLowerCase()}`,
    userGrossInputAtomic: input.grossInput,
    providerGrossExpectedOutputAtomic: input.expectedOutput,
    providerProtectedOutputAtomic: input.protectedOutput,
    settlementMode: "v2-atomic-input-fee"
  });
  const executionId = `0x${input.idSeed.repeat(64)}` as Hex;
  const execution = createRmtUniswapV3FeeExecutionV2({
    executor,
    executorRuntimeHash: runtimeHash,
    executionId,
    economics,
    trader: wallet,
    inputAsset: input.inputAsset,
    outputAsset: token,
    deadline,
    route: {
      kind: 0,
      tokenIn: input.native ? ROBINHOOD_WETH_ADDRESS : input.inputAsset,
      tokenOut: token,
      fee0: 3_000,
      fee1: 0,
      pool0: pool,
      pool1: zeroAddress
    }
  });
  const swapData = encodeRmtUniswapV3FeeExecutionV2(execution);
  const proof: VNextAtomicFeeSettlementProof = {
    verificationState: "verified_atomic",
    provider: "uniswap-v3",
    settlementMode: "v2-atomic-input-fee",
    implementationId: "rmt-uniswap-v3-fee-executor-v2",
    executionTarget: executor,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    calldataHash: keccak256(swapData),
    executionId,
    recipient: wallet,
    deadline,
    atomicFeeSettlement: true,
    revertsAtomically: true
  };
  const feeAuthorization = bindVNextAtomicFeeAuthorization({ economics, proof });
  const quoteRequestId = uuid(input.native ? "1" : "2");
  const verificationBase = {
    sourceQuoteRequestId: quoteRequestId,
    provider: "uniswap-v3" as const,
    chainId: 4_663 as const,
    inputAsset: input.inputAsset,
    outputAsset: token,
    inputAmountAtomic: input.grossInput,
    indicativeProtectedOutputFloorAtomic: input.protectedOutput,
    expectedOutputAtomic: input.expectedOutput,
    protectedOutputAtomic: input.protectedOutput,
    recipient: wallet,
    router: ROBINHOOD_SWAP_ROUTER_02,
    approvalSpender: executor,
    sufficientBalance: true,
    balanceAtomic: input.native ? "10000000000000000000" : "100000000",
    route: "direct" as const,
    fees: [3_000],
    pools: [pool],
    deadline,
    calldataHash: proof.calldataHash,
    nativeBalanceWei: "10000000000000000000",
    gasPriceWei: "1000000000",
    feeCeilingWei: "3000000000",
    estimatedNetworkCostUsdgAtomic: null,
    networkCostValuationSource: null,
    networkCostValuedAtMs: null,
    networkCostValuationExpiresAtMs: null,
    userPaysGas: true as const,
    rmtFeeEnabled: false,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    feeExecution: null,
    feeV2Economics: economics,
    feeV2Settlement: proof,
    v2VerificationCommitment,
    verifiedAtMs: generatedAtMs,
    expiresAtMs: generatedAtMs + 300_000,
    authorizationReady: false as const,
    routerRuntimeHash: `0x${"2".repeat(64)}`,
    factoryRuntimeHash: `0x${"3".repeat(64)}`,
    quoterRuntimeHash: `0x${"4".repeat(64)}`
  };
  const swapEvidence: VNextPreSignEvidence = {
    ...verificationBase,
    verificationId: uuid(input.native ? "3" : "4"),
    status: "verified",
    approvalRequired: false,
    allowanceAtomic: input.native ? "0" : input.grossInput,
    nextAction: "swap",
    nextActionTarget: executor,
    nextActionCalldataHash: proof.calldataHash,
    transactionValueAtomic: input.native ? input.grossInput : "0",
    estimatedGasUnits: "100000",
    gasLimitUnits: "120000",
    estimatedNetworkCostWei: "360000000000000",
    gasState: "sufficient",
    exactSimulationPassed: true
  };
  const swapWithoutHash: Omit<VNextAuthorizationPlan, "payloadHash"> = {
    planId: uuid(input.native ? "5" : "6"),
    sourceQuoteRequestId: quoteRequestId,
    sourceVerificationId: swapEvidence.verificationId,
    provider: "uniswap-v3",
    kind: "swap",
    chainId: 4_663,
    target: executor,
    data: swapData,
    value: input.native ? input.grossInput : "0",
    gasLimit: "120000",
    inputAsset: input.inputAsset,
    outputAsset: token,
    inputAmountAtomic: input.grossInput,
    protectedOutputAtomic: input.protectedOutput,
    recipient: wallet,
    router: ROBINHOOD_SWAP_ROUTER_02,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    feeV2Economics: economics,
    feeV2Authorization: feeAuthorization,
    deadline,
    preparedAtMs: generatedAtMs,
    expiresAtMs: walletPlanExpiresAt(deadline),
    userAuthorizationRequired: true,
    serverSubmissionEnabled: false
  };
  const swapPlan: VNextAuthorizationPlan = { ...swapWithoutHash, payloadHash: authorizationPayloadHash(swapWithoutHash) };
  const quote = {
    requestId: quoteRequestId,
    chainId: 4_663,
    inputAsset: input.inputAsset,
    outputAsset: token,
    inputAmountAtomic: input.grossInput,
    requestedAtMs: generatedAtMs,
    completedAtMs: generatedAtMs + 1,
    attempts: [{
      provider: "uniswap-v3",
      providerLabel: "Uniswap V3",
      providerFamily: "uniswap",
      adapterVersion: 1,
      status: "indicative",
      chainId: 4_663,
      inputAsset: input.inputAsset,
      outputAsset: token,
      inputAmountAtomic: input.grossInput,
      expectedOutputAtomic: input.expectedOutput,
      protectedOutputAtomic: input.protectedOutput,
      outputDecimals: 18,
      priceImpact: 0.003,
      liquidityFeeEvidence: [],
      quotedAtMs: generatedAtMs,
      expiresAtMs: generatedAtMs + 1_800_000,
      latencyMs: 12,
      executionKind: "direct_amm",
      strictVerificationAvailable: true,
      publicWalletExecutionEligible: true,
      userPaysGas: true,
      providerFeeAsset: null,
      providerFeeAtomic: null,
      gasSponsorshipFeeAsset: null,
      gasSponsorshipFeeAtomic: null,
      explicitProviderFeeOutputAtomic: null,
      settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
      executionTarget: executor,
      feeV2Economics: economics,
      netEconomics: null,
      networkFeeNativeAtomic: null,
      networkFeeNativeSymbol: "ETH",
      protectedNetOutputAtomic: null,
      costState: "network_fee_pending",
      authorizationReady: false,
      detail: "Deterministic browser acceptance route."
    }]
  };
  return { inputDecimals: input.inputDecimals, economics, execution, quote, swapEvidence, swapPlan };
}

const erc20 = buildScenario({
  idSeed: "7",
  inputAsset: ROBINHOOD_USDG_ADDRESS,
  inputAssetId: `eip155:4663/contract:${ROBINHOOD_USDG_ADDRESS.toLowerCase()}`,
  grossInput: "25000000",
  inputDecimals: 6,
  expectedOutput: "1000000000000000000000",
  protectedOutput: "990000000000000000000",
  native: false
});
const approvalData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [executor, 25_000_000n] });
const approvalEvidence: VNextPreSignEvidence = {
  ...erc20.swapEvidence,
  verificationId: uuid("8"),
  status: "approval_required",
  approvalRequired: true,
  allowanceAtomic: "0",
  nextAction: "approval",
  nextActionTarget: ROBINHOOD_USDG_ADDRESS,
  nextActionCalldataHash: keccak256(approvalData),
  estimatedGasUnits: "50000",
  gasLimitUnits: "60000",
  estimatedNetworkCostWei: "180000000000000",
  exactSimulationPassed: false
};
const approvalWithoutHash: Omit<VNextAuthorizationPlan, "payloadHash"> = {
  ...erc20.swapPlan,
  planId: uuid("9"),
  sourceVerificationId: approvalEvidence.verificationId,
  kind: "erc20_approval",
  target: ROBINHOOD_USDG_ADDRESS,
  data: approvalData,
  gasLimit: "60000"
};
const approvalPlan = { ...approvalWithoutHash, payloadHash: authorizationPayloadHash(approvalWithoutHash) };

const native = buildScenario({
  idSeed: "a",
  inputAsset: ROBINHOOD_NATIVE_ASSET_ADDRESS,
  inputAssetId: "eip155:4663/native",
  grossInput: "500000000000000",
  inputDecimals: 18,
  expectedOutput: "20000000000000000000",
  protectedOutput: "19800000000000000000",
  native: true
});
const quoteOnlyWinnerExpectedOutput = "20100000000000000000";
const quoteOnlyWinnerProtectedOutput = "19900000000000000000";
const quoteOnlyWinner = {
  ...native.quote,
  requestId: native.quote.requestId,
  attempts: [{
    ...native.quote.attempts[0],
    provider: "uniswap-v2" as const,
    providerLabel: "Uniswap V2",
    expectedOutputAtomic: quoteOnlyWinnerExpectedOutput,
    protectedOutputAtomic: quoteOnlyWinnerProtectedOutput,
    liquidityFeeEvidence: [{
      source: "uniswap-v2-factory" as const,
      poolAddress: getAddress("0x4444444444444444444444444444444444444444"),
      fee: 30,
      denominator: 10_000 as const,
      stable: null,
      tickSpacing: null,
      observedBlock: "50000016",
      observedBlockHash: `0x${"5".repeat(64)}` as Hex
    }],
    publicWalletExecutionEligible: false,
    settlementMode: undefined,
    executionTarget: undefined,
    feeV2Economics: undefined,
    netEconomics: normalizeDisabledRmtFee({
      userGrossInputAtomic: native.quote.inputAmountAtomic,
      providerGrossExpectedOutputAtomic: quoteOnlyWinnerExpectedOutput,
      providerProtectedOutputAtomic: quoteOnlyWinnerProtectedOutput,
      reason: "provider_not_admitted"
    }),
    detail: "Better protected output remains visible as a quote-only route."
  }, native.quote.attempts[0]]
};

const eventDataParameters = parseAbiParameters(
  "bytes32 policyIdHash, uint256 policyVersion, bytes32 providerId, address router, bytes32 routeIdentity, address requestedInputAsset, address requestedOutputAsset, address feeAsset, uint16 feeBps, uint8 feeSide, uint256 userGrossInput, uint256 providerInput, uint256 actualProviderOutput, uint256 actualRmtFee, address treasury"
);
const topics = encodeEventTopics({
  abi: rmtUniswapV3FeeExecutorV2Abi,
  eventName: "RMTUniswapV3FeeSettledV2",
  args: { executionId: erc20.execution.executionId, policyHash: erc20.execution.policyHash, trader: wallet }
}).flatMap((topic) => typeof topic === "string" ? [topic] : []);
const settlementLog = {
  address: executor,
  topics,
  data: encodeAbiParameters(eventDataParameters, [
    erc20.execution.policyIdHash,
    2n,
    RMT_UNISWAP_V3_V2_PROVIDER_ID,
    ROBINHOOD_SWAP_ROUTER_02,
    erc20.execution.routeIdentity,
    ROBINHOOD_USDG_ADDRESS,
    token,
    ROBINHOOD_USDG_ADDRESS,
    25,
    0,
    25_000_000n,
    24_937_500n,
    995_000_000_000_000_000_000n,
    62_500n,
    treasury
  ])
};
const nativeTopics = encodeEventTopics({
  abi: rmtUniswapV3FeeExecutorV2Abi,
  eventName: "RMTUniswapV3FeeSettledV2",
  args: { executionId: native.execution.executionId, policyHash: native.execution.policyHash, trader: wallet }
}).flatMap((topic) => typeof topic === "string" ? [topic] : []);
const nativeSettlementLog = {
  address: executor,
  topics: nativeTopics,
  data: encodeAbiParameters(eventDataParameters, [
    native.execution.policyIdHash,
    2n,
    RMT_UNISWAP_V3_V2_PROVIDER_ID,
    ROBINHOOD_SWAP_ROUTER_02,
    native.execution.routeIdentity,
    ROBINHOOD_NATIVE_ASSET_ADDRESS,
    token,
    ROBINHOOD_NATIVE_ASSET_ADDRESS,
    25,
    0,
    500_000_000_000_000n,
    498_750_000_000_000n,
    20_000_000_000_000_000_000n,
    1_250_000_000_000n,
    treasury
  ])
};

async function buildV4BrowserScenario() {
  const sourceQuoteRequestId = uuid("b");
  const verificationId = uuid("c");
  const planId = uuid("d");
  const inputAmountAtomic = "10000000000000000";
  const expectedOutputAtomic = "25000000000000000000000";
  const protectedOutputAtomic = "24750000000000000000000";
  const v4Deadline = BigInt(Math.floor(generatedAtMs / 1_000) + 240);
  const inventory: VNextCanonicalMarketInventoryResult = {
    status: "verified_shadow",
    chainId: 4_663,
    mode: "shadow",
    authoritative: false,
    sourceManifestHash: `0x${"1".repeat(64)}`,
    coverage: {
      complete: true,
      finalizedHead: "50000000",
      sources: [{ sourceId: "uniswap-v4", status: "shadow-ready", indexedThrough: "50000000" }]
    },
    nextCursor: null,
    pools: [{
      sourceId: "uniswap-v4",
      protocol: "uniswap",
      version: 4,
      poolKey: v4PoolId,
      poolAddress: null,
      token0: zeroAddress,
      token1: v4Token.toLowerCase(),
      stable: null,
      fee: v4PoolKey.fee,
      tickSpacing: v4PoolKey.tickSpacing,
      hooks: v4Hooks.toLowerCase(),
      transactionHash: `0x${"2".repeat(64)}`,
      blockNumber: "49000000",
      blockHash: `0x${"3".repeat(64)}`,
      stateStatus: "ready",
      liveFee: 0,
      feeDenominator: 1_000_000,
      gaugeAddress: null,
      gaugeAlive: null,
      gaugeWeight: null,
      gaugeClaimable: null,
      feesAddress: null,
      bribeAddress: null,
      stateError: null,
      stateObservedBlock: "50000000",
      stateObservedBlockHash: `0x${"4".repeat(64)}`
    }]
  };
  const dependencies = (allowances: {
    tokenToPermit2?: bigint;
    permit2ToRouter?: bigint;
    permit2Expiration?: bigint;
    quoteOut?: bigint;
  } = {}): VNextUniswapV4ExecutionDependencies => ({
    readInventory: async () => inventory,
    quote: async () => allowances.quoteOut ?? BigInt(expectedOutputAtomic),
    readBlock: async (blockNumber) => blockNumber === 50_000_001n
      ? { number: 50_000_001n, hash: v4QuoteBlockHash, timestamp: BigInt(Math.floor(generatedAtMs / 1_000) - 1) }
      : { number: 50_000_002n, hash: v4SimulationBlockHash, timestamp: BigInt(Math.floor(generatedAtMs / 1_000)) },
    getBytecode: async () => "0x60006000",
    getNativeBalance: async () => 10n ** 20n,
    getTokenState: async () => ({ balance: 10n ** 24n, permit2Allowance: allowances.tokenToPermit2 ?? MAX_UINT160 }),
    getPermit2Allowance: async () => ({
      amount: allowances.permit2ToRouter ?? MAX_UINT160,
      expiration: allowances.permit2Expiration ?? v4Deadline + 1_000n
    }),
    call: async () => undefined,
    estimateGas: async () => 200_000n,
    getGasPrice: async () => 1_000_000_000n,
    now: () => generatedAtMs
  });
  const quoteEvidence = {
    poolId: v4PoolId,
    currency0: zeroAddress,
    currency1: v4Token,
    fee: v4PoolKey.fee,
    tickSpacing: v4PoolKey.tickSpacing,
    hooks: v4Hooks,
    recipient: wallet,
    observedBlock: "50000001",
    observedBlockHash: v4QuoteBlockHash,
    observedAtMs: generatedAtMs - 1_000,
    quotedAtMs: generatedAtMs - 900,
    expiresAtMs: generatedAtMs + 29_000
  };
  const prepared = await prepareVNextUniswapV4Authorization({
    chainId: 4_663,
    inputAsset: zeroAddress,
    outputAsset: v4Token,
    inputAmountAtomic,
    amountIn: BigInt(inputAmountAtomic),
    recipient: wallet,
    indicativeProtectedOutputFloorAtomic: BigInt(protectedOutputAtomic),
    canonicalMarket: { sourceId: "uniswap-v4", poolId: v4PoolId },
    v4QuoteEvidence: quoteEvidence,
    deadlineSeconds: v4Deadline,
    protectedOutputFloorAtomic: BigInt(protectedOutputAtomic),
    nowMs: generatedAtMs
  }, dependencies());
  const evidence = {
    verificationId,
    sourceQuoteRequestId,
    ...prepared.evidence
  } as unknown as VNextPreSignEvidence;
  const planWithoutHash: Omit<VNextAuthorizationPlan, "payloadHash"> = {
    planId,
    sourceQuoteRequestId,
    sourceVerificationId: verificationId,
    provider: "uniswap-v4",
    kind: "swap",
    chainId: 4_663,
    target: prepared.transaction.target,
    data: prepared.transaction.data,
    value: prepared.transaction.value,
    gasLimit: prepared.transaction.gasLimit,
    inputAsset: zeroAddress,
    outputAsset: v4Token,
    inputAmountAtomic,
    protectedOutputAtomic: evidence.protectedOutputAtomic,
    recipient: wallet,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
    directNoRmtFee: evidence.directNoRmtFee,
    directAuthorization: directExecutionBinding({
      provider: "uniswap-v4",
      kind: "swap",
      chainId: 4_663,
      inputAsset: zeroAddress,
      outputAsset: v4Token,
      inputAmountAtomic,
      protectedOutputAtomic: evidence.protectedOutputAtomic,
      recipient: wallet,
      providerTarget: ROBINHOOD_UNIVERSAL_ROUTER,
      executionTarget: prepared.transaction.target,
      approvalSpender: evidence.approvalSpender,
      approvalAmountAtomic: inputAmountAtomic,
      data: prepared.transaction.data,
      valueAtomic: prepared.transaction.value,
      deadline: evidence.deadline
    }),
    netEconomics: evidence.netEconomics,
    feeExecution: null,
    v4Execution: evidence.v4Execution,
    deadline: evidence.deadline,
    preparedAtMs: generatedAtMs,
    expiresAtMs: walletPlanExpiresAt(evidence.deadline),
    userAuthorizationRequired: true,
    serverSubmissionEnabled: false
  };
  const plan: VNextAuthorizationPlan = { ...planWithoutHash, payloadHash: authorizationPayloadHash(planWithoutHash) };
  const quote = {
    requestId: sourceQuoteRequestId,
    chainId: 4_663,
    inputAsset: zeroAddress,
    outputAsset: v4Token,
    inputAmountAtomic,
    requestedAtMs: generatedAtMs,
    completedAtMs: generatedAtMs + 1,
    attempts: [{
      provider: "uniswap-v4",
      providerLabel: "Uniswap V4",
      providerFamily: "uniswap",
      adapterVersion: 1,
      status: "indicative",
      chainId: 4_663,
      inputAsset: zeroAddress,
      outputAsset: v4Token,
      inputAmountAtomic,
      expectedOutputAtomic,
      protectedOutputAtomic,
      outputDecimals: 18,
      priceImpact: null,
      liquidityFeeEvidence: [],
      quotedAtMs: generatedAtMs,
      expiresAtMs: generatedAtMs + 60_000,
      latencyMs: 14,
      executionKind: "direct_amm",
      strictVerificationAvailable: true,
      publicWalletExecutionEligible: false,
      userPaysGas: true,
      providerFeeAsset: null,
      providerFeeAtomic: null,
      gasSponsorshipFeeAsset: null,
      gasSponsorshipFeeAtomic: null,
      explicitProviderFeeOutputAtomic: null,
      netEconomics: evidence.netEconomics,
      networkFeeNativeAtomic: null,
      networkFeeNativeSymbol: "ETH",
      protectedNetOutputAtomic: null,
      costState: "network_fee_pending",
      authorizationReady: false,
      v4Evidence: {
        poolId: v4PoolId,
        currency0: zeroAddress,
        currency1: v4Token,
        fee: v4PoolKey.fee,
        tickSpacing: v4PoolKey.tickSpacing,
        hooks: v4Hooks,
        recipient: wallet,
        provenance: "canonical-market-indexer+uniswap-v4-quoter+robinhood-rpc",
        observedBlock: quoteEvidence.observedBlock,
        observedBlockHash: quoteEvidence.observedBlockHash,
        observedAtMs: quoteEvidence.observedAtMs
      },
      detail: "Canonical Uniswap V4 PoolKey quote. Exact Universal Router simulation is required before wallet review."
    }]
  } as const;

  const sellInputAmountAtomic = "1000000000000000000";
  const sellExpectedOutputAtomic = "4000000000000";
  const sellProtectedOutputAtomic = "3960000000000";
  const stageUuid = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
  const buildSellStage = async (input: {
    suffix: string;
    tokenToPermit2: bigint;
    permit2ToRouter: bigint;
    permit2Expiration: bigint;
  }) => {
    const stageQuoteRequestId = stageUuid(`${input.suffix}1`);
    const stageVerificationId = stageUuid(`${input.suffix}2`);
    const stagePlanId = stageUuid(`${input.suffix}3`);
    const preparedStage = await prepareVNextUniswapV4Authorization({
      chainId: 4_663,
      inputAsset: v4Token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellInputAmountAtomic,
      amountIn: BigInt(sellInputAmountAtomic),
      recipient: wallet,
      indicativeProtectedOutputFloorAtomic: BigInt(sellProtectedOutputAtomic),
      canonicalMarket: { sourceId: "uniswap-v4", poolId: v4PoolId },
      v4QuoteEvidence: quoteEvidence,
      deadlineSeconds: v4Deadline,
      protectedOutputFloorAtomic: BigInt(sellProtectedOutputAtomic),
      nowMs: generatedAtMs
    }, dependencies({
      tokenToPermit2: input.tokenToPermit2,
      permit2ToRouter: input.permit2ToRouter,
      permit2Expiration: input.permit2Expiration,
      quoteOut: BigInt(sellExpectedOutputAtomic)
    }));
    const stageEvidence = {
      verificationId: stageVerificationId,
      sourceQuoteRequestId: stageQuoteRequestId,
      ...preparedStage.evidence
    } as unknown as VNextPreSignEvidence;
    const stagePlanWithoutHash: Omit<VNextAuthorizationPlan, "payloadHash"> = {
      planId: stagePlanId,
      sourceQuoteRequestId: stageQuoteRequestId,
      sourceVerificationId: stageVerificationId,
      provider: "uniswap-v4",
      kind: preparedStage.transaction.kind,
      chainId: 4_663,
      target: preparedStage.transaction.target,
      data: preparedStage.transaction.data,
      value: preparedStage.transaction.value,
      gasLimit: preparedStage.transaction.gasLimit,
      inputAsset: v4Token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellInputAmountAtomic,
      protectedOutputAtomic: stageEvidence.protectedOutputAtomic,
      recipient: wallet,
      router: ROBINHOOD_UNIVERSAL_ROUTER,
      settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
      directNoRmtFee: stageEvidence.directNoRmtFee,
      directAuthorization: directExecutionBinding({
        provider: "uniswap-v4",
        kind: preparedStage.transaction.kind,
        chainId: 4_663,
        inputAsset: v4Token,
        outputAsset: zeroAddress,
        inputAmountAtomic: sellInputAmountAtomic,
        protectedOutputAtomic: stageEvidence.protectedOutputAtomic,
        recipient: wallet,
        providerTarget: ROBINHOOD_UNIVERSAL_ROUTER,
        executionTarget: preparedStage.transaction.target,
        approvalSpender: stageEvidence.approvalSpender,
        approvalAmountAtomic: sellInputAmountAtomic,
        data: preparedStage.transaction.data,
        valueAtomic: preparedStage.transaction.value,
        deadline: stageEvidence.deadline
      }),
      netEconomics: stageEvidence.netEconomics,
      feeExecution: null,
      v4Execution: stageEvidence.v4Execution,
      deadline: stageEvidence.deadline,
      preparedAtMs: generatedAtMs,
      expiresAtMs: walletPlanExpiresAt(stageEvidence.deadline),
      userAuthorizationRequired: true,
      serverSubmissionEnabled: false
    };
    const stagePlan: VNextAuthorizationPlan = {
      ...stagePlanWithoutHash,
      payloadHash: authorizationPayloadHash(stagePlanWithoutHash)
    };
    const stageQuote = {
      ...quote,
      requestId: stageQuoteRequestId,
      inputAsset: v4Token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellInputAmountAtomic,
      attempts: quote.attempts.map((attempt) => ({
        ...attempt,
        inputAsset: v4Token,
        outputAsset: zeroAddress,
        inputAmountAtomic: sellInputAmountAtomic,
        expectedOutputAtomic: sellExpectedOutputAtomic,
        protectedOutputAtomic: sellProtectedOutputAtomic,
        netEconomics: stageEvidence.netEconomics
      }))
    };
    parseVNextQuoteResponse(stageQuote, {
      inputAsset: v4Token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellInputAmountAtomic
    }, generatedAtMs);
    const parsedStageEvidence = parseVNextPreSignEvidence(stageEvidence, {
      quoteRequestId: stageQuoteRequestId,
      inputAsset: v4Token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellInputAmountAtomic,
      provider: "uniswap-v4",
      protectedOutputFloorAtomic: sellProtectedOutputAtomic,
      recipient: wallet
    }, generatedAtMs + 1);
    parseVNextAuthorizationBundle({ evidence: stageEvidence, plan: stagePlan }, parsedStageEvidence, {
      quoteRequestId: stageQuoteRequestId,
      inputAsset: v4Token,
      outputAsset: zeroAddress,
      inputAmountAtomic: sellInputAmountAtomic,
      recipient: wallet
    }, generatedAtMs + 1);
    return { quote: stageQuote, evidence: stageEvidence, plan: stagePlan };
  };
  const currentSeconds = BigInt(Math.floor(generatedAtMs / 1_000));
  const sellTokenApproval = await buildSellStage({
    suffix: "a",
    tokenToPermit2: 0n,
    permit2ToRouter: 0n,
    permit2Expiration: 0n
  });
  const sellPermit2Approval = await buildSellStage({
    suffix: "b",
    tokenToPermit2: BigInt(sellInputAmountAtomic),
    permit2ToRouter: 0n,
    permit2Expiration: 0n
  });
  const sellSwap = await buildSellStage({
    suffix: "c",
    tokenToPermit2: BigInt(sellInputAmountAtomic),
    permit2ToRouter: BigInt(sellInputAmountAtomic),
    permit2Expiration: currentSeconds + 90n
  });
  parseVNextQuoteResponse(quote, {
    inputAsset: zeroAddress,
    outputAsset: v4Token,
    inputAmountAtomic
  }, generatedAtMs);
  const parsedEvidence = parseVNextPreSignEvidence(evidence, {
    quoteRequestId: sourceQuoteRequestId,
    inputAsset: zeroAddress,
    outputAsset: v4Token,
    inputAmountAtomic,
    provider: "uniswap-v4",
    protectedOutputFloorAtomic: protectedOutputAtomic,
    recipient: wallet
  }, generatedAtMs + 1);
  parseVNextAuthorizationBundle({ evidence, plan }, parsedEvidence, {
    quoteRequestId: sourceQuoteRequestId,
    inputAsset: zeroAddress,
    outputAsset: v4Token,
    inputAmountAtomic,
    recipient: wallet
  }, generatedAtMs + 1);
  return {
    token: v4Token,
    hooks: v4Hooks,
    poolId: v4PoolId,
    poolKey: v4PoolKey,
    quoteEvidence,
    expectedOutputAtomic,
    protectedOutputAtomic,
    quote,
    evidence,
    plan,
    sell: {
      inputAmountAtomic: sellInputAmountAtomic,
      tokenApproval: sellTokenApproval,
      permit2Approval: sellPermit2Approval,
      swap: sellSwap,
      permit2: PERMIT2_ADDRESS,
      universalRouter: ROBINHOOD_UNIVERSAL_ROUTER
    }
  };
}

const destination = process.argv.slice(2).find((argument) => argument !== "--");
if (!destination) throw new Error("Browser acceptance fixture destination is required.");
const fixtureDestination = destination;
async function writeBrowserFixture() {
  parseVNextQuoteResponse(erc20.quote, {
    inputAsset: ROBINHOOD_USDG_ADDRESS,
    outputAsset: token,
    inputAmountAtomic: "25000000"
  }, generatedAtMs);
  parseVNextQuoteResponse(native.quote, {
    inputAsset: ROBINHOOD_NATIVE_ASSET_ADDRESS,
    outputAsset: token,
    inputAmountAtomic: "500000000000000"
  }, generatedAtMs);
  parseVNextQuoteResponse(quoteOnlyWinner, {
    inputAsset: ROBINHOOD_NATIVE_ASSET_ADDRESS,
    outputAsset: token,
    inputAmountAtomic: "500000000000000"
  }, generatedAtMs);
  const parsedApprovalEvidence = parseVNextPreSignEvidence(approvalEvidence, {
    quoteRequestId: erc20.quote.requestId,
    inputAsset: ROBINHOOD_USDG_ADDRESS,
    outputAsset: token,
    inputAmountAtomic: "25000000",
    provider: "uniswap-v3",
    protectedOutputFloorAtomic: erc20.economics.protectedUserNetOutputAtomic,
    recipient: wallet
  }, generatedAtMs);
  parseVNextAuthorizationBundle({ evidence: approvalEvidence, plan: approvalPlan }, parsedApprovalEvidence, {
    quoteRequestId: erc20.quote.requestId,
    inputAsset: ROBINHOOD_USDG_ADDRESS,
    outputAsset: token,
    inputAmountAtomic: "25000000",
    recipient: wallet
  }, generatedAtMs);
  const v4 = await buildV4BrowserScenario();
  await writeFile(fixtureDestination, JSON.stringify({
    generatedAtMs,
    wallet,
    token,
    executor,
    treasury,
    router: ROBINHOOD_SWAP_ROUTER_02,
    erc20: { ...erc20, approvalEvidence, approvalPlan, settlementLog },
    native: { ...native, settlementLog: nativeSettlementLog },
    releaseBlocker: { quote: quoteOnlyWinner },
    v4
  }, null, 2));
}

void writeBrowserFixture().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Browser acceptance fixture could not be written.");
  process.exitCode = 1;
});
