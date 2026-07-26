import {
  decodeEventLog,
  encodeEventTopics,
  getAddress,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import type { MarketSource } from "./sources.js";

export type RawMarketLog = Readonly<{
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  removed?: boolean;
}>;

export type DiscoveredPool = Readonly<{
  sourceId: string;
  protocol: MarketSource["protocol"];
  version: MarketSource["version"];
  poolKey: string;
  poolAddress: string | null;
  token0: string;
  token1: string;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
}>;

function lowerAddress(value: Address) {
  return getAddress(value).toLowerCase();
}

function expectedTopic(source: MarketSource) {
  return encodeEventTopics({ abi: [source.event] })[0]!.toLowerCase();
}

function requireOrderedCurrencies(token0: Address, token1: Address) {
  const first = BigInt(token0);
  const second = BigInt(token1);
  if (first >= second) {
    throw new Error("pool currencies must be distinct and canonically ordered");
  }
}

export function decodeMarketLog(
  source: MarketSource,
  log: RawMarketLog
): DiscoveredPool | null {
  if (log.removed) throw new Error("removed logs are not accepted");
  if (log.address.toLowerCase() !== source.contract.toLowerCase()) {
    throw new Error(`log address does not match ${source.id}`);
  }
  const topic0 = log.topics[0]?.toLowerCase();
  if (topic0 !== expectedTopic(source)) return null;
  if (!log.blockHash || !log.transactionHash) {
    throw new Error("confirmed log provenance is incomplete");
  }

  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: [source.event],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true
    });
  } catch (error) {
    throw new Error(
      `malformed ${source.id} market event: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const args = decoded.args as Record<string, unknown>;
  const token0 = getAddress(String(args.token0 ?? args.currency0));
  const token1 = getAddress(String(args.token1 ?? args.currency1));
  requireOrderedCurrencies(token0, token1);

  let poolKey: string;
  let poolAddress: string | null = null;
  let fee: number | null = null;
  let tickSpacing: number | null = null;
  let hooks: string | null = null;

  if (source.kind === "v2-factory") {
    const pair = getAddress(String(args.pair));
    if (pair === zeroAddress) throw new Error("V2 pair address is zero");
    poolAddress = lowerAddress(pair);
    poolKey = poolAddress;
  } else if (source.kind === "v3-factory") {
    const pool = getAddress(String(args.pool));
    if (pool === zeroAddress) throw new Error("V3 pool address is zero");
    const decodedFee = Number(args.fee);
    const decodedSpacing = Number(args.tickSpacing);
    if (
      !Number.isSafeInteger(decodedFee) ||
      decodedFee <= 0 ||
      decodedFee > 1_000_000 ||
      !Number.isSafeInteger(decodedSpacing) ||
      decodedSpacing <= 0 ||
      decodedSpacing > 16_384
    ) {
      throw new Error("V3 pool fee or tick spacing is outside the supported domain");
    }
    poolAddress = lowerAddress(pool);
    poolKey = poolAddress;
    fee = decodedFee;
    tickSpacing = decodedSpacing;
  } else {
    const id = String(args.id).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(id) || /^0x0{64}$/.test(id)) {
      throw new Error("V4 pool ID is invalid");
    }
    const decodedFee = Number(args.fee);
    const decodedSpacing = Number(args.tickSpacing);
    const decodedHooks = getAddress(String(args.hooks));
    if (
      !Number.isSafeInteger(decodedFee) ||
      decodedFee < 0 ||
      decodedFee > 0xff_ffff ||
      !Number.isSafeInteger(decodedSpacing) ||
      decodedSpacing <= 0 ||
      decodedSpacing > 32_767
    ) {
      throw new Error("V4 pool fee or tick spacing is outside the supported domain");
    }
    poolKey = id;
    fee = decodedFee;
    tickSpacing = decodedSpacing;
    hooks = lowerAddress(decodedHooks);
  }

  return Object.freeze({
    sourceId: source.id,
    protocol: source.protocol,
    version: source.version,
    poolKey,
    poolAddress,
    token0: lowerAddress(token0),
    token1: lowerAddress(token1),
    fee,
    tickSpacing,
    hooks,
    transactionHash: log.transactionHash.toLowerCase(),
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash.toLowerCase()
  });
}
