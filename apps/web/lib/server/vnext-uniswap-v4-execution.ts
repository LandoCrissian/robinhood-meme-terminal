import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  MAX_UINT160,
  PERMIT2_ADDRESS,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_POOL_MANAGER,
  ROBINHOOD_V4_QUOTER,
  permit2Abi
} from "../uniswap-v4";
import { directNoRmtFeeSettlement, VNEXT_DIRECT_NO_RMT_FEE } from "../vnext/execution-settlement";
import { assertUniswapTransactionIntegrity } from "../uniswap-transaction-integrity";
import { buildExternalV4Swap } from "./external-uniswap-v4-simulation";
import type { VerifiedExternalUniswapV4Market } from "./external-uniswap-v4-market";
import { readVNextCanonicalMarketInventory, type VNextCanonicalMarketInventoryResult } from "./vnext-market-indexer";
import { disabledVNextFeeEconomics, type VNextProviderAuthorizationRequest, type VNextProviderVerificationEvidence, type VNextProviderVerificationRequest } from "./vnext-provider-adapter";

const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;
const DEFAULT_AUTHORIZATION_WINDOW_SECONDS = 240n;
const MAX_AUTHORIZATION_WINDOW_SECONDS = 300n;
export const PERMIT2_MIN_REMAINING_VALIDITY_SECONDS = 90n;
const MAX_QUOTE_AGE_MS = 30_000;
const WALLET_FEE_CEILING_MULTIPLIER = 3n;
const BUY_COMMANDS = "0x100404";
const SELL_COMMANDS = "0x02100404";

const poolKeyParameters = [{
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" }
  ]
}] as const;

const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "poolKey", type: "tuple", components: poolKeyParameters[0].components },
    { name: "zeroForOne", type: "bool" },
    { name: "exactAmount", type: "uint128" },
    { name: "hookData", type: "bytes" }
  ] }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "gasEstimate", type: "uint256" }
  ]
}] as const;

const universalRouterAbi = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { name: "commands", type: "bytes" },
    { name: "inputs", type: "bytes[]" },
    { name: "deadline", type: "uint256" }
  ],
  outputs: []
}] as const;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } }
  )
});

type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type VNextUniswapV4ExecutionEvidence = {
  poolId: Hex;
  poolKey: PoolKey;
  poolManager: Address;
  quoter: Address;
  universalRouter: Address;
  permit2: Address;
  commands: typeof BUY_COMMANDS | typeof SELL_COMMANDS;
  hookData: "0x";
  quoteObservedBlock: string;
  quoteObservedBlockHash: Hex;
  quoteObservedAtMs: number;
  quotedAtMs: number;
  quoteExpiresAtMs: number;
  simulationBlock: string;
  simulationBlockHash: Hex;
  routerRuntimeHash: Hex;
  poolManagerRuntimeHash: Hex;
  quoterRuntimeHash: Hex;
  permit2RuntimeHash: Hex;
  rmtFeeAtomic: "0";
  treasuryTransferAtomic: "0";
};

export type VNextUniswapV4ExecutionDependencies = {
  readInventory?: (query: { token: string; poolKey?: string; source: "uniswap-v4"; limit: number }) => Promise<VNextCanonicalMarketInventoryResult>;
  quote?: (input: { poolKey: PoolKey; zeroForOne: boolean; amountIn: bigint; recipient: Address }) => Promise<bigint>;
  readBlock?: (blockNumber?: bigint) => Promise<{ number: bigint; hash: Hex | null; timestamp: bigint }>;
  getBytecode?: (address: Address) => Promise<Hex | undefined>;
  getNativeBalance?: (address: Address) => Promise<bigint>;
  getTokenState?: (token: Address, owner: Address) => Promise<{ balance: bigint; permit2Allowance: bigint }>;
  getPermit2Allowance?: (owner: Address, token: Address) => Promise<{ amount: bigint; expiration: bigint }>;
  call?: (input: { account: Address; to: Address; data: Hex; value: bigint }) => Promise<void>;
  estimateGas?: (input: { account: Address; to: Address; data: Hex; value: bigint }) => Promise<bigint>;
  getGasPrice?: () => Promise<bigint>;
  now?: () => number;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected Uniswap V4 execution: ${message}.`);
}

function derivePoolId(poolKey: PoolKey) {
  return keccak256(encodeAbiParameters(poolKeyParameters, [poolKey]));
}

function runtimeHash(code: Hex | undefined, label: string) {
  invariant(code && code !== "0x", `${label} runtime is unavailable`);
  return keccak256(code);
}

function canonicalPool(input: VNextProviderVerificationRequest, inventory: VNextCanonicalMarketInventoryResult) {
  invariant(input.canonicalMarket?.sourceId === "uniswap-v4", "canonical V4 market identity is missing");
  invariant(inventory.status === "verified_shadow", "canonical V4 inventory is unavailable");
  const poolId = input.canonicalMarket.poolId.toLowerCase();
  const requestInput = input.inputAsset.toLowerCase();
  const requestOutput = input.outputAsset.toLowerCase();
  const pool = inventory.pools.find((candidate) => (
    candidate.sourceId === "uniswap-v4"
    && candidate.protocol === "uniswap"
    && candidate.version === 4
    && candidate.poolAddress === null
    && candidate.poolKey === poolId
    && candidate.fee !== null
    && candidate.tickSpacing !== null
    && candidate.hooks !== null
    && ((candidate.token0 === requestInput && candidate.token1 === requestOutput)
      || (candidate.token0 === requestOutput && candidate.token1 === requestInput))
  ));
  invariant(pool && pool.fee !== null && pool.tickSpacing !== null && pool.hooks !== null, "canonical PoolKey does not match the exact asset pair");
  const poolKey: PoolKey = {
    currency0: getAddress(pool.token0),
    currency1: getAddress(pool.token1),
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: getAddress(pool.hooks)
  };
  const derivedPoolId = derivePoolId(poolKey);
  invariant(derivedPoolId.toLowerCase() === pool.poolKey, "canonical PoolId does not match its PoolKey");
  return { pool, poolKey, poolId: derivedPoolId };
}

function assertQuoteContinuity(input: VNextProviderVerificationRequest, poolKey: PoolKey, poolId: Hex, now: number) {
  const quote = input.v4QuoteEvidence;
  invariant(quote, "quoted V4 PoolKey evidence is missing");
  invariant(quote.expiresAtMs >= now && quote.quotedAtMs <= now && now - quote.observedAtMs <= MAX_QUOTE_AGE_MS, "quote evidence is stale");
  invariant(quote.poolId.toLowerCase() === poolId.toLowerCase(), "quoted PoolId changed");
  invariant(getAddress(quote.currency0) === poolKey.currency0 && getAddress(quote.currency1) === poolKey.currency1, "quoted currencies changed");
  invariant(quote.fee === poolKey.fee && quote.tickSpacing === poolKey.tickSpacing && getAddress(quote.hooks) === poolKey.hooks, "quoted PoolKey changed");
  invariant(getAddress(quote.recipient) === getAddress(input.recipient), "quoted recipient changed");
  return quote;
}

function syntheticVerifiedMarket(token: Address, poolId: Hex, poolKey: PoolKey): VerifiedExternalUniswapV4Market {
  return {
    protocol: "uniswap-v4",
    token,
    poolId,
    poolManager: ROBINHOOD_V4_POOL_MANAGER,
    stateView: zeroAddress,
    quoter: ROBINHOOD_V4_QUOTER,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    poolKey,
    poolState: { sqrtPriceX96: 1n, tick: 0, protocolFee: 0, lpFee: poolKey.fee, initializedAtBlock: 0n },
    hook: {
      address: poolKey.hooks,
      permissions: [],
      affectsSwap: poolKey.hooks !== zeroAddress,
      returnsSwapDelta: false,
      dynamicFee: false,
      codePresent: true,
      sourcePublished: null,
      isProxy: null,
      bytecodeChanged: null,
      contractName: null,
      customWriteFunctions: []
    },
    liquidityUsd: 0,
    url: ""
  };
}

async function evaluateVNextUniswapV4Route(
  input: VNextProviderVerificationRequest & { deadlineSeconds?: bigint; protectedOutputFloorAtomic?: bigint; nowMs?: number },
  dependencies: VNextUniswapV4ExecutionDependencies = {}
) {
  invariant((input.settlementMode ?? VNEXT_DIRECT_NO_RMT_FEE) === VNEXT_DIRECT_NO_RMT_FEE, "only DIRECT_NO_RMT_FEE is supported");
  invariant(input.chainId === 4_663 && input.amountIn > 0n && input.amountIn <= MAX_UINT128, "trade identity is invalid");
  invariant(input.inputAmountAtomic === input.amountIn.toString(), "input amount changed");
  invariant(isAddress(input.inputAsset) && isAddress(input.outputAsset) && isAddress(input.recipient), "address identity is invalid");
  const nativeInput = getAddress(input.inputAsset) === zeroAddress;
  const nativeOutput = getAddress(input.outputAsset) === zeroAddress;
  invariant(nativeInput !== nativeOutput, "current V4 admission requires an exact native ETH pair");
  const token = getAddress(nativeInput ? input.outputAsset : input.inputAsset);
  const now = input.nowMs ?? dependencies.now?.() ?? Date.now();
  const currentSeconds = BigInt(Math.floor(now / 1_000));
  const deadline = input.deadlineSeconds ?? currentSeconds + DEFAULT_AUTHORIZATION_WINDOW_SECONDS;
  invariant(deadline > currentSeconds + 30n && deadline <= currentSeconds + MAX_AUTHORIZATION_WINDOW_SECONDS && deadline <= MAX_UINT48, "deadline is stale or outside the supported window");

  const inventory = await (dependencies.readInventory ?? readVNextCanonicalMarketInventory)({
    token: token.toLowerCase(),
    poolKey: input.canonicalMarket?.poolId.toLowerCase(),
    source: "uniswap-v4",
    limit: 100
  });
  const canonical = canonicalPool(input, inventory);
  const quoted = assertQuoteContinuity(input, canonical.poolKey, canonical.poolId, now);
  const readBlock = dependencies.readBlock ?? (async (blockNumber?: bigint) => {
    const block = await client.getBlock(blockNumber === undefined ? {} : { blockNumber });
    return { number: block.number, hash: block.hash, timestamp: block.timestamp };
  });
  const [quotedBlock, freshBlock, routerCode, managerCode, quoterCode, permit2Code] = await Promise.all([
    readBlock(BigInt(quoted.observedBlock)),
    readBlock(),
    (dependencies.getBytecode ?? ((address) => client.getBytecode({ address })))(ROBINHOOD_UNIVERSAL_ROUTER),
    (dependencies.getBytecode ?? ((address) => client.getBytecode({ address })))(ROBINHOOD_V4_POOL_MANAGER),
    (dependencies.getBytecode ?? ((address) => client.getBytecode({ address })))(ROBINHOOD_V4_QUOTER),
    (dependencies.getBytecode ?? ((address) => client.getBytecode({ address })))(PERMIT2_ADDRESS)
  ]);
  invariant(quotedBlock.hash?.toLowerCase() === quoted.observedBlockHash.toLowerCase(), "quote block was reorganized");
  invariant(freshBlock.hash && freshBlock.number >= quotedBlock.number, "fresh chain evidence is unavailable");
  const routerRuntimeHash = runtimeHash(routerCode, "Universal Router");
  const poolManagerRuntimeHash = runtimeHash(managerCode, "PoolManager");
  const quoterRuntimeHash = runtimeHash(quoterCode, "V4 Quoter");
  const permit2RuntimeHash = runtimeHash(permit2Code, "Permit2");
  const quote = dependencies.quote ?? (async (request: { poolKey: PoolKey; zeroForOne: boolean; amountIn: bigint; recipient: Address }) => {
    const result = await client.simulateContract({
      account: request.recipient,
      address: ROBINHOOD_V4_QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: request.poolKey, zeroForOne: request.zeroForOne, exactAmount: request.amountIn, hookData: "0x" }]
    });
    return result.result[0];
  });
  const amountOut = await quote({
    poolKey: canonical.poolKey,
    zeroForOne: canonical.poolKey.currency0 === getAddress(input.inputAsset),
    amountIn: input.amountIn,
    recipient: getAddress(input.recipient)
  });
  const protectedFloor = input.protectedOutputFloorAtomic ?? input.indicativeProtectedOutputFloorAtomic;
  invariant(protectedFloor > 0n && amountOut >= protectedFloor, "live output moved below the protected floor");
  const market = syntheticVerifiedMarket(token, canonical.poolId, canonical.poolKey);
  const built = buildExternalV4Swap({
    market,
    recipient: getAddress(input.recipient),
    side: nativeInput ? "buy" : "sell",
    amountIn: input.amountIn,
    quoteOut: amountOut,
    deadline,
    minimumOutFloor: protectedFloor
  });
  assertUniswapTransactionIntegrity({
    venue: "uniswap-v4",
    token,
    recipient: getAddress(input.recipient),
    side: nativeInput ? "buy" : "sell",
    marketPair: canonical.poolId,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    calldata: built.calldata,
    value: built.value.toString(),
    amountIn: input.amountIn.toString(),
    quoteOut: amountOut.toString(),
    grossQuoteOut: amountOut.toString(),
    minimumOut: built.minimumOut.toString(),
    grossMinimumOut: built.grossMinimumOut.toString(),
    deadline: deadline.toString(),
    fee: canonical.poolKey.fee,
    inputToken: { address: getAddress(input.inputAsset), decimals: 18 },
    outputToken: { address: getAddress(input.outputAsset), decimals: 18 },
    passport: { hook: canonical.poolKey.hooks }
  }, {
    version: "v4",
    token,
    recipient: getAddress(input.recipient),
    side: nativeInput ? "buy" : "sell",
    amountIn: input.amountIn,
    nowSeconds: Number(currentSeconds)
  });
  invariant(built.estimatedFee === 0n && built.netQuoteOut === amountOut, "RMT fee commands are not disabled");
  const decoded = decodeFunctionData({ abi: universalRouterAbi, data: built.calldata });
  invariant(decoded.functionName === "execute", "Universal Router function changed");
  const [commands, commandInputs, calldataDeadline] = decoded.args;
  const expectedCommands = nativeInput ? BUY_COMMANDS : SELL_COMMANDS;
  invariant(commands.toLowerCase() === expectedCommands && commandInputs.length === (nativeInput ? 3 : 4), "Universal Router command sequence changed");
  invariant(calldataDeadline === deadline && built.value === (nativeInput ? input.amountIn : 0n), "Universal Router value or deadline changed");

  const owner = getAddress(input.recipient);
  const getNativeBalance = dependencies.getNativeBalance ?? ((address: Address) => client.getBalance({ address }));
  const getTokenState = dependencies.getTokenState ?? (async (nextToken: Address, nextOwner: Address) => {
    const [balance, permit2Allowance] = await Promise.all([
      client.readContract({ address: nextToken, abi: erc20Abi, functionName: "balanceOf", args: [nextOwner] }),
      client.readContract({ address: nextToken, abi: erc20Abi, functionName: "allowance", args: [nextOwner, PERMIT2_ADDRESS] })
    ]);
    return { balance, permit2Allowance };
  });
  const getPermit2Allowance = dependencies.getPermit2Allowance ?? (async (nextOwner: Address, nextToken: Address) => {
    const allowance = await client.readContract({
      address: PERMIT2_ADDRESS,
      abi: permit2Abi,
      functionName: "allowance",
      args: [nextOwner, nextToken, ROBINHOOD_UNIVERSAL_ROUTER]
    });
    return { amount: allowance[0], expiration: BigInt(allowance[1]) };
  });
  const [nativeBalance, tokenState, permit2State, gasPrice] = await Promise.all([
    getNativeBalance(owner),
    nativeInput ? Promise.resolve({ balance: 0n, permit2Allowance: MAX_UINT160 }) : getTokenState(token, owner),
    nativeInput ? Promise.resolve({ amount: MAX_UINT160, expiration: MAX_UINT48 }) : getPermit2Allowance(owner, token),
    (dependencies.getGasPrice ?? (() => client.getGasPrice()))()
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const sufficientBalance = balance >= input.amountIn;
  let approvalRequired = false;
  let approvalKind: "erc20_to_permit2" | "permit2_to_router" | null = null;
  let approvalSpender: Address = ROBINHOOD_UNIVERSAL_ROUTER;
  let allowance = nativeInput ? MAX_UINT160 : permit2State.amount;
  let nextTarget: Address = ROBINHOOD_UNIVERSAL_ROUTER;
  let nextData = built.calldata;
  let nextValue = built.value;
  if (!nativeInput && tokenState.permit2Allowance < input.amountIn) {
    approvalRequired = true;
    approvalKind = "erc20_to_permit2";
    approvalSpender = PERMIT2_ADDRESS;
    allowance = tokenState.permit2Allowance;
    nextTarget = token;
    nextValue = 0n;
    nextData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, input.amountIn] });
  } else if (!nativeInput && (
    permit2State.amount < input.amountIn
    || permit2State.expiration < currentSeconds + PERMIT2_MIN_REMAINING_VALIDITY_SECONDS
  )) {
    approvalRequired = true;
    approvalKind = "permit2_to_router";
    approvalSpender = ROBINHOOD_UNIVERSAL_ROUTER;
    allowance = permit2State.amount;
    nextTarget = PERMIT2_ADDRESS;
    nextValue = 0n;
    nextData = encodeFunctionData({
      abi: permit2Abi,
      functionName: "approve",
      args: [token, ROBINHOOD_UNIVERSAL_ROUTER, input.amountIn, Number(deadline)]
    });
  }

  let status: VNextProviderVerificationEvidence["status"] = sufficientBalance ? (approvalRequired ? "approval_required" : "verified") : "insufficient_balance";
  let exactSimulationPassed = false;
  let estimatedGasUnits: bigint | null = null;
  let gasLimitUnits: bigint | null = null;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  const call = dependencies.call ?? (async (request: { account: Address; to: Address; data: Hex; value: bigint }) => {
    await client.call(request);
  });
  if (sufficientBalance) {
    try {
      await call({ account: owner, to: nextTarget, data: nextData, value: nextValue });
      exactSimulationPassed = !approvalRequired;
      estimatedGasUnits = await (dependencies.estimateGas ?? ((request) => client.estimateGas(request)))({ account: owner, to: nextTarget, data: nextData, value: nextValue });
    } catch {
      status = approvalRequired ? "approval_simulation_failed" : "simulation_failed";
    }
  }
  const feeCeilingWei = gasPrice * WALLET_FEE_CEILING_MULTIPLIER;
  let estimatedNetworkCostWei: bigint | null = null;
  if (estimatedGasUnits !== null) {
    gasLimitUnits = estimatedGasUnits * 120n / 100n;
    estimatedNetworkCostWei = gasLimitUnits * feeCeilingWei;
    gasState = nativeBalance >= nextValue + estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
  } else if (sufficientBalance && status !== "approval_simulation_failed" && status !== "simulation_failed") {
    gasState = "unavailable";
    status = "gas_unavailable";
  }
  const protectedOutput = built.minimumOut;
  const evidence: VNextProviderVerificationEvidence = {
    provider: "uniswap-v4",
    status,
    chainId: 4_663,
    inputAsset: getAddress(input.inputAsset),
    outputAsset: getAddress(input.outputAsset),
    inputAmountAtomic: input.inputAmountAtomic,
    indicativeProtectedOutputFloorAtomic: input.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: amountOut.toString(),
    protectedOutputAtomic: protectedOutput.toString(),
    recipient: owner,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    approvalSpender,
    approvalRequired,
    approvalKind,
    sufficientBalance,
    allowanceAtomic: allowance.toString(),
    balanceAtomic: balance.toString(),
    route: "v4_pool",
    fees: [canonical.poolKey.fee],
    pools: [canonical.poolId],
    deadline: deadline.toString(),
    calldataHash: keccak256(built.calldata),
    nextAction: status === "verified" ? "swap" : status === "approval_required" ? "approval" : null,
    nextActionTarget: status === "verified" || status === "approval_required" ? nextTarget : null,
    nextActionCalldataHash: status === "verified" || status === "approval_required" ? keccak256(nextData) : null,
    transactionValueAtomic: nextValue.toString(),
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
    routerRuntimeHash,
    factoryRuntimeHash: poolManagerRuntimeHash,
    quoterRuntimeHash,
    exactSimulationPassed,
    userPaysGas: true,
    rmtFeeEnabled: false,
    settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
    directNoRmtFee: directNoRmtFeeSettlement(input.inputAmountAtomic),
    netEconomics: disabledVNextFeeEconomics({
      inputAmountAtomic: input.inputAmountAtomic,
      expectedOutputAtomic: amountOut.toString(),
      protectedOutputAtomic: protectedOutput.toString()
    }),
    feeExecution: null,
    verifiedAtMs: now,
    expiresAtMs: Number(deadline) * 1_000,
    authorizationReady: false,
    v4Execution: {
      poolId: canonical.poolId,
      poolKey: canonical.poolKey,
      poolManager: ROBINHOOD_V4_POOL_MANAGER,
      quoter: ROBINHOOD_V4_QUOTER,
      universalRouter: ROBINHOOD_UNIVERSAL_ROUTER,
      permit2: PERMIT2_ADDRESS,
      commands: expectedCommands,
      hookData: "0x",
      quoteObservedBlock: quoted.observedBlock,
      quoteObservedBlockHash: quoted.observedBlockHash,
      quoteObservedAtMs: quoted.observedAtMs,
      quotedAtMs: quoted.quotedAtMs,
      quoteExpiresAtMs: quoted.expiresAtMs,
      simulationBlock: freshBlock.number.toString(),
      simulationBlockHash: freshBlock.hash,
      routerRuntimeHash,
      poolManagerRuntimeHash,
      quoterRuntimeHash,
      permit2RuntimeHash,
      rmtFeeAtomic: "0",
      treasuryTransferAtomic: "0"
    } satisfies VNextUniswapV4ExecutionEvidence
  };
  return { evidence, payloads: { swapCalldata: built.calldata, nextData } };
}

export function verifyVNextUniswapV4Route(input: VNextProviderVerificationRequest, dependencies: VNextUniswapV4ExecutionDependencies = {}) {
  return evaluateVNextUniswapV4Route(input, dependencies).then((result) => result.evidence);
}

export async function prepareVNextUniswapV4Authorization(input: VNextProviderAuthorizationRequest, dependencies: VNextUniswapV4ExecutionDependencies = {}) {
  const evaluated = await evaluateVNextUniswapV4Route({
    ...input,
    deadlineSeconds: input.deadlineSeconds,
    protectedOutputFloorAtomic: input.protectedOutputFloorAtomic,
    nowMs: input.nowMs
  }, dependencies);
  const { evidence, payloads } = evaluated;
  invariant((evidence.status === "approval_required" || evidence.status === "verified") && evidence.gasLimitUnits && evidence.nextActionTarget, `exact next action is not ready (${evidence.status})`);
  return {
    evidence,
    transaction: {
      kind: evidence.status === "approval_required" ? "erc20_approval" as const : "swap" as const,
      target: evidence.nextActionTarget,
      data: evidence.status === "approval_required" ? payloads.nextData : payloads.swapCalldata,
      value: evidence.transactionValueAtomic,
      gasLimit: evidence.gasLimitUnits
    }
  };
}
