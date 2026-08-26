import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex
} from "viem";
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "./robinhood-assets";

export const ROBINHOOD_UNISWAP_V2_FACTORY = getAddress("0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f");
export const ROBINHOOD_UNISWAP_V2_ROUTER = getAddress("0x89e5db8b5aa49aa85ac63f691524311aeb649eba");
export const ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH = "0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0" as Hex;
export const ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH = "0xbd55ea26b2f8d42a8ff151511cef92a326a9817686899fe96a8a8f81ee7fc55e" as Hex;
export const ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH = "0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5" as Hex;

export const uniswapV2RouterAbi = [{
  type: "function", name: "getAmountsOut", stateMutability: "view",
  inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable",
  inputs: [
    { name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" }, { name: "to", type: "address" },
    { name: "deadline", type: "uint256" }
  ], outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "swapExactETHForTokens", stateMutability: "payable",
  inputs: [
    { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" },
    { name: "to", type: "address" }, { name: "deadline", type: "uint256" }
  ], outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "swapExactTokensForETH", stateMutability: "nonpayable",
  inputs: [
    { name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" }, { name: "to", type: "address" },
    { name: "deadline", type: "uint256" }
  ], outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "factory", stateMutability: "pure", inputs: [], outputs: [{ name: "factory", type: "address" }]
}, {
  type: "function", name: "WETH", stateMutability: "pure", inputs: [], outputs: [{ name: "wrappedNative", type: "address" }]
}] as const;

export type UniswapV2AuthorizationEvidence = {
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  deadline: string;
  transactionValueAtomic: string;
  route: "direct" | "weth_hop";
  pools: string[];
};

function exactDecode(data: Hex) {
  const decoded = decodeFunctionData({ abi: uniswapV2RouterAbi, data });
  const reencoded = encodeFunctionData({
    abi: uniswapV2RouterAbi,
    functionName: decoded.functionName,
    args: decoded.args
  } as Parameters<typeof encodeFunctionData>[0]);
  if (reencoded.toLowerCase() !== data.toLowerCase()) {
    throw new Error("RMT rejected trailing, unknown, or noncanonical Uniswap V2 calldata.");
  }
  return decoded;
}

export function assertUniswapV2SwapCalldata(data: Hex, evidence: UniswapV2AuthorizationEvidence) {
  const nativeInput = isRobinhoodNativeAsset(evidence.inputAsset);
  const nativeOutput = isRobinhoodNativeAsset(evidence.outputAsset);
  const routedInput = nativeInput ? ROBINHOOD_WETH_ADDRESS : getAddress(evidence.inputAsset);
  const routedOutput = nativeOutput ? ROBINHOOD_WETH_ADDRESS : getAddress(evidence.outputAsset);
  const expectedPath = evidence.route === "direct"
    ? [routedInput, routedOutput]
    : [routedInput, ROBINHOOD_WETH_ADDRESS, routedOutput];
  if (evidence.pools.length !== expectedPath.length - 1) {
    throw new Error("RMT rejected incomplete Uniswap V2 pool evidence.");
  }
  if (evidence.transactionValueAtomic !== (nativeInput ? evidence.inputAmountAtomic : "0")) {
    throw new Error("RMT rejected changed Uniswap V2 transaction value.");
  }
  const decoded = exactDecode(data);
  const expectedFunction = nativeInput
    ? "swapExactETHForTokens"
    : nativeOutput ? "swapExactTokensForETH" : "swapExactTokensForTokens";
  if (decoded.functionName !== expectedFunction) {
    throw new Error("RMT rejected a changed Uniswap V2 swap function.");
  }
  const args = decoded.args as readonly unknown[];
  const amountIn = nativeInput ? BigInt(evidence.inputAmountAtomic) : args[0];
  const amountOutMin = nativeInput ? args[0] : args[1];
  const path = (nativeInput ? args[1] : args[2]) as readonly Address[];
  const recipient = (nativeInput ? args[2] : args[3]) as Address;
  const deadline = nativeInput ? args[3] : args[4];
  if (
    amountIn !== BigInt(evidence.inputAmountAtomic)
    || amountOutMin !== BigInt(evidence.protectedOutputAtomic)
    || path.length !== expectedPath.length
    || path.some((asset, index) => getAddress(asset) !== expectedPath[index])
    || getAddress(recipient) !== getAddress(evidence.recipient)
    || deadline !== BigInt(evidence.deadline)
  ) throw new Error("RMT rejected changed Uniswap V2 swap economics or path.");
  return true;
}
