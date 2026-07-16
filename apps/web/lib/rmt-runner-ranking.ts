import type { LaunchFeedItem } from "./launch-feed";

export type RmtDiscoveryView = "moving" | "early" | "graduation" | "new";

function bigintDescending(a: string, b: string) {
  const difference = BigInt(b) - BigInt(a);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function deterministicTieBreak(a: LaunchFeedItem, b: LaunchFeedItem) {
  const launchDifference = bigintDescending(a.launchId, b.launchId);
  if (launchDifference !== 0) return launchDifference;
  return a.token.toLowerCase().localeCompare(b.token.toLowerCase());
}

function newestFirst(a: LaunchFeedItem, b: LaunchFeedItem) {
  const blockDifference = bigintDescending(a.blockNumber, b.blockNumber);
  return blockDifference || deterministicTieBreak(a, b);
}

export function launchMatchesView(launch: LaunchFeedItem, view: RmtDiscoveryView) {
  if (view === "moving") return launch.tradeCount > 0;
  if (view === "early") {
    return !launch.graduated
      && launch.progressBps < 2_500
      && launch.tradeCount > 0
      && launch.buyCount > launch.sellCount;
  }
  if (view === "graduation") return !launch.graduated;
  return true;
}

export function compareRmtLaunches(view: RmtDiscoveryView, a: LaunchFeedItem, b: LaunchFeedItem) {
  if (view === "moving") {
    return bigintDescending(a.volumeWei, b.volumeWei)
      || b.tradeCount - a.tradeCount
      || (b.buyCount - b.sellCount) - (a.buyCount - a.sellCount)
      || bigintDescending(a.reserveWei, b.reserveWei)
      || newestFirst(a, b);
  }
  if (view === "early") {
    return (b.buyCount - b.sellCount) - (a.buyCount - a.sellCount)
      || b.buyCount - a.buyCount
      || b.tradeCount - a.tradeCount
      || bigintDescending(a.volumeWei, b.volumeWei)
      || newestFirst(a, b);
  }
  if (view === "graduation") {
    return b.progressBps - a.progressBps
      || bigintDescending(a.reserveWei, b.reserveWei)
      || bigintDescending(a.volumeWei, b.volumeWei)
      || newestFirst(a, b);
  }
  return newestFirst(a, b);
}

export function rankRmtLaunches(launches: LaunchFeedItem[], view: RmtDiscoveryView) {
  return launches
    .filter((launch) => launchMatchesView(launch, view))
    .sort((a, b) => compareRmtLaunches(view, a, b));
}

export function buildRmtRankingOrders(launches: LaunchFeedItem[]) {
  const views: RmtDiscoveryView[] = ["moving", "early", "graduation", "new"];
  return Object.fromEntries(
    views.map((view) => [view, rankRmtLaunches(launches, view).map((launch) => launch.token.toLowerCase())])
  ) as Record<RmtDiscoveryView, string[]>;
}
