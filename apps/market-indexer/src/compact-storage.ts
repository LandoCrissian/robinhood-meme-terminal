import type { Hex } from "viem";
import { marketSources, type MarketSource } from "./sources.js";

export const MARKET_SOURCE_CODES = Object.freeze({
  "sushiswap-v2": 1,
  "sushiswap-v3": 2,
  "uniswap-v2": 3,
  "uniswap-v3": 4,
  "uniswap-v4": 5,
  "up-v2": 6,
  "up-cl": 7
} as const);

export type MarketSourceId = keyof typeof MARKET_SOURCE_CODES;
export type MarketSourceCode = (typeof MARKET_SOURCE_CODES)[MarketSourceId];

const SOURCE_BY_CODE = new Map<number, MarketSource>(
  marketSources.map((source) => [sourceCodeForId(source.id), source])
);

export function sourceCodeForId(sourceId: string): MarketSourceCode {
  const code = MARKET_SOURCE_CODES[sourceId as MarketSourceId];
  if (code === undefined) throw new Error(`unsupported market source ${sourceId}`);
  return code;
}

export function sourceForCode(sourceCode: number) {
  const source = SOURCE_BY_CODE.get(sourceCode);
  if (!source) throw new Error(`unsupported compact source code ${sourceCode}`);
  return source;
}

export function hexBytes(value: string, bytes: number, label: string) {
  if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error(`${label} must be canonical lowercase ${bytes}-byte hex`);
  }
  return Buffer.from(value.slice(2), "hex");
}

export function bytesHex(value: Buffer, bytes: number, label: string): Hex {
  if (!Buffer.isBuffer(value) || value.length !== bytes) {
    throw new Error(`PostgreSQL returned invalid ${label}`);
  }
  return `0x${value.toString("hex")}`;
}

function uint24(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff_ff_ff) {
    throw new Error("pool fee is outside uint24");
  }
  return Buffer.from([value >>> 16, value >>> 8, value]);
}

function int16(value: number) {
  if (!Number.isSafeInteger(value) || value < -32_768 || value > 32_767) {
    throw new Error("pool tick spacing is outside int16");
  }
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeInt16BE(value);
  return buffer;
}

export type CompactPoolInput = Readonly<{
  sourceId: string;
  poolKey: string;
  token0: string;
  token1: string;
  stable: boolean | null;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logIndex: number;
}>;

export function compactBlockNumber(value: bigint) {
  if (value < 0n || value > 2_147_483_647n) {
    throw new Error("block number is outside compact schema v3");
  }
  return Number(value);
}

export function packPoolAttributes(pool: CompactPoolInput) {
  const sourceCode = sourceCodeForId(pool.sourceId);
  switch (sourceCode) {
    case 1:
    case 3:
      if (pool.stable !== null || pool.fee !== null || pool.tickSpacing !== null || pool.hooks !== null) {
        throw new Error("v2 pool attributes do not match source manifest");
      }
      return null;
    case 2:
    case 4:
      if (pool.stable !== null || pool.fee === null || pool.tickSpacing === null || pool.hooks !== null) {
        throw new Error("v3 pool attributes do not match source manifest");
      }
      return Buffer.concat([uint24(pool.fee), int16(pool.tickSpacing)]);
    case 5:
      if (pool.stable !== null || pool.fee === null || pool.tickSpacing === null || pool.hooks === null) {
        throw new Error("v4 pool attributes do not match source manifest");
      }
      return Buffer.concat([
        uint24(pool.fee),
        int16(pool.tickSpacing),
        hexBytes(pool.hooks, 20, "v4 hooks")
      ]);
    case 6:
      if (pool.stable === null || pool.fee !== null || pool.tickSpacing !== null || pool.hooks !== null) {
        throw new Error("up-v2 pool attributes do not match source manifest");
      }
      return Buffer.from([pool.stable ? 1 : 0]);
    case 7:
      if (pool.stable !== null || pool.fee !== null || pool.tickSpacing === null || pool.hooks !== null) {
        throw new Error("up-cl pool attributes do not match source manifest");
      }
      return int16(pool.tickSpacing);
  }
}

export function packPoolProvenance(transactionHash: string, blockHash: string) {
  return Buffer.concat([
    hexBytes(transactionHash, 32, "transaction hash"),
    hexBytes(blockHash, 32, "block hash")
  ]);
}

export function packSyncProvenance(blockHash: string, parentHash: string) {
  return Buffer.concat([
    hexBytes(blockHash, 32, "block hash"),
    hexBytes(parentHash, 32, "parent hash")
  ]);
}
