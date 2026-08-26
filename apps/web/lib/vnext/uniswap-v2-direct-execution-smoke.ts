import assert from "node:assert/strict";
import { encodeFunctionData, getAddress, zeroAddress } from "viem";
import {
  assertUniswapV2SwapCalldata,
  ROBINHOOD_UNISWAP_V2_ROUTER,
  uniswapV2RouterAbi
} from "./uniswap-v2-authorization-codec";
import { ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";
import { VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY } from "./provider-execution-capability";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY } from "./provider-fee-settlement";

const tokenA = getAddress("0x1111111111111111111111111111111111111111");
const tokenB = getAddress("0x2222222222222222222222222222222222222222");
const recipient = getAddress("0x3333333333333333333333333333333333333333");
const pool = getAddress("0x4444444444444444444444444444444444444444");
const secondPool = getAddress("0x5555555555555555555555555555555555555555");
const amountIn = 1_000_000n;
const minimumOut = 900_000n;
const deadline = 1_800_000_000n;

const buy = encodeFunctionData({
  abi: uniswapV2RouterAbi, functionName: "swapExactETHForTokens",
  args: [minimumOut, [ROBINHOOD_WETH_ADDRESS, tokenA], recipient, deadline]
});
assert.equal(assertUniswapV2SwapCalldata(buy, {
  inputAsset: zeroAddress, outputAsset: tokenA, inputAmountAtomic: amountIn.toString(),
  protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
  transactionValueAtomic: amountIn.toString(), route: "direct", pools: [pool]
}), true);

const sell = encodeFunctionData({
  abi: uniswapV2RouterAbi, functionName: "swapExactTokensForETH",
  args: [amountIn, minimumOut, [tokenA, ROBINHOOD_WETH_ADDRESS], recipient, deadline]
});
assert.equal(assertUniswapV2SwapCalldata(sell, {
  inputAsset: tokenA, outputAsset: zeroAddress, inputAmountAtomic: amountIn.toString(),
  protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
  transactionValueAtomic: "0", route: "direct", pools: [pool]
}), true);

const erc20ToErc20 = encodeFunctionData({
  abi: uniswapV2RouterAbi, functionName: "swapExactTokensForTokens",
  args: [amountIn, minimumOut, [tokenA, ROBINHOOD_WETH_ADDRESS, tokenB], recipient, deadline]
});
assert.equal(assertUniswapV2SwapCalldata(erc20ToErc20, {
  inputAsset: tokenA, outputAsset: tokenB, inputAmountAtomic: amountIn.toString(),
  protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
  transactionValueAtomic: "0", route: "weth_hop", pools: [pool, secondPool]
}), true);

for (const changed of [
  { protectedOutputAtomic: (minimumOut - 1n).toString() },
  { recipient: tokenB },
  { deadline: (deadline + 1n).toString() },
  { inputAmountAtomic: (amountIn + 1n).toString() }
]) {
  assert.throws(() => assertUniswapV2SwapCalldata(sell, {
    inputAsset: tokenA, outputAsset: zeroAddress, inputAmountAtomic: amountIn.toString(),
    protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
    transactionValueAtomic: "0", route: "direct", pools: [pool], ...changed
  }), /changed Uniswap V2 swap economics or path/);
}

assert.throws(() => assertUniswapV2SwapCalldata(buy, {
  inputAsset: zeroAddress, outputAsset: tokenA, inputAmountAtomic: amountIn.toString(),
  protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
  transactionValueAtomic: (amountIn - 1n).toString(), route: "direct", pools: [pool]
}), /changed Uniswap V2 transaction value/);

assert.throws(() => assertUniswapV2SwapCalldata(erc20ToErc20, {
  inputAsset: tokenA, outputAsset: tokenB, inputAmountAtomic: amountIn.toString(),
  protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
  transactionValueAtomic: "0", route: "weth_hop", pools: [pool]
}), /incomplete Uniswap V2 pool evidence/);

const changedPath = encodeFunctionData({
  abi: uniswapV2RouterAbi, functionName: "swapExactTokensForETH",
  args: [amountIn, minimumOut, [tokenB, ROBINHOOD_WETH_ADDRESS], recipient, deadline]
});
assert.throws(() => assertUniswapV2SwapCalldata(changedPath, {
  inputAsset: tokenA, outputAsset: zeroAddress, inputAmountAtomic: amountIn.toString(),
  protectedOutputAtomic: minimumOut.toString(), recipient, deadline: deadline.toString(),
  transactionValueAtomic: "0", route: "direct", pools: [pool]
}), /changed Uniswap V2 swap economics or path/);

assert.equal(ROBINHOOD_UNISWAP_V2_ROUTER, getAddress("0x89e5db8b5aa49aa85ac63f691524311aeb649eba"));
assert.deepEqual(VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY["uniswap-v2"], {
  state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true
});
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v2"].state, "QUOTE_ONLY");
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v2"].walletCodecImplemented, true);

console.log("Generic fee-free Uniswap V2 exact calldata, router authority, and settlement containment checks passed.");
