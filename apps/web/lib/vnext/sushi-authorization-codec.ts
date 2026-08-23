import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { SUSHI_NATIVE_TOKEN, SUSHI_RED_SNWAPPER } from "../sushi";
import { isRobinhoodNativeAsset } from "./robinhood-assets";

export const SUSHI_RED_SNWAPPER_CODE_HASH = "0x4b299d0674c86f701924420b3c90e4eb8efcc49f7865cc9680ee631ec7048b97" as Hex;
export const SUSHI_ROUTE_EXECUTOR = getAddress("0x0e867974275cd31c25015c2753c9d75f9f355379");
export const SUSHI_ROUTE_EXECUTOR_CODE_HASH = "0x57d45a1dce631a859bd1780826e0fbb9a7489650453406e0dc593724eca6cb6b" as Hex;
export const SUSHI_ROUTE_EXECUTOR_ENTRYPOINT = "0x6be92b89" as Hex;

export const sushiRedSnwapperAbi = [{
  type: "function",
  name: "snwap",
  stateMutability: "payable",
  inputs: [
    { name: "tokenIn", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountOutMin", type: "uint256" },
    { name: "executor", type: "address" },
    { name: "executorData", type: "bytes" }
  ],
  outputs: [{ name: "amountOut", type: "uint256" }]
}] as const;

function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

export function sushiRouteAsset(address: string) {
  return isRobinhoodNativeAsset(address) ? SUSHI_NATIVE_TOKEN : getAddress(address);
}

export function assertSushiSwapCalldata(data: Hex, expected: {
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  transactionValueAtomic: string;
}) {
  let decoded: ReturnType<typeof decodeFunctionData<typeof sushiRedSnwapperAbi>>;
  try {
    decoded = decodeFunctionData({ abi: sushiRedSnwapperAbi, data });
  } catch {
    throw new Error("RMT rejected malformed Sushi calldata.");
  }
  if (decoded.functionName !== "snwap") throw new Error("RMT rejected an unsupported Sushi router entrypoint.");
  const [tokenIn, amountIn, recipient, tokenOut, minimumOut, executor, executorData] = decoded.args;
  if (!sameAddress(tokenIn, sushiRouteAsset(expected.inputAsset))) throw new Error("Sushi changed the input token.");
  if (!sameAddress(tokenOut, sushiRouteAsset(expected.outputAsset))) throw new Error("Sushi changed the output token.");
  if (amountIn !== BigInt(expected.inputAmountAtomic)) throw new Error("Sushi calldata changed the input amount.");
  if (!sameAddress(recipient, expected.recipient)) throw new Error("Sushi changed the output recipient.");
  if (minimumOut <= 0n || minimumOut !== BigInt(expected.protectedOutputAtomic)) {
    throw new Error("Sushi calldata changed the minimum received amount.");
  }
  if (!sameAddress(executor, SUSHI_ROUTE_EXECUTOR)) throw new Error("Sushi returned an unapproved route executor.");
  if (!executorData.toLowerCase().startsWith(SUSHI_ROUTE_EXECUTOR_ENTRYPOINT)) {
    throw new Error("Sushi returned an unsupported executor entrypoint.");
  }
  const expectedValue = isRobinhoodNativeAsset(expected.inputAsset) ? expected.inputAmountAtomic : "0";
  if (expected.transactionValueAtomic !== expectedValue) throw new Error("Sushi returned an invalid native transaction value.");
  return {
    router: SUSHI_RED_SNWAPPER,
    tokenIn: getAddress(tokenIn),
    tokenOut: getAddress(tokenOut),
    amountIn,
    recipient: getAddress(recipient),
    minimumOut,
    executor: getAddress(executor),
    executorData
  };
}
