import {
  decodeAbiParameters, decodeFunctionData, erc20Abi, isAddress, isHash, isHex, parseAbi, parseEther,
  parseTransaction, recoverTransactionAddress, toFunctionSelector, zeroAddress,
  type Address, type Hex, type TransactionSerialized,
} from "viem";
import { factoryAbi } from "../launchpad/direct-v4";
import { launchPoolId, launchPoolKeyParameter, type NewLaunchRecord } from "../launchpad/launch-record";
import type { LaunchpadRuntime } from "./new-launchpad-config";

const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const swapAction = {
  type: "tuple", components: [
    { name: "poolKey", ...launchPoolKeyParameter }, { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" },
    { name: "hookData", type: "bytes" },
  ],
} as const;
const currencies = [{ type: "address" }, { type: "uint256" }] as const;
const maxValue = parseEther("100");
export const previewRpcMaxGas = 8_000_000n;
const maxTokenAmount = parseEther("1000000000");

export type PreviewRpcPolicy = {
  runtime: LaunchpadRuntime;
  wallet: Address;
  readLaunch(token: Address): NewLaunchRecord | undefined;
  readTransaction(hash: Hex): Promise<{ from: string; to: string | null; blockNumber: bigint | null; input: Hex }>;
};

const publicReadLengths = new Map([
  ["eth_chainId", [0, 0]], ["net_version", [0, 0]], ["eth_blockNumber", [0, 0]],
  ["eth_gasPrice", [0, 0]], ["eth_maxPriorityFeePerGas", [0, 0]], ["eth_syncing", [0, 0]],
  ["eth_feeHistory", [2, 3]], ["eth_getBalance", [1, 2]], ["eth_getCode", [1, 2]],
  ["eth_getTransactionCount", [1, 2]], ["eth_getTransactionByHash", [1, 1]],
  ["eth_getTransactionReceipt", [1, 1]], ["eth_getBlockByNumber", [2, 2]],
  ["eth_getBlockByHash", [2, 2]],
]);
const equalAddress = (a: string | null | undefined, b: Address) => a?.toLowerCase() === b.toLowerCase();
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1_000));

function quantity(value: unknown): bigint | undefined {
  if (typeof value === "string" && /^0x[\da-f]{1,32}$/i.test(value)) return BigInt(value);
}

function address(value: unknown): Address | undefined {
  if (typeof value === "string" && isAddress(value, { strict: false })) return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

function matchLaunch(policy: PreviewRpcPolicy, token: Address) {
  const launch = policy.readLaunch(token);
  return launch && launch.chainId === 31337 && equalAddress(launch.factory, policy.runtime.deployment.factory)
    && equalAddress(launch.poolManager, policy.runtime.deployment.poolManager) && equalAddress(launch.token, token) ? launch : undefined;
}

function deadlineIsFresh(deadline: bigint) {
  const now = nowSeconds();
  return deadline >= now && deadline <= now + 1_800n;
}

function permittedSwap(policy: PreviewRpcPolicy, input: Hex, value: bigint) {
  if (!policy.runtime.deployment.tradingEnabled) return false;
  const { args: [commands, inputs, deadline] } = decodeFunctionData({ abi: routerAbi, data: input });
  if (commands !== "0x10" || inputs.length !== 1 || !deadlineIsFresh(deadline)) return false;
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
  if (actions !== "0x060b0f" || params.length !== 3) return false;
  const [swap] = decodeAbiParameters([swapAction], params[0]);
  const [currencyIn, exactAmount, payerIsUser] = decodeAbiParameters([...currencies, { type: "bool" }], params[1]);
  const [currencyOut, minAmount] = decodeAbiParameters(currencies, params[2]);
  const launch = matchLaunch(policy, swap.poolKey.currency1);
  return !!launch && launch.poolId === launchPoolId(swap.poolKey) && swap.hookData === "0x"
    && payerIsUser && exactAmount > 0n && exactAmount <= maxTokenAmount && minAmount > 0n
    && swap.amountIn === exactAmount && swap.amountOutMinimum === minAmount
    && equalAddress(currencyIn, swap.zeroForOne ? zeroAddress : launch.token)
    && equalAddress(currencyOut, swap.zeroForOne ? launch.token : zeroAddress)
    && value === (swap.zeroForOne ? exactAmount : 0n);
}

async function permittedRawTransaction(policy: PreviewRpcPolicy, raw: unknown) {
  if (typeof raw !== "string" || !isHex(raw) || raw.length < 24 || raw.length > 12_288) return false;
  const serialized = raw as TransactionSerialized;
  const tx = parseTransaction(serialized);
  if ((tx.type !== "legacy" && tx.type !== "eip2930" && tx.type !== "eip1559") || tx.chainId !== 31337 || !tx.to || !tx.data
    || !tx.gas || tx.gas > previewRpcMaxGas || (tx.value ?? 0n) > maxValue
    || !equalAddress(await recoverTransactionAddress({ serializedTransaction: serialized }), policy.wallet)) return false;
  const { deployment } = policy.runtime;
  if (equalAddress(tx.to, deployment.factory)) {
    const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.data });
    if (decoded.functionName === "launch") return deadlineIsFresh(decoded.args[0].deadline) && tx.value === decoded.args[0].nativeAmount;
    if (decoded.functionName === "collectFees") return !(tx.value ?? 0n) && !!matchLaunch(policy, decoded.args[0]) && deadlineIsFresh(decoded.args[1]);
    return false;
  }
  if (equalAddress(tx.to, deployment.universalRouter)) return permittedSwap(policy, tx.data, tx.value ?? 0n);
  if (!deployment.tradingEnabled || tx.value) return false;
  if (equalAddress(tx.to, deployment.permit2)) {
    const { args: [token, spender, amount, expiration] } = decodeFunctionData({ abi: permitAbi, data: tx.data });
    return !!matchLaunch(policy, token) && equalAddress(spender, deployment.universalRouter)
      && amount > 0n && amount <= maxTokenAmount && deadlineIsFresh(BigInt(expiration));
  }
  if (!matchLaunch(policy, tx.to) || !tx.data.startsWith(toFunctionSelector("approve(address,uint256)"))) return false;
  const approval = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  return approval.functionName === "approve" && equalAddress(approval.args[0], deployment.permit2)
    && approval.args[1] <= maxTokenAmount;
}

function boundedLogs(policy: PreviewRpcPolicy, params: unknown[]) {
  const filter = record(params[0]);
  if (!filter || params.length !== 1 || Object.keys(filter).some((key) => !["address", "fromBlock", "toBlock", "topics"].includes(key))) return false;
  const from = quantity(filter.fromBlock);
  const to = quantity(filter.toBlock);
  const target = address(filter.address);
  return !!target && equalAddress(target, policy.runtime.deployment.poolManager)
    && from !== undefined && to !== undefined && from >= policy.runtime.startBlock
    && to >= from && to - from <= 1_000n && Array.isArray(filter.topics)
    && filter.topics.length === 2 && filter.topics.every((topic) => typeof topic === "string" && isHash(topic));
}

function boundedSimulation(policy: PreviewRpcPolicy, params: unknown[]) {
  const call = record(params[0]);
  if (!call || params.length > 2 || (params[1] !== undefined
    && !["latest", "pending"].includes(String(params[1])) && quantity(params[1]) === undefined)) return false;
  const to = address(call.to);
  if (!to || (call.from !== undefined && (!address(call.from) || !equalAddress(String(call.from), policy.wallet)))
    || (call.gas !== undefined && (quantity(call.gas) ?? previewRpcMaxGas + 1n) > previewRpcMaxGas)
    || (call.value !== undefined && (quantity(call.value) ?? maxValue + 1n) > maxValue)) return false;
  if (Object.keys(call).some((key) => !["to", "from", "data", "input", "gas", "value", "gasPrice",
    "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "chainId", "type", "accessList"].includes(key))) return false;
  const contracts = Object.values(policy.runtime.contracts);
  return contracts.some((pin) => equalAddress(to, pin.address)) || !!matchLaunch(policy, to);
}

export async function permittedPreviewRpc(policy: PreviewRpcPolicy, method: string, params: unknown[]) {
  try {
    if (method === "eth_call" || method === "eth_estimateGas") return boundedSimulation(policy, params);
    if (method === "eth_getLogs") return boundedLogs(policy, params);
    if (method === "eth_sendRawTransaction") return params.length === 1 && await permittedRawTransaction(policy, params[0]);
    if (method === "debug_traceTransaction") {
      const options = record(params[1]);
      if (params.length !== 2 || typeof params[0] !== "string" || !isHash(params[0]) || !options
        || Object.keys(options).length !== 1 || options.tracer !== "callTracer") return false;
      const tx = await policy.readTransaction(params[0] as Hex);
      return tx.blockNumber !== null && tx.blockNumber >= policy.runtime.startBlock
        && equalAddress(tx.from, policy.wallet) && equalAddress(tx.to, policy.runtime.deployment.universalRouter)
        && tx.input.startsWith(toFunctionSelector("execute(bytes,bytes[],uint256)"));
    }
    const limits = publicReadLengths.get(method);
    if (!limits || params.length < limits[0] || params.length > limits[1]) return false;
    if (method === "eth_feeHistory") return (quantity(params[0]) ?? 257n) <= 256n
      && (params[2] === undefined || Array.isArray(params[2]) && params[2].length <= 16);
    if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash") return params[1] === false;
    return true;
  } catch {
    return false;
  }
}
