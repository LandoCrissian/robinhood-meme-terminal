import assert from "node:assert/strict";
import { getAddress, zeroAddress, type Hash, type PublicClient } from "viem";
import type { ExternalMarket, LaunchpadLifecycleEvidence } from "../external-market";
import { launchpadEvidenceIsBrowseRelevant } from "../launchpad-lifecycle";
import { normalizeDirectoryMarkets, selectVNextMarketDirectoryView } from "../vnext/market-directory";
import {
  CURRENT_LAUNCHPAD_SOURCE_MANIFEST,
  mergeCurrentLaunchpadMarkets
} from "./current-launchpad-feed";
import {
  fetchLemonLaunchMarkets,
  parseLemonLaunchCandidates,
  LEMON_FUN_CURRENT_FACTORY,
  LEMON_FUN_CURVE_FACTORY
} from "./lemon-launch-feed";
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
  fetchStonkBrokersSafeLaunchMarkets,
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

async function main() {
assert.deepEqual(
  CURRENT_LAUNCHPAD_SOURCE_MANIFEST.map((source) => source.sourceId),
  ["stonkbrokers-safe-launch", "sushi-launch", "pons-v1", "pons-v2", "lemon-fun", "circus"]
);
assert.equal(new Set(CURRENT_LAUNCHPAD_SOURCE_MANIFEST.map((source) => `${source.sourceId}:${source.version}`)).size, 6);
assert.deepEqual(
  CURRENT_LAUNCHPAD_SOURCE_MANIFEST.find((source) => source.sourceId === "lemon-fun"),
  { sourceId: "lemon-fun", version: "v1+current", browse: "bounded-current-lifecycle-feed-cross-checked-onchain" }
);
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
  log("SafeSell(uint256,address,uint256,uint256,uint16,uint256,uint256)", {
    id: "7",
    tokensIn: "999999999999999999999",
    taxPaid: "700000000000000000",
    ethOut: "300000000000000000"
  }, 20),
  log("SafeBuy(uint256,address,uint256,uint256,uint16,uint256,uint256)", { id: "8", ethIn: "9000000000000000000" }, 5)
], 7n, NOW);
assert.deepEqual(
  { buys1h: stonkActivity.buys1h, sells1h: stonkActivity.sells1h, volumeQuote24h: stonkActivity.volumeQuote24h },
  { buys1h: 1, sells1h: 1, volumeQuote24h: 2 },
  "SafeSell gross quote notional must add seller proceeds and withheld ETH tax"
);
assert.notEqual(stonkActivity.volumeQuote24h, 1.3, "seller net proceeds must not be reported as gross sell notional");

const RECENT_STONK = getAddress("0x6000000000000000000000000000000000000006");
const OLD_STONK = getAddress("0x7000000000000000000000000000000000000007");
const stonkWindowCalls: string[] = [];
function stonkCore(token: string, startTime: bigint, aborted: boolean) {
  return {
    token,
    creator: CREATOR,
    startMcapUsd8: 0n,
    gradMcapUsd8: 0n,
    startTaxBps: 0,
    decayPerMinuteBps: 0,
    creatorFeeBpsSnap: 0,
    protocolFeeBpsSnap: 0,
    windowSecs: 86_400,
    startTime,
    deadline: startTime + 86_400n,
    externalToken: false,
    sellsEnabled: true,
    armed: !aborted,
    graduated: false,
    bonded: false,
    aborted,
    loadedSupply: 1n,
    vEth: 1n,
    vToken: 1n,
    realEth: 0n,
    buyCount: 0n
  };
}
function stonkView(id: bigint, core: ReturnType<typeof stonkCore>) {
  return {
    id,
    core,
    taxBps: 0n,
    mcapUsd8Now: 0n,
    tokensSold: 0n,
    oracleFresh: true,
    legs: [],
    pools: [],
    lockIds: [],
    lpEth: 0n,
    lpFeeBpsSnap: 0,
    closedAtTs: 0n
  };
}
const stonkWindowClient = {
  readContract: async (request: { functionName: string; args?: readonly unknown[]; address?: string }) => {
    if (request.functionName === "viewLaunches") {
      const startId = request.args?.[0] as bigint;
      const count = request.args?.[1] as bigint;
      stonkWindowCalls.push(`${startId}:${count}`);
      assert.equal(startId, 0n, "zero must remain the verified latest-window sentinel");
      assert.equal(count, 32n, "browse discovery must remain bounded to the latest 32 launches");
      return [
        stonkView(65n, stonkCore(RECENT_STONK, BigInt(Math.floor((NOW - 60_000) / 1_000)), false)),
        stonkView(34n, stonkCore(OLD_STONK, BigInt(Math.floor((NOW - 60 * 86_400_000) / 1_000)), true))
      ];
    }
    if (request.functionName === "name") return request.address === RECENT_STONK ? "Recent zero trade launch" : "Old launch";
    if (request.functionName === "symbol") return request.address === RECENT_STONK ? "RECENT" : "OLD";
    throw new Error(`Unexpected StonkBrokers read: ${request.functionName}`);
  }
} as unknown as PublicClient;
const stonkWindowMarkets = await fetchStonkBrokersSafeLaunchMarkets(stonkWindowClient, {
  nowMs: NOW,
  fetch: async () => new Response(JSON.stringify({ items: [] }), { status: 200 })
});
assert.deepEqual(stonkWindowCalls, ["0:32"], "browse discovery must perform one bounded latest-window read");
assert.deepEqual(stonkWindowMarkets.map((item) => item.address), [RECENT_STONK]);
assert.equal(stonkWindowMarkets[0]?.buys24h, 0, "a current zero-trade launch must remain discoverable");
assert.equal(stonkWindowMarkets.some((item) => item.address === OLD_STONK), false, "an old aborted launch must not enter browse");

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

const lemonBondingPayload = {
  token: {
    address: TOKEN,
    curve: POOL,
    name: "Verified Lemon asset",
    symbol: "LEMONX",
    deployer: CREATOR,
    createdAt: new Date(NOW).toISOString(),
    graduated: false,
    poolAddress: null,
    dex: "curve-sushi",
    socials: {}
  }
};
const lemonCurveClient = {
  getCode: async ({ address }: { address: string }) => address === POOL ? "0x6000" : undefined,
  readContract: async (request: { functionName: string }) => {
    if (request.functionName === "getTokenInfo") return {
      token: TOKEN,
      curve: POOL,
      deployer: CREATOR,
      graduationThreshold: 4n * 10n ** 18n,
      creatorFeeBps: 100,
      dexKind: 1,
      graduated: false,
      poolAfterGraduation: zeroAddress,
      lpLocker: zeroAddress,
      tokenReserve: 1n,
      ethReserve: 1n,
      virtualTokenReserve: 1n,
      virtualEthReserve: 1n
    };
    if (request.functionName === "name") return "Verified Lemon asset";
    if (request.functionName === "symbol") return "LEMONX";
    if (request.functionName === "launcher") return LEMON_FUN_CURVE_FACTORY;
    if (request.functionName === "poolSetter") return POOL;
    if (request.functionName === "pool") return zeroAddress;
    throw new Error(`Unexpected Lemon curve read: ${request.functionName}`);
  }
} as unknown as PublicClient;
const lemonBonding = await fetchLemonLaunchMarkets(lemonCurveClient, {
  token: TOKEN,
  fetch: async () => new Response(JSON.stringify(lemonBondingPayload), { status: 200 })
});
assert.equal(lemonBonding.length, 1, "a factory-bound current Lemon bonding asset must be discoverable");
assert.equal(lemonBonding[0]?.address, TOKEN);
assert.equal(lemonBonding[0]?.pairAddress, POOL);
assert.equal(lemonBonding[0]?.launchpadEvidence?.[0]?.state, "curve-live");
assert.equal(lemonBonding[0]?.launchpadEvidence?.[0]?.venue.kind, "bonding-curve");

const LEMON_GRADUATED_POOL = getAddress("0xC00000000000000000000000000000000000000C");
const LEMON_CURVE_QUOTE = getAddress("0xD00000000000000000000000000000000000000D");
const lemonCurveGraduatedPayload = {
  token: {
    ...lemonBondingPayload.token,
    graduated: true,
    poolAddress: LEMON_GRADUATED_POOL
  }
};
const lemonCurveGraduatedClient = {
  getCode: async ({ address }: { address: string }) => (
    address === POOL || address === LEMON_GRADUATED_POOL ? "0x6000" : undefined
  ),
  readContract: async (request: { functionName: string }) => {
    if (request.functionName === "getTokenInfo") return {
      token: TOKEN,
      curve: POOL,
      deployer: CREATOR,
      graduationThreshold: 4n * 10n ** 18n,
      creatorFeeBps: 100,
      dexKind: 1,
      graduated: true,
      poolAfterGraduation: LEMON_GRADUATED_POOL,
      lpLocker: getAddress("0xE00000000000000000000000000000000000000E"),
      tokenReserve: 0n,
      ethReserve: 0n,
      virtualTokenReserve: 1n,
      virtualEthReserve: 1n
    };
    if (request.functionName === "name") return "Verified Lemon asset";
    if (request.functionName === "symbol") return "LEMONX";
    if (request.functionName === "launcher") return LEMON_FUN_CURVE_FACTORY;
    if (request.functionName === "poolSetter") return POOL;
    if (request.functionName === "pool") return LEMON_GRADUATED_POOL;
    if (request.functionName === "token0") return TOKEN;
    if (request.functionName === "token1") return LEMON_CURVE_QUOTE;
    throw new Error(`Unexpected Lemon curve graduation read: ${request.functionName}`);
  }
} as unknown as PublicClient;
const lemonCurveGraduated = await fetchLemonLaunchMarkets(lemonCurveGraduatedClient, {
  token: TOKEN,
  fetch: async () => new Response(JSON.stringify(lemonCurveGraduatedPayload), { status: 200 })
});
assert.equal(lemonCurveGraduated.length, 1, "a verified Lemon curve graduation must remain discoverable");
assert.equal(lemonCurveGraduated[0]?.address, lemonBonding[0]?.address, "Lemon curve graduation must preserve token identity");
assert.equal(lemonCurveGraduated[0]?.pairAddress, LEMON_GRADUATED_POOL);
assert.equal(lemonCurveGraduated[0]?.launchpadEvidence?.[0]?.state, "graduated");
assert.equal(lemonCurveGraduated[0]?.launchpadEvidence?.[0]?.venue.kind, "canonical-pool");

const POSITION_MANAGER = getAddress("0x8000000000000000000000000000000000000008");
const DEX_FACTORY = getAddress("0x9000000000000000000000000000000000000009");
const PAIRED_TOKEN = getAddress("0xA00000000000000000000000000000000000000A");
const lemonGraduatedPayload = {
  token: {
    address: TOKEN,
    curve: null,
    name: "Verified Lemon asset",
    symbol: "LEMONX",
    deployer: CREATOR,
    createdAt: new Date(NOW).toISOString(),
    graduated: true,
    poolAddress: POOL,
    dex: "uniswap-v3",
    socials: {}
  }
};
const lemonGraduatedClient = {
  readContract: async (request: { functionName: string }) => {
    if (request.functionName === "getLaunchedToken") return {
      token: TOKEN,
      deployer: CREATOR,
      pairedToken: PAIRED_TOKEN,
      positionManager: POSITION_MANAGER,
      positionId: 1n,
      dexId: 1n,
      launchConfigId: 1n,
      restrictionsEndBlock: 0n,
      supply: 1n,
      isToken0: true,
      poolFee: 3_000,
      exists: true,
      initialBuyAmount: 0n
    };
    if (request.functionName === "name") return "Verified Lemon asset";
    if (request.functionName === "symbol") return "LEMONX";
    if (request.functionName === "getDexConfig") return {
      name: "Uniswap V3",
      factory: DEX_FACTORY,
      positionManager: POSITION_MANAGER,
      swapRouter: getAddress("0xB00000000000000000000000000000000000000B"),
      poolFee: 3_000,
      tickSpacing: 60,
      enabled: true
    };
    if (request.functionName === "getPool") return POOL;
    throw new Error(`Unexpected Lemon graduated read: ${request.functionName}`);
  }
} as unknown as PublicClient;
const lemonGraduated = await fetchLemonLaunchMarkets(lemonGraduatedClient, {
  token: TOKEN,
  fetch: async () => new Response(JSON.stringify(lemonGraduatedPayload), { status: 200 })
});
assert.equal(lemonGraduated.length, 1, "a current-factory Lemon graduated asset must remain discoverable");
assert.equal(lemonGraduated[0]?.launchpadEvidence?.[0]?.state, "graduated");
assert.equal(lemonGraduated[0]?.launchpadEvidence?.[0]?.venue.kind, "canonical-pool");
assert.equal(lemonBonding[0]?.address, lemonGraduated[0]?.address, "graduation must enrich the same token identity");

console.info("Current launchpad lifecycle normalization and source-boundary smoke passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
