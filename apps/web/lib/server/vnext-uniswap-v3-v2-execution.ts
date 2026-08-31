import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";
import { normalizeDisabledRmtFee } from "../vnext/execution-fee-policy";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";
import {
  normalizeRmtExecutionFeeV2Input,
  type RmtExecutionFeeV2Policy
} from "../vnext/execution-fee-policy-v2";
import { bindVNextAtomicFeeAuthorization, type VNextAtomicFeeSettlementProof } from "../vnext/provider-fee-settlement";
import { isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import {
  createRmtUniswapV3FeeExecutionV2,
  encodeRmtUniswapV3FeeExecutionV2,
  type RmtUniswapV3FeeRouteV2
} from "../vnext/uniswap-v3-fee-executor-v2";
import {
  RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
  configuredVNextUniswapFeeExecutorV2,
  verifyConfiguredVNextUniswapFeeExecutorV2,
  type VNextUniswapFeeExecutorV2Config
} from "./vnext-uniswap-fee-executor-v2";
import {
  ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH
} from "./vnext-uniswap-fee-executor";
import { quoteVNextUniswapDirect } from "./vnext-uniswap-quote";

const MAX_UINT256 = (1n << 256n) - 1n;
const DEFAULT_AUTHORIZATION_WINDOW_SECONDS = 240n;
const MAX_AUTHORIZATION_WINDOW_SECONDS = 300n;
const WALLET_FEE_CEILING_MULTIPLIER = 3n;
const QUOTER_RUNTIME_HASH = "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28" as Hex;

export function requiresExactV2TraderApproval(input: {
  nativeInput: boolean;
  allowance: bigint;
  userGrossInput: bigint;
}) {
  return !input.nativeInput && input.allowance !== input.userGrossInput;
}

export type VerifiedVNextUniswapFeeExecutorV2Config = VNextUniswapFeeExecutorV2Config & {
  verifiedAtBlock: string;
};

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL
      ?? process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
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
  configured: VerifiedVNextUniswapFeeExecutorV2Config | null | undefined,
  requirePolicyEffective = true
) {
  if (configured !== undefined) return configured;
  const config = configuredVNextUniswapFeeExecutorV2();
  return config ? verifyConfiguredVNextUniswapFeeExecutorV2(config, { requirePolicyEffective }) : null;
}

export async function quoteVNextUniswapForUserV2(input: {
  inputAsset: Address;
  outputAsset: Address;
  userGrossInput: bigint;
  config?: VerifiedVNextUniswapFeeExecutorV2Config | null;
  quoteProvider?: typeof quoteVNextUniswapDirect;
}) {
  const config = await resolveConfig(input.config, false);
  if (!config) return null;
  const requestedInputAsset = getAddress(input.inputAsset);
  const requestedOutputAsset = getAddress(input.outputAsset);
  const routedInputAsset = isRobinhoodNativeAsset(requestedInputAsset) ? ROBINHOOD_WETH : requestedInputAsset;
  const routedOutputAsset = isRobinhoodNativeAsset(requestedOutputAsset) ? ROBINHOOD_WETH : requestedOutputAsset;
  const fee = input.userGrossInput * 25n / 10_000n;
  const providerInput = input.userGrossInput - fee;
  if (input.userGrossInput <= 0n || providerInput <= 0n) throw new Error("RMT V2 fee leaves no Uniswap provider input.");
  const quote = await (input.quoteProvider ?? quoteVNextUniswapDirect)({
    inputAsset: routedInputAsset,
    outputAsset: routedOutputAsset,
    amountIn: providerInput
  });
  if (!quote) return null;
  const economics = normalizeRmtExecutionFeeV2Input({
    policy: config.policy,
    inputAssetId: assetId(requestedInputAsset),
    outputAssetId: assetId(requestedOutputAsset),
    userGrossInputAtomic: input.userGrossInput.toString(),
    providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
    providerProtectedOutputAtomic: quote.minimumOut.toString(),
    settlementMode: "v2-atomic-input-fee"
  });
  return { config, quote, economics, requestedInputAsset, requestedOutputAsset };
}

export async function evaluateVNextUniswapRouteV2(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  executionId: Hex;
  indicativeProtectedOutputFloorAtomic: bigint;
  protectedOutputFloorAtomic?: bigint;
  deadlineSeconds?: bigint;
  nowMs?: number;
  config?: VerifiedVNextUniswapFeeExecutorV2Config | null;
  quoteProvider?: typeof quoteVNextUniswapDirect;
}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.executionId) || input.executionId === `0x${"0".repeat(64)}`) {
    throw new Error("RMT Uniswap V3 V2 execution requires an exact nonzero execution ID.");
  }
  const recipient = getAddress(input.recipient);
  const effectiveConfig = await resolveConfig(input.config, true);
  if (!effectiveConfig) throw new Error("RMT Uniswap V3 V2 wallet authorization is not configured.");
  const quoted = await quoteVNextUniswapForUserV2({
    inputAsset: input.inputAsset,
    outputAsset: input.outputAsset,
    userGrossInput: input.amountIn,
    config: effectiveConfig,
    ...(input.quoteProvider ? { quoteProvider: input.quoteProvider } : {})
  });
  if (!quoted) throw new Error("RMT Uniswap V3 V2 execution is quote-only until the executor is configured and verified.");
  const { config, quote, requestedInputAsset, requestedOutputAsset } = quoted;
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
  const protectedOutput = protectedFloor > quote.minimumOut ? protectedFloor : quote.minimumOut;
  if (protectedOutput > quote.quoteOut) throw new Error("The V2 protected output exceeds the fresh provider quote.");
  const economics = normalizeRmtExecutionFeeV2Input({
    policy: config.policy,
    inputAssetId: assetId(requestedInputAsset),
    outputAssetId: assetId(requestedOutputAsset),
    userGrossInputAtomic: input.amountIn.toString(),
    providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
    providerProtectedOutputAtomic: protectedOutput.toString(),
    settlementMode: "v2-atomic-input-fee"
  });
  const route: RmtUniswapV3FeeRouteV2 = {
    kind: quote.route === "direct" ? 0 : 1,
    tokenIn: quote.inputAsset,
    tokenOut: quote.outputAsset,
    fee0: quote.fees[0],
    fee1: quote.route === "direct" ? 0 : quote.fees[1],
    pool0: quote.pools[0],
    pool1: quote.route === "direct" ? getAddress("0x0000000000000000000000000000000000000000") : quote.pools[1]
  };
  const execution = createRmtUniswapV3FeeExecutionV2({
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
  const calldata = encodeRmtUniswapV3FeeExecutionV2(execution);
  const calldataHash = keccak256(calldata);
  const nativeInput = isRobinhoodNativeAsset(requestedInputAsset);
  const transactionValue = nativeInput ? input.amountIn : 0n;
  const [tokenState, nativeBalance, gasPrice] = await Promise.all([
    nativeInput
      ? Promise.resolve({ balance: 0n, allowance: MAX_UINT256 })
      : Promise.all([
          client.readContract({ address: requestedInputAsset, abi: erc20Abi, functionName: "balanceOf", args: [recipient] }),
          client.readContract({ address: requestedInputAsset, abi: erc20Abi, functionName: "allowance", args: [recipient, config.executor] })
        ]).then(([balance, allowance]) => ({ balance, allowance })),
    client.getBalance({ address: recipient }),
    client.getGasPrice()
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const allowance = tokenState.allowance;
  const sufficientBalance = balance >= input.amountIn;
  const approvalRequired = requiresExactV2TraderApproval({
    nativeInput,
    allowance,
    userGrossInput: input.amountIn
  });
  let status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionData: Hex | null = null;
  let exactSimulationPassed = false;
  let estimatedGasUnits: bigint | null = null;
  if (!sufficientBalance) {
    status = "insufficient_balance";
  } else if (approvalRequired) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = requestedInputAsset;
    nextActionData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [config.executor, input.amountIn]
    });
    try {
      // Tokens that cannot replace an existing nonzero allowance with the
      // exact requested amount fail closed here. RMT never proceeds with
      // widened authority and never manufactures an unlimited approval.
      await client.call({ account: recipient, to: requestedInputAsset, data: nextActionData, value: 0n });
      try {
        estimatedGasUnits = await client.estimateGas({ account: recipient, to: requestedInputAsset, data: nextActionData, value: 0n });
      } catch {
        status = "gas_unavailable";
      }
    } catch {
      status = "approval_simulation_failed";
    }
  } else {
    nextAction = "swap";
    nextActionTarget = config.executor;
    nextActionData = calldata;
    try {
      await client.call({ account: recipient, to: config.executor, data: calldata, value: transactionValue });
      exactSimulationPassed = true;
      status = "verified";
      try {
        estimatedGasUnits = await client.estimateGas({ account: recipient, to: config.executor, data: calldata, value: transactionValue });
      } catch {
        status = "gas_unavailable";
      }
    } catch {
      status = "simulation_failed";
    }
  }
  const feeCeilingWei = gasPrice * WALLET_FEE_CEILING_MULTIPLIER;
  const gasLimitUnits = estimatedGasUnits === null ? null : estimatedGasUnits * 120n / 100n;
  const estimatedNetworkCostWei = gasLimitUnits === null ? null : gasLimitUnits * feeCeilingWei;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (gasLimitUnits !== null && estimatedNetworkCostWei !== null) {
    gasState = nativeBalance >= transactionValue + estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
  } else if (status === "gas_unavailable") {
    gasState = "unavailable";
  }
  const proof: VNextAtomicFeeSettlementProof = {
    verificationState: "verified_atomic",
    provider: "uniswap-v3",
    settlementMode: "v2-atomic-input-fee",
    implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
    executionTarget: config.executor,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    calldataHash,
    executionId: input.executionId,
    recipient,
    deadline: deadline.toString(),
    atomicFeeSettlement: true,
    revertsAtomically: true
  };
  const evidence = {
    provider: "uniswap-v3" as const,
    status,
    chainId: 4_663 as const,
    inputAsset: requestedInputAsset,
    outputAsset: requestedOutputAsset,
    inputAmountAtomic: input.amountIn.toString(),
    indicativeProtectedOutputFloorAtomic: input.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: economics.expectedUserNetOutputAtomic,
    protectedOutputAtomic: economics.protectedUserNetOutputAtomic,
    recipient,
    router: ROBINHOOD_SWAP_ROUTER_02,
    approvalSpender: config.executor,
    approvalRequired,
    sufficientBalance,
    allowanceAtomic: allowance.toString(),
    balanceAtomic: balance.toString(),
    route: quote.route,
    fees: quote.fees,
    pools: quote.pools,
    deadline: deadline.toString(),
    calldataHash,
    nextAction,
    nextActionTarget,
    nextActionCalldataHash: nextActionData ? keccak256(nextActionData) : null,
    transactionValueAtomic: transactionValue.toString(),
    nativeBalanceWei: nativeBalance.toString(),
    gasPriceWei: gasPrice.toString(),
    feeCeilingWei: feeCeilingWei.toString(),
    estimatedGasUnits: estimatedGasUnits?.toString() ?? null,
    gasLimitUnits: gasLimitUnits?.toString() ?? null,
    estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null,
    estimatedNetworkCostUsdgAtomic: null,
    networkCostValuationSource: null,
    networkCostValuedAtMs: null,
    networkCostValuationExpiresAtMs: null,
    gasState,
    routerRuntimeHash: ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH,
    factoryRuntimeHash: ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH,
    quoterRuntimeHash: QUOTER_RUNTIME_HASH,
    exactSimulationPassed,
    userPaysGas: true as const,
    rmtFeeEnabled: false,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    netEconomics: normalizeDisabledRmtFee({
      userGrossInputAtomic: input.amountIn.toString(),
      providerGrossExpectedOutputAtomic: economics.providerGrossExpectedOutputAtomic,
      providerProtectedOutputAtomic: economics.providerProtectedOutputAtomic
    }),
    feeExecution: null,
    feeV2Economics: economics,
    feeV2Settlement: proof,
    verifiedAtMs: nowMs,
    expiresAtMs: Number(deadline) * 1_000,
    authorizationReady: false as const
  };
  return {
    evidence,
    execution,
    feeV2Authorization: bindVNextAtomicFeeAuthorization({ economics, proof }),
    payloads: { swapCalldata: calldata, nextActionData }
  };
}

export async function prepareVNextUniswapAuthorizationV2(
  input: Parameters<typeof evaluateVNextUniswapRouteV2>[0]
) {
  const evaluated = await evaluateVNextUniswapRouteV2(input);
  const { evidence, payloads } = evaluated;
  if (!payloads.nextActionData || !evidence.nextActionTarget || !evidence.gasLimitUnits) {
    throw new Error(`The exact Uniswap V3 V2 next action is not ready (${evidence.status}).`);
  }
  if (evidence.status !== "approval_required" && evidence.status !== "verified") {
    throw new Error(`The exact Uniswap V3 V2 next action is not ready (${evidence.status}).`);
  }
  return {
    ...evaluated,
    transaction: {
      kind: evidence.status === "approval_required" ? "erc20_approval" as const : "swap" as const,
      target: evidence.nextActionTarget,
      data: payloads.nextActionData,
      value: evidence.transactionValueAtomic,
      gasLimit: evidence.gasLimitUnits
    }
  };
}

export function vNextUniswapV3V2Capability() {
  return {
    state: "V2_ATOMIC_INPUT_FEE" as const,
    requiredMode: "v2-atomic-input-fee" as const,
    implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
    walletCodecImplemented: true as const,
    currentSettlement: "RMTUniswapV3FeeExecutorV2 atomically settles the exact universal input fee.",
    requiredImplementation: "Exact deployed V2 runtime and owner-authorized RMT_EXECUTION_V2 activation."
  };
}

export function policyFromVerifiedV2Config(config: VerifiedVNextUniswapFeeExecutorV2Config): RmtExecutionFeeV2Policy {
  return config.policy;
}
