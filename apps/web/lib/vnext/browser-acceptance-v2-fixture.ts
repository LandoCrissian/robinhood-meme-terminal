import { writeFile } from "node:fs/promises";
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
import { authorizationPayloadHash, parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "./authorization-plan";
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
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";

const wallet = "0x3333333333333333333333333333333333333333" as Address;
const token = "0x0000000000000000000000000000000000001001" as Address;
const executor = "0x5555555555555555555555555555555555555555" as Address;
const treasury = "0x7777777777777777777777777777777777777777" as Address;
const pool = "0x6666666666666666666666666666666666666666" as Address;
const runtimeHash = `0x${"8".repeat(64)}` as Hex;
const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "40000000" });
const generatedAtMs = Date.now();
const deadline = Math.floor((generatedAtMs + 300_000) / 1_000).toString();

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
    expiresAtMs: generatedAtMs + 60_000,
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
      userPaysGas: true,
      providerFeeAsset: null,
      providerFeeAtomic: null,
      gasSponsorshipFeeAsset: null,
      gasSponsorshipFeeAtomic: null,
      explicitProviderFeeOutputAtomic: null,
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

const destination = process.argv.slice(2).find((argument) => argument !== "--");
if (!destination) throw new Error("Browser acceptance fixture destination is required.");
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
void writeFile(destination, JSON.stringify({
  generatedAtMs,
  wallet,
  token,
  executor,
  treasury,
  router: ROBINHOOD_SWAP_ROUTER_02,
  erc20: { ...erc20, approvalEvidence, approvalPlan, settlementLog },
  native
}, null, 2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Browser acceptance fixture could not be written.");
  process.exitCode = 1;
});
