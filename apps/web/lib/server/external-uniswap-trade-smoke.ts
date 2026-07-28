import assert from "node:assert/strict";
import { decodeFunctionData, getAddress, type Hex } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";
import {
  buildExternalUniswapSwap,
  calculateUniswapPriceImpact
} from "./external-uniswap-trade";

const token = getAddress("0x232CDFc415D10b673845D83Dc02ba2eaBe7e30d1");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const amountIn = 100_000_000_000_000n;
const quoteOut = 26_834_480_817_139_353_188n;
const deadline = 2_000_000_000n;
const fee = 10_000;
const q96 = 1n << 96n;

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
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }]
  }
] as const;

function inspect(calldata: Hex) {
  const outer = decodeFunctionData({ abi: routerAbi, data: calldata });
  assert.equal(outer.functionName, "multicall");
  const [routeDeadline, calls] = outer.args;
  const swap = decodeFunctionData({ abi: routerAbi, data: calls[0] });
  assert.equal(swap.functionName, "exactInputSingle");
  return { routeDeadline, calls, swap: swap.args[0] };
}

assert.throws(
  () => buildExternalUniswapSwap({ token, recipient, side: "buy", fee, amountIn: 1n, quoteOut: 1n, deadline }),
  /too small to enforce a safe minimum received/
);

assert.equal(
  calculateUniswapPriceImpact({
    sqrtPriceX96: q96,
    tokenInIsToken0: true,
    amountIn: 1_000n,
    quoteOut: 990n
  }),
  0.01
);
assert.equal(
  calculateUniswapPriceImpact({
    sqrtPriceX96: q96,
    tokenInIsToken0: false,
    amountIn: 1_000n,
    quoteOut: 900n
  }),
  0.1
);
assert.equal(
  calculateUniswapPriceImpact({
    sqrtPriceX96: q96 * 2n,
    tokenInIsToken0: true,
    amountIn: 1_000n,
    quoteOut: 3_960n
  }),
  0.01
);
assert.equal(
  calculateUniswapPriceImpact({
    sqrtPriceX96: q96 * 2n,
    tokenInIsToken0: false,
    amountIn: 4_000n,
    quoteOut: 990n
  }),
  0.01
);
assert.equal(
  calculateUniswapPriceImpact({
    sqrtPriceX96: q96,
    tokenInIsToken0: true,
    amountIn: 1_000n,
    quoteOut: 1_001n
  }),
  0
);
assert.throws(
  () => calculateUniswapPriceImpact({
    sqrtPriceX96: 0n,
    tokenInIsToken0: true,
    amountIn: 1_000n,
    quoteOut: 990n
  }),
  /invalid pool or quote values/
);

const buy = buildExternalUniswapSwap({ token, recipient, side: "buy", fee, amountIn, quoteOut, deadline });
const buyRoute = inspect(buy.calldata);
assert.equal(buy.value, amountIn);
assert.equal(buy.minimumOut, quoteOut * 99n / 100n);
assert.equal(buyRoute.routeDeadline, deadline);
assert.equal(buyRoute.calls.length, 1);
assert.equal(buyRoute.swap.tokenIn.toLowerCase(), ROBINHOOD_WETH.toLowerCase());
assert.equal(buyRoute.swap.tokenOut.toLowerCase(), token.toLowerCase());
assert.equal(buyRoute.swap.recipient.toLowerCase(), recipient.toLowerCase());
assert.equal(buyRoute.swap.amountIn, amountIn);
assert.equal(buyRoute.swap.amountOutMinimum, buy.minimumOut);
assert.equal(buyRoute.swap.fee, fee);

const sell = buildExternalUniswapSwap({ token, recipient, side: "sell", fee, amountIn: quoteOut, quoteOut: amountIn, deadline });
const sellRoute = inspect(sell.calldata);
assert.equal(sell.value, 0n);
assert.equal(sellRoute.routeDeadline, deadline);
assert.equal(sellRoute.calls.length, 2);
assert.equal(sellRoute.swap.tokenIn.toLowerCase(), token.toLowerCase());
assert.equal(sellRoute.swap.tokenOut.toLowerCase(), ROBINHOOD_WETH.toLowerCase());
assert.equal(sellRoute.swap.recipient.toLowerCase(), ROBINHOOD_SWAP_ROUTER_02.toLowerCase());
const unwrap = decodeFunctionData({ abi: routerAbi, data: sellRoute.calls[1] });
assert.equal(unwrap.functionName, "unwrapWETH9");
assert.equal(unwrap.args[0], sell.minimumOut);
assert.equal(unwrap.args[1].toLowerCase(), recipient.toLowerCase());

console.log("External Uniswap buy/sell calldata is slippage- and deadline-bounded.");
