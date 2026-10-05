import { isAddress } from "viem";
import type { VNextDirectoryMarket } from "./market-directory";
import { mergeVNextExplicitSelectionMarket } from "./market-directory";
import { marketAtSelectedPool, retainSelectedMarket, selectedMarketPool } from "./selected-market-price";

export const SEARCH_ROW_ENRICHMENT_POLICY = Object.freeze({
  concurrency: 1, retainedRows: 24, opportunityMs: 60_000,
  failureBaseMs: 120_000, failureMaximumMs: 300_000
});

export function unresolvedSearchRow(row: VNextDirectoryMarket) {
  const identity = row.verifiedIdentity;
  return isAddress(row.address, { strict: false })
    && row.address.toLowerCase() !== "0x0000000000000000000000000000000000000000"
    && identity?.address.toLowerCase() === row.address.toLowerCase()
    && Boolean(identity.name && identity.symbol)
    && Number.isInteger(identity.decimals) && identity.decimals >= 0 && identity.decimals <= 255
    && (!row.primaryMarket || row.primaryMarket.displayEligibility !== "eligible"
      || row.priceUsd === null || !Number.isFinite(row.priceUsd) || row.priceUsd <= 0);
}

/** A successful read binds one exact observation, never mixes summary metrics. */
export function enrichSearchRow(row: VNextDirectoryMarket, provider: VNextDirectoryMarket | null) {
  if (!provider || provider.address.toLowerCase() !== row.address.toLowerCase()) return null;
  const pool = selectedMarketPool(row);
  const bound = pool ? marketAtSelectedPool(provider, pool) : provider;
  const observation = bound?.primaryMarket;
  if (!observation || observation.chainId !== 4663 || observation.displayEligibility !== "eligible"
    || observation.token.address.toLowerCase() !== row.address.toLowerCase()
    || observation.priceUsd === null || observation.priceUsd <= 0 || !Number.isFinite(observation.priceUsd)) return null;
  const next = mergeVNextExplicitSelectionMarket({ existing: row, provider: bound });
  if (!next) return null;
  const retained = retainSelectedMarket(row, next);
  return unresolvedSearchRow(retained) ? null : retained;
}

/** No autonomous timer or fanout: one fair attempt at an ordinary refresh opportunity. */
export function createSearchRowEnrichment(
  run: (row: VNextDirectoryMarket, signal: AbortSignal) => Promise<boolean>,
  available: () => boolean,
  now = Date.now
) {
  let disposed = false, nextOpportunity = 0, lastKey = "";
  let active: { key: string; controller: AbortController } | undefined;
  const retained = new Map<string, { row: VNextDirectoryMarket; failures: number; due: number }>();
  return {
    retain(rows: VNextDirectoryMarket[]) {
      if (disposed) return;
      const keys = new Set<string>();
      for (const row of rows) {
        const key = row.address.toLowerCase();
        if (keys.size >= SEARCH_ROW_ENRICHMENT_POLICY.retainedRows) break;
        if (!unresolvedSearchRow(row)) continue;
        keys.add(key);
        const prior = retained.get(key);
        if (prior) prior.row = row;
        else retained.set(key, { row, failures: 0, due: 0 });
      }
      for (const key of retained.keys()) if (!keys.has(key)) retained.delete(key);
      if (active && !keys.has(active.key)) active.controller.abort();
    },
    async opportunity() {
      if (disposed || active || !available() || now() < nextOpportunity) return;
      const keys = [...retained.keys()].sort();
      const ordered = [...keys.filter(k => k > lastKey), ...keys.filter(k => k <= lastKey)];
      const key = ordered.find(k => retained.get(k)!.due <= now());
      if (!key) return;
      const entry = retained.get(key)!, job = { key, controller: new AbortController() };
      active = job; lastKey = key; nextOpportunity = now() + SEARCH_ROW_ENRICHMENT_POLICY.opportunityMs;
      try {
        const success = await run(entry.row, job.controller.signal);
        if (disposed || job.controller.signal.aborted || retained.get(key) !== entry) return;
        if (success) retained.delete(key);
        else throw new Error("Search market evidence unavailable");
      } catch {
        if (!disposed && !job.controller.signal.aborted && retained.get(key) === entry) {
          entry.failures = Math.min(4, entry.failures + 1);
          entry.due = now() + Math.min(SEARCH_ROW_ENRICHMENT_POLICY.failureMaximumMs,
            SEARCH_ROW_ENRICHMENT_POLICY.failureBaseMs * 2 ** (entry.failures - 1));
        }
      } finally { if (active === job) active = undefined; }
    },
    suspend() { active?.controller.abort(); },
    dispose() { disposed = true; retained.clear(); active?.controller.abort(); }
  };
}
