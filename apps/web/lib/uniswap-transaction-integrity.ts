import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import {
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_WETH,
  ROUTER_AS_RECIPIENT
} from "./uniswap-v4";

const V4_SWAP_ACTIONS = "0x060b0e";
const MAX_QUOTE_LIFETIME_SECONDS = 15 * 60;
const SENDER_AS_RECIPIENT = "0x0000000000000000000000000000000000000001";

const v3RouterAbi = [
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

const v4SwapInputParameters = [{ type: "bytes" }, { type: "bytes[]" }] as const;
const v4ExactInputParameters = [{
  type: "tuple",
  components: [
    { name: "poolKey", type: "tuple", components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" }
    ] },
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
    { name: "minHopPriceX36", type: "uint256" },
    { name: "hookData", type: "bytes" }
  ]
}] as const;
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
const settleParameters = [{ type: "address" }, { type: "uint256" }, { type: "bool" }] as const;
const takeParameters = [{ type: "address" }, { type: "address" }, { type: "uint256" }] as const;
const permit2TransferParameters = [{ type: "address" }, { type: "address" }, { type: "uint160" }] as const;

type PreparedUniswapQuote = {
  venue: "uniswap-v3" | "uniswap-v4";
  token: Address;
  recipient: Address;
  side: "buy" | "sell";
  marketPair: string;
  router: Address;
  calldata: Hex;
  value: string;
  amountIn: string;
  quoteOut: string;
  grossQuoteOut?: string;
  minimumOut: string;
  grossMinimumOut?: string;
  deadline: string;
  fee: number;
  inputToken: { address: Address; decimals: number };
  outputToken: { address: Address; decimals: number };
  passport?: { hook: Address };
  executionFee?: {
    bps: number;
    treasury: Address;
    estimatedAmount: string;
  } | null;
};

type UniswapV4PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export function uniswapV4PoolId(poolKey: UniswapV4PoolKey) {
  return keccak256(encodeAbiParameters(poolKeyParameters, [poolKey]));
}

function fail(reason: string): never {
  throw new Error(`RMT rejected unsafe Uniswap transaction data: ${reason}.`);
}

function uint(value: string, label: string) {
  if (!/^\d+$/.test(value)) fail(`${label} is malformed`);
  return BigInt(value);
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function requireAddress(actual: string, expected: string, label: string) {
  if (!sameAddress(actual, expected)) fail(`${label} changed`);
}

function requireValue(condition: boolean, reason: string): asserts condition {
  if (!condition) fail(reason);
}

function verifyEnvelope(
  quote: PreparedUniswapQuote,
  expected: {
    token: Address;
    recipient: Address;
    side: "buy" | "sell";
    amountIn: bigint;
    nowSeconds: number;
  }
) {
  const amountIn = uint(quote.amountIn, "input amount");
  const quoteOut = uint(quote.quoteOut, "quoted output");
  const minimumOut = uint(quote.minimumOut, "minimum output");
  const executionFee = quote.executionFee ?? null;
  const grossQuoteOut = quote.grossQuoteOut ? uint(quote.grossQuoteOut, "gross quoted output") : quoteOut;
  const grossMinimumOut = quote.grossMinimumOut ? uint(quote.grossMinimumOut, "gross minimum output") : minimumOut;
  const value = uint(quote.value, "native value");
  const deadline = uint(quote.deadline, "deadline");
  requireAddress(quote.token, expected.token, "token");
  requireAddress(quote.recipient, expected.recipient, "recipient");
  requireValue(quote.side === expected.side, "trade side changed");
  requireValue(amountIn === expected.amountIn && amountIn > 0n, "input amount changed");
  requireValue(quoteOut > 0n, "quoted output is zero");
  requireValue(minimumOut > 0n && minimumOut <= quoteOut, "minimum output is invalid");
  requireValue(grossQuoteOut >= quoteOut && grossMinimumOut >= minimumOut, "gross output is invalid");
  if (executionFee) {
    requireValue(Number.isSafeInteger(executionFee.bps) && executionFee.bps > 0 && executionFee.bps <= 100, "RMT fee rate is invalid");
    requireValue(
      !sameAddress(executionFee.treasury, zeroAddress)
      && !sameAddress(executionFee.treasury, SENDER_AS_RECIPIENT)
      && !sameAddress(executionFee.treasury, ROUTER_AS_RECIPIENT),
      "RMT fee treasury is invalid"
    );
    const quoteFee = grossQuoteOut * BigInt(executionFee.bps) / 10_000n;
    const minimumFee = grossMinimumOut * BigInt(executionFee.bps) / 10_000n;
    requireValue(uint(executionFee.estimatedAmount, "RMT fee estimate") === quoteFee, "RMT fee estimate changed");
    requireValue(quoteOut === grossQuoteOut - quoteFee, "net quoted output changed");
    requireValue(minimumOut === grossMinimumOut - minimumFee, "net minimum output changed");
  } else {
    requireValue(grossQuoteOut === quoteOut && grossMinimumOut === minimumOut, "undisclosed RMT fee detected");
  }
  requireValue(Number.isInteger(quote.fee) && quote.fee >= 0 && quote.fee < 1_000_000, "pool fee is invalid");
  requireValue(
    Number.isInteger(quote.inputToken.decimals)
      && quote.inputToken.decimals >= 0
      && quote.inputToken.decimals <= 36
      && Number.isInteger(quote.outputToken.decimals)
      && quote.outputToken.decimals >= 0
      && quote.outputToken.decimals <= 36,
    "token decimals are invalid"
  );
  const now = BigInt(expected.nowSeconds);
  requireValue(deadline > now + 30n, "deadline is stale");
  requireValue(deadline <= now + BigInt(MAX_QUOTE_LIFETIME_SECONDS), "deadline is too far in the future");
  requireValue(value === (expected.side === "buy" ? amountIn : 0n), "native value changed");
  return { amountIn, minimumOut, grossMinimumOut, deadline, executionFee };
}

function verifyV3(
  quote: PreparedUniswapQuote,
  expected: { token: Address; recipient: Address; side: "buy" | "sell"; amountIn: bigint; nowSeconds: number }
) {
  const envelope = verifyEnvelope(quote, expected);
  requireValue(quote.fee > 0, "v3 pool fee is invalid");
  requireAddress(quote.router, ROBINHOOD_SWAP_ROUTER_02, "router");
  requireAddress(quote.inputToken.address, expected.side === "buy" ? ROBINHOOD_WETH : expected.token, "input token");
  requireAddress(quote.outputToken.address, expected.side === "buy" ? expected.token : ROBINHOOD_WETH, "output token");
  const outer = decodeFunctionData({ abi: v3RouterAbi, data: quote.calldata });
  requireValue(outer.functionName === "multicall", "router function changed");
  const [deadline, calls] = outer.args;
  requireValue(deadline === envelope.deadline, "calldata deadline changed");
  requireValue(calls.length === (expected.side === "buy" && !envelope.executionFee ? 1 : 2), "unexpected router calls were added");
  const decodedSwap = decodeFunctionData({ abi: v3RouterAbi, data: calls[0] });
  requireValue(decodedSwap.functionName === "exactInputSingle", "swap function changed");
  const swap = decodedSwap.args[0];
  requireAddress(swap.tokenIn, expected.side === "buy" ? ROBINHOOD_WETH : expected.token, "swap input token");
  requireAddress(swap.tokenOut, expected.side === "buy" ? expected.token : ROBINHOOD_WETH, "swap output token");
  requireAddress(swap.recipient, expected.side === "buy" && !envelope.executionFee ? expected.recipient : ROBINHOOD_SWAP_ROUTER_02, "swap recipient");
  requireValue(swap.amountIn === envelope.amountIn, "swap amount changed");
  requireValue(swap.amountOutMinimum === envelope.grossMinimumOut, "protected minimum changed");
  requireValue(swap.fee === quote.fee, "pool fee changed");
  requireValue(swap.sqrtPriceLimitX96 === 0n, "unexpected price-limit behavior");
  if (envelope.executionFee) {
    const payout = decodeFunctionData({ abi: v3RouterAbi, data: calls[1] });
    if (expected.side === "buy") {
      requireValue(payout.functionName === "sweepTokenWithFee", "buy fee payout function changed");
      requireAddress(payout.args[0], expected.token, "buy fee output token");
      requireValue(payout.args[1] === envelope.grossMinimumOut, "buy fee payout minimum changed");
      requireAddress(payout.args[2], expected.recipient, "buy payout recipient");
      requireValue(payout.args[3] === BigInt(envelope.executionFee.bps), "buy fee rate changed");
      requireAddress(payout.args[4], envelope.executionFee.treasury, "buy fee treasury");
    } else {
      requireValue(payout.functionName === "unwrapWETH9WithFee", "sell fee payout function changed");
      requireValue(payout.args[0] === envelope.grossMinimumOut, "sell fee payout minimum changed");
      requireAddress(payout.args[1], expected.recipient, "sell payout recipient");
      requireValue(payout.args[2] === BigInt(envelope.executionFee.bps), "sell fee rate changed");
      requireAddress(payout.args[3], envelope.executionFee.treasury, "sell fee treasury");
    }
  } else if (expected.side === "sell") {
    const unwrap = decodeFunctionData({ abi: v3RouterAbi, data: calls[1] });
    requireValue(unwrap.functionName === "unwrapWETH9", "sell payout function changed");
    requireValue(unwrap.args[0] === envelope.minimumOut, "sell payout minimum changed");
    requireAddress(unwrap.args[1], expected.recipient, "sell payout recipient");
  }
}

function verifyV4(
  quote: PreparedUniswapQuote,
  expected: { token: Address; recipient: Address; side: "buy" | "sell"; amountIn: bigint; nowSeconds: number }
) {
  const envelope = verifyEnvelope(quote, expected);
  requireAddress(quote.router, ROBINHOOD_UNIVERSAL_ROUTER, "router");
  requireAddress(quote.inputToken.address, expected.side === "buy" ? zeroAddress : expected.token, "input token");
  requireAddress(quote.outputToken.address, expected.side === "buy" ? expected.token : zeroAddress, "output token");
  const outer = decodeFunctionData({ abi: universalRouterAbi, data: quote.calldata });
  requireValue(outer.functionName === "execute", "router function changed");
  const [commands, inputs, deadline] = outer.args;
  const isBuy = expected.side === "buy";
  const feeEnabled = Boolean(envelope.executionFee);
  requireValue(commands === (feeEnabled
    ? isBuy ? "0x10060404" : "0x0210060404"
    : isBuy ? "0x100404" : "0x02100404"), "router command sequence changed");
  requireValue(inputs.length === (isBuy ? feeEnabled ? 4 : 3 : feeEnabled ? 5 : 4), "unexpected router inputs were added");
  requireValue(deadline === envelope.deadline, "calldata deadline changed");
  const v4Offset = isBuy ? 0 : 1;
  if (!isBuy) {
    const [token, recipient, amount] = decodeAbiParameters(permit2TransferParameters, inputs[0]);
    requireAddress(token, expected.token, "Permit2 token");
    requireAddress(recipient, ROUTER_AS_RECIPIENT, "Permit2 recipient");
    requireValue(amount === envelope.amountIn, "Permit2 amount changed");
  }
  const [actions, actionInputs] = decodeAbiParameters(v4SwapInputParameters, inputs[v4Offset]);
  requireValue(actions === V4_SWAP_ACTIONS && actionInputs.length === 3, "v4 action sequence changed");
  const [swap] = decodeAbiParameters(v4ExactInputParameters, actionInputs[0]);
  const currencies = [swap.poolKey.currency0.toLowerCase(), swap.poolKey.currency1.toLowerCase()];
  requireValue(currencies.includes(zeroAddress.toLowerCase()) && currencies.includes(expected.token.toLowerCase()), "v4 pool currencies changed");
  requireValue(/^0x[0-9a-fA-F]{64}$/.test(quote.marketPair), "v4 pool id is malformed");
  requireValue(uniswapV4PoolId(swap.poolKey).toLowerCase() === quote.marketPair.toLowerCase(), "v4 pool key changed");
  requireValue(swap.poolKey.fee === quote.fee, "v4 pool fee changed");
  requireValue(Boolean(quote.passport?.hook), "v4 passport hook is missing");
  requireAddress(swap.poolKey.hooks, quote.passport!.hook, "v4 hook");
  const inputCurrency = isBuy ? zeroAddress : expected.token;
  requireValue(
    swap.zeroForOne === sameAddress(swap.poolKey.currency0, inputCurrency),
    "v4 swap direction changed"
  );
  requireValue(swap.amountIn === envelope.amountIn, "v4 swap amount changed");
  requireValue(swap.amountOutMinimum === envelope.grossMinimumOut, "v4 protected minimum changed");
  requireValue(swap.minHopPriceX36 === 0n && swap.hookData === "0x", "unexpected v4 hook or hop data");
  const [settleCurrency, settleAmount, settlePayer] = decodeAbiParameters(settleParameters, actionInputs[1]);
  requireAddress(settleCurrency, inputCurrency, "v4 settlement currency");
  requireValue(settleAmount === envelope.amountIn && settlePayer === false, "v4 settlement changed");
  const outputCurrency = isBuy ? expected.token : zeroAddress;
  const [takeCurrency, takeRecipient, takeAmount] = decodeAbiParameters(takeParameters, actionInputs[2]);
  requireAddress(takeCurrency, outputCurrency, "v4 output currency");
  requireAddress(takeRecipient, ROUTER_AS_RECIPIENT, "v4 output recipient");
  requireValue(takeAmount === 0n, "v4 take amount changed");
  if (envelope.executionFee) {
    const [feeCurrency, feeRecipient, feeBps] = decodeAbiParameters(takeParameters, inputs[v4Offset + 1]);
    requireAddress(feeCurrency, outputCurrency, "v4 fee currency");
    requireAddress(feeRecipient, envelope.executionFee.treasury, "v4 fee treasury");
    requireValue(feeBps === BigInt(envelope.executionFee.bps), "v4 fee rate changed");
  }
  const sweepOffset = v4Offset + (feeEnabled ? 2 : 1);
  const [sweepCurrency, sweepRecipient, sweepMinimum] = decodeAbiParameters(takeParameters, inputs[sweepOffset]);
  requireAddress(sweepCurrency, outputCurrency, "v4 sweep currency");
  requireAddress(sweepRecipient, expected.recipient, "v4 sweep recipient");
  requireValue(sweepMinimum === envelope.minimumOut, "v4 sweep minimum changed");
  const [refundCurrency, refundRecipient, refundMinimum] = decodeAbiParameters(takeParameters, inputs[sweepOffset + 1]);
  requireAddress(refundCurrency, zeroAddress, "v4 refund currency");
  requireAddress(refundRecipient, expected.recipient, "v4 refund recipient");
  requireValue(refundMinimum === 0n, "v4 refund minimum changed");
}

export function assertUniswapTransactionIntegrity(
  quote: PreparedUniswapQuote,
  expected: {
    version: "v3" | "v4";
    token: Address;
    recipient: Address;
    side: "buy" | "sell";
    amountIn: bigint;
    nowSeconds?: number;
  }
) {
  const input = {
    token: expected.token,
    recipient: expected.recipient,
    side: expected.side,
    amountIn: expected.amountIn,
    nowSeconds: expected.nowSeconds ?? Math.floor(Date.now() / 1_000)
  };
  try {
    if (expected.version === "v3") {
      requireValue(quote.venue === "uniswap-v3", "venue changed");
      verifyV3(quote, input);
    } else {
      requireValue(quote.venue === "uniswap-v4", "venue changed");
      verifyV4(quote, input);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("RMT rejected unsafe Uniswap")) throw cause;
    fail("calldata could not be decoded exactly");
  }
  return true;
}
