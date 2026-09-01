import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAddress, getCreate2Address, keccak256, zeroAddress, type Hex } from "viem";
import {
  prepareVNextProviderAuthorization,
  type VNextQuoteProviderAdapter
} from "../server/vnext-provider-adapter";
import {
  assertVNextUniswapV3V2PolicyBlock,
  configuredVNextUniswapFeeExecutorV2,
  isVNextUniswapV3V2AuthorizationEnabled,
  RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID
} from "../server/vnext-uniswap-fee-executor-v2";
import { createVNextUniswapV3Adapter, vNextUniswapV3Adapter } from "../server/vnext-uniswap-v3-adapter";
import {
  quoteVNextUniswapForUserV2,
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
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  executionTarget: executor,
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
const manifest = JSON.parse(await readFile(new URL(
  "../../../../packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v2.template.json",
  import.meta.url
), "utf8")) as {
  status: string;
  authorizationStatus: string;
  ownerDeploymentAuthorizationRequired: boolean;
  deploymentAuthorized: boolean;
  activationAuthorized: boolean;
  chainId: number;
  sourceHead: string;
  chainSnapshot: {
    blockNumber: number;
    blockHash: Hex;
    timestampUnix: number;
    cadenceSampleStartBlock: number;
    cadenceSampleBlocks: number;
    observedSecondsPerBlock: number;
    effectiveBlockLead: number;
    estimatedLeadSeconds: number;
  };
  policy: { policyHash: Hex; effectiveFromBlock: number; effectiveBeforeBlock: number };
  dependencies: { deterministicFactory: `0x${string}` };
  deterministicDeployment: {
    salt: Hex;
    creationCodeHash: Hex;
    encodedConstructorArguments: Hex;
    constructorArgsHash: Hex;
    initCodeHash: Hex;
    predictedExecutor: `0x${string}`;
    predictedExecutorHasCode: boolean;
    expectedRuntimeHash: Hex;
  };
  deploymentEvidence: {
    verificationBase: string;
    deploymentTransactionHash: Hex;
    receiptStatus: string;
    deploymentBlock: number;
    deploymentBlockHash: Hex;
    deploymentTimestampUnix: number;
    transactionIndex: number;
    deployerNonce: number;
    gasLimit: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    costWei: string;
    factory: `0x${string}`;
    transactionValueWei: string;
    deploymentCalldataHash: Hex;
    deployedExecutor: `0x${string}`;
    deployedRuntimeHash: Hex;
    deployedRuntimeBytes: number;
    receiptLogCount: number;
    exactDeploymentCalldataMatches: boolean;
    create2AddressMatches: boolean;
    runtimeMatches: boolean;
    immutablesMatch: boolean;
    dependenciesMatch: boolean;
    matchingSuccessfulDeploymentTransactions: number;
    duplicateSuccessfulDeploymentTransactions: number;
    deployerNonceAfter: number;
    v1ExecutorUnchanged: boolean;
  };
  deploymentTransaction: { data: Hex; dataHash: Hex; dataBytes: number; valueWei: string; to: `0x${string}` };
  applicationWiring: { quote: string; authorize: string; providerRegistry: string };
};
const deploymentData = manifest.deploymentTransaction.data;
const initCode = `0x${deploymentData.slice(66)}` as Hex;
const constructorArguments = manifest.deterministicDeployment.encodedConstructorArguments;
assert.ok(initCode.endsWith(constructorArguments.slice(2)));
const creationCode = `0x${initCode.slice(2, -constructorArguments.slice(2).length)}` as Hex;
assert.equal(manifest.status, "DEPLOYED");
assert.equal(manifest.authorizationStatus, "DEPLOYED_NOT_ACTIVATED");
assert.equal(manifest.ownerDeploymentAuthorizationRequired, false);
assert.equal(manifest.deploymentAuthorized, true);
assert.equal(manifest.activationAuthorized, false);
assert.equal(manifest.chainId, 4_663);
assert.equal(manifest.sourceHead, "9cd69b20cad70f5302ea4b900174b3610250eeb7");
assert.equal(manifest.chainSnapshot.blockNumber, 51_071_658);
assert.equal(manifest.chainSnapshot.blockHash, "0x76c535778fd4f0f3a2c447e41114bd636d9aff6b658a1cc2be205596d87ecd1e");
assert.equal(manifest.chainSnapshot.timestampUnix, 1_788_200_267);
assert.equal(manifest.chainSnapshot.cadenceSampleStartBlock, 50_971_658);
assert.equal(manifest.chainSnapshot.cadenceSampleBlocks, 100_000);
assert.equal(manifest.chainSnapshot.observedSecondsPerBlock, 0.10134);
assert.equal(manifest.chainSnapshot.effectiveBlockLead, 225_000);
assert.equal(manifest.chainSnapshot.estimatedLeadSeconds, 22_801.5);
assert.equal(manifest.policy.effectiveFromBlock, 51_296_658);
assert.equal(
  manifest.policy.effectiveFromBlock - manifest.chainSnapshot.blockNumber,
  manifest.chainSnapshot.effectiveBlockLead
);
assert.ok(manifest.chainSnapshot.effectiveBlockLead >= 100_000);
assert.ok(manifest.chainSnapshot.effectiveBlockLead <= 250_000);
assert.equal(manifest.policy.effectiveBeforeBlock, 0);
assert.equal(keccak256(creationCode), manifest.deterministicDeployment.creationCodeHash);
assert.equal(keccak256(constructorArguments), manifest.deterministicDeployment.constructorArgsHash);
assert.equal(keccak256(initCode), manifest.deterministicDeployment.initCodeHash);
assert.equal(keccak256(deploymentData), manifest.deploymentTransaction.dataHash);
assert.equal((deploymentData.length - 2) / 2, manifest.deploymentTransaction.dataBytes);
assert.equal(manifest.deploymentTransaction.valueWei, "0");
assert.equal(getAddress(manifest.deploymentTransaction.to), getAddress(manifest.dependencies.deterministicFactory));
assert.equal(getCreate2Address({
  from: manifest.dependencies.deterministicFactory,
  salt: manifest.deterministicDeployment.salt,
  bytecodeHash: manifest.deterministicDeployment.initCodeHash
}), getAddress(manifest.deterministicDeployment.predictedExecutor));
assert.equal(manifest.deterministicDeployment.predictedExecutorHasCode, true);
assert.equal(manifest.deterministicDeployment.expectedRuntimeHash, "0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d");
assert.equal(manifest.deploymentEvidence.verificationBase, "5631dc5d7b70a22e593e6845650401f52e09ce7c");
assert.equal(manifest.deploymentEvidence.deploymentTransactionHash, "0xc25e1d4265c47fa08fd81c5296fab1ec1e73e732a7fd989b3313f45c8764356d");
assert.equal(manifest.deploymentEvidence.receiptStatus, "success");
assert.equal(manifest.deploymentEvidence.deploymentBlock, 51_119_538);
assert.equal(manifest.deploymentEvidence.deploymentBlockHash, "0xed8d05d267fc7315636e34200d672ed22678c7aa9d6c03413091e6f6d35465ed");
assert.equal(manifest.deploymentEvidence.deploymentTimestampUnix, 1_788_205_107);
assert.equal(manifest.deploymentEvidence.transactionIndex, 3);
assert.equal(manifest.deploymentEvidence.deployerNonce, 202);
assert.equal(manifest.deploymentEvidence.gasLimit, "3038363");
assert.equal(manifest.deploymentEvidence.gasUsed, "2490107");
assert.equal(manifest.deploymentEvidence.effectiveGasPriceWei, "328550000");
assert.equal(
  BigInt(manifest.deploymentEvidence.costWei),
  BigInt(manifest.deploymentEvidence.gasUsed) * BigInt(manifest.deploymentEvidence.effectiveGasPriceWei)
);
assert.equal(getAddress(manifest.deploymentEvidence.factory), getAddress(manifest.dependencies.deterministicFactory));
assert.equal(manifest.deploymentEvidence.transactionValueWei, "0");
assert.equal(manifest.deploymentEvidence.deploymentCalldataHash, manifest.deploymentTransaction.dataHash);
assert.equal(getAddress(manifest.deploymentEvidence.deployedExecutor), getAddress(manifest.deterministicDeployment.predictedExecutor));
assert.equal(manifest.deploymentEvidence.deployedRuntimeHash, manifest.deterministicDeployment.expectedRuntimeHash);
assert.equal(manifest.deploymentEvidence.deployedRuntimeBytes, 10_968);
assert.equal(manifest.deploymentEvidence.receiptLogCount, 0);
assert.equal(manifest.deploymentEvidence.exactDeploymentCalldataMatches, true);
assert.equal(manifest.deploymentEvidence.create2AddressMatches, true);
assert.equal(manifest.deploymentEvidence.runtimeMatches, true);
assert.equal(manifest.deploymentEvidence.immutablesMatch, true);
assert.equal(manifest.deploymentEvidence.dependenciesMatch, true);
assert.equal(manifest.deploymentEvidence.matchingSuccessfulDeploymentTransactions, 1);
assert.equal(manifest.deploymentEvidence.duplicateSuccessfulDeploymentTransactions, 0);
assert.equal(manifest.deploymentEvidence.deployerNonceAfter, 203);
assert.equal(manifest.deploymentEvidence.v1ExecutorUnchanged, true);
assert.equal(manifest.applicationWiring.quote, "READY");
assert.equal(manifest.applicationWiring.authorize, "READY");
assert.equal(manifest.applicationWiring.providerRegistry, "V2_ATOMIC_INPUT_FEE_SOURCE_ADMITTED");

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

assert.equal(vNextUniswapV3Adapter.capabilities.walletAuthorization, true);

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

assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v3"].state, "V2_ATOMIC_INPUT_FEE");
assert.equal(vNextUniswapV3Adapter.capabilities.walletAuthorization, true);
assert.equal(configuredVNextUniswapFeeExecutorV2({ NODE_ENV: "test" }), null);
assert.throws(() => configuredVNextUniswapFeeExecutorV2({
  NODE_ENV: "test",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED: "true"
}), /active RMT_EXECUTION_V2 policy/);
assert.throws(() => configuredVNextUniswapFeeExecutorV2({
  NODE_ENV: "test",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED: "TRUE"
}), /exact lowercase true or false/);
assert.equal(isVNextUniswapV3V2AuthorizationEnabled({ NODE_ENV: "test" }), false);
assert.equal(isVNextUniswapV3V2AuthorizationEnabled({
  NODE_ENV: "test", RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED: "true"
}), true);
assert.throws(() => isVNextUniswapV3V2AuthorizationEnabled({
  NODE_ENV: "test", RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED: "TRUE"
}), /exact lowercase true or false/);
assert.throws(() => assertVNextUniswapV3V2PolicyBlock({
  currentBlock: 99n, fromBlock: 100n, beforeBlock: 0n
}), /not effective until block 100/);
assert.equal(assertVNextUniswapV3V2PolicyBlock({
  currentBlock: 99n, fromBlock: 100n, beforeBlock: 0n, requireEffective: false
}), false, "pre-boundary observation remains truthful while authorization is denied");
assert.equal(assertVNextUniswapV3V2PolicyBlock({
  currentBlock: 100n, fromBlock: 100n, beforeBlock: 0n
}), true);

const savedV2Gate = process.env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED;
const savedV2ProofWallet = process.env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET;
process.env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED = "true";
process.env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET = trader;
try {
  const verifiedConfig = { executor, executorRuntimeHash, policy, verifiedAtBlock: "101" };
  const quoteProvider = async ({ inputAsset: routedInput, outputAsset: routedOutput, amountIn }: {
    inputAsset: typeof inputAsset; outputAsset: typeof outputAsset; amountIn: bigint;
  }) => ({
    route: "direct" as const,
    fees: [500], pools: [pool], quoteOut: 1_000n, gasEstimate: 100_000n,
    inputAsset: routedInput, outputAsset: routedOutput, amountIn, minimumOut: 990n
  });
  const quoteAdapter = createVNextUniswapV3Adapter({
    walletAuthorization: true,
    v2Config: verifiedConfig,
    v2QuoteProvider: quoteProvider
  });
  const attempt = await quoteAdapter.quote({
    chainId: 4_663, inputAsset, outputAsset, amountIn: 40_000n, inputAmountAtomic: "40000",
    recipient: trader,
    inputIdentity: { address: inputAsset, symbol: "IN", decimals: 18 },
    outputIdentity: { address: outputAsset, symbol: "OUT", decimals: 18 }
  });
  assert.equal(attempt.status, "indicative");
  assert.equal(attempt.settlementMode, VNEXT_V2_ATOMIC_INPUT_FEE);
  assert.equal(attempt.feeV2Economics?.expectedFeeAtomic, "100");
  assert.equal(attempt.feeV2Economics?.providerInputAtomic, "39900");
  assert.equal(attempt.executionTarget, executor);
  assert.equal(attempt.netEconomics, null);

  const nativeBuy = await quoteVNextUniswapForUserV2({
    inputAsset: zeroAddress, outputAsset, userGrossInput: 100_000n,
    config: verifiedConfig, quoteProvider
  });
  assert.equal(nativeBuy?.economics.expectedFeeAtomic, "250");
  assert.equal(nativeBuy?.economics.providerInputAtomic, "99750");
  assert.equal(nativeBuy?.economics.feeAsset, "eip155:4663/native");

  const tokenSell = await quoteVNextUniswapForUserV2({
    inputAsset, outputAsset: zeroAddress, userGrossInput: 100_000n,
    config: verifiedConfig, quoteProvider
  });
  assert.equal(tokenSell?.economics.expectedFeeAtomic, "250");
  assert.equal(tokenSell?.economics.providerInputAtomic, "99750");
  assert.equal(tokenSell?.economics.feeAsset, `eip155:4663/contract:${inputAsset.toLowerCase()}`);
  assert.equal(tokenSell?.economics.outputAsset, "eip155:4663/native");

  const wethHop = await quoteVNextUniswapForUserV2({
    inputAsset, outputAsset, userGrossInput: 100_000n, config: verifiedConfig,
    quoteProvider: async ({ inputAsset: routedInput, outputAsset: routedOutput, amountIn }) => ({
      route: "weth_hop" as const, fees: [500, 3_000], pools: [pool, executor],
      quoteOut: 900n, gasEstimate: 140_000n, inputAsset: routedInput,
      outputAsset: routedOutput, amountIn, minimumOut: 891n
    })
  });
  assert.equal(wethHop?.quote.route, "weth_hop");
  assert.deepEqual(wethHop?.quote.fees, [500, 3_000]);
  assert.equal(wethHop?.economics.providerInputAtomic, "99750");
} finally {
  if (savedV2Gate === undefined) delete process.env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED;
  else process.env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED = savedV2Gate;
  if (savedV2ProofWallet === undefined) delete process.env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET;
  else process.env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET = savedV2ProofWallet;
}

console.log("RMT Uniswap V3 universal atomic fee executor V2 smoke checks passed.");
}

void run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
