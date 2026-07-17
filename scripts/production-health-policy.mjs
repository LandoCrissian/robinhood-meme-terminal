const CACHE_HEADER_NAMES = new Set([
  "cache-control",
  "cdn-cache-control",
  "vercel-cdn-cache-control"
]);

export const INDEXER_WARNING_AGE_MS = 60_000;
export const INDEXER_FAILURE_AGE_MS = 10 * 60_000;
// Robinhood Chain currently advances much faster than one block per second.
// Keep a deliberately conservative ceiling so normal poll/cache gaps do not
// masquerade as indexer failures while timestamp freshness remains strict.
export const MAX_CHAIN_BLOCKS_PER_SECOND = 20;
export const REQUEST_SKEW_MS = 5_000;

function nonnegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative.`);
  return value;
}

function nonnegativeBigInt(value, label) {
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`${label} must be nonnegative.`);
  return parsed;
}

export function hasSharedCachePolicy(rawHeaders, expectedSeconds) {
  const expected = String(nonnegativeNumber(expectedSeconds, "expectedSeconds"));
  for (const line of rawHeaders.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!CACHE_HEADER_NAMES.has(name)) continue;
    const directives = line.slice(separator + 1).split(",").map((value) => value.trim().toLowerCase());
    if (directives.includes(`s-maxage=${expected}`)) return true;
  }
  return false;
}

export function maximumExpectedIndexerLagBlocks({
  confirmationDepth,
  lastSyncAgeMs,
  blocksPerSecond = MAX_CHAIN_BLOCKS_PER_SECOND,
  requestSkewMs = REQUEST_SKEW_MS
}) {
  const confirmations = nonnegativeBigInt(confirmationDepth, "confirmationDepth");
  const elapsedMs = nonnegativeNumber(lastSyncAgeMs, "lastSyncAgeMs")
    + nonnegativeNumber(requestSkewMs, "requestSkewMs");
  const rate = nonnegativeNumber(blocksPerSecond, "blocksPerSecond");
  return confirmations + BigInt(Math.ceil(elapsedMs * rate / 1_000));
}

export function maximumExpectedCheckpointDriftBlocks({
  confirmationDepth,
  olderSyncedAtMs,
  newerSyncedAtMs,
  blocksPerSecond = MAX_CHAIN_BLOCKS_PER_SECOND,
  requestSkewMs = REQUEST_SKEW_MS
}) {
  const ageDeltaMs = Math.max(
    0,
    nonnegativeNumber(newerSyncedAtMs, "newerSyncedAtMs")
      - nonnegativeNumber(olderSyncedAtMs, "olderSyncedAtMs")
  );
  return maximumExpectedIndexerLagBlocks({
    confirmationDepth,
    lastSyncAgeMs: ageDeltaMs,
    blocksPerSecond,
    requestSkewMs
  });
}
