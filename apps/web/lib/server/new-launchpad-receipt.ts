import {
  decodeEventLog, getAddress, parseAbi, parseAbiItem, toHex, zeroAddress,
  type AbiEvent, type Address, type Hash, type Log, type PublicClient, type TransactionReceipt,
} from "viem";
import { launchCreatedEvent, launchPoolId, type NewLaunchDeployment, type NewLaunchRecord } from "../launchpad/launch-record";

const initialize = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");
const modifyLiquidity = parseAbiItem("event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)");
const tokenTransfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const positionTransfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const positionAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
]);

export class InvalidLaunchReceipt extends Error {}

export type LaunchReceiptBinding = { creator: Address; intentId: Hash };

export function sameHex(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function decode<Event extends AbiEvent>(event: Event, address: Address, logs: Log[]) {
  return logs.flatMap((log) => {
    if (log.removed || log.logIndex === null || !sameHex(log.address, address)) return [];
    try {
      const { args } = decodeEventLog({ abi: [event], data: log.data, topics: log.topics, strict: true });
      if (!args || Array.isArray(args)) return [];
      return [{ args: args as Exclude<typeof args, readonly unknown[] | undefined>, logIndex: log.logIndex }];
    } catch {
      return [];
    }
  });
}

export function projectLaunchReceipt(
  deployment: NewLaunchDeployment,
  receipt: TransactionReceipt,
  requestedHash: Hash,
  binding?: LaunchReceiptBinding,
): NewLaunchRecord {
  if (receipt.status !== "success" || !sameHex(receipt.transactionHash, requestedHash)) {
    throw new InvalidLaunchReceipt("The launch transaction did not succeed");
  }
  const receiptLogs = receipt.logs.filter((log) => sameHex(log.transactionHash, receipt.transactionHash)
    && sameHex(log.blockHash, receipt.blockHash) && log.blockNumber === receipt.blockNumber);
  const canonicalEvents = decode(launchCreatedEvent, deployment.factory, receiptLogs);
  if (canonicalEvents.length !== 1) throw new InvalidLaunchReceipt("Expected one canonical factory launch event");
  const [{ args, logIndex }] = canonicalEvents;
  if (!args) throw new InvalidLaunchReceipt("Invalid factory launch event");
  const { creator, token, poolId, intentId, poolKey, positionTokenId, sqrtPriceX96,
    tickLower, tickUpper, liquidity, amount0, amount1, totalSupply, name, symbol, projectURI } = args;

  if (sameHex(creator, zeroAddress) || sameHex(token, zeroAddress) || (binding &&
    (!sameHex(creator, binding.creator) || !sameHex(intentId, binding.intentId)))) {
    throw new InvalidLaunchReceipt("The launch does not match the reviewed creator and intent");
  }
  if (!sameHex(poolKey.currency0, zeroAddress) || !sameHex(poolKey.currency1, token) || !sameHex(poolKey.hooks, zeroAddress)
    || poolKey.fee !== 3000 || poolKey.tickSpacing !== 60 || !sameHex(poolId, launchPoolId(poolKey))
    || tickLower !== -887220 || tickUpper !== 887220 || positionTokenId <= 0n || sqrtPriceX96 <= 0n
    || liquidity <= 0n || amount0 <= 0n || amount1 <= 0n || amount1 > totalSupply) {
    throw new InvalidLaunchReceipt("The launch does not match the supported funded pool terms");
  }

  const initialization = decode(initialize, deployment.poolManager, receiptLogs).find(({ args: data, logIndex: index }) =>
    data && index < logIndex && sameHex(data.id, poolId) && sameHex(data.currency0, poolKey.currency0)
      && sameHex(data.currency1, token) && data.fee === poolKey.fee && data.tickSpacing === poolKey.tickSpacing
      && sameHex(data.hooks, poolKey.hooks) && data.sqrtPriceX96 === sqrtPriceX96 && data.tick >= tickLower && data.tick < tickUpper);
  const liquidityChange = decode(modifyLiquidity, deployment.poolManager, receiptLogs).find(({ args: data, logIndex: index }) =>
    data && initialization && index > initialization.logIndex && index < logIndex && sameHex(data.id, poolId)
      && sameHex(data.sender, deployment.positionManager) && data.tickLower === tickLower && data.tickUpper === tickUpper
      && data.liquidityDelta === liquidity && sameHex(data.salt, toHex(positionTokenId, { size: 32 })));
  const custodyMint = decode(positionTransfer, deployment.positionManager, receiptLogs).find(({ args: data, logIndex: index }) =>
    data && liquidityChange && index < liquidityChange.logIndex && sameHex(data.from, zeroAddress)
      && sameHex(data.to, deployment.factory) && data.tokenId === positionTokenId);
  const transferLogs = decode(tokenTransfer, token, receiptLogs);
  const supplyMinted = transferLogs.find(({ args: data, logIndex: index }) => data && initialization
    && index < initialization.logIndex && sameHex(data.from, zeroAddress) && sameHex(data.to, deployment.factory)
    && data.value === totalSupply);
  const tokenDeposit = transferLogs.find(({ args: data, logIndex: index }) => data && liquidityChange
    && index > liquidityChange.logIndex && index < logIndex && sameHex(data.from, deployment.factory)
    && sameHex(data.to, deployment.poolManager) && data.value === amount1);
  if (!initialization || !liquidityChange || !custodyMint || !supplyMinted || !tokenDeposit) {
    throw new InvalidLaunchReceipt("The receipt is missing the pool, custody or token settlement evidence");
  }

  return {
    chainId: deployment.chainId, factory: deployment.factory, creator: getAddress(creator), token: getAddress(token),
    poolManager: deployment.poolManager, poolId, poolKey, intentId, positionTokenId: positionTokenId.toString(),
    sqrtPriceX96: sqrtPriceX96.toString(), tickLower, tickUpper, liquidity: liquidity.toString(),
    amount0: amount0.toString(), amount1: amount1.toString(), totalSupply: totalSupply.toString(), name, symbol, projectURI,
    transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    logIndex, indexing: "pending",
  };
}

export async function verifyLaunchReceipt(
  rpc: PublicClient,
  deployment: NewLaunchDeployment,
  transactionHash: Hash,
  binding?: LaunchReceiptBinding,
): Promise<NewLaunchRecord> {
  const receipt = await rpc.getTransactionReceipt({ hash: transactionHash });
  const record = projectLaunchReceipt(deployment, receipt, transactionHash, binding);
  const position = { address: deployment.positionManager, abi: positionAbi, args: [BigInt(record.positionTokenId)] as const, blockNumber: receipt.blockNumber };
  const [owner, liquidity] = await Promise.all([
    rpc.readContract({ ...position, functionName: "ownerOf" }),
    rpc.readContract({ ...position, functionName: "getPositionLiquidity" }),
  ]);
  const canonicalBlock = await rpc.getBlock({ blockNumber: receipt.blockNumber, includeTransactions: false });
  if (!sameHex(receipt.blockHash, canonicalBlock.hash)) throw new Error("Launch receipt block is no longer canonical");
  if (!sameHex(owner, deployment.factory) || liquidity.toString() !== record.liquidity) {
    throw new InvalidLaunchReceipt("Onchain position ownership or liquidity does not match the launch event");
  }
  return { ...record, blockTimestamp: canonicalBlock.timestamp?.toString() };
}
