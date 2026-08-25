import { encodeFunctionData, erc20Abi, getAddress, keccak256, type Hex } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { directExecutionBinding, directNoRmtFeeSettlement, VNEXT_DIRECT_NO_RMT_FEE } from "./execution-settlement";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";

export const DIRECT_SMOKE_NOW_MS = 1_786_000_000_000;
export const DIRECT_SMOKE_INPUT = getAddress("0x1111111111111111111111111111111111111111");
export const DIRECT_SMOKE_OUTPUT = getAddress("0x2222222222222222222222222222222222222222");
export const DIRECT_SMOKE_RECIPIENT = getAddress("0x3333333333333333333333333333333333333333");
export const DIRECT_SMOKE_SWAP_DATA = "0x12345678" as Hex;
export const DIRECT_SMOKE_APPROVAL_DATA = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [ROBINHOOD_SWAP_ROUTER_02, 1_000_000n]
});

export const DIRECT_SMOKE_APPROVAL_EVIDENCE: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3",
  status: "approval_required",
  chainId: 4_663,
  inputAsset: DIRECT_SMOKE_INPUT,
  outputAsset: DIRECT_SMOKE_OUTPUT,
  inputAmountAtomic: "1000000",
  indicativeProtectedOutputFloorAtomic: "980",
  expectedOutputAtomic: "1000",
  protectedOutputAtomic: "990",
  recipient: DIRECT_SMOKE_RECIPIENT,
  router: ROBINHOOD_SWAP_ROUTER_02,
  approvalSpender: ROBINHOOD_SWAP_ROUTER_02,
  approvalRequired: true,
  sufficientBalance: true,
  allowanceAtomic: "0",
  balanceAtomic: "2000000",
  route: "direct",
  fees: [3_000],
  pools: ["0x4444444444444444444444444444444444444444"],
  deadline: "1786000300",
  calldataHash: keccak256(DIRECT_SMOKE_SWAP_DATA),
  nextAction: "approval",
  nextActionTarget: DIRECT_SMOKE_INPUT,
  nextActionCalldataHash: keccak256(DIRECT_SMOKE_APPROVAL_DATA),
  transactionValueAtomic: "0",
  nativeBalanceWei: "1000000000000000",
  gasPriceWei: "1000000000",
  feeCeilingWei: "3000000000",
  estimatedGasUnits: "50000",
  gasLimitUnits: "60000",
  estimatedNetworkCostWei: "180000000000000",
  estimatedNetworkCostUsdgAtomic: null,
  networkCostValuationSource: null,
  networkCostValuedAtMs: null,
  networkCostValuationExpiresAtMs: null,
  gasState: "sufficient",
  routerRuntimeHash: `0x${"2".repeat(64)}`,
  factoryRuntimeHash: `0x${"3".repeat(64)}`,
  quoterRuntimeHash: `0x${"4".repeat(64)}`,
  exactSimulationPassed: false,
  userPaysGas: true,
  rmtFeeEnabled: false,
  settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
  directNoRmtFee: directNoRmtFeeSettlement("1000000"),
  verifiedAtMs: DIRECT_SMOKE_NOW_MS - 1_000,
  expiresAtMs: DIRECT_SMOKE_NOW_MS + 300_000,
  authorizationReady: false
};

function withHash(plan: Omit<VNextAuthorizationPlan, "payloadHash">): VNextAuthorizationPlan {
  return { ...plan, payloadHash: authorizationPayloadHash(plan) };
}

export const DIRECT_SMOKE_APPROVAL_PLAN = withHash({
  planId: "33333333-3333-4333-8333-333333333333",
  sourceQuoteRequestId: DIRECT_SMOKE_APPROVAL_EVIDENCE.sourceQuoteRequestId,
  sourceVerificationId: DIRECT_SMOKE_APPROVAL_EVIDENCE.verificationId,
  provider: "uniswap-v3",
  kind: "erc20_approval",
  chainId: 4_663,
  target: DIRECT_SMOKE_INPUT,
  data: DIRECT_SMOKE_APPROVAL_DATA,
  value: "0",
  gasLimit: "60000",
  inputAsset: DIRECT_SMOKE_INPUT,
  outputAsset: DIRECT_SMOKE_OUTPUT,
  inputAmountAtomic: "1000000",
  protectedOutputAtomic: "990",
  recipient: DIRECT_SMOKE_RECIPIENT,
  router: ROBINHOOD_SWAP_ROUTER_02,
  settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
  directNoRmtFee: directNoRmtFeeSettlement("1000000"),
  directAuthorization: directExecutionBinding({
    provider: "uniswap-v3",
    kind: "erc20_approval",
    chainId: 4_663,
    inputAsset: DIRECT_SMOKE_INPUT,
    outputAsset: DIRECT_SMOKE_OUTPUT,
    inputAmountAtomic: "1000000",
    protectedOutputAtomic: "990",
    recipient: DIRECT_SMOKE_RECIPIENT,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    executionTarget: DIRECT_SMOKE_INPUT,
    approvalSpender: ROBINHOOD_SWAP_ROUTER_02,
    approvalAmountAtomic: "1000000",
    data: DIRECT_SMOKE_APPROVAL_DATA,
    valueAtomic: "0",
    deadline: DIRECT_SMOKE_APPROVAL_EVIDENCE.deadline
  }),
  deadline: DIRECT_SMOKE_APPROVAL_EVIDENCE.deadline,
  preparedAtMs: DIRECT_SMOKE_NOW_MS,
  expiresAtMs: DIRECT_SMOKE_NOW_MS + 60_000,
  userAuthorizationRequired: true,
  serverSubmissionEnabled: false
});

export const DIRECT_SMOKE_SWAP_EVIDENCE: VNextPreSignEvidence = {
  ...DIRECT_SMOKE_APPROVAL_EVIDENCE,
  status: "verified",
  approvalRequired: false,
  allowanceAtomic: "1000000",
  nextAction: "swap",
  nextActionTarget: ROBINHOOD_SWAP_ROUTER_02,
  nextActionCalldataHash: keccak256(DIRECT_SMOKE_SWAP_DATA),
  estimatedGasUnits: "100000",
  gasLimitUnits: "120000",
  estimatedNetworkCostWei: "360000000000000",
  exactSimulationPassed: true
};

export const DIRECT_SMOKE_SWAP_PLAN = withHash({
  ...DIRECT_SMOKE_APPROVAL_PLAN,
  planId: "55555555-5555-4555-8555-555555555555",
  kind: "swap",
  target: ROBINHOOD_SWAP_ROUTER_02,
  data: DIRECT_SMOKE_SWAP_DATA,
  gasLimit: "120000",
  directAuthorization: directExecutionBinding({
    provider: "uniswap-v3",
    kind: "swap",
    chainId: 4_663,
    inputAsset: DIRECT_SMOKE_INPUT,
    outputAsset: DIRECT_SMOKE_OUTPUT,
    inputAmountAtomic: "1000000",
    protectedOutputAtomic: "990",
    recipient: DIRECT_SMOKE_RECIPIENT,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    executionTarget: ROBINHOOD_SWAP_ROUTER_02,
    approvalSpender: ROBINHOOD_SWAP_ROUTER_02,
    approvalAmountAtomic: "1000000",
    data: DIRECT_SMOKE_SWAP_DATA,
    valueAtomic: "0",
    deadline: DIRECT_SMOKE_APPROVAL_EVIDENCE.deadline
  })
});
