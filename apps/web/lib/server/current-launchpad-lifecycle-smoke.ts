import assert from "node:assert/strict";
import { getAddress, type Hash } from "viem";
import type { ExternalMarket, LaunchpadLifecycleEvidence } from "../external-market";
import { launchpadEvidenceIsBrowseRelevant } from "../launchpad-lifecycle";
import { normalizeDirectoryMarkets, selectVNextMarketDirectoryView } from "../vnext/market-directory";
import {
  CURRENT_LAUNCHPAD_SOURCE_MANIFEST,
  mergeCurrentLaunchpadMarkets
} from "./current-launchpad-feed";
import { parseLemonLaunchCandidates, LEMON_FUN_CURRENT_FACTORY } from "./lemon-launch-feed";
import {
  PONS_V2_FACTORY,
  PONS_V2_MEME_HOOK,
  ponsV2LaunchEvents,
  ponsV2PoolId
} from "./pons-v2-launch-feed";
import { PONS_V1_FACTORY, ponsV1LaunchEvents } from "./pons-project-metadata";
import {
  STONKBROKERS_SAFE_LAUNCH_DEPLOY_BLOCK,
  STONKBROKERS_SAFE_LAUNCH_DEPLOY_TRANSACTION,
  STONKBROKERS_SAFE_LAUNCHPAD,
  stonkSafeLaunchpadAbi,
  stonkSafeLaunchActivity
} from "./stonkbrokers-safe-launch-feed";
import type { VerifiedContractLog } from "./blockscout-contract-logs";

const TOKEN = getAddress("0x1000000000000000000000000000000000000001");
const CREATOR = getAddress("0x2000000000000000000000000000000000000002");
const POOL = getAddress("0x3000000000000000000000000000000000000003");
const TX = `0x${"4".repeat(64)}` as Hash;
const NOW = Date.parse("2026-08-24T21:00:00.000Z");

function lifecycle(overrides: Partial<LaunchpadLifecycleEvidence> = {}): LaunchpadLifecycleEvidence {
  return {
    sourceId: "stonkbrokers-safe-launch",
    sourceName: "StonkBrokers Smart/Safe Launch",
    version: "current",
    factory: STONKBROKERS_SAFE_LAUNCHPAD,
    creator: CREATOR,
    launchId: "1",
    launchBlock: "38814054",
    launchTransactionHash: STONKBROKERS_SAFE_LAUNCH_DEPLOY_TRANSACTION,
    state: "curve-live",
    current: true,
    metricsState: "unavailable",
    venue: { kind: "bonding-curve", address: POOL, poolId: null },
    activity: { buys1h: 1, sells1h: 1, buys24h: 1, sells24h: 1, volumeQuote24h: 3, lastActivityAt: new Date(NOW).toISOString() },
    provenance: "verified-contract-state-and-events",
    ...overrides
  };
}

function market(evidence: LaunchpadLifecycleEvidence): ExternalMarket {
  return {
    address: TOKEN,
    name: "Current Asset",
    symbol: "CURRENT",
    pairAddress: POOL,
    url: `https://robinhoodchain.blockscout.com/token/${TOKEN}`,
    dexId: evidence.sourceId,
    launchpadEvidence: [evidence],
    origin: { kind: "external", state: "unknown", coverage: "partial" },
    venue: { kind: "external-launchpad", sourceId: evidence.sourceId, market: POOL, execution: "read-only" },
    priceUsd: 0,
    liquidityUsd: 0,
    marketCapUsd: 0,
    fdvUsd: 0,
    volume5m: 0,
    volume1h: 0,
    volume24h: 0,
    priceChange5m: 0,
    priceChange1h: 0,
    priceChange24h: 0,
    buys5m: 0,
    sells5m: 0,
    buys1h: evidence.activity.buys1h ?? 0,
    sells1h: evidence.activity.sells1h ?? 0,
    buys24h: evidence.activity.buys24h ?? 0,
    sells24h: evidence.activity.sells24h ?? 0,
    pairCreatedAt: NOW - 60_000,
    ageMinutes: 1,
    momentumScore: 24,
    buyPressureBps: 5_000,
    signal: "early",
    riskFlags: []
  };
}

function log(method: string, parameters: Record<string, string>, minutesAgo: number): VerifiedContractLog {
  return {
    blockNumber: 40_000_000n,
    blockTimestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
    transactionHash: TX,
    topics: [TX],
    data: "0x",
    method,
    parameters: new Map(Object.entries(parameters))
  };
}

assert.deepEqual(
  CURRENT_LAUNCHPAD_SOURCE_MANIFEST.map((source) => source.sourceId),
  ["stonkbrokers-safe-launch", "sushi-launch", "pons-v1", "pons-v2", "lemon-fun", "circus"]
);
assert.equal(new Set(CURRENT_LAUNCHPAD_SOURCE_MANIFEST.map((source) => `${source.sourceId}:${source.version}`)).size, 6);
assert.equal(STONKBROKERS_SAFE_LAUNCH_DEPLOY_BLOCK, 38_814_054n);
assert.equal(STONKBROKERS_SAFE_LAUNCHPAD, getAddress("0xEcA5726dae1e53365c37fFc02369d947A91d71f9"));
assert.equal(
  stonkSafeLaunchpadAbi.some((entry) => entry.type === "function" && entry.name === "viewLaunches"),
  true,
  "current StonkBrokers browse must use the verified bounded launch-view surface"
);
assert.equal(LEMON_FUN_CURRENT_FACTORY, getAddress("0x2ba793fd69bf251fd1af90b576be8b9fa6be46db"));
assert.notEqual(PONS_V1_FACTORY, PONS_V2_FACTORY, "Pons V1 and V2 must remain separate sources");

const stonkActivity = stonkSafeLaunchActivity([
  log("SafeBuy(uint256,address,uint256,uint256,uint16,uint256,uint256)", { id: "7", ethIn: "1000000000000000000" }, 10),
  log("SafeSell(uint256,address,uint256,uint256,uint16,uint256,uint256)", { id: "7", tokensIn: "999999999999999999999", ethOut: "2000000000000000000" }, 20),
  log("SafeBuy(uint256,address,uint256,uint256,uint16,uint256,uint256)", { id: "8", ethIn: "9000000000000000000" }, 5)
], 7n, NOW);
assert.deepEqual(
  { buys1h: stonkActivity.buys1h, sells1h: stonkActivity.sells1h, volumeQuote24h: stonkActivity.volumeQuote24h },
  { buys1h: 1, sells1h: 1, volumeQuote24h: 3 },
  "SafeSell activity must use ethOut rather than token input"
);

assert.equal(launchpadEvidenceIsBrowseRelevant(lifecycle({ state: "aborted", current: false }), NOW, false, NOW), false);
assert.equal(launchpadEvidenceIsBrowseRelevant(lifecycle({ state: "curve-live" }), null, false, NOW), true);
assert.equal(launchpadEvidenceIsBrowseRelevant(lifecycle({ state: "graduated", activity: { buys1h: null, sells1h: null, buys24h: null, sells24h: null, volumeQuote24h: null, lastActivityAt: null } }), NOW - 30 * 86_400_000, false, NOW), false);
assert.equal(launchpadEvidenceIsBrowseRelevant(lifecycle({ state: "graduated", activity: { buys1h: null, sells1h: null, buys24h: null, sells24h: null, volumeQuote24h: null, lastActivityAt: null } }), NOW - 30 * 86_400_000, true, NOW), true);

const ponsEvidence: LaunchpadLifecycleEvidence = {
  ...lifecycle(),
  sourceId: "pons-v2",
  sourceName: "Pons V2",
  version: "v2",
  factory: PONS_V2_FACTORY
};
const merged = mergeCurrentLaunchpadMarkets([market(lifecycle()), market(ponsEvidence)]);
assert.equal(merged.length, 1, "the same token must remain one asset across origin/lifecycle sources");
assert.deepEqual(merged[0]?.launchpadEvidence?.map((item) => item.sourceId).sort(), ["pons-v2", "stonkbrokers-safe-launch"]);

const normalized = normalizeDirectoryMarkets({ markets: [market(lifecycle())] });
assert.equal(normalized[0]?.priceUsd, null, "launch identity must not fabricate price metrics");
assert.equal(normalized[0]?.marketCapUsd, null, "launch identity must not fabricate market-cap metrics");
assert.equal(selectVNextMarketDirectoryView(normalized, "active").length, 1, "launch-native recent activity belongs in Active");
assert.equal(selectVNextMarketDirectoryView(normalized, "new").length, 1, "a recent current launch belongs in New");

const cannaCatPoolId = ponsV2PoolId(
  getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92"),
  getAddress("0x0000000000000000000000000000000000000000"),
  0,
  200
);
assert.equal(cannaCatPoolId, "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3");
assert.equal(PONS_V2_MEME_HOOK, getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044"));
assert.deepEqual(ponsV2LaunchEvents([
  log("TokenLaunched(address,address,address)", { token: TOKEN, curve: POOL, deployer: CREATOR }, 5)
]).map((event) => event.token), [TOKEN]);
assert.deepEqual(ponsV1LaunchEvents([
  log("TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)", { token: TOKEN, pool: POOL, deployer: CREATOR }, 5)
]).map((event) => event.token), [TOKEN]);

const lemonCandidates = parseLemonLaunchCandidates({ tokens: [{
  address: TOKEN,
  curve: null,
  name: "Verified Lemon asset",
  symbol: "LEMONX",
  image: "https://lemon.fun/m/example.jpg",
  description: "Current launch",
  deployer: CREATOR,
  createdAt: new Date(NOW).toISOString(),
  graduated: true,
  poolAddress: POOL,
  priceEth: "0.01",
  marketCapEth: "100",
  socials: { website: "https://lemon.fun" }
}, {
  address: getAddress("0x5000000000000000000000000000000000000005"),
  name: "Not graduated",
  symbol: "OLD",
  deployer: CREATOR,
  createdAt: new Date(NOW).toISOString(),
  graduated: false,
  poolAddress: POOL
}] });
assert.equal(lemonCandidates.length, 1);
assert.equal(lemonCandidates[0]?.address, TOKEN);

console.info("Current launchpad lifecycle normalization and source-boundary smoke passed.");
