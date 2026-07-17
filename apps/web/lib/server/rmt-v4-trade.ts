import { createPublicClient, encodeAbiParameters, encodeFunctionData, getAddress, http, zeroAddress, type Address, type Hex } from "viem";
import { activeChain, isMainnetRelease } from "../network";
import {
  RMT_V6_GRADUATION_ADAPTER,
  RMT_V6_GRADUATION_HOOK,
  RMT_V6_POOL_FEE,
  RMT_V6_TICK_SPACING,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_QUOTER,
  ROUTER_AS_RECIPIENT
} from "../uniswap-v4";
import { verifyActiveV6LaunchIdentity } from "./rmt-trade-identity";

const marketAbi = [
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const adapterAbi = [
  { type: "function", name: "isGraduated", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "poolIds", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "poolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "hook", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const v4QuoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
    { name: "zeroForOne", type: "bool" },
    { name: "exactAmount", type: "uint128" },
    { name: "hookData", type: "bytes" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }]
}] as const;

const client = createPublicClient({
  chain: activeChain,
  transport: http(process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0], { retryCount: 3, timeout: 12_000 })
});

const MAX_UINT128 = (1n << 128n) - 1n;
const ZERO_POOL_ID = `0x${"0".repeat(64)}`;
const V4_SWAP_ACTIONS = "0x060b0e" as Hex;

const universalRouterAbi = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }, { name: "deadline", type: "uint256" }],
  outputs: []
}] as const;

const exactInputSingleParameters = [{ type: "tuple", components: [
  { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
  { name: "zeroForOne", type: "bool" },
  { name: "amountIn", type: "uint128" },
  { name: "amountOutMinimum", type: "uint128" },
  { name: "minHopPriceX36", type: "uint256" },
  { name: "hookData", type: "bytes" }
] }] as const;

export type RmtV4TradeSide = "buy" | "sell";

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

function poolKey(token: Address) {
  return {
    currency0: zeroAddress,
    currency1: token,
    fee: RMT_V6_POOL_FEE,
    tickSpacing: RMT_V6_TICK_SPACING,
    hooks: RMT_V6_GRADUATION_HOOK
  } as const;
}

export function buildRmtV4Swap(params: { token: Address; recipient: Address; side: RmtV4TradeSide; amountIn: bigint; quoteOut: bigint; deadline: bigint }) {
  const minimumOut = params.quoteOut * 99n / 100n;
  if (minimumOut <= 0n) throw new Error("The canonical pool quote is too small to enforce a safe minimum received.");
  const inputAddress = params.side === "buy" ? zeroAddress : params.token;
  const outputAddress = params.side === "buy" ? params.token : zeroAddress;
  const swapAction = encodeAbiParameters(exactInputSingleParameters, [{
    poolKey: poolKey(params.token),
    zeroForOne: params.side === "buy",
    amountIn: params.amountIn,
    amountOutMinimum: minimumOut,
    minHopPriceX36: 0n,
    hookData: "0x"
  }]);
  const settleAction = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [inputAddress, params.amountIn, false]
  );
  const takeAction = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [outputAddress, ROUTER_AS_RECIPIENT, 0n]
  );
  const v4Swap = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [V4_SWAP_ACTIONS, [swapAction, settleAction, takeAction]]
  );
  const outputSweep = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [outputAddress, params.recipient, minimumOut]
  );
  const safeNativeSweep = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [zeroAddress, params.recipient, 0n]
  );
  const isBuy = params.side === "buy";
  const commands = isBuy ? "0x100404" : "0x02100404";
  const inputs = isBuy ? [v4Swap, outputSweep, safeNativeSweep] : [
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint160" }],
      [params.token, ROUTER_AS_RECIPIENT, params.amountIn]
    ),
    v4Swap,
    outputSweep,
    safeNativeSweep
  ];
  const calldata = encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [commands, inputs, params.deadline] });

  return { calldata, value: isBuy ? params.amountIn : 0n, minimumOut };
}

export async function quoteAndBuildRmtV4Swap(params: { launchId: bigint; token: Address; recipient: Address; side: RmtV4TradeSide; amountIn: bigint }) {
  if (!isMainnetRelease) throw new Error("Native V4 trading is available only on Robinhood Chain mainnet.");
  if (params.amountIn <= 0n || params.amountIn > MAX_UINT128) throw new Error("Trade amount is outside the supported range.");
  if (sameAddress(params.recipient, zeroAddress)) throw new Error("A valid wallet recipient is required.");

  const launch = await verifyActiveV6LaunchIdentity({ launchId: params.launchId, token: params.token });

  const [marketGraduated, graduationAdapter, adapterGraduated, preparedPoolId, poolFee, tickSpacing, hook, routerCode, quoterCode] = await Promise.all([
    client.readContract({ address: launch.market, abi: marketAbi, functionName: "graduated" }),
    client.readContract({ address: launch.market, abi: marketAbi, functionName: "graduationAdapter" }),
    client.readContract({ address: RMT_V6_GRADUATION_ADAPTER, abi: adapterAbi, functionName: "isGraduated", args: [params.token] }),
    client.readContract({ address: RMT_V6_GRADUATION_ADAPTER, abi: adapterAbi, functionName: "poolIds", args: [params.token] }),
    client.readContract({ address: RMT_V6_GRADUATION_ADAPTER, abi: adapterAbi, functionName: "poolFee" }),
    client.readContract({ address: RMT_V6_GRADUATION_ADAPTER, abi: adapterAbi, functionName: "tickSpacing" }),
    client.readContract({ address: RMT_V6_GRADUATION_ADAPTER, abi: adapterAbi, functionName: "hook" }),
    client.getBytecode({ address: ROBINHOOD_UNIVERSAL_ROUTER }),
    client.getBytecode({ address: ROBINHOOD_V4_QUOTER })
  ]);

  if (!marketGraduated || !adapterGraduated || preparedPoolId === ZERO_POOL_ID) throw new Error("The canonical V4 pool is not open yet.");
  if (!sameAddress(graduationAdapter, RMT_V6_GRADUATION_ADAPTER) || Number(poolFee) !== RMT_V6_POOL_FEE || Number(tickSpacing) !== RMT_V6_TICK_SPACING || !sameAddress(hook, RMT_V6_GRADUATION_HOOK)) throw new Error("The graduated pool configuration failed RMT verification.");
  if (!routerCode || !quoterCode) throw new Error("The official Uniswap execution contracts are unavailable.");

  const quoteSimulation = await client.simulateContract({
    account: params.recipient,
    address: ROBINHOOD_V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: poolKey(params.token), zeroForOne: params.side === "buy", exactAmount: params.amountIn, hookData: "0x" }]
  });
  const quoteOut = quoteSimulation.result[0];
  if (quoteOut <= 0n || quoteOut > MAX_UINT128) throw new Error("The canonical pool returned an invalid quote.");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  return { ...buildRmtV4Swap({ ...params, quoteOut, deadline }), quoteOut, deadline, market: getAddress(launch.market) };
}
