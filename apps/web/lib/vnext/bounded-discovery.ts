import { VNEXT_MARKET_DIRECTORY_MAX_MARKETS } from "./market-directory";

export type BoundedDiscoveryCoverage = {
  mode: "bounded";
  completeWithinObservedCandidates: boolean;
  truncated: boolean;
  returnedCount: number;
  observedCandidateCount: number;
  limit: number;
};

// This describes this observation only, never an exhaustive chain inventory.
export function boundedDiscoveryCoverage(observedCandidateCount: number, delayed: boolean): BoundedDiscoveryCoverage {
  const limit = VNEXT_MARKET_DIRECTORY_MAX_MARKETS;
  const truncated = observedCandidateCount > limit;
  return {
    mode: "bounded", completeWithinObservedCandidates: !delayed && !truncated,
    truncated, returnedCount: Math.min(observedCandidateCount, limit), observedCandidateCount, limit
  };
}

export function parseBoundedDiscoveryCoverage(value: unknown, returnedCount: number): BoundedDiscoveryCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coverage = value as BoundedDiscoveryCoverage;
  if (coverage.mode !== "bounded" || coverage.limit !== VNEXT_MARKET_DIRECTORY_MAX_MARKETS
    || typeof coverage.completeWithinObservedCandidates !== "boolean" || typeof coverage.truncated !== "boolean"
    || !Number.isSafeInteger(coverage.observedCandidateCount) || coverage.observedCandidateCount < 0
    || !Number.isSafeInteger(coverage.returnedCount) || coverage.returnedCount !== returnedCount
    || coverage.returnedCount !== Math.min(coverage.observedCandidateCount, coverage.limit)
    || coverage.truncated !== (coverage.observedCandidateCount > coverage.limit)
    || (coverage.truncated && coverage.completeWithinObservedCandidates)) return null;
  return { ...coverage };
}

export function mergeBoundedDiscoveryRefresh<T extends { address: string }>(
  previous: readonly T[], fresh: readonly T[], coverage: BoundedDiscoveryCoverage | null,
  delayed: boolean, quarantinedAddresses: readonly string[] = []
): T[] {
  const complete = !delayed && parseBoundedDiscoveryCoverage(coverage, fresh.length)?.completeWithinObservedCandidates === true;
  const quarantined = new Set(quarantinedAddresses.map((address) => address.toLowerCase()));
  const byAddress = new Map<string, T>();
  // Fresh evidence wins, including positive identity conflicts on partial reads.
  for (const market of [...(complete ? [] : previous), ...fresh]) {
    const address = market.address.toLowerCase();
    if (!quarantined.has(address)) byAddress.set(address, market);
  }
  return [...byAddress.values()];
}
