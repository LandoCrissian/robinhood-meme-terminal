import {
  createPublicClient, encodeAbiParameters, encodeFunctionData, erc20Abi, formatEther, http, keccak256, parseAbi,
  parseAbiItem, parseEventLogs, toHex, zeroAddress,
  type Address, type Hex, type PublicClient, type TransactionReceipt,
} from "viem";
import { launchPoolId, launchPoolKeyParameter, type LaunchPoolKey, type NewLaunchRecord } from "./launch-record";
import { NativeSettlementPending, verifyNativeSettlement, type NativeSettlementOptions } from "./native-settlement";
import { boundedReceiptLogs } from "./receipt-logs";
import { launchpadRouterPins, launchpadRouterVersion, type LaunchpadRouterVersion } from "./router-pins";
import type { BoundWallet, LaunchDeployment, LaunchRequest } from "./transactions";

export const factoryAbi = parseAbi([
  "function preview(uint8 supplyPreset,uint16 poolAllocationBps,uint128 nativeAmount) pure returns (uint256 totalSupply,uint128 tokenMaximum,uint160 sqrtPriceX96,uint128 liquidity,uint128 amount0,uint128 amount1)",
  "function launch((string name,string symbol,string projectURI,bytes32 intentId,uint8 supplyPreset,uint16 poolAllocationBps,uint128 nativeAmount,uint256 deadline) terms) payable returns (address token)",
  "function collectFees(address token,uint256 deadline)",
]);
export const longevityFactoryAbi = [
  ...factoryAbi,
  ...parseAbi([
    "function launchWithLongevity((string name,string symbol,string projectURI,bytes32 intentId,uint8 supplyPreset,uint16 poolAllocationBps,uint128 nativeAmount,uint256 deadline) terms,(address treasury,address reserve,uint16 creatorBps,uint16 treasuryBps,uint16 reserveBps) feePolicy) payable returns (address token)",
    "function withdrawFees(address token,uint8 bucket)",
  ]),
] as const;
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const permitAbi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const swapEvent = parseAbiItem("event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)");
const maxInput = (1n << 127n) - 1n;
const priceScale = 1n << 192n;
const hopPriceScale = 10n ** 36n;
const exactInputFields = [
  { name: "poolKey", ...launchPoolKeyParameter },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" },
  { name: "amountOutMinimum", type: "uint128" },
] as const;
const exactInput20 = [{ type: "tuple", components: [...exactInputFields, { name: "hookData", type: "bytes" }] }] as const;
const exactInput212 = [{
  type: "tuple", components: [...exactInputFields, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }],
}] as const;

export function launchPublicClient(deployment: LaunchDeployment) {
  return createPublicClient({ transport: http(deployment.rpcUrl, { timeout: 12_000, retryCount: 1, maxResponseBodySize: 1024 * 1024 }) });
}

export function priceInWei(sqrtPriceX96: bigint) {
  return sqrtPriceX96 > 0n ? priceScale * 10n ** 18n / (sqrtPriceX96 * sqrtPriceX96) : 0n;
}

export function displayAmount(amount: bigint | string) {
  const display = formatEther(BigInt(amount));
  const [whole, fraction] = display.split(".");
  if (!fraction) return BigInt(whole).toLocaleString("en-US");
  if (whole === "0" && Number(display) < 0.000001) return display;
  return `${BigInt(whole).toLocaleString("en-US")}.${fraction.slice(0, 8).replace(/0+$/, "") || "0"}`;
}

export async function prepareTransaction(
  client: PublicClient, deployment: LaunchDeployment, wallet: BoundWallet,
  operation: Pick<LaunchRequest, "kind" | "to" | "data" | "deadline" | "intentId" | "token" | "amountIn" | "minimumOut" | "feeBucket"> & { value?: bigint },
): Promise<LaunchRequest> {
  if (wallet.chainId !== deployment.chainId || await client.getChainId() !== deployment.chainId) {
    throw new Error(`Switch your wallet to ${deployment.name} before reviewing.`);
  }
  const value = operation.value ?? 0n;
  const params = { account: wallet.address, to: operation.to, data: operation.data, value };
  const [block, balance, gas, gasPrice] = await Promise.all([
    client.getBlock(), client.getBalance({ address: wallet.address }), client.estimateGas(params), client.getGasPrice(),
    client.call(params),
  ]);
  if (balance < value + gas * gasPrice) throw new Error("Insufficient ETH for the amount and network gas.");
  if (!block.hash || block.number === null) throw new Error("Network block evidence is unavailable. Try reviewing again.");
  return {
    ...operation, chainId: deployment.chainId, from: wallet.address, value: toHex(value),
    blockNumber: toHex(block.number), blockHash: block.hash,
  };
}

export type SwapReview = {
  side: "buy" | "sell";
  amountIn: bigint;
  amountOut: bigint;
  minimumOut: bigint;
  deadline: number;
  request: LaunchRequest;
};

function assertLaunchPool(deployment: LaunchDeployment, record: NewLaunchRecord) {
  const key = record.poolKey;
  const guard = deployment.engineVersion === 2 ? deployment.initializationGuard : zeroAddress;
  if (deployment.chainId !== 31337 || record.chainId !== deployment.chainId
    || record.engineVersion !== deployment.engineVersion || !guard
    || record.poolManager.toLowerCase() !== deployment.poolManager.toLowerCase()
    || record.factory.toLowerCase() !== deployment.factory.toLowerCase()
    || key.currency0 !== zeroAddress || key.currency1.toLowerCase() !== record.token.toLowerCase()
    || key.hooks.toLowerCase() !== guard.toLowerCase() || key.fee !== 3000 || key.tickSpacing !== 60 || launchPoolId(key) !== record.poolId) {
    throw new Error("Direct trading is unavailable for this pool.");
  }
}

function routerSupportsDeployment(deployment: LaunchDeployment, version: LaunchpadRouterVersion) {
  if (version === "2.0") return true;
  const rpc = new URL(deployment.rpcUrl);
  return deployment.engineVersion === 2 && rpc.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname) && rpc.pathname === "/"
    && !rpc.username && !rpc.password && !rpc.search && !rpc.hash;
}

function encodeSwap(
  version: LaunchpadRouterVersion, poolKey: LaunchPoolKey, buy: boolean,
  amountIn: bigint, minimumOut: bigint, deadline: number,
) {
  const swap = { poolKey, zeroForOne: buy, amountIn, amountOutMinimum: minimumOut, hookData: "0x" as const };
  // The router's price is output base units per input base unit. Use the same reviewed floor as amountOutMinimum.
  const minHopPriceX36 = version === "2.1.2" ? minimumOut * hopPriceScale / amountIn : undefined;
  if (minHopPriceX36 === 0n) throw new Error("The minimum per-hop price is outside the supported range.");
  const swapParams = minHopPriceX36 === undefined
    ? encodeAbiParameters(exactInput20, [swap])
    : encodeAbiParameters(exactInput212, [{ ...swap, minHopPriceX36 }]);
  const [currencyIn, currencyOut] = buy ? [poolKey.currency0, poolKey.currency1] : [poolKey.currency1, poolKey.currency0];
  // Explicit exact settlement leaves a nonzero delta and reverts if the pool consumes a partial input.
  const settleParams = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [currencyIn, amountIn, true]);
  const takeParams = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minimumOut]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }],
    ["0x060b0f", [swapParams, settleParams, takeParams]]);
  return encodeFunctionData({ abi: routerAbi, functionName: "execute", args: ["0x10", [input], BigInt(deadline)] });
}

export async function prepareSwap(
  client: PublicClient, deployment: LaunchDeployment, wallet: BoundWallet, record: NewLaunchRecord,
  side: "buy" | "sell", amountIn: bigint, slippageBps: number,
): Promise<SwapReview> {
  assertLaunchPool(deployment, record);
  const version = launchpadRouterVersion(deployment.universalRouter);
  if (!deployment.tradingEnabled || !version || !routerSupportsDeployment(deployment, version)
    || (deployment.universalRouterVersion && deployment.universalRouterVersion !== version)) {
    throw new Error("Direct trading is unavailable for this router.");
  }
  if (amountIn <= 0n || amountIn > maxInput || !Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) {
    throw new Error("Enter a supported amount and slippage between 0.10% and 5.00%.");
  }
  const buy = side === "buy";
  const deadline = Math.floor(Date.now() / 1000) + 5 * 60;
  const token = record.token;
  const prepare = (operation: Parameters<typeof prepareTransaction>[3]) => prepareTransaction(client, deployment, wallet, operation);

  const { result: [amountOut] } = await client.simulateContract({
    address: deployment.quoter, abi: quoterAbi, functionName: "quoteExactInputSingle",
    args: [{ poolKey: record.poolKey, zeroForOne: buy, exactAmount: amountIn, hookData: "0x" }],
    account: wallet.address,
  });
  const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  if (minimumOut === 0n || amountOut > maxInput) throw new Error("The quoted output is outside the supported range.");
  const review = { side, amountIn, amountOut, minimumOut, deadline };

  if (!buy) {
    const [balance, tokenAllowance, [routerAllowance, expiration]] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [wallet.address, deployment.permit2] }),
      client.readContract({ address: deployment.permit2, abi: permitAbi, functionName: "allowance",
        args: [wallet.address, token, deployment.universalRouter] }),
    ]);
    if (balance < amountIn) throw new Error("Insufficient token balance for this sell.");
    if (tokenAllowance !== amountIn) {
      return { ...review, request: await prepare({
        kind: "token-approval", to: token, token, deadline, amountIn: amountIn.toString(),
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deployment.permit2, amountIn] }),
      }) };
    }
    if (routerAllowance !== amountIn || expiration <= Math.floor(Date.now() / 1000) + 30) {
      return { ...review, request: await prepare({
        kind: "router-approval", to: deployment.permit2, token, deadline, amountIn: amountIn.toString(),
        data: encodeFunctionData({ abi: permitAbi, functionName: "approve", args: [token, deployment.universalRouter, amountIn, deadline] }),
      }) };
    }
  }

  const request = await prepare({
    kind: side, to: deployment.universalRouter, token, deadline,
    amountIn: amountIn.toString(), minimumOut: minimumOut.toString(), value: buy ? amountIn : 0n,
    data: encodeSwap(version, record.poolKey, buy, amountIn, minimumOut, deadline),
  });
  return { ...review, request };
}

function sameAddress(left: string | null, right: string) {
  return left?.toLowerCase() === right.toLowerCase();
}

export async function boundReceipt(client: PublicClient, hash: Hex, request: LaunchRequest) {
  if (await client.getChainId() !== request.chainId) throw new Error("Receipt RPC is on a different network.");
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }), client.getTransactionReceipt({ hash }),
  ]);
  if (transaction.hash.toLowerCase() !== hash.toLowerCase() || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
    || !sameAddress(transaction.from, request.from) || !sameAddress(transaction.to, request.to)
    || !sameAddress(receipt.from, request.from) || !sameAddress(receipt.to, request.to)
    || transaction.input !== request.data || transaction.value !== BigInt(request.value)
    || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber) {
    throw new Error("This transaction does not match the reviewed wallet request.");
  }
  const reviewedNumber = BigInt(request.blockNumber);
  if (receipt.blockNumber < reviewedNumber) throw new Error("The receipt predates the reviewed network block.");
  const [block, reviewedBlock] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlock({ blockNumber: reviewedNumber }),
  ]);
  if (block.number !== receipt.blockNumber || block.hash !== receipt.blockHash) {
    throw new Error("The receipt block changed. Check again after network recovery.");
  }
  if (reviewedBlock.number !== reviewedNumber || reviewedBlock.hash !== request.blockHash) {
    throw new Error("The reviewed network block changed. Recovery requires the original network evidence.");
  }
  return receipt;
}

export async function verifySwap(
  client: PublicClient, receipt: TransactionReceipt, deployment: LaunchDeployment, record: NewLaunchRecord, request: LaunchRequest,
  options?: NativeSettlementOptions,
) {
  assertLaunchPool(deployment, record);
  const buy = request.kind === "buy";
  const version = launchpadRouterVersion(request.to);
  const amountIn = BigInt(request.amountIn ?? "0");
  const minimumOut = BigInt(request.minimumOut ?? "0");
  if (!version || !routerSupportsDeployment(deployment, version) || request.chainId !== record.chainId
    || (!buy && request.kind !== "sell") || !sameAddress(request.token ?? null, record.token)
    || !sameAddress(receipt.to, request.to) || !sameAddress(receipt.from, request.from) || receipt.status !== "success"
    || amountIn <= 0n || amountIn > maxInput || minimumOut <= 0n || minimumOut > maxInput
    || !Number.isSafeInteger(request.deadline) || request.deadline <= 0
    || BigInt(request.value) !== (buy ? amountIn : 0n)
    || request.data !== encodeSwap(version, record.poolKey, buy, amountIn, minimumOut, request.deadline)) {
    throw new Error("The transaction does not match the reviewed pool swap.");
  }
  const routerCode = await client.getCode({ address: request.to, blockHash: receipt.blockHash, requireCanonical: true });
  if (!routerCode || keccak256(routerCode) !== launchpadRouterPins[version].runtimeHash) {
    throw new Error("The receipt router runtime does not match its pinned hash.");
  }
  const receiptLogs = boundedReceiptLogs(receipt);
  const logs = receiptLogs.filter((log) => sameAddress(log.address, deployment.poolManager));
  const swaps = parseEventLogs({ abi: [swapEvent], logs }).filter(({ args }) =>
    args.id === record.poolId && sameAddress(args.sender, request.to));
  const swap = swaps[0];
  const input = buy ? -(swap?.args.amount0 ?? 0n) : -(swap?.args.amount1 ?? 0n);
  const output = buy ? (swap?.args.amount1 ?? 0n) : (swap?.args.amount0 ?? 0n);
  if (swaps.length !== 1 || input !== amountIn || output < minimumOut) {
    throw new Error("The receipt does not prove the reviewed pool swap.");
  }
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer",
    logs: receiptLogs.filter((log) => sameAddress(log.address, record.token)) });
  const tokenPayments = transfers.filter(({ args }) => buy
    ? sameAddress(args.from, deployment.poolManager) && sameAddress(args.to, request.from)
    : sameAddress(args.from, request.from) && sameAddress(args.to, deployment.poolManager));
  if (tokenPayments.length !== 1 || tokenPayments[0].args.value !== (buy ? output : input)) {
    throw new Error("The receipt does not prove the token transfer.");
  }
  if (!buy) {
    if (request.chainId !== 31337 && !options?.corroboration) throw new NativeSettlementPending("unavailable");
    await verifyNativeSettlement(client, receipt, record, request, swap.logIndex, output,
      (rpc, hash) => boundReceipt(rpc, hash, request), options);
  }
  return output;
}

export async function readTradeHistory(client: PublicClient, record: NewLaunchRecord) {
  const latest = await client.getBlockNumber();
  const first = BigInt(record.blockNumber);
  const fromBlock = latest > first + 1_000n ? latest - 1_000n : first;
  const logs = await client.getLogs({
    address: record.poolManager, event: swapEvent, args: { id: record.poolId }, fromBlock, toBlock: latest, strict: true,
  });
  return logs.slice(-60).map(({ blockNumber, args }) => ({
    blockNumber, priceWei: priceInWei(args.sqrtPriceX96), side: args.amount0 < 0n ? "buy" as const : "sell" as const,
  }));
}
