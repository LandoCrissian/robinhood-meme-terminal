import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_V3_QUOTER,
  ROBINHOOD_WETH
} from "../uniswap-v4";
import { PRICE_IMPACT_BLOCK } from "../trade-ticket";
import { verifyExternalUniswapMarket } from "./external-uniswap-market";
import {
  calculateRmtExecutionFee,
  currentRmtExecutionFeeConfig,
  type RmtExecutionFeeConfig
} from "./rmt-execution-fee";

const MAX_UINT128 = (1n << 128n) - 1n;
const Q192 = 1n << 192n;
const SLIPPAGE_BPS = 100n;
const BPS = 10_000n;
const IMPACT_SCALE = 1_000_000n;

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
}] as const;

const routerAbi = [
  {
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
  },
  {
    type: "function",
    name: "unwrapWETH9",
    stateMutability: "payable",
    inputs: [{ name: "amountMinimum", type: "uint256" }, { name: "recipient", type: "address" }],
    outputs: []
  },
  {
    type: "function",
    name: "unwrapWETH9WithFee",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "feeBips", type: "uint256" },
      { name: "feeRecipient", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "sweepTokenWithFee",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "feeBips", type: "uint256" },
      { name: "feeRecipient", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }]
  }
] as const;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

export type ExternalUniswapTradeSide = "buy" | "sell";

export type ExternalUniswapQuote = {
  chainId: 4663;
  venue: "uniswap-v3";
  protocol: "UNISWAP";
  token: Address;
  recipient: Address;
  side: ExternalUniswapTradeSide;
  router: Address;
  calldata: Hex;
  value: string;
  amountIn: string;
  quoteOut: string;
  grossQuoteOut?: string;
  minimumOut: string;
  grossMinimumOut?: string;
  priceImpact: number;
  deadline: string;
  fee: number;
  marketPair: Address;
  marketVerified: true;
  executable: true;
  inputToken: { address: Address; symbol: string; name: string; decimals: number };
  outputToken: { address: Address; symbol: string; name: string; decimals: number };
  executionFee: {
    bps: number;
    treasury: Address;
    estimatedAmount: string;
  } | null;
};

function safeText(value: string, fallback: string) {
  const clean = value.trim().slice(0, 80);
  return clean || fallback;
}

export function calculateUniswapPriceImpact(params: {
  sqrtPriceX96: bigint;
  tokenInIsToken0: boolean;
  amountIn: bigint;
  quoteOut: bigint;
}) {
  if (params.sqrtPriceX96 <= 0n || params.amountIn <= 0n || params.quoteOut <= 0n) {
    throw new Error("Cannot calculate Uniswap price impact from invalid pool or quote values.");
  }
  const squaredPrice = params.sqrtPriceX96 * params.sqrtPriceX96;
  const executionToSpotNumerator = params.tokenInIsToken0
    ? params.quoteOut * Q192
    : params.quoteOut * squaredPrice;
  const executionToSpotDenominator = params.tokenInIsToken0
    ? params.amountIn * squaredPrice
    : params.amountIn * Q192;
  if (executionToSpotNumerator >= executionToSpotDenominator) return 0;
  const impact = (executionToSpotDenominator - executionToSpotNumerator) * IMPACT_SCALE
    / executionToSpotDenominator;
  return Number(impact) / Number(IMPACT_SCALE);
}

async function tokenMetadata(token: Address) {
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
  ]);
  if (decimals > 36) throw new Error("The token decimals are outside the supported range.");
  return {
    address: getAddress(token),
    symbol: safeText(symbol, "TOKEN"),
    name: safeText(name, "Token"),
    decimals
  };
}

export function buildExternalUniswapSwap(params: {
  token: Address;
  recipient: Address;
  side: ExternalUniswapTradeSide;
  fee: number;
  amountIn: bigint;
  quoteOut: bigint;
  deadline: bigint;
  executionFee?: RmtExecutionFeeConfig;
}) {
  const grossMinimumOut = params.quoteOut * (BPS - SLIPPAGE_BPS) / BPS;
  if (grossMinimumOut <= 0n) throw new Error("The Uniswap quote is too small to enforce a safe minimum received.");
  const feeConfig = params.executionFee?.enabled ? params.executionFee : undefined;
  const quoteAmounts = calculateRmtExecutionFee(params.quoteOut, feeConfig?.feeBps ?? 0);
  const minimumAmounts = calculateRmtExecutionFee(grossMinimumOut, feeConfig?.feeBps ?? 0);
  const minimumOut = minimumAmounts.netOutput;
  if (minimumOut <= 0n) throw new Error("The Uniswap quote is too small after the RMT execution fee.");
  const isBuy = params.side === "buy";
  const swap = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: isBuy ? ROBINHOOD_WETH : params.token,
      tokenOut: isBuy ? params.token : ROBINHOOD_WETH,
      fee: params.fee,
      recipient: feeConfig || !isBuy ? ROBINHOOD_SWAP_ROUTER_02 : params.recipient,
      amountIn: params.amountIn,
      amountOutMinimum: grossMinimumOut,
      sqrtPriceLimitX96: 0n
    }]
  });
  let feePayoutFunction = "unwrapWETH9WithFee" as "unwrapWETH9WithFee" | "sweepTokenWithFee";
  if (isBuy) feePayoutFunction = "sweepTokenWithFee";
  const feePayout = feeConfig
    ? encodeFunctionData({
        abi: routerAbi,
        functionName: feePayoutFunction,
        args: isBuy
          ? [params.token, grossMinimumOut, params.recipient, BigInt(feeConfig.feeBps), feeConfig.treasury!]
          : [grossMinimumOut, params.recipient, BigInt(feeConfig.feeBps), feeConfig.treasury!]
      })
    : undefined;
  const calls = feePayout
    ? [swap, feePayout]
    : isBuy
      ? [swap]
      : [
        swap,
        encodeFunctionData({
          abi: routerAbi,
          functionName: "unwrapWETH9",
          args: [grossMinimumOut, params.recipient]
        })
      ];
  const calldata = encodeFunctionData({
    abi: routerAbi,
    functionName: "multicall",
    args: [params.deadline, calls]
  });
  return {
    calldata,
    minimumOut,
    grossMinimumOut,
    netQuoteOut: quoteAmounts.netOutput,
    estimatedFee: quoteAmounts.fee,
    value: isBuy ? params.amountIn : 0n
  };
}

export async function quoteAndBuildExternalUniswapSwap(params: {
  token: Address;
  pair: Address;
  recipient: Address;
  side: ExternalUniswapTradeSide;
  amountIn: bigint;
  maxPriceImpact?: number;
}): Promise<ExternalUniswapQuote> {
  if (params.amountIn <= 0n || params.amountIn > MAX_UINT128) {
    throw new Error("Trade amount is outside the supported range.");
  }
  const market = await verifyExternalUniswapMarket({ token: params.token, pair: params.pair });
  const [routerCode, quoterCode, metadata] = await Promise.all([
    client.getBytecode({ address: ROBINHOOD_SWAP_ROUTER_02 }),
    client.getBytecode({ address: ROBINHOOD_V3_QUOTER }),
    tokenMetadata(params.token)
  ]);
  if (!routerCode || !quoterCode) throw new Error("The official Uniswap execution contracts are unavailable.");

  const isBuy = params.side === "buy";
  const quote = await client.simulateContract({
    account: params.recipient,
    address: ROBINHOOD_V3_QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      tokenIn: isBuy ? ROBINHOOD_WETH : params.token,
      tokenOut: isBuy ? params.token : ROBINHOOD_WETH,
      amountIn: params.amountIn,
      fee: market.fee,
      sqrtPriceLimitX96: 0n
    }]
  });
  const quoteOut = quote.result[0];
  if (quoteOut <= 0n || quoteOut > MAX_UINT128) throw new Error("The Uniswap pool returned an invalid quote.");
  const tokenIn = isBuy ? ROBINHOOD_WETH : params.token;
  const priceImpact = calculateUniswapPriceImpact({
    sqrtPriceX96: market.sqrtPriceX96,
    tokenInIsToken0: tokenIn.toLowerCase() === market.token0.toLowerCase(),
    amountIn: params.amountIn,
    quoteOut
  });
  const maxPriceImpact = params.maxPriceImpact ?? PRICE_IMPACT_BLOCK;
  if (!Number.isFinite(maxPriceImpact) || maxPriceImpact <= 0 || maxPriceImpact > 1) {
    throw new Error("The selected maximum price impact is invalid.");
  }
  if (priceImpact > maxPriceImpact) {
    throw new Error("Trade exceeds your selected maximum price impact.");
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const executionFee = currentRmtExecutionFeeConfig();
  const built = buildExternalUniswapSwap({
    token: params.token,
    recipient: params.recipient,
    side: params.side,
    fee: market.fee,
    amountIn: params.amountIn,
    quoteOut,
    deadline,
    executionFee
  });
  const native = {
    address: ROBINHOOD_WETH,
    symbol: "ETH",
    name: "Ether",
    decimals: 18
  };
  return {
    chainId: 4663,
    venue: "uniswap-v3",
    protocol: "UNISWAP",
    token: getAddress(params.token),
    recipient: getAddress(params.recipient),
    side: params.side,
    router: ROBINHOOD_SWAP_ROUTER_02,
    calldata: built.calldata,
    value: built.value.toString(),
    amountIn: params.amountIn.toString(),
    quoteOut: built.netQuoteOut.toString(),
    grossQuoteOut: quoteOut.toString(),
    minimumOut: built.minimumOut.toString(),
    grossMinimumOut: built.grossMinimumOut.toString(),
    priceImpact,
    deadline: deadline.toString(),
    fee: market.fee,
    marketPair: market.pair,
    marketVerified: true,
    executable: true,
    inputToken: isBuy ? native : metadata,
    outputToken: isBuy ? metadata : native,
    executionFee: executionFee.enabled && built.estimatedFee > 0n
      ? {
          bps: executionFee.feeBps,
          treasury: executionFee.treasury!,
          estimatedAmount: built.estimatedFee.toString()
        }
      : null
  };
}
