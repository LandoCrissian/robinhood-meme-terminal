import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { normalizeDisabledRmtFee } from "../vnext/execution-fee-policy";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";
import { normalizeRmtExecutionFeeV2Input, type RmtExecutionFeeV2Policy } from "../vnext/execution-fee-policy-v2";
import { bindVNextAtomicFeeAuthorization, type VNextAtomicFeeSettlementProof } from "../vnext/provider-fee-settlement";
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import {
  RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
  createRmtUniswapV2FeeExecutionV2,
  encodeRmtUniswapV2FeeExecutionV2,
  type RmtUniswapV2FeeRouteV2
} from "../vnext/uniswap-v2-fee-executor-v2";
import {
  ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_ROUTER,
  ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH
} from "../vnext/uniswap-v2-authorization-codec";
import {
  configuredVNextUniswapV2FeeExecutorV2,
  isVNextUniswapV2V2ReleaseRecipientEligible,
  verifyConfiguredVNextUniswapV2FeeExecutorV2,
  type VNextUniswapV2FeeExecutorV2Config
} from "./vnext-uniswap-v2-fee-executor-v2";
import { quoteVNextUniswapV2 } from "./vnext-uniswap-v2-execution";

const MAX_UINT256 = (1n << 256n) - 1n;
const DEFAULT_AUTHORIZATION_WINDOW_SECONDS = 240n;
const MAX_AUTHORIZATION_WINDOW_SECONDS = 300n;
const WALLET_FEE_CEILING_MULTIPLIER = 3n;

export type VerifiedVNextUniswapV2FeeExecutorV2Config = VNextUniswapV2FeeExecutorV2Config & {
  verifiedAtBlock: string;
  verifiedAtBlockHash: Hex;
};

export type VNextUniswapV2V2ExecutionClient = {
  readContract(input: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly Address[] }): Promise<bigint>;
  getBalance(input: { address: Address }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  call(input: { account: Address; to: Address; data: Hex; value: bigint }): Promise<unknown>;
  estimateGas(input: { account: Address; to: Address; data: Hex; value: bigint }): Promise<bigint>;
};

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_VNEXT_UNISWAP_V2_RPC_URL
      ?? process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } }
  )
});

function assetId(address: Address) {
  return isRobinhoodNativeAsset(address)
    ? "eip155:4663/native"
    : `eip155:4663/contract:${getAddress(address).toLowerCase()}`;
}

async function resolveConfig(
  configured: VerifiedVNextUniswapV2FeeExecutorV2Config | null | undefined,
  expectedInfrastructure?: { verifiedAtBlock: string; verifiedAtBlockHash: Hex }
) {
  if (configured !== undefined) {
    if (configured && expectedInfrastructure && (
      configured.verifiedAtBlock !== expectedInfrastructure.verifiedAtBlock
      || configured.verifiedAtBlockHash.toLowerCase() !== expectedInfrastructure.verifiedAtBlockHash.toLowerCase()
    )) throw new Error("The committed Uniswap V2 infrastructure authority changed.");
    return configured;
  }
  const config = configuredVNextUniswapV2FeeExecutorV2();
  return config ? verifyConfiguredVNextUniswapV2FeeExecutorV2(config, undefined, expectedInfrastructure ? {
    blockNumber: BigInt(expectedInfrastructure.verifiedAtBlock),
    blockHash: expectedInfrastructure.verifiedAtBlockHash
  } : undefined).then((verified) => ({
    ...config,
    verifiedAtBlock: verified.verifiedAtBlock,
    verifiedAtBlockHash: verified.verifiedAtBlockHash
  })) : null;
}

export function selectVNextUniswapV2SettlementMode(input: {
  recipient: Address;
  v2Configured?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (!isVNextUniswapV2V2ReleaseRecipientEligible(input.recipient, env)) return VNEXT_DIRECT_NO_RMT_FEE;
  if (input.v2Configured !== true && !configuredVNextUniswapV2FeeExecutorV2(env)) {
    throw new Error("RMT Uniswap V2 V2 authorization is enabled without a complete executor policy.");
  }
  return VNEXT_V2_ATOMIC_INPUT_FEE;
}

export async function quoteVNextUniswapV2ForUserV2(input: {
  inputAsset: Address;
  outputAsset: Address;
  userGrossInput: bigint;
  config?: VerifiedVNextUniswapV2FeeExecutorV2Config | null;
  quoteProvider?: typeof quoteVNextUniswapV2;
}) {
  const config = await resolveConfig(input.config);
  if (!config) return null;
  if (input.userGrossInput <= 0n) throw new Error("RMT Uniswap V2 V2 gross input must be positive.");
  const fee = input.userGrossInput * 25n / 10_000n;
  const providerInput = input.userGrossInput - fee;
  if (providerInput <= 0n) throw new Error("RMT V2 fee leaves no Uniswap V2 provider input.");
  const quote = await (input.quoteProvider ?? quoteVNextUniswapV2)({
    inputAsset: getAddress(input.inputAsset),
    outputAsset: getAddress(input.outputAsset),
    amountIn: providerInput,
    recipient: zeroAddress
  });
  const economics = normalizeRmtExecutionFeeV2Input({
    policy: config.policy,
    inputAssetId: assetId(getAddress(input.inputAsset)),
    outputAssetId: assetId(getAddress(input.outputAsset)),
    userGrossInputAtomic: input.userGrossInput.toString(),
    providerGrossExpectedOutputAtomic: quote.expectedOutputAtomic,
    providerProtectedOutputAtomic: quote.protectedOutputAtomic,
    settlementMode: "v2-atomic-input-fee"
  });
  return { config, quote, economics, providerInput };
}

export async function evaluateVNextUniswapV2RouteV2(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  executionId: Hex;
  indicativeProtectedOutputFloorAtomic: bigint;
  protectedOutputFloorAtomic?: bigint;
  deadlineSeconds?: bigint;
  nowMs?: number;
  infrastructureVerifiedAtBlock?: string;
  infrastructureVerifiedAtBlockHash?: Hex;
  config?: VerifiedVNextUniswapV2FeeExecutorV2Config | null;
  quoteProvider?: typeof quoteVNextUniswapV2;
  executionClient?: VNextUniswapV2V2ExecutionClient;
}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.executionId) || input.executionId === `0x${"0".repeat(64)}`) {
    throw new Error("RMT Uniswap V2 V2 execution requires an exact nonzero execution ID.");
  }
  const recipient = getAddress(input.recipient);
  if ((input.infrastructureVerifiedAtBlock === undefined) !== (input.infrastructureVerifiedAtBlockHash === undefined)) {
    throw new Error("The committed Uniswap V2 infrastructure authority is incomplete.");
  }
  const config = await resolveConfig(input.config, input.infrastructureVerifiedAtBlock && input.infrastructureVerifiedAtBlockHash ? {
    verifiedAtBlock: input.infrastructureVerifiedAtBlock,
    verifiedAtBlockHash: input.infrastructureVerifiedAtBlockHash
  } : undefined);
  if (!config) throw new Error("RMT Uniswap V2 V2 wallet authorization is not configured.");
  const quoted = await quoteVNextUniswapV2ForUserV2({
    inputAsset: input.inputAsset,
    outputAsset: input.outputAsset,
    userGrossInput: input.amountIn,
    config,
    ...(input.quoteProvider ? { quoteProvider: input.quoteProvider } : {})
  });
  if (!quoted) throw new Error("RMT Uniswap V2 V2 execution is quote-only until the executor is configured and verified.");
  const nowMs = input.nowMs ?? Date.now();
  const currentSeconds = BigInt(Math.floor(nowMs / 1_000));
  const deadline = input.deadlineSeconds ?? currentSeconds + DEFAULT_AUTHORIZATION_WINDOW_SECONDS;
  if (deadline <= currentSeconds + 30n || deadline > currentSeconds + MAX_AUTHORIZATION_WINDOW_SECONDS) {
    throw new Error("The V2 authorization deadline is stale or outside the supported window.");
  }
  const protectedFloor = input.protectedOutputFloorAtomic ?? input.indicativeProtectedOutputFloorAtomic;
  if (input.indicativeProtectedOutputFloorAtomic <= 0n || protectedFloor < input.indicativeProtectedOutputFloorAtomic) {
    throw new Error("The V2 route weakened the indicative protected output floor.");
  }
  const protectedOutput = protectedFloor > BigInt(quoted.quote.protectedOutputAtomic)
    ? protectedFloor
    : BigInt(quoted.quote.protectedOutputAtomic);
  if (protectedOutput > BigInt(quoted.quote.expectedOutputAtomic)) throw new Error("The V2 protected output exceeds the fresh provider quote.");
  const requestedInputAsset = getAddress(input.inputAsset);
  const requestedOutputAsset = getAddress(input.outputAsset);
  const routedInputAsset = isRobinhoodNativeAsset(requestedInputAsset) ? ROBINHOOD_WETH_ADDRESS : requestedInputAsset;
  const routedOutputAsset = isRobinhoodNativeAsset(requestedOutputAsset) ? ROBINHOOD_WETH_ADDRESS : requestedOutputAsset;
  const economics = normalizeRmtExecutionFeeV2Input({
    policy: config.policy,
    inputAssetId: assetId(requestedInputAsset),
    outputAssetId: assetId(requestedOutputAsset),
    userGrossInputAtomic: input.amountIn.toString(),
    providerGrossExpectedOutputAtomic: quoted.quote.expectedOutputAtomic,
    providerProtectedOutputAtomic: protectedOutput.toString(),
    settlementMode: "v2-atomic-input-fee"
  });
  const route: RmtUniswapV2FeeRouteV2 = {
    kind: quoted.quote.route === "direct" ? 0 : 1,
    tokenIn: routedInputAsset,
    tokenOut: routedOutputAsset,
    pair0: quoted.quote.pools[0],
    pair1: quoted.quote.route === "direct" ? zeroAddress : quoted.quote.pools[1]
  };
  const execution = createRmtUniswapV2FeeExecutionV2({
    executor: config.executor,
    executorRuntimeHash: config.executorRuntimeHash,
    executionId: input.executionId,
    economics,
    trader: recipient,
    inputAsset: requestedInputAsset,
    outputAsset: requestedOutputAsset,
    deadline: deadline.toString(),
    route
  });
  const calldata = encodeRmtUniswapV2FeeExecutionV2(execution);
  const calldataHash = keccak256(calldata);
  const nativeInput = isRobinhoodNativeAsset(requestedInputAsset);
  const transactionValue = nativeInput ? input.amountIn : 0n;
  const executionClient = input.executionClient ?? client as unknown as VNextUniswapV2V2ExecutionClient;
  const [tokenState, nativeBalance, gasPrice] = await Promise.all([
    nativeInput ? Promise.resolve({ balance: 0n, allowance: MAX_UINT256 }) : Promise.all([
      executionClient.readContract({ address: requestedInputAsset, abi: erc20Abi, functionName: "balanceOf", args: [recipient] }),
      executionClient.readContract({ address: requestedInputAsset, abi: erc20Abi, functionName: "allowance", args: [recipient, config.executor] })
    ]).then(([balance, allowance]) => ({ balance, allowance })),
    executionClient.getBalance({ address: recipient }),
    executionClient.getGasPrice()
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const approvalRequired = !nativeInput && tokenState.allowance !== input.amountIn;
  let status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionData: Hex | null = null;
  let estimatedGasUnits: bigint | null = null;
  let exactSimulationPassed = false;
  if (balance < input.amountIn) status = "insufficient_balance";
  else if (approvalRequired) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = requestedInputAsset;
    nextActionData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [config.executor, input.amountIn] });
    try {
      await executionClient.call({ account: recipient, to: requestedInputAsset, data: nextActionData, value: 0n });
      try { estimatedGasUnits = await executionClient.estimateGas({ account: recipient, to: requestedInputAsset, data: nextActionData, value: 0n }); }
      catch { status = "gas_unavailable"; }
    } catch { status = "approval_simulation_failed"; }
  } else {
    status = "simulation_failed";
    nextAction = "swap";
    nextActionTarget = config.executor;
    nextActionData = calldata;
    try {
      await executionClient.call({ account: recipient, to: config.executor, data: calldata, value: transactionValue });
      exactSimulationPassed = true;
      status = "verified";
      try { estimatedGasUnits = await executionClient.estimateGas({ account: recipient, to: config.executor, data: calldata, value: transactionValue }); }
      catch { status = "gas_unavailable"; }
    } catch { status = "simulation_failed"; }
  }
  const feeCeilingWei = gasPrice * WALLET_FEE_CEILING_MULTIPLIER;
  const gasLimitUnits = estimatedGasUnits === null ? null : estimatedGasUnits * 120n / 100n;
  const estimatedNetworkCostWei = gasLimitUnits === null ? null : gasLimitUnits * feeCeilingWei;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (gasLimitUnits !== null && estimatedNetworkCostWei !== null) {
    gasState = nativeBalance >= transactionValue + estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
  } else if (status === "gas_unavailable") gasState = "unavailable";
  const proof: VNextAtomicFeeSettlementProof = {
    verificationState: "verified_atomic", provider: "uniswap-v2", settlementMode: "v2-atomic-input-fee",
    implementationId: RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID, executionTarget: config.executor,
    providerTarget: ROBINHOOD_UNISWAP_V2_ROUTER, calldataHash, executionId: input.executionId,
    recipient, deadline: deadline.toString(), atomicFeeSettlement: true, revertsAtomically: true
  };
  const evidence = {
    provider: "uniswap-v2" as const, status, chainId: 4_663 as const,
    inputAsset: requestedInputAsset, outputAsset: requestedOutputAsset, inputAmountAtomic: input.amountIn.toString(),
    indicativeProtectedOutputFloorAtomic: input.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: economics.expectedUserNetOutputAtomic, protectedOutputAtomic: economics.protectedUserNetOutputAtomic,
    recipient, router: ROBINHOOD_UNISWAP_V2_ROUTER, approvalSpender: config.executor, approvalRequired,
    sufficientBalance: balance >= input.amountIn, allowanceAtomic: tokenState.allowance.toString(), balanceAtomic: balance.toString(),
    route: quoted.quote.route, fees: quoted.quote.pools.map(() => 30), pools: quoted.quote.pools,
    quoteBlock: quoted.quote.quoteBlock, quoteBlockHash: quoted.quote.quoteBlockHash,
    deadline: deadline.toString(), calldataHash, nextAction, nextActionTarget,
    nextActionCalldataHash: nextActionData ? keccak256(nextActionData) : null,
    transactionValueAtomic: transactionValue.toString(), nativeBalanceWei: nativeBalance.toString(),
    gasPriceWei: gasPrice.toString(), feeCeilingWei: feeCeilingWei.toString(),
    estimatedGasUnits: estimatedGasUnits?.toString() ?? null, gasLimitUnits: gasLimitUnits?.toString() ?? null,
    estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null, estimatedNetworkCostUsdgAtomic: null,
    networkCostValuationSource: null, networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null,
    gasState, routerRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
    factoryRuntimeHash: ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
    quoterRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
    exactSimulationPassed, userPaysGas: true as const, rmtFeeEnabled: false,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    netEconomics: normalizeDisabledRmtFee({
      userGrossInputAtomic: input.amountIn.toString(),
      providerGrossExpectedOutputAtomic: economics.providerGrossExpectedOutputAtomic,
      providerProtectedOutputAtomic: economics.providerProtectedOutputAtomic
    }),
    feeExecution: null, feeV2Economics: economics, feeV2Settlement: proof,
    infrastructureVerifiedAtBlock: config.verifiedAtBlock,
    infrastructureVerifiedAtBlockHash: config.verifiedAtBlockHash,
    verifiedAtMs: nowMs, expiresAtMs: Number(deadline) * 1_000, authorizationReady: false as const
  };
  return {
    evidence,
    execution,
    feeV2Authorization: bindVNextAtomicFeeAuthorization({ economics, proof }),
    payloads: { swapCalldata: calldata, nextActionData }
  };
}

export async function prepareVNextUniswapV2AuthorizationV2(input: Parameters<typeof evaluateVNextUniswapV2RouteV2>[0]) {
  const evaluated = await evaluateVNextUniswapV2RouteV2(input);
  if (!evaluated.payloads.nextActionData || !evaluated.evidence.nextActionTarget || !evaluated.evidence.gasLimitUnits
    || (evaluated.evidence.status !== "approval_required" && evaluated.evidence.status !== "verified")) {
    throw new Error(`The exact Uniswap V2 V2 next action is not ready (${evaluated.evidence.status}).`);
  }
  return {
    ...evaluated,
    transaction: {
      kind: evaluated.evidence.status === "approval_required" ? "erc20_approval" as const : "swap" as const,
      target: evaluated.evidence.nextActionTarget,
      data: evaluated.payloads.nextActionData,
      value: evaluated.evidence.transactionValueAtomic,
      gasLimit: evaluated.evidence.gasLimitUnits
    }
  };
}

export function policyFromVerifiedUniswapV2Config(config: VerifiedVNextUniswapV2FeeExecutorV2Config): RmtExecutionFeeV2Policy {
  return config.policy;
}
