import type { DiscoveredPool, RawMarketLog } from "./decoder.js";
import { decodeMarketLog } from "./decoder.js";
import type { MarketSource } from "./sources.js";

export type SyncPoint = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

function compareLogs(a: RawMarketLog, b: RawMarketLog) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.transactionIndex !== b.transactionIndex) {
    return a.transactionIndex - b.transactionIndex;
  }
  return a.logIndex - b.logIndex;
}

export function replayMarketLogs(
  source: MarketSource,
  logs: readonly RawMarketLog[]
): readonly DiscoveredPool[] {
  const seen = new Map<string, string>();
  const output: DiscoveredPool[] = [];
  for (const log of [...logs].sort(compareLogs)) {
    const identity = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    const fingerprint = [
      log.address.toLowerCase(),
      log.blockNumber,
      log.blockHash.toLowerCase(),
      log.transactionIndex,
      log.topics.join(",").toLowerCase(),
      log.data.toLowerCase()
    ].join("|");
    const previous = seen.get(identity);
    if (previous !== undefined) {
      if (previous !== fingerprint) {
        throw new Error(`conflicting duplicate log ${identity}`);
      }
      continue;
    }
    seen.set(identity, fingerprint);
    const decoded = decodeMarketLog(source, log);
    if (decoded) output.push(decoded);
  }
  return Object.freeze(output);
}

export async function findReorgAncestor(
  pointsNewestFirst: readonly SyncPoint[],
  canonicalHash: (blockNumber: bigint) => Promise<string | null>
) {
  if (pointsNewestFirst.length === 0) return null;
  for (const point of pointsNewestFirst) {
    const canonical = await canonicalHash(point.blockNumber);
    if (canonical?.toLowerCase() === point.blockHash.toLowerCase()) {
      return point.blockNumber;
    }
  }
  throw new Error("reorg exceeds retained checkpoint history");
}
