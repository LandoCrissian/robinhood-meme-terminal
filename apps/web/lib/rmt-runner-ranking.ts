import { formatEther } from "viem";
import type { LaunchFeedItem } from "./launch-feed";

export type RmtDiscoveryView = "moving" | "early" | "graduation" | "new";

export type RmtMomentumRanking = {
  momentumScore: number;
  effectiveVolumeEth: number;
  moving: boolean;
  earlyStage: boolean;
};

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function norm(value: number, unit: number, cap: number) {
  return clamp(Math.log1p(Math.max(0, value) / unit) / Math.log1p(cap / unit));
}

function eth(value: string) {
  try {
    return Number(formatEther(BigInt(value)));
  } catch {
    return 0;
  }
}

function creatorConcentrationFactor(creatorBps: number | undefined) {
  if (creatorBps === undefined || !Number.isFinite(creatorBps)) return 0.85;
  if (creatorBps <= 1_000) return 1;
  if (creatorBps <= 2_500) return 1 - ((creatorBps - 1_000) / 1_500) * 0.3;
  if (creatorBps <= 5_000) return 0.7 - ((creatorBps - 2_500) / 2_500) * 0.45;
  return 0.1;
}

function creatorFlowFactor(flow: LaunchFeedItem["creatorFlow"]) {
  if (flow === "selling") return 0.6;
  if (!flow || flow === "unknown") return 0.9;
  return 1;
}

function creatorGate(launch: LaunchFeedItem, maximumBps: number) {
  return launch.creatorOutsideCurveBps !== undefined
    && launch.creatorOutsideCurveBps <= maximumBps
    && launch.creatorFlow !== "selling"
    && launch.creatorFlow !== "unknown"
    && launch.creatorFlow !== undefined;
}

export function rankRmtMomentum(launch: LaunchFeedItem): RmtMomentumRanking {
  if (launch.graduated) {
    return { momentumScore: 0, effectiveVolumeEth: 0, moving: false, earlyStage: false };
  }

  const volumeEth = Math.max(0, eth(launch.volumeWei));
  const reserveEth = Math.max(0, eth(launch.reserveWei));
  const trades = Math.max(0, Math.trunc(launch.tradeCount));
  const buys = Math.max(0, Math.trunc(launch.buyCount));
  const effectiveVolumeEth = Math.min(volumeEth, 4 * reserveEth);

  const volumeSignal = norm(effectiveVolumeEth, 0.001, 0.25);
  const activitySignal = Math.log1p(Math.min(trades, 40)) / Math.log(41);
  const buyShare = trades > 0 ? buys / trades : 0;
  const buySignal = clamp((buyShare - 0.35) / 0.4);
  const progressSignal = Math.sqrt(clamp(launch.progressBps / 10_000));
  const raw =
    0.6 * volumeSignal
    + 0.2 * activitySignal
    + 0.1 * buySignal
    + 0.1 * progressSignal;

  const confidence =
    Math.min(1, Math.sqrt(trades / 5))
    * Math.min(1, Math.sqrt(effectiveVolumeEth / 0.005));
  const retention =
    0.35
    + 0.65 * Math.sqrt(clamp(volumeEth > 0 ? reserveEth / volumeEth : 0));
  const momentumScore = Math.round(100 * clamp(
    raw
      * confidence
      * retention
      * creatorConcentrationFactor(launch.creatorOutsideCurveBps)
      * creatorFlowFactor(launch.creatorFlow)
  ));

  const moving =
    momentumScore >= 40
    && trades >= 5
    && effectiveVolumeEth >= 0.005
    && reserveEth >= 0.002
    && creatorGate(launch, 1_000);
  const earlyStage =
    momentumScore >= 25
    && trades >= 3
    && effectiveVolumeEth >= 0.002
    && reserveEth >= 0.001
    && launch.progressBps <= 1_500
    && creatorGate(launch, 500);

  return { momentumScore, effectiveVolumeEth, moving, earlyStage };
}

function bigintDescending(a: string, b: string) {
  const difference = BigInt(b) - BigInt(a);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function deterministicTieBreak(a: LaunchFeedItem, b: LaunchFeedItem) {
  return bigintDescending(a.blockNumber, b.blockNumber)
    || bigintDescending(a.launchId, b.launchId)
    || a.token.toLowerCase().localeCompare(b.token.toLowerCase());
}

export function launchMatchesView(launch: LaunchFeedItem, view: RmtDiscoveryView) {
  const ranking = rankRmtMomentum(launch);
  if (view === "moving") return ranking.moving;
  if (view === "early") return ranking.earlyStage;
  if (view === "graduation") return !launch.graduated;
  return true;
}

export function compareRmtLaunches(view: RmtDiscoveryView, a: LaunchFeedItem, b: LaunchFeedItem) {
  if (view === "new" && a.officialMigration !== b.officialMigration) {
    return a.officialMigration ? -1 : 1;
  }
  if (view === "moving" || view === "early") {
    return rankRmtMomentum(b).momentumScore - rankRmtMomentum(a).momentumScore
      || deterministicTieBreak(a, b);
  }
  if (view === "graduation") {
    return b.progressBps - a.progressBps
      || bigintDescending(a.reserveWei, b.reserveWei)
      || bigintDescending(a.volumeWei, b.volumeWei)
      || deterministicTieBreak(a, b);
  }
  return deterministicTieBreak(a, b);
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
