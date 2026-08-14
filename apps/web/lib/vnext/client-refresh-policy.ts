export const VNEXT_CLIENT_REFRESH_POLICY = Object.freeze({
  marketDirectoryMs: 60_000,
  ecosystemDirectoryMs: 300_000,
  assetWorkspaceMs: 60_000,
  walletBalanceMs: 60_000,
  walletDiscoveryMs: 300_000,
  ethPriceMs: 300_000
});

export function visibilityRefreshDelay(lastStartedAt: number | null, intervalMs: number, now = Date.now()) {
  if (lastStartedAt === null) return 0;
  return Math.max(0, intervalMs - Math.max(0, now - lastStartedAt));
}
