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
import { ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import { directNoRmtFeeSettlement, VNEXT_DIRECT_NO_RMT_FEE } from "../vnext/execution-settlement";
import {
  assertUniswapV2SwapCalldata,
  ROBINHOOD_UNISWAP_V2_FACTORY,
  ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_ROUTER,
  ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
  uniswapV2RouterAbi
} from "../vnext/uniswap-v2-authorization-codec";
import { quoteVNextUniswapDirect } from "./vnext-uniswap-quote";

const BPS = 10_000n;
const SLIPPAGE_BPS = 100n;
const MAX_UINT256 = (1n << 256n) - 1n;
const WALLET_FEE_CEILING_MULTIPLIER = 3n;

const factoryAbi = [{
  type: "function", name: "getPair", stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
  outputs: [{ name: "pair", type: "address" }]
}] as const;
const pairAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ name: "factory", type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "token0", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "token1", type: "address" }] }
] as const;

function rpcUrl() {
  return process.env.RMT_VNEXT_UNISWAP_V2_RPC_URL?.trim()
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
  if (!code || keccak256(code).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} runtime bytecode is not approved.`);
  }
}

function candidatePaths(inputAsset: Address, outputAsset: Address) {
  const routedInput = isRobinhoodNativeAsset(inputAsset) ? ROBINHOOD_WETH_ADDRESS : inputAsset;
  const routedOutput = isRobinhoodNativeAsset(outputAsset) ? ROBINHOOD_WETH_ADDRESS : outputAsset;
  if (routedInput === routedOutput) throw new Error("Input and output assets must differ.");
  const paths: Address[][] = [[routedInput, routedOutput]];
  if (routedInput !== ROBINHOOD_WETH_ADDRESS && routedOutput !== ROBINHOOD_WETH_ADDRESS) {
    paths.push([routedInput, ROBINHOOD_WETH_ADDRESS, routedOutput]);
  }
  return paths;
}

async function verifyPair(path: readonly Address[], blockNumber: bigint) {
  const pools: Address[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const pair = getAddress(await client.readContract({
      address: ROBINHOOD_UNISWAP_V2_FACTORY, abi: factoryAbi, functionName: "getPair",
      args: [path[index], path[index + 1]], blockNumber
    }));
    if (pair === zeroAddress) throw new Error("The canonical Uniswap V2 pair does not exist.");
    const [factory, token0, token1] = await Promise.all([
      client.readContract({ address: pair, abi: pairAbi, functionName: "factory", blockNumber }),
      client.readContract({ address: pair, abi: pairAbi, functionName: "token0", blockNumber }),
      client.readContract({ address: pair, abi: pairAbi, functionName: "token1", blockNumber }),
      requireRuntime(pair, ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH, blockNumber, "Uniswap V2 pair")
    ]);
    const expected = [getAddress(path[index]), getAddress(path[index + 1])].sort();
    const actual = [getAddress(token0), getAddress(token1)].sort();
    if (getAddress(factory) !== ROBINHOOD_UNISWAP_V2_FACTORY || actual[0] !== expected[0] || actual[1] !== expected[1]) {
      throw new Error("The Uniswap V2 pair identity changed.");
    }
    pools.push(pair);
  }
  return pools;
}

async function observeBestRoute(inputAsset: Address, outputAsset: Address, amountIn: bigint) {
  const block = await client.getBlock();
  if (!block.hash) throw new Error("The current Robinhood Chain block has no hash.");
  const candidates = await Promise.all(candidatePaths(inputAsset, outputAsset).map(async (path) => {
    try {
      const pools = await verifyPair(path, block.number);
      const amounts = await client.readContract({
        address: ROBINHOOD_UNISWAP_V2_ROUTER, abi: uniswapV2RouterAbi, functionName: "getAmountsOut",
        args: [amountIn, path], blockNumber: block.number
      });
      const amountOut = amounts.at(-1) ?? 0n;
      return amountOut > 0n ? { path, pools, amountOut } : null;
    } catch { return null; }
  }));
  const route = candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => left.amountOut === right.amountOut ? 0 : left.amountOut > right.amountOut ? -1 : 1)[0];
  if (!route) throw new Error("No canonical Uniswap V2 route is available.");
  return { ...route, blockNumber: block.number, blockHash: block.hash };
}

function buildSwap(input: {
  inputAsset: Address; outputAsset: Address; amountIn: bigint; protectedOutput: bigint;
  recipient: Address; deadline: bigint; path: readonly Address[];
}) {
  const nativeInput = isRobinhoodNativeAsset(input.inputAsset);
  const nativeOutput = isRobinhoodNativeAsset(input.outputAsset);
  const data = nativeInput
    ? encodeFunctionData({ abi: uniswapV2RouterAbi, functionName: "swapExactETHForTokens", args: [input.protectedOutput, [...input.path], input.recipient, input.deadline] })
    : nativeOutput
      ? encodeFunctionData({ abi: uniswapV2RouterAbi, functionName: "swapExactTokensForETH", args: [input.amountIn, input.protectedOutput, [...input.path], input.recipient, input.deadline] })
      : encodeFunctionData({ abi: uniswapV2RouterAbi, functionName: "swapExactTokensForTokens", args: [input.amountIn, input.protectedOutput, [...input.path], input.recipient, input.deadline] });
  return { data, transactionValue: nativeInput ? input.amountIn : 0n };
}

async function evaluateUniswapV2Route(input: {
  inputAsset: Address; outputAsset: Address; amountIn: bigint; recipient: Address;
  deadlineSeconds?: bigint; protectedOutputFloorAtomic?: bigint; indicativeProtectedOutputFloorAtomic?: bigint; nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const currentSeconds = BigInt(Math.floor(nowMs / 1_000));
  const deadline = input.deadlineSeconds ?? currentSeconds + 300n;
  if (deadline <= currentSeconds + 30n || deadline > currentSeconds + 300n) {
    throw new Error("The authorization deadline is stale or outside the supported window.");
  }
  const inputAsset = getAddress(input.inputAsset);
  const outputAsset = getAddress(input.outputAsset);
  const route = await observeBestRoute(inputAsset, outputAsset, input.amountIn);
  await Promise.all([
    requireRuntime(ROBINHOOD_UNISWAP_V2_ROUTER, ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH, route.blockNumber, "Uniswap V2 Router02"),
    requireRuntime(ROBINHOOD_UNISWAP_V2_FACTORY, ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH, route.blockNumber, "Uniswap V2 factory")
  ]);
  const [factory, weth, freshBlock] = await Promise.all([
    client.readContract({ address: ROBINHOOD_UNISWAP_V2_ROUTER, abi: uniswapV2RouterAbi, functionName: "factory", blockNumber: route.blockNumber }),
    client.readContract({ address: ROBINHOOD_UNISWAP_V2_ROUTER, abi: uniswapV2RouterAbi, functionName: "WETH", blockNumber: route.blockNumber }),
    client.getBlock({ blockNumber: route.blockNumber })
  ]);
  if (getAddress(factory) !== ROBINHOOD_UNISWAP_V2_FACTORY || getAddress(weth) !== ROBINHOOD_WETH_ADDRESS || freshBlock.hash !== route.blockHash) {
    throw new Error("Uniswap V2 execution dependencies or quote block changed.");
  }
  const floor = input.protectedOutputFloorAtomic ?? 0n;
  const protectedOutput = route.amountOut * (BPS - SLIPPAGE_BPS) / BPS;
  if (floor > route.amountOut) throw new Error("The live route moved below the indicative protected-output floor.");
  const finalProtectedOutput = protectedOutput > floor ? protectedOutput : floor;
  const built = buildSwap({ inputAsset, outputAsset, amountIn: input.amountIn, protectedOutput: finalProtectedOutput, recipient: getAddress(input.recipient), deadline, path: route.path });
  const routeKind = route.path.length === 2 ? "direct" : "weth_hop";
  assertUniswapV2SwapCalldata(built.data, {
    inputAsset, outputAsset, inputAmountAtomic: input.amountIn.toString(), protectedOutputAtomic: finalProtectedOutput.toString(),
    recipient: getAddress(input.recipient), deadline: deadline.toString(), transactionValueAtomic: built.transactionValue.toString(),
    route: routeKind, pools: route.pools
  });
  const nativeInput = isRobinhoodNativeAsset(inputAsset);
  const [tokenState, nativeBalance, gasPrice] = await Promise.all([
    nativeInput ? Promise.resolve({ balance: 0n, allowance: MAX_UINT256 }) : Promise.all([
      client.readContract({ address: inputAsset, abi: erc20Abi, functionName: "balanceOf", args: [input.recipient] }),
      client.readContract({ address: inputAsset, abi: erc20Abi, functionName: "allowance", args: [input.recipient, ROBINHOOD_UNISWAP_V2_ROUTER] })
    ]).then(([balance, allowance]) => ({ balance, allowance })),
    client.getBalance({ address: input.recipient }),
    client.getGasPrice()
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const approvalRequired = !nativeInput && tokenState.allowance < input.amountIn;
  let status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionCalldataHash: Hex | null = null;
  let approvalCalldata: Hex | null = null;
  let estimatedGasUnits: bigint | null = null;
  let exactSimulationPassed = false;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (balance < input.amountIn) status = "insufficient_balance";
  else if (approvalRequired) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = inputAsset;
    approvalCalldata = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROBINHOOD_UNISWAP_V2_ROUTER, input.amountIn] });
    nextActionCalldataHash = keccak256(approvalCalldata);
    try {
      await client.call({ account: input.recipient, to: inputAsset, data: approvalCalldata, value: 0n });
      estimatedGasUnits = await client.estimateGas({ account: input.recipient, to: inputAsset, data: approvalCalldata, value: 0n });
    } catch { status = "approval_simulation_failed"; }
  } else {
    try {
      await client.call({ account: input.recipient, to: ROBINHOOD_UNISWAP_V2_ROUTER, data: built.data, value: built.transactionValue });
      exactSimulationPassed = true;
      nextAction = "swap";
      nextActionTarget = ROBINHOOD_UNISWAP_V2_ROUTER;
      nextActionCalldataHash = keccak256(built.data);
      estimatedGasUnits = await client.estimateGas({ account: input.recipient, to: ROBINHOOD_UNISWAP_V2_ROUTER, data: built.data, value: built.transactionValue });
      status = "verified";
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
    provider: "uniswap-v2" as const, status, chainId: 4_663 as const, inputAsset, outputAsset,
    inputAmountAtomic: input.amountIn.toString(), indicativeProtectedOutputFloorAtomic: (input.indicativeProtectedOutputFloorAtomic ?? floor).toString(),
    expectedOutputAtomic: route.amountOut.toString(), protectedOutputAtomic: finalProtectedOutput.toString(), recipient: getAddress(input.recipient),
    router: ROBINHOOD_UNISWAP_V2_ROUTER, approvalSpender: ROBINHOOD_UNISWAP_V2_ROUTER, approvalRequired,
    sufficientBalance: balance >= input.amountIn, allowanceAtomic: tokenState.allowance.toString(), balanceAtomic: balance.toString(),
    deadline: deadline.toString(), calldataHash: keccak256(built.data), nextAction, nextActionTarget, nextActionCalldataHash,
    transactionValueAtomic: built.transactionValue.toString(), route: routeKind, pools: route.pools, fees: route.pools.map(() => 30),
    nativeBalanceWei: nativeBalance.toString(), gasPriceWei: gasPrice.toString(), feeCeilingWei: feeCeilingWei.toString(),
    estimatedGasUnits: estimatedGasUnits?.toString() ?? null, gasLimitUnits: gasLimitUnits?.toString() ?? null,
    estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null, estimatedNetworkCostUsdgAtomic: estimatedNetworkCostUsdgAtomic?.toString() ?? null,
    networkCostValuationSource, networkCostValuedAtMs, networkCostValuationExpiresAtMs, gasState,
    routerRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH, factoryRuntimeHash: ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
    quoterRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
    quoteBlock: route.blockNumber.toString(), quoteBlockHash: route.blockHash, exactSimulationPassed, userPaysGas: true as const,
    rmtFeeEnabled: false as const, settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
    directNoRmtFee: directNoRmtFeeSettlement(input.amountIn.toString()), verifiedAtMs: nowMs, expiresAtMs: Number(deadline) * 1_000,
    authorizationReady: false as const
  };
  return { evidence, payloads: { swapCalldata: built.data, approvalCalldata } };
}

export async function quoteVNextUniswapV2(input: Parameters<typeof evaluateUniswapV2Route>[0]) {
  const route = await observeBestRoute(getAddress(input.inputAsset), getAddress(input.outputAsset), input.amountIn);
  return {
    expectedOutputAtomic: route.amountOut.toString(),
    protectedOutputAtomic: (route.amountOut * (BPS - SLIPPAGE_BPS) / BPS).toString(),
    route: route.path.length === 2 ? "direct" as const : "weth_hop" as const,
    pools: route.pools,
    quoteBlock: route.blockNumber.toString(),
    quoteBlockHash: route.blockHash
  };
}

export async function verifyVNextUniswapV2(input: Parameters<typeof evaluateUniswapV2Route>[0]) {
  return (await evaluateUniswapV2Route(input)).evidence;
}

export async function prepareVNextUniswapV2Authorization(input: Parameters<typeof evaluateUniswapV2Route>[0]) {
  const evaluated = await evaluateUniswapV2Route(input);
  if (evaluated.evidence.status === "approval_required" && evaluated.payloads.approvalCalldata && evaluated.evidence.gasLimitUnits) return {
    evidence: evaluated.evidence,
    transaction: { kind: "erc20_approval" as const, target: evaluated.evidence.inputAsset, data: evaluated.payloads.approvalCalldata, value: "0", gasLimit: evaluated.evidence.gasLimitUnits }
  };
  if (evaluated.evidence.status === "verified" && evaluated.evidence.gasLimitUnits) return {
    evidence: evaluated.evidence,
    transaction: { kind: "swap" as const, target: ROBINHOOD_UNISWAP_V2_ROUTER, data: evaluated.payloads.swapCalldata, value: evaluated.evidence.transactionValueAtomic, gasLimit: evaluated.evidence.gasLimitUnits }
  };
  throw new Error(`The exact next action is not ready for wallet authorization (${evaluated.evidence.status}).`);
}
