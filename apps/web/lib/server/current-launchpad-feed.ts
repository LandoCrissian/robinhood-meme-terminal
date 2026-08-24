import { getAddress, type Address, type PublicClient } from "viem";
import type { ExternalMarket } from "../external-market";
import { mergeLaunchpadEvidenceOntoMarket } from "../launchpad-lifecycle";
import { fetchCircusCurveMarkets } from "./circus-curve-feed";
import { fetchLemonLaunchMarkets } from "./lemon-launch-feed";
import { fetchPonsV1LaunchMarkets } from "./pons-project-metadata";
import { fetchPonsV2LaunchMarkets } from "./pons-v2-launch-feed";
import { fetchStonkBrokersSafeLaunchMarkets } from "./stonkbrokers-safe-launch-feed";
import { fetchSushiLaunchSnapshot, type SushiLaunchSnapshot } from "./sushi-launch-feed";

export const CURRENT_LAUNCHPAD_SOURCE_MANIFEST = Object.freeze([
  { sourceId: "stonkbrokers-safe-launch", version: "current", browse: "bounded-state-and-event" },
  { sourceId: "sushi-launch", version: "current", browse: "bounded-production-graphql" },
  { sourceId: "pons-v1", version: "v1", browse: "canonical-market-enrichment" },
  { sourceId: "pons-v2", version: "v2", browse: "bounded-state-and-event" },
  { sourceId: "lemon-fun", version: "current", browse: "bounded-public-feed-cross-checked-onchain" },
  { sourceId: "circus", version: "current", browse: "bounded-live-curve-feed-cross-checked-onchain" }
] as const);

export type CurrentLaunchpadSnapshot = {
  markets: ExternalMarket[];
  sushi: SushiLaunchSnapshot;
  delayedSources: string[];
  coverage: "partial" | "unavailable";
};

function emptySushiSnapshot(): SushiLaunchSnapshot {
  return { projects: new Map(), lifecycle: new Map(), candidateAddresses: [], delayed: true };
}

export function mergeCurrentLaunchpadMarkets(markets: ExternalMarket[]) {
  const merged = new Map<string, ExternalMarket>();
  for (const market of markets) {
    const key = market.address.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, market);
      continue;
    }
    const preferred = (market.buys1h + market.sells1h) > (existing.buys1h + existing.sells1h)
      ? market
      : existing;
    const other = preferred === market ? existing : market;
    merged.set(key, mergeLaunchpadEvidenceOntoMarket(preferred, other));
  }
  return [...merged.values()];
}

export async function fetchCurrentLaunchpadSnapshot(
  client: PublicClient,
  options: { token?: Address; fetch?: typeof fetch; nowMs?: number } = {}
): Promise<CurrentLaunchpadSnapshot> {
  const fetcher = options.fetch ?? fetch;
  const tasks = [
    fetchStonkBrokersSafeLaunchMarkets(client, { token: options.token, fetch: fetcher, nowMs: options.nowMs }),
    fetchPonsV1LaunchMarkets(client, { token: options.token, fetch: fetcher, nowMs: options.nowMs }),
    fetchPonsV2LaunchMarkets(client, { token: options.token, fetch: fetcher, nowMs: options.nowMs }),
    fetchLemonLaunchMarkets(client, { token: options.token, fetch: fetcher }),
    fetchCircusCurveMarkets(client, fetcher).then((markets) => options.token
      ? markets.filter((market) => market.address.toLowerCase() === getAddress(options.token!).toLowerCase())
      : markets),
    fetchSushiLaunchSnapshot({ fetch: fetcher })
  ] as const;
  const [stonk, ponsV1, ponsV2, lemon, circus, sushi] = await Promise.allSettled(tasks);
  const delayedSources = [...new Set([
    ...(stonk.status === "rejected" ? ["stonkbrokers-safe-launch"] : []),
    ...(ponsV1.status === "rejected" ? ["pons-v1"] : []),
    ...(ponsV2.status === "rejected" ? ["pons-v2"] : []),
    ...(lemon.status === "rejected" ? ["lemon-fun"] : []),
    ...(circus.status === "rejected" ? ["circus"] : []),
    ...(sushi.status === "rejected" || sushi.value.delayed ? ["sushi-launch"] : [])
  ])];
  return {
    markets: mergeCurrentLaunchpadMarkets([
      ...(stonk.status === "fulfilled" ? stonk.value : []),
      ...(ponsV1.status === "fulfilled" ? ponsV1.value : []),
      ...(ponsV2.status === "fulfilled" ? ponsV2.value : []),
      ...(lemon.status === "fulfilled" ? lemon.value : []),
      ...(circus.status === "fulfilled" ? circus.value : [])
    ]),
    sushi: sushi.status === "fulfilled" ? sushi.value : emptySushiSnapshot(),
    delayedSources,
    coverage: delayedSources.length === CURRENT_LAUNCHPAD_SOURCE_MANIFEST.length ? "unavailable" : "partial"
  };
}
