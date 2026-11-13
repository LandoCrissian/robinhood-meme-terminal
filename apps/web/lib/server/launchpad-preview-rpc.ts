import {
  decodeAbiParameters, decodeFunctionData, erc20Abi, isAddress, isHash, isHex, parseAbi, parseEther,
  parseTransaction, recoverTransactionAddress, toFunctionSelector, zeroAddress,
  type Address, type Hex, type TransactionSerialized,
} from "viem";
import { curveAbi, curveFactoryAbi, curveGraduationAbi } from "../launchpad/curve-v1";
import { encodeSwap, exactInput20, exactInput212, factoryAbi, longevityFactoryAbi } from "../launchpad/direct-v4";
import { launchPoolId, type NewLaunchDeployment, type NewLaunchRecord } from "../launchpad/launch-record";
import type { LaunchpadRuntime } from "./new-launchpad-config";

const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const currencies = [{ type: "address" }, { type: "uint256" }] as const;
const maxValue = parseEther("100");
export const previewRpcMaxGas = 8_000_000n;
const maxTokenAmount = parseEther("1000000000");

type CommonPolicy = {
  wallet: Address;
  readTransaction(hash: Hex): Promise<{ from: string; to: string | null; blockNumber: bigint | null; input: Hex; blockHash?: Hex | null }>;
};
export type PreviewRpcPolicy = CommonPolicy & { runtime: LaunchpadRuntime; readLaunch(token: Address): NewLaunchRecord | undefined };
export type CurvePreviewProject = {
  token: Address; activeCurve: Address; poolId: Hex | undefined;
  targetRole: "token" | "activeCurve" | "previousCurve" | "curveLedger" | "lpLedger";
};
export type CurvePreviewRpcPolicy = CommonPolicy & {
  runtime: { deployment: NewLaunchDeployment; startBlock: bigint; contracts: Record<string, { address: Address }> };
  curve: {
    creationFee: bigint;
    graduationEngine: Address;
    lookup(target: Address): Promise<CurvePreviewProject | undefined>;
    timestamp(): Promise<bigint>;
    canonicalBlock(hash: Hex, height: bigint): Promise<boolean>;
  };
};
type RpcPolicy = PreviewRpcPolicy | CurvePreviewRpcPolicy;

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
  const { deployment } = policy.runtime;
  const hook = deployment.engineVersion === 2 ? deployment.initializationGuard : zeroAddress;
  return launch && hook && launch.chainId === 31337 && launch.engineVersion === deployment.engineVersion
    && equalAddress(launch.poolKey.hooks, hook) && equalAddress(launch.factory, deployment.factory)
    && equalAddress(launch.poolManager, deployment.poolManager) && equalAddress(launch.token, token) ? launch : undefined;
}

function deadlineIsFresh(deadline: bigint, now = nowSeconds()) {
  return deadline >= now && deadline <= now + 1_800n;
}

async function permittedSwap(policy: RpcPolicy, input: Hex, value: bigint, now?: bigint) {
  const { deployment } = policy.runtime;
  if (!deployment.tradingEnabled) return false;
  const { args: [commands, inputs, deadline] } = decodeFunctionData({ abi: routerAbi, data: input });
  if (commands !== "0x10" || inputs.length !== 1 || !deadlineIsFresh(deadline, now)) return false;
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
  if (actions !== "0x060b0f" || params.length !== 3) return false;
  const [currencyIn, exactAmount, payerIsUser] = decodeAbiParameters([...currencies, { type: "bool" }], params[1]);
  const [currencyOut, minAmount] = decodeAbiParameters(currencies, params[2]);
  if (!payerIsUser || exactAmount <= 0n || exactAmount > maxTokenAmount || minAmount <= 0n) return false;
  const swap = "curve" in policy ? decodeAbiParameters(exactInput212, params[0])[0] : decodeAbiParameters(exactInput20, params[0])[0];
  const token = swap.poolKey.currency1;
  const project = "curve" in policy ? await policy.curve.lookup(token) : matchLaunch(policy, token);
  if ("curve" in policy && encodeSwap("2.1.2", swap.poolKey, swap.zeroForOne, exactAmount, minAmount, deadline).toLowerCase()
    !== input.toLowerCase()) return false;
  return !!project && equalAddress(project.token, token) && project.poolId === launchPoolId(swap.poolKey) && swap.hookData === "0x"
    && swap.amountIn === exactAmount && swap.amountOutMinimum === minAmount
    && equalAddress(currencyIn, swap.zeroForOne ? zeroAddress : token)
    && equalAddress(currencyOut, swap.zeroForOne ? token : zeroAddress)
    && value === (swap.zeroForOne ? exactAmount : 0n);
}

async function permittedCurveTransaction(policy: CurvePreviewRpcPolicy, target: Address, data: Hex, value: bigint) {
  const { deployment } = policy.runtime;
  const now = await policy.curve.timestamp();
  if (equalAddress(target, deployment.factory)) {
    const call = decodeFunctionData({ abi: curveFactoryAbi, data });
    return call.functionName === "create" && value === policy.curve.creationFee && deadlineIsFresh(call.args[7], now);
  }
  if (equalAddress(target, deployment.universalRouter)) return permittedSwap(policy, data, value, now);
  if (equalAddress(target, policy.curve.graduationEngine)) {
    const call = decodeFunctionData({ abi: curveGraduationAbi, data });
    return call.functionName === "collectLpFees" && !value && deadlineIsFresh(call.args[1], now)
      && !!(await policy.curve.lookup(call.args[0]))?.poolId;
  }
  if (equalAddress(target, deployment.permit2)) {
    const { args: [token, spender, amount, expiration] } = decodeFunctionData({ abi: permitAbi, data });
    return !value && equalAddress(spender, deployment.universalRouter) && amount > 0n && amount <= maxTokenAmount
      && deadlineIsFresh(BigInt(expiration), now) && !!(await policy.curve.lookup(token))?.poolId;
  }
  const project = await policy.curve.lookup(target);
  if (!project) return false;
  switch (project.targetRole) {
    case "token": {
      if (value) return false;
      const approval = decodeFunctionData({ abi: erc20Abi, data });
      return approval.functionName === "approve" && approval.args[1] <= maxTokenAmount
        && equalAddress(approval.args[0], project.poolId ? deployment.permit2 : project.activeCurve);
    }
    case "activeCurve": {
      if (project.poolId) return false;
      const call = decodeFunctionData({ abi: curveAbi, data });
      if (call.functionName === "buy" || call.functionName === "buyAndGraduate") {
        return value > 0n && call.args[0] > 0n && deadlineIsFresh(call.args[1], now);
      }
      if (call.functionName === "sell") {
        return !value && call.args[0] > 0n && call.args[0] <= maxTokenAmount && call.args[1] > 0n && deadlineIsFresh(call.args[2], now);
      }
      return call.functionName === "graduate" && !value && deadlineIsFresh(call.args[0], now);
    }
    case "curveLedger":
    case "lpLedger":
      return !value && data === toFunctionSelector("claim()");
    case "previousCurve":
      return false;
  }
}

async function permittedRawTransaction(policy: RpcPolicy, raw: unknown) {
  if (typeof raw !== "string" || !isHex(raw) || raw.length < 24 || raw.length > 12_288) return false;
  const serialized = raw as TransactionSerialized;
  const tx = parseTransaction(serialized);
  if ((tx.type !== "legacy" && tx.type !== "eip2930" && tx.type !== "eip1559") || tx.chainId !== 31337 || !tx.to || !tx.data
    || !tx.gas || tx.gas > previewRpcMaxGas || (tx.value ?? 0n) > maxValue
    || !equalAddress(await recoverTransactionAddress({ serializedTransaction: serialized }), policy.wallet)) return false;
  if ("curve" in policy) return permittedCurveTransaction(policy, tx.to, tx.data, tx.value ?? 0n);
  const { deployment } = policy.runtime;
  if (equalAddress(tx.to, deployment.factory)) {
    const decoded = decodeFunctionData({ abi: deployment.engineVersion === 2 ? longevityFactoryAbi : factoryAbi, data: tx.data });
    if (decoded.functionName === "launch" || decoded.functionName === "launchWithLongevity") {
      return deadlineIsFresh(decoded.args[0].deadline) && tx.value === decoded.args[0].nativeAmount;
    }
    if (decoded.functionName === "collectFees") return !(tx.value ?? 0n) && !!matchLaunch(policy, decoded.args[0]) && deadlineIsFresh(decoded.args[1]);
    if (decoded.functionName === "withdrawFees") {
      const [token, bucket] = decoded.args;
      const terms = matchLaunch(policy, token)?.feePolicy;
      if (tx.value || !terms || bucket > 2) return false;
      const shares = [terms.creatorBps, terms.treasuryBps, terms.reserveBps];
      return shares[bucket] > 0 && equalAddress([terms.creator, terms.treasury, terms.reserve][bucket], policy.wallet);
    }
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

function boundedLogs(policy: RpcPolicy, params: unknown[]) {
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

async function boundedSimulation(policy: RpcPolicy, params: unknown[]) {
  const call = record(params[0]);
  const block = params[1];
  const selector = record(block);
  const canonical = "curve" in policy && selector && Object.keys(selector).length === 2 && selector.requireCanonical === true
    && typeof selector.blockHash === "string" && isHash(selector.blockHash);
  if (!call || params.length > 2 || (block !== undefined && !canonical
    && block !== "latest" && block !== "pending" && quantity(block) === undefined)) return false;
  const to = address(call.to);
  if (!to || (call.from !== undefined && (!address(call.from) || !equalAddress(String(call.from), policy.wallet)))
    || (call.gas !== undefined && (quantity(call.gas) ?? previewRpcMaxGas + 1n) > previewRpcMaxGas)
    || (call.value !== undefined && (quantity(call.value) ?? maxValue + 1n) > maxValue)) return false;
  if (Object.keys(call).some((key) => !["to", "from", "data", "input", "gas", "value", "gasPrice",
    "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "chainId", "type", "accessList"].includes(key))) return false;
  const contracts = Object.values(policy.runtime.contracts);
  return contracts.some((pin) => equalAddress(to, pin.address))
    || ("curve" in policy ? !!await policy.curve.lookup(to) : !!matchLaunch(policy, to));
}

async function permittedCurveTrace(policy: CurvePreviewRpcPolicy, tx: Awaited<ReturnType<CommonPolicy["readTransaction"]>>) {
  if (!tx.to || !tx.blockHash || tx.blockNumber === null || !await policy.curve.canonicalBlock(tx.blockHash, tx.blockNumber)) return false;
  const selector = tx.input.slice(0, 10);
  if (equalAddress(tx.to, policy.runtime.deployment.factory)) return selector === toFunctionSelector(curveFactoryAbi[0]);
  if (equalAddress(tx.to, policy.runtime.deployment.universalRouter)) return selector === toFunctionSelector(routerAbi[0]);
  if (equalAddress(tx.to, policy.curve.graduationEngine)) return selector === toFunctionSelector("collectLpFees(address,uint256)");
  const project = await policy.curve.lookup(tx.to as Address);
  if (project?.targetRole === "curveLedger" || project?.targetRole === "lpLedger") return selector === toFunctionSelector("claim()");
  return (project?.targetRole === "activeCurve" || project?.targetRole === "previousCurve")
    && ["buy(uint256,uint256)", "buyAndGraduate(uint256,uint256)", "sell(uint256,uint256,uint256)", "graduate(uint256)"].some((call) => selector === toFunctionSelector(call));
}

export async function permittedPreviewRpc(policy: RpcPolicy, method: string, params: unknown[]) {
  try {
    if (method === "eth_call" || method === "eth_estimateGas") return await boundedSimulation(policy, params);
    if (method === "eth_getLogs") return boundedLogs(policy, params);
    if (method === "eth_sendRawTransaction") return params.length === 1 && await permittedRawTransaction(policy, params[0]);
    if (method === "debug_traceTransaction") {
      const options = record(params[1]);
      if (params.length !== 2 || typeof params[0] !== "string" || !isHash(params[0]) || !options
        || Object.keys(options).length !== 1 || options.tracer !== "callTracer") return false;
      const tx = await policy.readTransaction(params[0] as Hex);
      if (tx.blockNumber === null || tx.blockNumber < policy.runtime.startBlock || !equalAddress(tx.from, policy.wallet)) return false;
      return "curve" in policy ? await permittedCurveTrace(policy, tx) : equalAddress(tx.to, policy.runtime.deployment.universalRouter)
        && tx.input.startsWith(toFunctionSelector(routerAbi[0]));
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
