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
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_V3_FACTORY, ROBINHOOD_V3_QUOTER, ROBINHOOD_WETH } from "../uniswap-v4";

const FEES = [100, 500, 3_000, 10_000] as const;
const BPS = 10_000n;
const SLIPPAGE_BPS = 100n;
const ROUTER_RUNTIME_HASH = "0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc";
const FACTORY_RUNTIME_HASH = "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739";
const QUOTER_RUNTIME_HASH = "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28";
const factoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }],
  outputs: [{ name: "pool", type: "address" }]
}] as const;
const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "fee", type: "uint24" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" },
    { name: "gasEstimate", type: "uint256" }
  ]
}, {
  type: "function",
  name: "quoteExactInput",
  stateMutability: "nonpayable",
  inputs: [{ name: "path", type: "bytes" }, { name: "amountIn", type: "uint256" }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96AfterList", type: "uint160[]" },
    { name: "initializedTicksCrossedList", type: "uint32[]" },
    { name: "gasEstimate", type: "uint256" }
  ]
}] as const;
const routerAbi = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function",
  name: "exactInput",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "path", type: "bytes" },
    { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function",
  name: "multicall",
  stateMutability: "payable",
  inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
  outputs: [{ name: "results", type: "bytes[]" }]
}] as const;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } }
  )
});

async function requireRuntimeHash(address: Address, expectedHash: Hex, label: string) {
  const code = await client.getBytecode({ address });
  if (!code || keccak256(code) !== expectedHash) throw new Error(`${label} runtime bytecode is not approved.`);
  return expectedHash;
}

export async function quoteVNextUniswapDirect(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
}) {
  if (input.amountIn <= 0n) throw new Error("Trade amount must be positive.");
  const inputAsset = getAddress(input.inputAsset);
  const outputAsset = getAddress(input.outputAsset);
  if (inputAsset === outputAsset) throw new Error("Input and output assets must differ.");
  await Promise.all([
    requireRuntimeHash(ROBINHOOD_V3_FACTORY, FACTORY_RUNTIME_HASH, "Uniswap factory"),
    requireRuntimeHash(ROBINHOOD_V3_QUOTER, QUOTER_RUNTIME_HASH, "Uniswap quoter")
  ]);

  const poolsForPair = async (tokenA: Address, tokenB: Address) => {
    const pools = await Promise.all(FEES.map(async (fee) => ({
      fee,
      pool: await client.readContract({
        address: ROBINHOOD_V3_FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [tokenA, tokenB, fee]
      })
    })));
    const verified = await Promise.all(pools
      .filter((candidate) => candidate.pool !== zeroAddress)
      .map(async (candidate) => ({ ...candidate, code: await client.getBytecode({ address: candidate.pool }) })));
    return verified.filter((candidate) => Boolean(candidate.code));
  };

  type QuoteResult = { route: "direct" | "weth_hop"; fees: number[]; pools: Address[]; quoteOut: bigint; gasEstimate: bigint };
  const results: PromiseSettledResult<QuoteResult>[] = [];
  const directPools = await poolsForPair(inputAsset, outputAsset);
  results.push(...await Promise.allSettled(directPools.map(async (candidate): Promise<QuoteResult> => {
    const quote = await client.simulateContract({
        address: ROBINHOOD_V3_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: inputAsset, tokenOut: outputAsset, amountIn: input.amountIn, fee: candidate.fee, sqrtPriceLimitX96: 0n }]
      });
    if (quote.result[0] <= 0n) throw new Error("Uniswap pool quote is unavailable.");
    return { route: "direct", fees: [candidate.fee], pools: [getAddress(candidate.pool)], quoteOut: quote.result[0], gasEstimate: quote.result[3] };
  })));

  if (inputAsset !== ROBINHOOD_WETH && outputAsset !== ROBINHOOD_WETH) {
    const [firstHop, secondHop] = await Promise.all([
      poolsForPair(inputAsset, ROBINHOOD_WETH),
      poolsForPair(ROBINHOOD_WETH, outputAsset)
    ]);
    const paths = firstHop.flatMap((first) => secondHop.map((second) => ({ first, second })));
    results.push(...await Promise.allSettled(paths.map(async ({ first, second }): Promise<QuoteResult> => {
      const path = encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [inputAsset, first.fee, ROBINHOOD_WETH, second.fee, outputAsset]
      );
      const quote = await client.simulateContract({
        address: ROBINHOOD_V3_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInput",
        args: [path, input.amountIn]
      });
      if (quote.result[0] <= 0n) throw new Error("Uniswap multihop quote is unavailable.");
      return {
        route: "weth_hop",
        fees: [first.fee, second.fee],
        pools: [getAddress(first.pool), getAddress(second.pool)],
        quoteOut: quote.result[0],
        gasEstimate: quote.result[3]
      };
    })));
  }

  const valid = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (valid.length === 0) return null;
  const best = valid.sort((left, right) => left.quoteOut === right.quoteOut ? left.gasEstimate < right.gasEstimate ? -1 : 1 : left.quoteOut > right.quoteOut ? -1 : 1)[0];
  return {
    ...best,
    inputAsset,
    outputAsset,
    amountIn: input.amountIn,
    minimumOut: best.quoteOut * (BPS - SLIPPAGE_BPS) / BPS
  };
}

async function evaluateVNextUniswapRoute(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  nowMs?: number;
  deadlineSeconds?: bigint;
}) {
  const recipient = getAddress(input.recipient);
  const nowMs = input.nowMs ?? Date.now();
  const [quote, routerRuntimeHash] = await Promise.all([
    quoteVNextUniswapDirect(input),
    requireRuntimeHash(ROBINHOOD_SWAP_ROUTER_02, ROUTER_RUNTIME_HASH, "Uniswap router")
  ]);
  if (!quote) throw new Error("No canonical Uniswap V3 route is available for exact verification.");
  const currentSeconds = BigInt(Math.floor(nowMs / 1_000));
  const deadline = input.deadlineSeconds ?? currentSeconds + 300n;
  if (deadline <= currentSeconds + 30n || deadline > currentSeconds + 300n) {
    throw new Error("The authorization deadline is stale or outside the supported window.");
  }
  const path = quote.route === "direct"
    ? null
    : encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [quote.inputAsset, quote.fees[0], ROBINHOOD_WETH, quote.fees[1], quote.outputAsset]
      );
  const swap = quote.route === "direct"
    ? encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: quote.inputAsset,
          tokenOut: quote.outputAsset,
          fee: quote.fees[0],
          recipient,
          amountIn: quote.amountIn,
          amountOutMinimum: quote.minimumOut,
          sqrtPriceLimitX96: 0n
        }]
      })
    : encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInput",
        args: [{ path: path!, recipient, amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut }]
      });
  const calldata = encodeFunctionData({
    abi: routerAbi,
    functionName: "multicall",
    args: [deadline, [swap]]
  });
  const [balance, allowance, nativeBalance, gasPrice] = await Promise.all([
    client.readContract({ address: quote.inputAsset, abi: erc20Abi, functionName: "balanceOf", args: [recipient] }),
    client.readContract({ address: quote.inputAsset, abi: erc20Abi, functionName: "allowance", args: [recipient, ROBINHOOD_SWAP_ROUTER_02] }),
    client.getBalance({ address: recipient }),
    client.getGasPrice()
  ]);
  const sufficientBalance = balance >= quote.amountIn;
  const approvalRequired = allowance < quote.amountIn;
  let simulationPassed = false;
  let status: "verified" | "approval_required" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionCalldataHash: Hex | null = null;
  let approvalCalldata: Hex | null = null;
  let estimatedGasUnits: bigint | null = null;
  let gasLimitUnits: bigint | null = null;
  let estimatedNetworkCostWei: bigint | null = null;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (!sufficientBalance) {
    status = "insufficient_balance";
  } else if (approvalRequired) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = quote.inputAsset;
    approvalCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ROBINHOOD_SWAP_ROUTER_02, quote.amountIn]
    });
    nextActionCalldataHash = keccak256(approvalCalldata);
    try {
      estimatedGasUnits = await client.estimateGas({ account: recipient, to: quote.inputAsset, data: approvalCalldata, value: 0n });
    } catch {
      gasState = "unavailable";
      status = "gas_unavailable";
    }
  } else {
    try {
      await client.call({ account: recipient, to: ROBINHOOD_SWAP_ROUTER_02, data: calldata, value: 0n });
      simulationPassed = true;
      status = "verified";
      nextAction = "swap";
      nextActionTarget = ROBINHOOD_SWAP_ROUTER_02;
      nextActionCalldataHash = keccak256(calldata);
      try {
        estimatedGasUnits = await client.estimateGas({ account: recipient, to: ROBINHOOD_SWAP_ROUTER_02, data: calldata, value: 0n });
      } catch {
        gasState = "unavailable";
        status = "gas_unavailable";
      }
    } catch {
      status = "simulation_failed";
    }
  }
  if (estimatedGasUnits !== null) {
    gasLimitUnits = estimatedGasUnits * 120n / 100n;
    estimatedNetworkCostWei = gasLimitUnits * gasPrice;
    gasState = nativeBalance >= estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
  }
  return { evidence: {
    provider: "uniswap-v3" as const,
    status,
    chainId: 4_663 as const,
    inputAsset: quote.inputAsset,
    outputAsset: quote.outputAsset,
    inputAmountAtomic: quote.amountIn.toString(),
    expectedOutputAtomic: quote.quoteOut.toString(),
    protectedOutputAtomic: quote.minimumOut.toString(),
    recipient,
    router: ROBINHOOD_SWAP_ROUTER_02,
    approvalSpender: ROBINHOOD_SWAP_ROUTER_02,
    approvalRequired,
    sufficientBalance,
    allowanceAtomic: allowance.toString(),
    balanceAtomic: balance.toString(),
    route: quote.route,
    fees: quote.fees,
    pools: quote.pools,
    deadline: deadline.toString(),
    calldataHash: keccak256(calldata),
    nextAction,
    nextActionTarget,
    nextActionCalldataHash,
    nativeBalanceWei: nativeBalance.toString(),
    gasPriceWei: gasPrice.toString(),
    estimatedGasUnits: estimatedGasUnits?.toString() ?? null,
    gasLimitUnits: gasLimitUnits?.toString() ?? null,
    estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null,
    gasState,
    routerRuntimeHash,
    factoryRuntimeHash: FACTORY_RUNTIME_HASH,
    quoterRuntimeHash: QUOTER_RUNTIME_HASH,
    exactSimulationPassed: simulationPassed,
    userPaysGas: true,
    rmtFeeEnabled: false,
    verifiedAtMs: nowMs,
    expiresAtMs: Number(deadline) * 1_000,
    authorizationReady: false as const
  }, payloads: { swapCalldata: calldata, approvalCalldata } };
}

export async function verifyVNextUniswapRoute(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  nowMs?: number;
}) {
  return (await evaluateVNextUniswapRoute(input)).evidence;
}

export async function prepareVNextUniswapAuthorization(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  deadlineSeconds: bigint;
  nowMs?: number;
}) {
  const evaluated = await evaluateVNextUniswapRoute(input);
  const { evidence, payloads } = evaluated;
  if (evidence.status === "approval_required" && payloads.approvalCalldata && evidence.gasLimitUnits) {
    return {
      evidence,
      transaction: {
        kind: "erc20_approval" as const,
        target: evidence.inputAsset,
        data: payloads.approvalCalldata,
        value: "0" as const,
        gasLimit: evidence.gasLimitUnits
      }
    };
  }
  if (evidence.status === "verified" && evidence.gasLimitUnits) {
    return {
      evidence,
      transaction: {
        kind: "swap" as const,
        target: evidence.router,
        data: payloads.swapCalldata,
        value: "0" as const,
        gasLimit: evidence.gasLimitUnits
      }
    };
  }
  throw new Error("The exact next action is not ready for wallet authorization.");
}
