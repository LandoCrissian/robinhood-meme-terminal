import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "./robinhood-assets";

export const UP_V2_EXECUTION_ROUTER = getAddress("0xf5198743240fAC98db71868F34c70139b1eb0474");
export const UP_CL_EXECUTION_ROUTER = getAddress("0xC062b870E813fcA720f1e002c234369Ab3aB9415");
export const UP_V2_FACTORY_ADDRESS = getAddress("0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28");
export const UP_CL_FACTORY_ADDRESS = getAddress("0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3");
export const UP_CL_EXECUTION_ROUTER_RUNTIME_HASH = "0x11ea7d3599ef56eda32c0ce7ca26e9aae71bec13bfcbd3ad0e83826c1a2defe4" as Hex;

const v2Route = { name: "routes", type: "tuple[]", components: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "stable", type: "bool" }, { name: "factory", type: "address" }
] } as const;

export const upV2ExecutionAbi = [{
  type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable",
  inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, v2Route,
    { name: "to", type: "address" }, { name: "deadline", type: "uint256" }],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "swapExactETHForTokens", stateMutability: "payable",
  inputs: [{ name: "amountOutMin", type: "uint256" }, v2Route, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "swapExactTokensForETH", stateMutability: "nonpayable",
  inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, v2Route,
    { name: "to", type: "address" }, { name: "deadline", type: "uint256" }],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}, {
  type: "function", name: "defaultFactory", stateMutability: "view", inputs: [], outputs: [{ name: "factory", type: "address" }]
}, {
  type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ name: "wrappedNative", type: "address" }]
}] as const;

export const upClExecutionAbi = [{
  type: "function", name: "exactInputSingle", stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "tickSpacing", type: "int24" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }], outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function", name: "exactInput", stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "path", type: "bytes" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }
  ] }], outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function", name: "multicall", stateMutability: "payable",
  inputs: [{ name: "data", type: "bytes[]" }], outputs: [{ name: "results", type: "bytes[]" }]
}, {
  type: "function", name: "unwrapWETH9", stateMutability: "payable",
  inputs: [{ name: "amountMinimum", type: "uint256" }, { name: "recipient", type: "address" }], outputs: []
}, {
  type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ name: "factory", type: "address" }]
}, {
  type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ name: "wrappedNative", type: "address" }]
}] as const;

export type UpAuthorizationEvidence = {
  provider: "up-v2" | "up-cl";
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  deadline: string;
  transactionValueAtomic: string;
  route: "direct" | "weth_hop";
  pools: string[];
  fees: number[];
  stableFlags?: boolean[];
  tickSpacings?: number[];
};

function exactReencode(abi: typeof upV2ExecutionAbi | typeof upClExecutionAbi, data: Hex) {
  const decoded = decodeFunctionData({ abi, data } as Parameters<typeof decodeFunctionData>[0]);
  const reencoded = encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args } as Parameters<typeof encodeFunctionData>[0]);
  if (reencoded.toLowerCase() !== data.toLowerCase()) throw new Error("RMT rejected trailing, unknown, or noncanonical up. calldata.");
  return decoded;
}

function decodeClPath(path: Hex) {
  const body = path.slice(2);
  if (body.length !== 86 && body.length !== 132) throw new Error("RMT rejected an unexpected up CL path length.");
  const tokens: Address[] = [getAddress(`0x${body.slice(0, 40)}`)];
  const tickSpacings: number[] = [];
  let offset = 40;
  while (offset < body.length) {
    const raw = Number.parseInt(body.slice(offset, offset + 6), 16);
    const signed = raw >= 0x800000 ? raw - 0x1000000 : raw;
    tickSpacings.push(signed);
    tokens.push(getAddress(`0x${body.slice(offset + 6, offset + 46)}`));
    offset += 46;
  }
  return { tokens, tickSpacings };
}

export function assertUpSwapCalldata(data: Hex, evidence: UpAuthorizationEvidence) {
  const nativeInput = isRobinhoodNativeAsset(evidence.inputAsset);
  const nativeOutput = isRobinhoodNativeAsset(evidence.outputAsset);
  const routedInput = nativeInput ? ROBINHOOD_WETH_ADDRESS : getAddress(evidence.inputAsset);
  const routedOutput = nativeOutput ? ROBINHOOD_WETH_ADDRESS : getAddress(evidence.outputAsset);
  if (evidence.transactionValueAtomic !== (nativeInput ? evidence.inputAmountAtomic : "0")) {
    throw new Error("RMT rejected changed up. transaction value.");
  }
  if (evidence.provider === "up-v2") {
    const decoded = exactReencode(upV2ExecutionAbi, data);
    const expectedFunction = nativeInput ? "swapExactETHForTokens" : nativeOutput ? "swapExactTokensForETH" : "swapExactTokensForTokens";
    if (decoded.functionName !== expectedFunction) throw new Error("RMT rejected a changed up v2 swap function.");
    const args = decoded.args as readonly unknown[];
    const amountIn = nativeInput ? BigInt(evidence.inputAmountAtomic) : args[0];
    const amountOutMin = nativeInput ? args[0] : args[1];
    const routes = (nativeInput ? args[1] : args[2]) as readonly { from: Address; to: Address; stable: boolean; factory: Address }[];
    const recipient = nativeInput ? args[2] : args[3];
    const deadline = nativeInput ? args[3] : args[4];
    if (amountIn !== BigInt(evidence.inputAmountAtomic) || amountOutMin !== BigInt(evidence.protectedOutputAtomic)
      || getAddress(recipient as Address) !== getAddress(evidence.recipient) || deadline !== BigInt(evidence.deadline)
      || routes.length !== evidence.pools.length || routes.length !== evidence.stableFlags?.length) {
      throw new Error("RMT rejected changed up v2 swap economics.");
    }
    routes.forEach((route, index) => {
      const expectedFrom = index === 0 ? routedInput : ROBINHOOD_WETH_ADDRESS;
      const expectedTo = index === routes.length - 1 ? routedOutput : ROBINHOOD_WETH_ADDRESS;
      if (getAddress(route.from) !== expectedFrom || getAddress(route.to) !== expectedTo
        || getAddress(route.factory) !== UP_V2_FACTORY_ADDRESS
        || route.stable !== evidence.stableFlags![index]) throw new Error("RMT rejected changed up v2 route legs.");
    });
    return;
  }
  const outer = exactReencode(upClExecutionAbi, data);
  let swapData = data;
  if (nativeOutput) {
    if (outer.functionName !== "multicall") throw new Error("RMT rejected missing up CL native-output unwrap.");
    const calls = (outer.args as readonly unknown[])[0] as readonly Hex[];
    if (calls.length !== 2) throw new Error("RMT rejected changed up CL multicall length.");
    swapData = calls[0];
    const unwrap = exactReencode(upClExecutionAbi, calls[1]);
    const unwrapArgs = unwrap.args as readonly [bigint, Address];
    if (unwrap.functionName !== "unwrapWETH9" || unwrapArgs[0] !== BigInt(evidence.protectedOutputAtomic)
      || getAddress(unwrapArgs[1]) !== getAddress(evidence.recipient)) throw new Error("RMT rejected changed up CL unwrap economics.");
  } else if (outer.functionName === "multicall") {
    throw new Error("RMT rejected an unnecessary up CL multicall.");
  }
  const swap = exactReencode(upClExecutionAbi, swapData);
  const expectedRecipient = nativeOutput ? zeroAddress : getAddress(evidence.recipient);
  if (evidence.route === "direct") {
    if (swap.functionName !== "exactInputSingle") throw new Error("RMT rejected a changed up CL direct function.");
    const params = (swap.args as readonly unknown[])[0] as {
      tokenIn: Address; tokenOut: Address; tickSpacing: number; recipient: Address; deadline: bigint;
      amountIn: bigint; amountOutMinimum: bigint; sqrtPriceLimitX96: bigint;
    };
    if (getAddress(params.tokenIn) !== routedInput || getAddress(params.tokenOut) !== routedOutput
      || params.tickSpacing !== evidence.tickSpacings?.[0] || getAddress(params.recipient) !== expectedRecipient
      || params.deadline !== BigInt(evidence.deadline) || params.amountIn !== BigInt(evidence.inputAmountAtomic)
      || params.amountOutMinimum !== BigInt(evidence.protectedOutputAtomic) || params.sqrtPriceLimitX96 !== 0n) {
      throw new Error("RMT rejected changed up CL direct economics.");
    }
  } else {
    if (swap.functionName !== "exactInput") throw new Error("RMT rejected a changed up CL multihop function.");
    const params = (swap.args as readonly unknown[])[0] as {
      path: Hex; recipient: Address; deadline: bigint; amountIn: bigint; amountOutMinimum: bigint;
    };
    const path = decodeClPath(params.path);
    if (path.tokens.length !== 3 || path.tokens[0] !== routedInput || path.tokens[1] !== ROBINHOOD_WETH_ADDRESS
      || path.tokens[2] !== routedOutput || JSON.stringify(path.tickSpacings) !== JSON.stringify(evidence.tickSpacings)
      || getAddress(params.recipient) !== expectedRecipient || params.deadline !== BigInt(evidence.deadline)
      || params.amountIn !== BigInt(evidence.inputAmountAtomic) || params.amountOutMinimum !== BigInt(evidence.protectedOutputAtomic)) {
      throw new Error("RMT rejected changed up CL multihop economics.");
    }
  }
}
