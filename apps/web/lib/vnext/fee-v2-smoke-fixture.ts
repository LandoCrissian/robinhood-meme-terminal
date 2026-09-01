import { encodeFunctionData, erc20Abi, getAddress, keccak256, type Hex } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import {
  createRmtExecutionFeeV2Policy,
  normalizeRmtExecutionFeeV2Input
} from "./execution-fee-policy-v2";
import {
  bindVNextAtomicFeeAuthorization,
  type VNextAtomicFeeSettlementProof
} from "./provider-fee-settlement";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";

export const FEE_V2_SMOKE_NOW_MS = 1_786_000_000_000;
export const FEE_V2_SMOKE_INPUT = getAddress("0x1111111111111111111111111111111111111111");
export const FEE_V2_SMOKE_OUTPUT = getAddress("0x2222222222222222222222222222222222222222");
export const FEE_V2_SMOKE_RECIPIENT = getAddress("0x3333333333333333333333333333333333333333");
export const FEE_V2_SMOKE_EXECUTOR = getAddress("0x5555555555555555555555555555555555555555");
export const FEE_V2_SMOKE_TREASURY = getAddress("0x7777777777777777777777777777777777777777");
export const FEE_V2_SMOKE_SWAP_DATA = "0x12345678" as Hex;
export const FEE_V2_SMOKE_APPROVAL_DATA = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [FEE_V2_SMOKE_EXECUTOR, 1_000_000n]
});
export const FEE_V2_SMOKE_COMMITMENT = "v1.eyJ0ZXN0IjoidjIifQ.c2lnbmF0dXJl";

const policy = createRmtExecutionFeeV2Policy({
  treasury: FEE_V2_SMOKE_TREASURY,
  fromBlock: "40000000"
});
const economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: `eip155:4663/contract:${FEE_V2_SMOKE_INPUT.toLowerCase()}`,
  outputAssetId: `eip155:4663/contract:${FEE_V2_SMOKE_OUTPUT.toLowerCase()}`,
  userGrossInputAtomic: "1000000",
  providerGrossExpectedOutputAtomic: "1000",
  providerProtectedOutputAtomic: "990",
  settlementMode: "v2-atomic-input-fee"
});
const proof: VNextAtomicFeeSettlementProof = {
  verificationState: "verified_atomic",
  provider: "uniswap-v3",
  settlementMode: "v2-atomic-input-fee",
  implementationId: "test-universal-fee-executor-v2",
  executionTarget: FEE_V2_SMOKE_EXECUTOR,
  providerTarget: ROBINHOOD_SWAP_ROUTER_02,
  calldataHash: keccak256(FEE_V2_SMOKE_SWAP_DATA),
  executionId: `0x${"6".repeat(64)}`,
  recipient: FEE_V2_SMOKE_RECIPIENT,
  deadline: "1786000300",
  atomicFeeSettlement: true,
  revertsAtomically: true
};
const authorization = bindVNextAtomicFeeAuthorization({ economics, proof });

export const FEE_V2_SMOKE_APPROVAL_EVIDENCE: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3",
  status: "approval_required",
  chainId: 4_663,
  inputAsset: FEE_V2_SMOKE_INPUT,
  outputAsset: FEE_V2_SMOKE_OUTPUT,
  inputAmountAtomic: "1000000",
  indicativeProtectedOutputFloorAtomic: "980",
  expectedOutputAtomic: "1000",
  protectedOutputAtomic: "990",
  recipient: FEE_V2_SMOKE_RECIPIENT,
  router: ROBINHOOD_SWAP_ROUTER_02,
  approvalSpender: FEE_V2_SMOKE_EXECUTOR,
  approvalRequired: true,
  sufficientBalance: true,
  allowanceAtomic: "0",
  balanceAtomic: "2000000",
  route: "direct",
  fees: [3_000],
  pools: ["0x4444444444444444444444444444444444444444"],
  deadline: proof.deadline,
  calldataHash: proof.calldataHash,
  nextAction: "approval",
  nextActionTarget: FEE_V2_SMOKE_INPUT,
  nextActionCalldataHash: keccak256(FEE_V2_SMOKE_APPROVAL_DATA),
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
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  netEconomics: undefined,
  feeExecution: null,
  feeV2Economics: economics,
  feeV2Settlement: proof,
  v2VerificationCommitment: FEE_V2_SMOKE_COMMITMENT,
  verifiedAtMs: FEE_V2_SMOKE_NOW_MS - 1_000,
  expiresAtMs: FEE_V2_SMOKE_NOW_MS + 300_000,
  authorizationReady: false
};

function planWithHash(plan: Omit<VNextAuthorizationPlan, "payloadHash">): VNextAuthorizationPlan {
  return { ...plan, payloadHash: authorizationPayloadHash(plan) };
}

export const FEE_V2_SMOKE_APPROVAL_PLAN = planWithHash({
  planId: "33333333-3333-4333-8333-333333333333",
  sourceQuoteRequestId: FEE_V2_SMOKE_APPROVAL_EVIDENCE.sourceQuoteRequestId,
  sourceVerificationId: FEE_V2_SMOKE_APPROVAL_EVIDENCE.verificationId,
  provider: "uniswap-v3",
  kind: "erc20_approval",
  chainId: 4_663,
  target: FEE_V2_SMOKE_INPUT,
  data: FEE_V2_SMOKE_APPROVAL_DATA,
  value: "0",
  gasLimit: "60000",
  inputAsset: FEE_V2_SMOKE_INPUT,
  outputAsset: FEE_V2_SMOKE_OUTPUT,
  inputAmountAtomic: "1000000",
  protectedOutputAtomic: "990",
  recipient: FEE_V2_SMOKE_RECIPIENT,
  router: ROBINHOOD_SWAP_ROUTER_02,
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  feeV2Economics: economics,
  feeV2Authorization: authorization,
  deadline: proof.deadline,
  preparedAtMs: FEE_V2_SMOKE_NOW_MS,
  expiresAtMs: FEE_V2_SMOKE_NOW_MS + 60_000,
  userAuthorizationRequired: true,
  serverSubmissionEnabled: false
});

export const FEE_V2_SMOKE_SWAP_EVIDENCE: VNextPreSignEvidence = {
  ...FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  status: "verified",
  approvalRequired: false,
  allowanceAtomic: "1000000",
  nextAction: "swap",
  nextActionTarget: FEE_V2_SMOKE_EXECUTOR,
  nextActionCalldataHash: proof.calldataHash,
  estimatedGasUnits: "100000",
  gasLimitUnits: "120000",
  estimatedNetworkCostWei: "360000000000000",
  exactSimulationPassed: true
};

export const FEE_V2_SMOKE_SWAP_PLAN = planWithHash({
  ...FEE_V2_SMOKE_APPROVAL_PLAN,
  planId: "55555555-5555-4555-8555-555555555555",
  kind: "swap",
  target: FEE_V2_SMOKE_EXECUTOR,
  data: FEE_V2_SMOKE_SWAP_DATA,
  gasLimit: "120000"
});
