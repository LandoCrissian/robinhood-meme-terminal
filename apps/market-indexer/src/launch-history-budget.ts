/** A sequential history lane, bounded independently of ordinary market cycles. */
export const LAUNCH_HISTORY_BUDGET = Object.freeze({
  windowMs: 5_000,
  maxRanges: 8,
  maxBlockReads: 48,
  rangeIntervalMs: 1_000,
  idleMs: 1_000,
  failureDelayMs: 30_000,
  maxFailureDelayMs: 300_000,
});

export type HistorySourceState = {
  source_id: string;
  historical_next: string;
};

/** Rotate groups by source identity, coalescing equal cursors without starving lagging sources. */
export function nextHistoryGroup<T extends HistorySourceState>(
  pending: T[],
  afterSource: string | null,
): T[] {
  const ordered = [...pending].sort((a, b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0);
  const first = ordered.find((s) => afterSource === null || s.source_id > afterSource) ?? ordered[0];
  // Keep the scheduling anchor first. Advancing past the last coalesced member
  // could skip divergent sources whose IDs lie between members of this group.
  return first ? [first, ...ordered.filter((s) => s !== first && s.historical_next === first.historical_next)] : [];
}

export function historicalFailureDelay(failures: number) {
  return Math.min(
    LAUNCH_HISTORY_BUDGET.maxFailureDelayMs,
    LAUNCH_HISTORY_BUDGET.failureDelayMs * 2 ** Math.min(Math.max(failures - 1, 0), 4),
  );
}
