import assert from "node:assert/strict";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { assertUniswapTransactionIntegrity, uniswapV4PoolId } from "./uniswap-transaction-integrity";
import { isTradePreflightReady } from "./trade-preflight";
import {
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_WETH
} from "./uniswap-v4";
import { buildExternalUniswapSwap } from "./server/external-uniswap-trade";
import { buildExternalV4Swap } from "./server/external-uniswap-v4-simulation";
import type { VerifiedExternalUniswapV4Market } from "./server/external-uniswap-v4-market";

const token = getAddress("0x26616fD1A48cA881cB5ca8181e04E76F64c1e58F");
const recipient = getAddress("0x94973819b134A6F45C57448172Cc2B84019C161f");
const otherRecipient = getAddress("0x1111111111111111111111111111111111111111");
const amountIn = 1_000n;
const quoteOut = 990n;
const minimumOut = 980n;
const nowSeconds = 2_000_000_000;
const deadline = BigInt(nowSeconds + 600);
const poolKey = {
  currency0: zeroAddress,
  currency1: token,
  fee: 5_000,
  tickSpacing: 200,
  hooks: zeroAddress
} as const;
const poolId = uniswapV4PoolId(poolKey) as Hex;

function v3Quote(side: "buy" | "sell", override: Record<string, unknown> = {}) {
  const built = buildExternalUniswapSwap({ token, recipient, side, fee: 10_000, amountIn, quoteOut, deadline });
  return {
    venue: "uniswap-v3" as const,
    token,
    recipient,
    side,
    marketPair: getAddress("0x2222222222222222222222222222222222222222"),
    router: ROBINHOOD_SWAP_ROUTER_02,
    calldata: built.calldata,
    value: built.value.toString(),
    amountIn: amountIn.toString(),
    quoteOut: quoteOut.toString(),
    minimumOut: built.minimumOut.toString(),
    deadline: deadline.toString(),
    fee: 10_000,
    inputToken: { address: side === "buy" ? ROBINHOOD_WETH : token, decimals: 18 },
    outputToken: { address: side === "buy" ? token : ROBINHOOD_WETH, decimals: 18 },
    ...override
  };
}

function v4Market(): VerifiedExternalUniswapV4Market {
  return {
    protocol: "uniswap-v4",
    token,
    poolId,
    poolManager: getAddress("0x8366a39cC670B4001A1121b8f6A443A643E40951"),
    stateView: getAddress("0xF3334192D15450cDD385c8b70E03F9a6Bd9e673b"),
    quoter: getAddress("0x8dC178efB8111Bb0973dD9D722eBeFF267c98F94"),
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    poolKey,
    poolState: { sqrtPriceX96: 1n << 96n, tick: 0, protocolFee: 0, lpFee: 5_000, initializedAtBlock: 23_711_922n },
    hook: {
      address: zeroAddress,
      permissions: [],
      affectsSwap: false,
      returnsSwapDelta: false,
      dynamicFee: false,
      codePresent: true,
      sourcePublished: null,
      isProxy: null,
      bytecodeChanged: null,
      contractName: null,
      customWriteFunctions: []
    },
    liquidityUsd: 50_000,
    url: `https://dexscreener.com/robinhood/${poolId}`
  };
}

function v4Quote(side: "buy" | "sell", calldataRecipient: Address = recipient, override: Record<string, unknown> = {}) {
  const built = buildExternalV4Swap({ market: v4Market(), recipient: calldataRecipient, side, amountIn, quoteOut, deadline });
  return {
    venue: "uniswap-v4" as const,
    token,
    recipient,
    side,
    marketPair: poolId,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    calldata: built.calldata,
    value: built.value.toString(),
    amountIn: amountIn.toString(),
    quoteOut: quoteOut.toString(),
    minimumOut: built.minimumOut.toString(),
    deadline: deadline.toString(),
    fee: 5_000,
    inputToken: { address: side === "buy" ? zeroAddress : token, decimals: 18 },
    outputToken: { address: side === "buy" ? token : zeroAddress, decimals: 18 },
    passport: { hook: zeroAddress },
    ...override
  };
}

for (const side of ["buy", "sell"] as const) {
  assert.equal(assertUniswapTransactionIntegrity(v3Quote(side), {
    version: "v3", token, recipient, side, amountIn, nowSeconds
  }), true);
  assert.equal(assertUniswapTransactionIntegrity(v4Quote(side), {
    version: "v4", token, recipient, side, amountIn, nowSeconds
  }), true);
}

assert.throws(() => assertUniswapTransactionIntegrity(v3Quote("buy", { value: "999" }), {
  version: "v3", token, recipient, side: "buy", amountIn, nowSeconds
}), /native value changed/);
assert.throws(() => assertUniswapTransactionIntegrity(v3Quote("sell", { minimumOut: (minimumOut - 1n).toString() }), {
  version: "v3", token, recipient, side: "sell", amountIn, nowSeconds
}), /protected minimum changed/);
assert.throws(() => assertUniswapTransactionIntegrity(v3Quote("buy", { deadline: String(nowSeconds + 3_600) }), {
  version: "v3", token, recipient, side: "buy", amountIn, nowSeconds
}), /deadline is too far/);
assert.throws(() => assertUniswapTransactionIntegrity(v4Quote("buy", otherRecipient), {
  version: "v4", token, recipient, side: "buy", amountIn, nowSeconds
}), /sweep recipient changed/);
assert.throws(() => assertUniswapTransactionIntegrity(v4Quote("sell", recipient, { calldata: "0x1234" }), {
  version: "v4", token, recipient, side: "sell", amountIn, nowSeconds
}), /calldata could not be decoded exactly/);
assert.throws(() => assertUniswapTransactionIntegrity(v4Quote("buy", recipient, {
  marketPair: `0x${"11".repeat(32)}`
}), {
  version: "v4", token, recipient, side: "buy", amountIn, nowSeconds
}), /v4 pool key changed/);

assert.equal(isTradePreflightReady({ status: "loading" }), false);
assert.equal(isTradePreflightReady({ status: "unavailable" }), false);
assert.equal(isTradePreflightReady({ status: "ready", gas: 1n, gasPrice: 1n, feeWei: 1n }), true);
assert.equal(isTradePreflightReady({ status: "ready", gas: 0n, gasPrice: 1n, feeWei: 1n }), false);
assert.equal(isTradePreflightReady({ status: "ready", gas: 1n, gasPrice: 0n, feeWei: 1n }), false);
assert.equal(isTradePreflightReady({ status: "ready", gas: 1n, gasPrice: 1n, feeWei: 0n }), false);

console.log("Uniswap transaction payloads are independently decoded and fail closed before wallet review.");
