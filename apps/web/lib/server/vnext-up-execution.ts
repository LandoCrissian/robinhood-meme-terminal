import {
  createPublicClient,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import {
  assertUpSwapCalldata,
  UP_CL_EXECUTION_ROUTER,
  UP_CL_EXECUTION_ROUTER_RUNTIME_HASH,
  UP_V2_EXECUTION_ROUTER,
  upClExecutionAbi,
  upV2ExecutionAbi
} from "../vnext/up-authorization-codec";
import { quoteVNextUniswapDirect } from "./vnext-uniswap-quote";
import {
  quoteUpCl,
  quoteUpV2,
  UP_CL_FACTORY,
  UP_CL_FACTORY_RUNTIME_HASH,
  UP_CL_QUOTER_RUNTIME_HASH,
  UP_V2_FACTORY,
  UP_V2_FACTORY_RUNTIME_HASH,
  UP_V2_ROUTER_RUNTIME_HASH,
  type UpClRouteLeg,
  type UpObservedQuote,
  type UpV2RouteLeg
} from "./vnext-up-quote";

const BPS = 10_000n;
const SLIPPAGE_BPS = 100n;
const MAX_UINT256 = (1n << 256n) - 1n;
const WALLET_FEE_CEILING_MULTIPLIER = 3n;

const v2FactoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [
  { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "stable", type: "bool" }
], outputs: [{ name: "pool", type: "address" }] }, {
  type: "function", name: "isPool", stateMutability: "view", inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "recognized", type: "bool" }]
}, {
  type: "function", name: "getFee", stateMutability: "view", inputs: [{ name: "pool", type: "address" }, { name: "stable", type: "bool" }], outputs: [{ name: "fee", type: "uint256" }]
}] as const;
const clFactoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [
  { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "tickSpacing", type: "int24" }
], outputs: [{ name: "pool", type: "address" }] }, {
  type: "function", name: "isPool", stateMutability: "view", inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "recognized", type: "bool" }]
}] as const;
const clPoolAbi = [{ type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ name: "fee", type: "uint24" }] }] as const;

function rpcUrl() {
  return process.env.RMT_VNEXT_UP_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || robinhoodChain.rpcUrls.default.http[0];
}

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(rpcUrl(), { retryCount: 1, timeout: 8_000, batch: { batchSize: 32, wait: 0 } })
});

async function requireRuntime(address: Address, expected: Hex, blockNumber: bigint, label: string) {
  const code = await client.getBytecode({ address, blockNumber });
  if (!code || keccak256(code).toLowerCase() !== expected.toLowerCase()) throw new Error(`${label} runtime bytecode is not approved.`);
}

async function verifyExecutionDependencies(provider: "up-v2" | "up-cl", quote: UpObservedQuote) {
  const blockNumber = quote.snapshot.blockNumber;
  const router = provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER;
  const expectedRuntime = provider === "up-v2" ? UP_V2_ROUTER_RUNTIME_HASH : UP_CL_EXECUTION_ROUTER_RUNTIME_HASH;
  const factory = provider === "up-v2" ? UP_V2_FACTORY : UP_CL_FACTORY;
  const abi = provider === "up-v2" ? upV2ExecutionAbi : upClExecutionAbi;
  const [factoryDependency, wethDependency] = await Promise.all([
    client.readContract({ address: router, abi, functionName: provider === "up-v2" ? "defaultFactory" : "factory", blockNumber } as never),
    client.readContract({ address: router, abi, functionName: provider === "up-v2" ? "weth" : "WETH9", blockNumber } as never)
  ]) as [Address, Address];
  await Promise.all([
    requireRuntime(router, expectedRuntime, blockNumber, `${provider} execution router`),
    requireRuntime(factory, provider === "up-v2" ? UP_V2_FACTORY_RUNTIME_HASH : UP_CL_FACTORY_RUNTIME_HASH, blockNumber, `${provider} factory`)
  ]);
  if (getAddress(factoryDependency) !== factory || getAddress(wethDependency) !== ROBINHOOD_WETH_ADDRESS) {
    throw new Error(`${provider} execution router dependencies changed.`);
  }
  await Promise.all(quote.legs.map(async (leg) => {
    if (provider === "up-v2") {
      const candidate = leg as UpV2RouteLeg;
      const [pool, recognized, fee] = await Promise.all([
        client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "getPool", args: [candidate.from, candidate.to, candidate.stable], blockNumber }),
        client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "isPool", args: [candidate.pool], blockNumber }),
        client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "getFee", args: [candidate.pool, candidate.stable], blockNumber })
      ]);
      if (getAddress(pool) !== candidate.pool || !recognized || fee !== BigInt(candidate.fee)) throw new Error("up-v2 pool identity, stable flag, or live fee changed.");
    } else {
      const candidate = leg as UpClRouteLeg;
      const [pool, recognized, fee] = await Promise.all([
        client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "getPool", args: [candidate.from, candidate.to, candidate.tickSpacing], blockNumber }),
        client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "isPool", args: [candidate.pool], blockNumber }),
        client.readContract({ address: candidate.pool, abi: clPoolAbi, functionName: "fee", blockNumber })
      ]);
      if (getAddress(pool) !== candidate.pool || !recognized || fee !== candidate.fee) throw new Error("up-cl pool identity, tick spacing, or live fee changed.");
    }
  }));
  const block = await client.getBlock({ blockNumber });
  if (!block.hash || block.hash.toLowerCase() !== quote.snapshot.blockHash.toLowerCase()) throw new Error(`${provider} quote block was reorganized.`);
  return { router, expectedRuntime };
}

function buildSwap(provider: "up-v2" | "up-cl", quote: UpObservedQuote, input: {
  inputAsset: Address; outputAsset: Address; amountIn: bigint; recipient: Address; deadline: bigint; protectedOutput: bigint;
}) {
  const nativeInput = isRobinhoodNativeAsset(input.inputAsset);
  const nativeOutput = isRobinhoodNativeAsset(input.outputAsset);
  const transactionValue = nativeInput ? input.amountIn : 0n;
  if (provider === "up-v2") {
    const routes = (quote.legs as readonly UpV2RouteLeg[]).map((leg) => ({ from: leg.from, to: leg.to, stable: leg.stable, factory: UP_V2_FACTORY }));
    const data = nativeInput
      ? encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactETHForTokens", args: [input.protectedOutput, routes, input.recipient, input.deadline] })
      : nativeOutput
        ? encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForETH", args: [input.amountIn, input.protectedOutput, routes, input.recipient, input.deadline] })
        : encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [input.amountIn, input.protectedOutput, routes, input.recipient, input.deadline] });
    return { data, transactionValue };
  }
  const legs = quote.legs as readonly UpClRouteLeg[];
  const recipient = nativeOutput ? zeroAddress : input.recipient;
  const swap = legs.length === 1
    ? encodeFunctionData({ abi: upClExecutionAbi, functionName: "exactInputSingle", args: [{
        tokenIn: legs[0].from, tokenOut: legs[0].to, tickSpacing: legs[0].tickSpacing, recipient,
        deadline: input.deadline, amountIn: input.amountIn, amountOutMinimum: input.protectedOutput, sqrtPriceLimitX96: 0n
      }] })
    : encodeFunctionData({ abi: upClExecutionAbi, functionName: "exactInput", args: [{
        path: encodePacked(["address", "int24", "address", "int24", "address"], [legs[0].from, legs[0].tickSpacing, legs[0].to, legs[1].tickSpacing, legs[1].to]),
        recipient, deadline: input.deadline, amountIn: input.amountIn, amountOutMinimum: input.protectedOutput
      }] });
  const data = nativeOutput
    ? encodeFunctionData({ abi: upClExecutionAbi, functionName: "multicall", args: [[
        swap,
        encodeFunctionData({ abi: upClExecutionAbi, functionName: "unwrapWETH9", args: [input.protectedOutput, input.recipient] })
      ]] })
    : swap;
  return { data, transactionValue };
}

async function evaluateUpRoute(provider: "up-v2" | "up-cl", input: {
  inputAsset: Address; outputAsset: Address; amountIn: bigint; recipient: Address;
  deadlineSeconds?: bigint; protectedOutputFloorAtomic?: bigint; indicativeProtectedOutputFloorAtomic?: bigint; nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const currentSeconds = BigInt(Math.floor(nowMs / 1_000));
  const deadline = input.deadlineSeconds ?? currentSeconds + 300n;
  if (deadline <= currentSeconds + 30n || deadline > currentSeconds + 300n) throw new Error("The authorization deadline is stale or outside the supported window.");
  const requestedInput = getAddress(input.inputAsset);
  const requestedOutput = getAddress(input.outputAsset);
  const quote = provider === "up-v2" ? await quoteUpV2(input) : await quoteUpCl(input);
  if (!quote) throw new Error(`No ${provider} route is available for exact verification.`);
  const protectedFloor = input.protectedOutputFloorAtomic ?? 0n;
  if (protectedFloor > quote.amountOut) throw new Error("The live route moved below the indicative protected-output floor.");
  const protectedOutput = quote.protectedAmountOut > protectedFloor ? quote.protectedAmountOut : protectedFloor;
  const { router, expectedRuntime } = await verifyExecutionDependencies(provider, quote);
  const built = buildSwap(provider, quote, { inputAsset: requestedInput, outputAsset: requestedOutput, amountIn: input.amountIn, recipient: getAddress(input.recipient), deadline, protectedOutput });
  const routeEvidence = {
    provider, inputAsset: requestedInput, outputAsset: requestedOutput, inputAmountAtomic: input.amountIn.toString(),
    protectedOutputAtomic: protectedOutput.toString(), recipient: getAddress(input.recipient), deadline: deadline.toString(),
    transactionValueAtomic: built.transactionValue.toString(), route: quote.routeKind, pools: quote.legs.map((leg) => leg.pool),
    fees: quote.legs.map((leg) => leg.fee),
    stableFlags: provider === "up-v2" ? (quote.legs as readonly UpV2RouteLeg[]).map((leg) => leg.stable) : undefined,
    tickSpacings: provider === "up-cl" ? (quote.legs as readonly UpClRouteLeg[]).map((leg) => leg.tickSpacing) : undefined
  } as const;
  assertUpSwapCalldata(built.data, routeEvidence);
  const nativeInput = isRobinhoodNativeAsset(requestedInput);
  const routedInput = nativeInput ? ROBINHOOD_WETH_ADDRESS : requestedInput;
  const [tokenState, nativeBalance, gasPrice] = await Promise.all([
    nativeInput ? Promise.resolve({ balance: 0n, allowance: MAX_UINT256 }) : Promise.all([
      client.readContract({ address: routedInput, abi: erc20Abi, functionName: "balanceOf", args: [input.recipient] }),
      client.readContract({ address: routedInput, abi: erc20Abi, functionName: "allowance", args: [input.recipient, router] })
    ]).then(([balance, allowance]) => ({ balance, allowance })),
    client.getBalance({ address: input.recipient }),
    client.getGasPrice()
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const allowance = tokenState.allowance;
  const sufficientBalance = balance >= input.amountIn;
  const approvalRequired = !nativeInput && allowance < input.amountIn;
  let status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let exactSimulationPassed = false;
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionCalldataHash: Hex | null = null;
  let approvalCalldata: Hex | null = null;
  let estimatedGasUnits: bigint | null = null;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (!sufficientBalance) status = "insufficient_balance";
  else if (approvalRequired) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = routedInput;
    approvalCalldata = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, input.amountIn] });
    nextActionCalldataHash = keccak256(approvalCalldata);
    try {
      await client.call({ account: input.recipient, to: routedInput, data: approvalCalldata, value: 0n });
    } catch { status = "approval_simulation_failed"; }
    if (status === "approval_required") {
      try { estimatedGasUnits = await client.estimateGas({ account: input.recipient, to: routedInput, data: approvalCalldata, value: 0n }); }
      catch { status = "gas_unavailable"; gasState = "unavailable"; }
    }
  } else {
    try {
      await client.call({ account: input.recipient, to: router, data: built.data, value: built.transactionValue });
      exactSimulationPassed = true;
      status = "verified";
      nextAction = "swap";
      nextActionTarget = router;
      nextActionCalldataHash = keccak256(built.data);
      try { estimatedGasUnits = await client.estimateGas({ account: input.recipient, to: router, data: built.data, value: built.transactionValue }); }
      catch { status = "gas_unavailable"; gasState = "unavailable"; }
    } catch { status = "simulation_failed"; }
  }
  const feeCeilingWei = gasPrice * WALLET_FEE_CEILING_MULTIPLIER;
  let gasLimitUnits: bigint | null = null;
  let estimatedNetworkCostWei: bigint | null = null;
  let estimatedNetworkCostUsdgAtomic: bigint | null = null;
  let networkCostValuationSource: "canonical_uniswap_v3_weth_usdg_quote_plus_1pct" | null = null;
  let networkCostValuedAtMs: number | null = null;
  let networkCostValuationExpiresAtMs: number | null = null;
  if (estimatedGasUnits !== null) {
    gasLimitUnits = estimatedGasUnits * 120n / 100n;
    estimatedNetworkCostWei = gasLimitUnits * feeCeilingWei;
    gasState = nativeBalance >= built.transactionValue + estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
    try {
      const valuation = await quoteVNextUniswapDirect({ inputAsset: ROBINHOOD_WETH_ADDRESS, outputAsset: ROBINHOOD_USDG_ADDRESS, amountIn: estimatedNetworkCostWei });
      if (valuation) {
        estimatedNetworkCostUsdgAtomic = (valuation.quoteOut * (BPS + SLIPPAGE_BPS) + BPS - 1n) / BPS;
        networkCostValuationSource = "canonical_uniswap_v3_weth_usdg_quote_plus_1pct";
        networkCostValuedAtMs = nowMs;
        networkCostValuationExpiresAtMs = Math.min(Number(deadline) * 1_000, nowMs + 30_000);
      }
    } catch { /* advisory valuation only */ }
  }
  const evidence = {
    ...routeEvidence, status, chainId: 4_663 as const,
    indicativeProtectedOutputFloorAtomic: (input.indicativeProtectedOutputFloorAtomic ?? protectedFloor).toString(),
    expectedOutputAtomic: quote.amountOut.toString(), router, approvalSpender: router, approvalRequired, sufficientBalance,
    allowanceAtomic: allowance.toString(), balanceAtomic: balance.toString(), calldataHash: keccak256(built.data),
    nextAction, nextActionTarget, nextActionCalldataHash, nativeBalanceWei: nativeBalance.toString(), gasPriceWei: gasPrice.toString(),
    feeCeilingWei: feeCeilingWei.toString(), estimatedGasUnits: estimatedGasUnits?.toString() ?? null,
    gasLimitUnits: gasLimitUnits?.toString() ?? null, estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null,
    estimatedNetworkCostUsdgAtomic: estimatedNetworkCostUsdgAtomic?.toString() ?? null, networkCostValuationSource,
    networkCostValuedAtMs, networkCostValuationExpiresAtMs, gasState, routerRuntimeHash: expectedRuntime,
    factoryRuntimeHash: provider === "up-v2" ? UP_V2_FACTORY_RUNTIME_HASH : UP_CL_FACTORY_RUNTIME_HASH,
    quoterRuntimeHash: provider === "up-v2" ? UP_V2_ROUTER_RUNTIME_HASH : UP_CL_QUOTER_RUNTIME_HASH,
    quoteBlock: quote.snapshot.blockNumber.toString(), quoteBlockHash: quote.snapshot.blockHash,
    exactSimulationPassed, userPaysGas: true as const, rmtFeeEnabled: false as const,
    verifiedAtMs: nowMs, expiresAtMs: Number(deadline) * 1_000, authorizationReady: false as const
  };
  return { evidence, payloads: { swapCalldata: built.data, approvalCalldata } };
}

export async function verifyVNextUpRoute(provider: "up-v2" | "up-cl", input: Parameters<typeof evaluateUpRoute>[1]) {
  return (await evaluateUpRoute(provider, input)).evidence;
}

export async function prepareVNextUpAuthorization(provider: "up-v2" | "up-cl", input: Parameters<typeof evaluateUpRoute>[1]) {
  const evaluated = await evaluateUpRoute(provider, input);
  if (evaluated.evidence.status === "approval_required" && evaluated.payloads.approvalCalldata && evaluated.evidence.gasLimitUnits) return {
    evidence: evaluated.evidence,
    transaction: { kind: "erc20_approval" as const, target: evaluated.evidence.inputAsset, data: evaluated.payloads.approvalCalldata, value: "0", gasLimit: evaluated.evidence.gasLimitUnits }
  };
  if (evaluated.evidence.status === "verified" && evaluated.evidence.gasLimitUnits) return {
    evidence: evaluated.evidence,
    transaction: { kind: "swap" as const, target: evaluated.evidence.router, data: evaluated.payloads.swapCalldata, value: evaluated.evidence.transactionValueAtomic, gasLimit: evaluated.evidence.gasLimitUnits }
  };
  throw new Error(`The exact next action is not ready for wallet authorization (${evaluated.evidence.status}).`);
}
