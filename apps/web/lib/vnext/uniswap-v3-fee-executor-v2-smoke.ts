import assert from "node:assert/strict";
import { getAddress, keccak256, zeroAddress, type Hex } from "viem";
import {
  prepareVNextProviderAuthorization,
  type VNextQuoteProviderAdapter
} from "../server/vnext-provider-adapter";
import {
  configuredVNextUniswapFeeExecutorV2,
  RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID
} from "../server/vnext-uniswap-fee-executor-v2";
import { vNextUniswapV3Adapter } from "../server/vnext-uniswap-v3-adapter";
import {
  requiresExactV2TraderApproval,
  vNextUniswapV3V2Capability
} from "../server/vnext-uniswap-v3-v2-execution";
import {
  assertCanonicalWethImplementationSlot,
  ROBINHOOD_WETH_IMPLEMENTATION
} from "../server/vnext-uniswap-fee-executor";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";
import {
  createRmtExecutionFeeV2Policy,
  normalizeRmtExecutionFeeV2Input
} from "./execution-fee-policy-v2";
import {
  bindVNextAtomicFeeAuthorization,
  VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY,
  type VNextAtomicFeeSettlementProof
} from "./provider-fee-settlement";
import { assertVNextQuoteAttempt } from "./quote-observation";
import {
  assertRmtUniswapV3FeeCalldataV2,
  createRmtUniswapV3FeeExecutionV2,
  encodeRmtUniswapV3FeeExecutionV2,
  type RmtUniswapV3FeeRouteV2
} from "./uniswap-v3-fee-executor-v2";

const inputAsset = getAddress("0x1111111111111111111111111111111111111111");
const outputAsset = getAddress("0x2222222222222222222222222222222222222222");
const trader = getAddress("0x3333333333333333333333333333333333333333");
const executor = getAddress("0x4444444444444444444444444444444444444444");
const treasury = getAddress("0x5555555555555555555555555555555555555555"); // deterministic test fixture only
const pool = getAddress("0x6666666666666666666666666666666666666666");
const executionId = `0x${"7".repeat(64)}` as Hex;
const executorRuntimeHash = `0x${"8".repeat(64)}` as Hex;

const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "100" });
const economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: `eip155:4663/contract:${inputAsset.toLowerCase()}`,
  outputAssetId: `eip155:4663/contract:${outputAsset.toLowerCase()}`,
  userGrossInputAtomic: "40000",
  providerGrossExpectedOutputAtomic: "1000",
  providerProtectedOutputAtomic: "990",
  settlementMode: "v2-atomic-input-fee"
});
const route: RmtUniswapV3FeeRouteV2 = {
  kind: 0,
  tokenIn: inputAsset,
  tokenOut: outputAsset,
  fee0: 500,
  fee1: 0,
  pool0: pool,
  pool1: zeroAddress
};
const deadline = BigInt(Math.floor(Date.now() / 1_000) + 240);
const execution = createRmtUniswapV3FeeExecutionV2({
  executor,
  executorRuntimeHash,
  executionId,
  economics,
  trader,
  inputAsset,
  outputAsset,
  deadline: deadline.toString(),
  route
});
const calldata = encodeRmtUniswapV3FeeExecutionV2(execution);
assertRmtUniswapV3FeeCalldataV2(calldata, execution, economics);
assert.equal(execution.userGrossInputAtomic, "40000");
assert.equal(execution.expectedFeeAtomic, "100");
assert.equal(execution.providerInputAtomic, "39900");
assert.equal(execution.executor, executor);
assert.equal(execution.feeAsset, inputAsset);
const quoteNow = Date.now();
assertVNextQuoteAttempt({
  provider: "uniswap-v3",
  providerLabel: "Uniswap v3",
  providerFamily: "uniswap",
  adapterVersion: 1,
  status: "indicative",
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "40000",
  expectedOutputAtomic: "1000",
  protectedOutputAtomic: "990",
  outputDecimals: 18,
  priceImpact: null,
  liquidityFeeEvidence: [],
  quotedAtMs: quoteNow,
  expiresAtMs: quoteNow + 30_000,
  latencyMs: 1,
  executionKind: "direct_amm",
  strictVerificationAvailable: true,
  userPaysGas: true,
  providerFeeAsset: null,
  providerFeeAtomic: null,
  gasSponsorshipFeeAsset: null,
  gasSponsorshipFeeAtomic: null,
  explicitProviderFeeOutputAtomic: null,
  netEconomics: null,
  feeV2Economics: economics,
  networkFeeNativeAtomic: null,
  networkFeeNativeSymbol: "ETH",
  protectedNetOutputAtomic: null,
  costState: "network_fee_pending",
  authorizationReady: false,
  detail: "Test-only V2 quote uses the exact provider input after the universal input fee."
}, { inputAsset, outputAsset, inputAmountAtomic: "40000" }, quoteNow);

const nativeEconomics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: "eip155:4663/native",
  outputAssetId: `eip155:4663/contract:${outputAsset.toLowerCase()}`,
  userGrossInputAtomic: "399",
  providerGrossExpectedOutputAtomic: "500",
  providerProtectedOutputAtomic: "490",
  settlementMode: "v2-atomic-input-fee"
});
const nativeExecution = createRmtUniswapV3FeeExecutionV2({
  executor,
  executorRuntimeHash,
  executionId: `0x${"9".repeat(64)}`,
  economics: nativeEconomics,
  trader,
  inputAsset: zeroAddress,
  outputAsset,
  deadline: deadline.toString(),
  route: { ...route, tokenIn: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73") }
});
assert.equal(nativeExecution.feeAsset, zeroAddress);
assert.equal(nativeExecution.expectedFeeAtomic, "0");
assert.equal(nativeExecution.providerInputAtomic, "399");

assert.throws(() => assertRmtUniswapV3FeeCalldataV2(
  calldata,
  { ...execution, expectedFeeAtomic: "99" },
  economics
), /fee changed/);
assert.throws(() => assertRmtUniswapV3FeeCalldataV2(
  calldata,
  { ...execution, providerInputAtomic: "39899" },
  economics
), /provider input changed/);
assert.throws(() => assertRmtUniswapV3FeeCalldataV2(
  calldata,
  { ...execution, trader: treasury },
  economics
), /calldata changed/);

const proof: VNextAtomicFeeSettlementProof = {
  verificationState: "verified_atomic",
  provider: "uniswap-v3",
  settlementMode: "v2-atomic-input-fee",
  implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
  executionTarget: executor,
  providerTarget: ROBINHOOD_SWAP_ROUTER_02,
  calldataHash: keccak256(calldata),
  executionId,
  recipient: trader,
  deadline: deadline.toString(),
  atomicFeeSettlement: true,
  revertsAtomically: true
};
const feeV2Authorization = bindVNextAtomicFeeAuthorization({ economics, proof });
const capability = vNextUniswapV3V2Capability();
const adapter: VNextQuoteProviderAdapter = {
  provider: "uniswap-v3",
  providerLabel: "Uniswap v3",
  providerFamily: "uniswap",
  adapterVersion: 1,
  executionKind: "direct_amm",
  capabilities: { strictVerification: true, walletAuthorization: true },
  async quote() { throw new Error("not used"); },
  async verify(request) {
    return {
      provider: "uniswap-v3",
      status: "verified",
      chainId: 4_663,
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      inputAmountAtomic: request.inputAmountAtomic,
      indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic.toString(),
      protectedOutputAtomic: economics.protectedUserNetOutputAtomic,
      recipient: request.recipient,
      router: ROBINHOOD_SWAP_ROUTER_02,
      approvalSpender: executor,
      deadline: deadline.toString(),
      calldataHash: keccak256(calldata),
      nextAction: "swap",
      nextActionTarget: executor,
      nextActionCalldataHash: keccak256(calldata),
      transactionValueAtomic: "0",
      gasLimitUnits: "120000",
      estimatedNetworkCostUsdgAtomic: null,
      networkCostValuationSource: null,
      networkCostValuedAtMs: null,
      networkCostValuationExpiresAtMs: null,
      feeV2Economics: economics,
      feeV2Settlement: proof,
      settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE
    };
  },
  async prepareAuthorization(request) {
    return {
      evidence: await this.verify!(request),
      feeV2Authorization,
      transaction: { kind: "swap", target: executor, data: calldata, value: "0", gasLimit: "120000" }
    };
  }
};
async function run() {
const prepared = await prepareVNextProviderAuthorization("uniswap-v3", {
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "40000",
  amountIn: 40_000n,
  recipient: trader,
  indicativeProtectedOutputFloorAtomic: 980n,
  protectedOutputFloorAtomic: 990n,
  deadlineSeconds: deadline,
  nowMs: Date.now(),
  executionId,
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE
}, [adapter], { policy, capability });
assert.equal(prepared.transaction.target, executor);
assert.notEqual(prepared.transaction.target, ROBINHOOD_SWAP_ROUTER_02);
assert.equal(prepared.evidence.approvalSpender, executor);
assert.equal(prepared.evidence.feeV2Economics?.expectedFeeAtomic, "100");

await assert.rejects(() => vNextUniswapV3Adapter.prepareAuthorization!({
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "40000",
  amountIn: 40_000n,
  recipient: trader,
  indicativeProtectedOutputFloorAtomic: 980n,
  protectedOutputFloorAtomic: 990n,
  deadlineSeconds: deadline,
  nowMs: Date.now(),
  executionId
}), /wallet authorization is not available yet/);

assert.equal(requiresExactV2TraderApproval({ nativeInput: false, allowance: 40_000n, userGrossInput: 40_000n }), false);
assert.equal(requiresExactV2TraderApproval({ nativeInput: false, allowance: 39_999n, userGrossInput: 40_000n }), true);
assert.equal(requiresExactV2TraderApproval({ nativeInput: false, allowance: 40_001n, userGrossInput: 40_000n }), true);
assert.equal(requiresExactV2TraderApproval({ nativeInput: false, allowance: (1n << 256n) - 1n, userGrossInput: 40_000n }), true);
assert.equal(requiresExactV2TraderApproval({ nativeInput: true, allowance: (1n << 256n) - 1n, userGrossInput: 40_000n }), false);

const canonicalWethSlot = `0x${"0".repeat(24)}${ROBINHOOD_WETH_IMPLEMENTATION.slice(2).toLowerCase()}` as Hex;
assert.equal(assertCanonicalWethImplementationSlot(canonicalWethSlot), ROBINHOOD_WETH_IMPLEMENTATION);
assert.throws(
  () => assertCanonicalWethImplementationSlot(`0x${"0".repeat(24)}${treasury.slice(2).toLowerCase()}` as Hex),
  /canonical WETH implementation address changed/
);

assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v3"].state, "QUOTE_ONLY");
assert.equal(vNextUniswapV3Adapter.capabilities.walletAuthorization, false);
assert.equal(configuredVNextUniswapFeeExecutorV2({ NODE_ENV: "test" }), null);
assert.throws(() => configuredVNextUniswapFeeExecutorV2({
  NODE_ENV: "test",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED: "true"
}), /active RMT_EXECUTION_V2 policy/);
assert.throws(() => configuredVNextUniswapFeeExecutorV2({
  NODE_ENV: "test",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED: "TRUE"
}), /exact lowercase true or false/);

console.log("RMT Uniswap V3 universal atomic fee executor V2 smoke checks passed.");
}

void run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
