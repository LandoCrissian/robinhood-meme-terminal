import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FIXTURE_EPOCH_MS, FIXTURE_NOW, BROAD_TOKEN_MARKETS, TOKEN_MARKETS, VISIBLE_TOKEN_MARKETS, canonicalDirectoryMarkets,
  CCFF00_COLLECTION, NFT_ITEM, NFT_MARKETPLACE, NFT_MINT_RADAR_DETAILS, NFT_MINT_RADAR_PAGES, NFT_ONCHAIN,
  RADAR_CCFF00_GATE_END, RADAR_CCFF00_GATE_START, RADAR_DROP_COLLECTION, RADAR_SEADROP, RADAR_SEADROP_CODE, nftInventory,
} from "./legion-fixtures.mjs";

const argv = process.argv.slice(2);
const captureOnly = argv.includes("--capture-only");
const browserAcceptanceProfile = argv.includes("--browser-acceptance-profile");
const option = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const base = option("--base-url") ?? process.env.RMT_VISUAL_BASE_URL ?? "http://127.0.0.1:3111";
const output = path.resolve(option("--output") ?? process.env.RMT_VISUAL_OUTPUT ?? ".artifacts/legion-visual-qa/latest/actual");
const acceptanceOutput = path.join(output, "release-polish-acceptance");
const fixturePort = Number(process.env.RMT_VISUAL_FIXTURE_PORT ?? 43111);
const visualFixtureNow = process.env.RMT_VISUAL_FIXTURE_NOW ?? FIXTURE_NOW;
const visualFixtureEpochMs = Date.parse(visualFixtureNow);
const calldataAddressWord = (value) => value.slice(2).toLowerCase().padStart(64, "0");
const tokenGatedAllowedTokensArgs = calldataAddressWord(RADAR_DROP_COLLECTION);
const tokenGatedDropArgs = `${tokenGatedAllowedTokensArgs}${calldataAddressWord(CCFF00_COLLECTION)}`;
const radarCcff00GateStartSeconds = Math.floor(Date.parse(RADAR_CCFF00_GATE_START) / 1_000);
const radarCcff00GateEndSeconds = Math.floor(Date.parse(RADAR_CCFF00_GATE_END) / 1_000);
const visualLiveGateStart = "2026-09-21T19:48:00.000Z";
const visualLiveGateStartSeconds = Math.floor(Date.parse(visualLiveGateStart) / 1_000);
const token = TOKEN_MARKETS[1].address;
const pair = TOKEN_MARKETS[1].pairAddress;
const failures = [];
const stateResults = [];
let horizontalOverflowPixels = 0;
let watchingPublicClassificationViolations = 0;
let nftExecutionControls = 0;
let controlsAudited = 0;
let controlHeightViolations = 0;
let heroClippingViolations = 0;
let communityOverlapViolations = 0;
let mobileSignalHeightViolations = 0;
let registrationCornerRoleViolations = 0;
let crossSurfaceNavigationViolations = 0;
let portfolioReturnPathViolations = 0;
let valuationTruthViolations = 0;
let startupMetrics = null;
let nftOwnershipMode = "available";
let nftMarketplaceMode = "available";
let nftRadarMode = "ready";
let nftReaderDelays = { inventory: 0, onchain: 0, marketplace: 0 };
const progressiveNftTimings = [];
const delay = (milliseconds) => milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();

const verifiedLiveRadarDrop = {
  ...NFT_MINT_RADAR_PAGES.upcoming.drops[0],
  is_minting: true,
  active_stage: {
    ...NFT_MINT_RADAR_PAGES.upcoming.drops[0].next_stage,
    start_time: visualLiveGateStart,
  },
  next_stage: null,
};

function visualRadarPage(type) {
  if (nftRadarMode === "empty") return { drops: [], next: null };
  return type === "featured" ? { drops: [verifiedLiveRadarDrop], next: null } : { drops: [], next: null };
}

function visualRadarDetail(slug) {
  if (slug !== verifiedLiveRadarDrop.collection_slug) return null;
  return {
    ...NFT_MINT_RADAR_DETAILS[slug],
    is_minting: true,
    active_stage: verifiedLiveRadarDrop.active_stage,
    next_stage: null,
    stages: [verifiedLiveRadarDrop.active_stage],
  };
}

await mkdir(output, { recursive: true });
await mkdir(acceptanceOutput, { recursive: true });

function check(condition, state, message, evidence = null) {
  if (condition) return;
  failures.push({ state, message, evidence });
}

const json = (response, body, status = 200) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (value) => value.slice(2).toLowerCase().padStart(64, "0");
const rpcResult = (response, id, result) => json(response, { jsonrpc: "2.0", id, result });

const fixtureServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${fixturePort}`);
  if (url.pathname === "/api/v2/drops") {
    if (request.headers["x-api-key"] !== "legion-radar-fixture") return json(response, { error: "unauthorized" }, 401);
    const type = url.searchParams.get("type");
    const chain = url.searchParams.get("chains");
    if (chain !== "robinhood" || !type || !(type in NFT_MINT_RADAR_PAGES)) return json(response, { error: "invalid_radar_request" }, 400);
    return json(response, visualRadarPage(type));
  }
  if (url.pathname.startsWith("/api/v2/drops/")) {
    if (request.headers["x-api-key"] !== "legion-radar-fixture") return json(response, { error: "unauthorized" }, 401);
    const slug = decodeURIComponent(url.pathname.slice("/api/v2/drops/".length));
    const detail = visualRadarDetail(slug);
    return detail ? json(response, detail) : json(response, { error: "not_found" }, 404);
  }
  if (url.pathname === "/rpc" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (payload.method === "eth_chainId") return rpcResult(response, payload.id, "0x1237");
    if (payload.method === "eth_getCode") {
      const address = String(payload.params?.[0] ?? "").toLowerCase();
      return rpcResult(response, payload.id, [RADAR_DROP_COLLECTION, RADAR_SEADROP].map((item) => item.toLowerCase()).includes(address) ? RADAR_SEADROP_CODE : "0x");
    }
    if (payload.method === "eth_call") {
      const call = payload.params?.[0] ?? {};
      const target = String(call.to ?? "").toLowerCase();
      const data = String(call.data ?? "").toLowerCase();
      if (target === RADAR_DROP_COLLECTION.toLowerCase() && data.startsWith("0x01ffc9a7")) return rpcResult(response, payload.id, `0x${word(0)}`);
      if (target === RADAR_SEADROP.toLowerCase() && data.length === 74 && data.slice(10) === tokenGatedAllowedTokensArgs) {
        return rpcResult(response, payload.id, `0x${word(32)}${word(1)}${addressWord(CCFF00_COLLECTION)}`);
      }
      if (target === RADAR_SEADROP.toLowerCase() && data.length === 138 && data.slice(10) === tokenGatedDropArgs) {
        return rpcResult(response, payload.id, `0x${word(12_500_000_000_000_000n)}${word(2)}${word(nftRadarMode === "ready" ? visualLiveGateStartSeconds : radarCcff00GateStartSeconds)}${word(radarCcff00GateEndSeconds)}${word(7)}${word(500)}${word(0)}${word(0)}`);
      }
      return rpcResult(response, payload.id, "0x");
    }
    return json(response, { jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "method_not_found" } }, 400);
  }
  if (request.headers.authorization !== `Bearer ${"a".repeat(64)}`) return json(response, { error: "unauthorized" }, 401);
  if (/^\/internal\/v1\/projects\/ccff00\/inventory$/.test(url.pathname)) {
    await delay(nftReaderDelays.inventory);
    return json(response,
    nftOwnershipMode === "available"
      ? nftInventory(Number(url.searchParams.get("limit") ?? 24))
      : { ...nftInventory(0), availability: "UNAVAILABLE", availabilityReason: "SOURCE_ERROR", asOf: null, items: [], nextCursor: null });
  }
  if (url.pathname === "/internal/v1/projects/ccff00/items/1") return json(response, NFT_ITEM);
  if (url.pathname === "/internal/v1/projects/ccff00/items/5") return json(response, {
    ...NFT_ITEM, tokenId: "5", tokenBoundAccount: { ...NFT_ITEM.tokenBoundAccount, tokenId: "5" },
  });
  if (url.pathname === "/internal/v1/projects/ccff00/onchain") {
    await delay(nftReaderDelays.onchain);
    return json(response,
    nftOwnershipMode === "available" ? NFT_ONCHAIN : { ...NFT_ONCHAIN, sourceStatus: "ERROR", availability: "UNAVAILABLE", completeness: "UNAVAILABLE", holderCount: null, circulatingTokenCount: null, recentActivity: [], asOf: null });
  }
  if (url.pathname === "/internal/v1/projects/ccff00/marketplace") {
    await delay(nftReaderDelays.marketplace);
    return nftMarketplaceMode === "available"
    ? json(response, NFT_MARKETPLACE)
    : json(response, { error: "marketplace_unavailable" }, 503);
  }
  return json(response, { error: "not_found" }, 404);
});
await new Promise((resolve, reject) => fixtureServer.listen(fixturePort, "127.0.0.1", resolve).once("error", reject));

const trades = Array.from({ length: 10 }, (_, index) => ({
  id: `fixture-${index}`, transactionHash: `0x${String(index + 4).repeat(64).slice(0, 64)}`,
  trader: `0x${(0x5000 + index).toString(16).padStart(40, "0")}`, side: index % 3 === 0 ? "sell" : "buy",
  tokenAmount: 120000 + index * 18000, quoteAmount: 0.11 + index * 0.018,
  priceUsd: 0.000092 + index * 0.000001, volumeUsd: 480 + index * 235,
  timestamp: new Date(FIXTURE_EPOCH_MS - index * 27_000).toISOString(),
}));

function candles(range, referencePrice = 0.000092) {
  const count = range === "7D" ? 84 : range === "24H" ? 72 : 42;
  const step = range === "7D" ? 7200 : range === "24H" ? 1200 : 60;
  const start = Math.floor(FIXTURE_EPOCH_MS / 1000) - count * step;
  return Array.from({ length: count }, (_, index) => {
    const close = referencePrice * (0.94 + index * 0.0012 + Math.sin(index / 3.2) * 0.004);
    const open = close - referencePrice * Math.cos(index / 2.8) * 0.002;
    return { timestamp: start + index * step, open, high: Math.max(open, close) + referencePrice * 0.003, low: Math.min(open, close) - referencePrice * 0.0025, close, volume: 3200 + Math.abs(Math.sin(index / 2)) * 9600 };
  });
}

async function installTokenRoutes(page, { riskUnavailable = false } = {}) {
  let chartMode = "ready";
  let riskMode = riskUnavailable ? "unavailable" : "ready";
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "fixture_route_not_registered" }) }));
  await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true, coverage: "complete", nextCursor: null, markets: canonicalDirectoryMarkets(), updatedAt: FIXTURE_NOW }) }));
  await page.route(/\/api\/vnext\/asset-workspace(?:\?.*)?$/, (route) => {
    const requestUrl = new URL(route.request().url());
    const selectedToken = requestUrl.searchParams.get("address");
    const upMarkets = Array.from({ length: 5 }, (_, index) => ({
      venue: index % 2 ? "up-cl" : "up-v2",
      poolAddress: `0x${(0x7100 + index).toString(16).padStart(40, "0")}`,
      token0: selectedToken,
      token1: `0x${(0x8100 + index).toString(16).padStart(40, "0")}`,
      quoteToken: `0x${(0x8100 + index).toString(16).padStart(40, "0")}`,
      stable: index % 2 ? null : false,
      tickSpacing: index % 2 ? 200 : null,
      liveFee: index === 0 ? 100 : index === 1 ? 2_500 : 3_000,
      feeDenominator: index === 0 ? 10_000 : 1_000_000,
      gaugeState: index === 0 ? "live" : "none",
      gaugeAddress: null, gaugeWeight: null, gaugeClaimable: null, feesAddress: null, bribeAddress: null
    }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ecosystem: { chainId: 4663, token: selectedToken, status: "ready", authoritative: false, observedBlock: "50000000", observedBlockHash: `0x${"a".repeat(64)}`, observedAt: FIXTURE_NOW, upMarkets, stonkBrokers: { sourceId: "stonkbrokers", sourceName: "StonkBrokers", attributionState: "production-source-unverified", tokenCreated: false, sourceListed: false, authoritative: false } }, stockAssetRelationships: [], stockAssetCoverage: "complete", updatedAt: FIXTURE_NOW }) });
  });
  await page.route(/\/api\/markets\/external(?:\?.*)?$/, (route) => {
    const contract = new URL(route.request().url()).searchParams.get("contract")?.toLowerCase();
    const markets = contract ? VISIBLE_TOKEN_MARKETS.filter((market) => market.address === contract || market.pairAddress === contract) : VISIBLE_TOKEN_MARKETS;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets, source: "legion-visual-fixture", rankingVersion: "deterministic-v1", thresholds: {}, originCoverage: "complete", rmtOriginCoverage: "complete", stockAssetCoverage: "complete", delayedSources: [], updatedAt: FIXTURE_NOW, stale: false }) });
  });
  await page.route(/\/api\/markets\/ohlcv(?:\?.*)?$/, (route) => {
    const requestUrl = new URL(route.request().url());
    const range = requestUrl.searchParams.get("range") ?? "1H";
    if (chartMode === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable" }) });
    const referencePrice = Number(requestUrl.searchParams.get("referencePrice") ?? 0.000092);
    const history = chartMode === "sparse" ? candles(range, referencePrice).slice(-1) : candles(range, referencePrice);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: requestUrl.searchParams.get("token"), pair: requestUrl.searchParams.get("pair"), range, candles: history, source: "GeckoTerminal", updatedAt: FIXTURE_NOW, lastTradeAt: trades[0].timestamp, refreshMs: 60_000, stale: chartMode === "stale" }) });
  });
  await page.route(/\/api\/trade\/external-venues(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, venues: [{ venue: "uniswap-v3", pair, dexId: "uniswap-v3", liquidityUsd: TOKEN_MARKETS[1].liquidityUsd, verification: "dex-and-route" }] }) }));
  await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, pair, source: "LEGION_FIXTURE", updatedAt: FIXTURE_NOW, trades }) }));
  await page.route(/\/api\/markets\/external-stream(?:\?.*)?$/, (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(/\/api\/markets\/token-risk(?:\?.*)?$/, (route) => {
    if (riskMode === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable" }) });
    const requestUrl = new URL(route.request().url());
    const countOnly = riskMode === "count-only";
    const holderRows = countOnly ? [] : [{ address: `0x${"9".repeat(40)}`, shareBps: 420, isContract: null, isScam: false }, { address: `0x${"8".repeat(40)}`, shareBps: 320, isContract: false, isScam: false }];
    const verifiedPosition = riskMode === "verified-position";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: requestUrl.searchParams.get("token"), pair: requestUrl.searchParams.get("pair"), marketVerified: true, coverage: riskMode === "partial" || countOnly ? "partial" : "complete", freshness: "fresh", domains: { token: "ready", holders: "ready", contract: "ready", abi: "ready", creator: "not-applicable", liquidity: riskMode === "partial" ? "unavailable" : "ready", sell: countOnly ? "unavailable" : "ready" }, contract: { sourcePublished: true, isProxy: false, bytecodeChanged: false, controls: { assessment: "no-common-controls-found", detected: [], customWriteFunctions: [], administrator: null, activeLaunchRestrictions: false, restrictionEndBlock: null, maxTransactionBps: null, maxWalletBps: null } }, liquidity: verifiedPosition ? { controlStatus: "contract-held", evidenceSource: "launchpad-registry", positionManager: `0x${"7".repeat(40)}`, positionId: "393642", owner: `0x${"6".repeat(40)}`, approvedOperator: null, creatorCanTransfer: false, positionLiquidity: "1000" } : { controlStatus: "not-proven", evidenceSource: "none", positionManager: null, positionId: null, owner: null, approvedOperator: null, creatorCanTransfer: null, positionLiquidity: null }, holders: { count: 975, poolShareBps: 4200, topNonPoolShareBps: countOnly ? null : 740, topNonPoolHolders: holderRows, largestNonPoolHolder: holderRows[0] ? { address: holderRows[0].address, shareBps: holderRows[0].shareBps } : null, creator: null, creatorShareBps: null }, sellSimulation: countOnly ? { status: "not-run", method: "holder-to-pool-transfer", holder: null, amount: null, returnStyle: null } : { status: "passed", method: "holder-to-pool-transfer", holder: holderRows[1].address, amount: "1", returnStyle: "boolean-true" }, warnings: countOnly ? ["Concentration rows and sell-direction evidence are temporarily unavailable."] : [], checkedAt: FIXTURE_NOW }) });
  });
  await page.route(/\/api\/vnext\/chain-pulse(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chainId: 4663, chain: "Robinhood Chain", source: "LEGION_FIXTURE", authoritative: false, status: "ready", tvlUsd: 580000000, dexVolume24hUsd: 640000000, dexVolume7dUsd: 3460000000, dexChange1dPct: 3.4, dexChange7dPct: 8.2, fees24hUsd: null, fees7dUsd: null, revenue24hUsd: null, revenue7dUsd: null, protocolRevenue24hUsd: null, protocolRevenue7dUsd: null }) }));
  await page.route(/\/api\/vnext\/capital-flow(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, chainId: 4663, chain: "Robinhood Chain", source: "DEFILLAMA", authoritative: false, status: "ready", asOf: FIXTURE_NOW, stablecoinMarketCapUsd: 148000000, stablecoinChange7dPct: 2.3, usdgMarketCapUsd: 91000000, usdgDominancePct: 61.5 }) }));
  return { setChartMode: (mode) => { chartMode = mode; }, setRiskMode: (mode) => { riskMode = mode; } };
}

async function createContext(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark", locale: "en-US", timezoneId: "UTC" });
  await context.addInitScript(({ fixedNow }) => {
    const acceptanceWallet = "0x3333333333333333333333333333333333333333";
    const listeners = new Map();
    Object.defineProperty(window, "ethereum", {
      configurable: false,
      value: {
        isMetaMask: false,
        on(event, listener) {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(listener);
          listeners.set(event, handlers);
        },
        removeListener(event, listener) {
          listeners.get(event)?.delete(listener);
        },
        async request({ method }) {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [acceptanceWallet];
          if (method === "eth_chainId") return "0x1237";
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_getCapabilities") return {};
          throw new Error(`Unsupported deterministic acceptance wallet method: ${method}`);
        }
      }
    });
    Date.now = () => fixedNow;
    localStorage.setItem("rmt:trading-terms", JSON.stringify({ version: "2026-07-28", acceptedAt: new Date(fixedNow).toISOString() }));
    localStorage.setItem("rmt:experience-preferences", JSON.stringify({ schemaVersion: 1, onboardingVersion: 1, diagnosticsEnabled: false, updatedAt: fixedNow }));
  }, { fixedNow: visualFixtureEpochMs });
  return context;
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function startupLane(browser) {
  const context = await createContext(browser, { width: 390, height: 844 });
  const page = await context.newPage();
  const canonicalGate = deferred();
  const enrichmentGate = deferred();
  let canonicalStartedAt = null;
  let enrichmentStartedAt = null;
  let enrichmentRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/vnext/market-directory") {
      canonicalStartedAt ??= performance.now();
      await canonicalGate.promise;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true, coverage: "complete", nextCursor: null, markets: canonicalDirectoryMarkets(), updatedAt: FIXTURE_NOW }) });
    }
    if (url.pathname === "/api/markets/external") {
      enrichmentRequests += 1;
      enrichmentStartedAt ??= performance.now();
      await enrichmentGate.promise;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets: VISIBLE_TOKEN_MARKETS, source: "legion-startup-fixture", rankingVersion: "deterministic-v1", thresholds: {}, originCoverage: "complete", rmtOriginCoverage: "complete", stockAssetCoverage: "complete", delayedSources: [], updatedAt: FIXTURE_NOW, stale: false }) });
    }
    if (url.pathname === "/api/vnext/chain-pulse" || url.pathname === "/api/vnext/capital-flow") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "unavailable" }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "startup_fixture_unregistered" }) });
  });
  const openedAt = performance.now();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector(".rmtMobileTerminal"));
  for (let attempt = 0; attempt < 100 && (canonicalStartedAt === null || enrichmentStartedAt === null); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  check(canonicalStartedAt !== null && enrichmentStartedAt !== null, "token-startup", "Canonical inventory and provider enrichment did not start concurrently.", { canonicalStartedAt, enrichmentStartedAt });
  canonicalGate.resolve();
  const canonicalRows = page.locator(".rmtMobileMarketRow");
  await canonicalRows.first().waitFor();
  const canonicalVisibleAt = performance.now();
  const pendingText = await canonicalRows.allTextContents();
  check(pendingText.some((text) => /Loading market data|Market data pending/.test(text)), "token-startup", "Canonical first paint did not expose a truthful pending metric state.");
  check(pendingText.every((text) => !/Unavailable/.test(text)), "token-startup", "Canonical first paint flashed a false Unavailable metric.", pendingText);
  await stabilize(page);
  await acceptanceCapture(page, "canonical-metrics-pending-390x844");
  enrichmentGate.resolve();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll(".rmtMobileMarketRow")].find((element) => element.textContent?.includes("PONS"));
    return Boolean(row && !/Loading market data|Market data pending/.test(row.textContent ?? ""));
  });
  const enrichedAt = performance.now();
  startupMetrics = {
    timeToCanonicalRowsMs: Math.round(canonicalVisibleAt - openedAt),
    timeCanonicalToEnrichedMs: Math.round(enrichedAt - canonicalVisibleAt),
    providerRequestStarted: enrichmentStartedAt !== null && canonicalStartedAt !== null && enrichmentStartedAt <= canonicalVisibleAt ? "BEFORE_CANONICAL_COMPLETE" : "AFTER_CANONICAL_COMPLETE",
    initialProviderRequests: enrichmentRequests,
    falseUnavailableFlash: pendingText.filter((text) => /Unavailable/.test(text)).length
  };
  check(enrichmentRequests === 1, "token-startup", "Initial provider enrichment request was duplicated.", { enrichmentRequests });
  await context.close();

  const delayedContext = await createContext(browser, { width: 390, height: 844 });
  const delayedPage = await delayedContext.newPage();
  await delayedPage.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/vnext/market-directory") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true, coverage: "complete", nextCursor: null, markets: canonicalDirectoryMarkets(), updatedAt: FIXTURE_NOW }) });
    if (url.pathname === "/api/markets/external") return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "fixture_rate_limited" }) });
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "unavailable" }) });
  });
  await delayedPage.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await delayedPage.getByRole("button", { name: /^All\b/ }).click();
  try {
    await delayedPage.locator(".rmtMobileMarketRow").first().waitFor();
  } catch (error) {
    throw new Error(`Delayed startup fixture did not render canonical rows. BODY=${(await delayedPage.locator("body").innerText()).slice(0, 2_000)}`, { cause: error });
  }
  await delayedPage.getByText(/Canonical markets ready · market data delayed/).waitFor();
  const delayedRows = await delayedPage.locator(".rmtMobileMarketRow").allTextContents();
  check(delayedRows.every((text) => !/Unavailable/.test(text)), "token-startup-delayed", "Provider failure produced repeated false Unavailable cells.", delayedRows);
  await delayedContext.close();
}

async function stabilize(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}" });
  await page.evaluate(() => document.fonts.ready);
}

async function overflow(page, state) {
  const value = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  horizontalOverflowPixels += value;
  check(value === 0, state, "Horizontal document overflow detected.", { pixels: value });
  return value;
}

async function legacyUxGuards(page, state, { focused = false, mobileScanner = false } = {}) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const exempt = (element) => Boolean(element.closest(".siteFooter,.universalHeroSocials,.externalIdentityLink"));
    const controls = Array.from(document.querySelectorAll("a,button,input,select,summary"))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 80), height: rect.height, exempt: exempt(element) };
      });
    const undersized = controls.filter((control) => !control.exempt && control.height < 32);
    const heroActions = document.querySelector(".universalHeroActions");
    const heroRect = heroActions && visible(heroActions) ? heroActions.getBoundingClientRect() : null;
    const clippedHeroActions = heroRect
      ? Array.from(heroActions.children).filter(visible).map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: (element.textContent ?? "").trim().slice(0, 80), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }).filter((rect) => rect.left < heroRect.left - 1 || rect.right > heroRect.right + 1 || rect.top < heroRect.top - 1 || rect.bottom > heroRect.bottom + 1)
      : [];
    const community = document.querySelector(".communityLive");
    const signalCard = document.querySelector(".liveSignalRail > a");
    return {
      controlCount: controls.length,
      undersized,
      clippedHeroActions,
      communityVisible: Boolean(community && visible(community)),
      signalCardHeight: signalCard && visible(signalCard) ? signalCard.getBoundingClientRect().height : null,
    };
  });

  controlsAudited += result.controlCount;
  controlHeightViolations += result.undersized.length;
  heroClippingViolations += result.clippedHeroActions.length;
  if (focused && result.communityVisible) communityOverlapViolations += 1;
  if (mobileScanner && result.signalCardHeight !== null && result.signalCardHeight > 140) mobileSignalHeightViolations += 1;

  check(result.undersized.length === 0, state, "Visible non-exempt interactive control is below 32 CSS px.", result.undersized);
  check(result.clippedHeroActions.length === 0, state, "Visible market hero action overflows its container.", result.clippedHeroActions);
  if (focused) check(!result.communityVisible, state, "Community/RMT Live overlay appears over a focused trading surface.");
  if (mobileScanner && result.signalCardHeight !== null) check(result.signalCardHeight <= 140, state, "Mobile signal card exceeds the 140 CSS px bound.", { height: result.signalCardHeight });
}

async function terminalNavigation(page, state, activeLabel) {
  const nav = page.locator('nav[aria-label="Terminal navigation"]:visible');
  await nav.waitFor();
  const labels = (await nav.locator("a,button").allTextContents()).map((label) => label.trim());
  const primary = labels.slice(0, 4);
  const aligned = JSON.stringify(primary) === JSON.stringify(["Markets", "NFTs", "Portfolio", "Distribution"]);
  const active = await nav.locator('[aria-current="page"]').allTextContents();
  crossSurfaceNavigationViolations += Number(!aligned) + Number(!active.includes(activeLabel));
  check(aligned, state, "Global market navigation is not aligned across RMT surfaces.", { primary });
  check(active.includes(activeLabel), state, `${activeLabel} is not the unmistakable active product section.`, { active });
}

async function capture(page, name) {
  const file = path.join(output, `${name}.png`);
  let previous = null;
  let stable = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const current = await page.screenshot({ fullPage: false, animations: "disabled", timeout: 30_000 });
    if (previous?.equals(current)) {
      stable = current;
      break;
    }
    previous = current;
  }
  if (!stable) throw new Error(`Visual state did not stabilize: ${name}`);
  await writeFile(file, stable);
  stateResults.push({ name, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), file });
}

async function acceptanceCapture(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(acceptanceOutput, `${name}.png`), fullPage: false, animations: "disabled", timeout: 30_000 });
}

async function tokenLane(browser, viewport, platform) {
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const fixture = await installTokenRoutes(page);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(platform === "mobile" ? ".rmtMobileTerminal" : ".rmtDesktopTerminal").waitFor();
  await stabilize(page);
  await terminalNavigation(page, `token-scanner-${platform}`, "Markets");
  const categoryButtons = page.locator(".rmtMarketViews button");
  const labels = await categoryButtons.locator("span").allTextContents();
  check(
    JSON.stringify(labels.slice(0, 4)) === JSON.stringify(["Active", "Movers", "New", "Trending"]),
    `token-scanner-${platform}`,
    "ACTIVE, MOVERS, NEW, and TRENDING must remain in the owner-authorized order.",
    { labels },
  );
  await categoryButtons.filter({ hasText: "Trending" }).click();
  const marketRowSelector = platform === "mobile" ? ".rmtMobileMarketRow" : ".rmtMarketTableRow";
  const trendingRows = page.locator(marketRowSelector);
  check(await trendingRows.count() === BROAD_TOKEN_MARKETS.filter((market) => market.signal === "moving" || market.signal === "early").length, `token-scanner-${platform}`, "TRENDING must derive from explicit activity/ranking evidence.");
  await categoryButtons.filter({ hasText: "New" }).click();
  const newRows = page.locator(marketRowSelector);
  check(await newRows.count() === BROAD_TOKEN_MARKETS.filter((market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60).length, `token-scanner-${platform}`, "NEW must derive from actual pool age evidence.");
  await categoryButtons.filter({ hasText: "All" }).click();
  const rows = page.locator(marketRowSelector);
  await rows.first().waitFor();
  check(await rows.count() === VISIBLE_TOKEN_MARKETS.length, `token-scanner-${platform}`, "ALL must expose the canonical seeds plus bounded broad markets.", { count: await rows.count() });
  const rowText = await rows.allTextContents();
  for (const market of TOKEN_MARKETS) {
    const text = rowText.find((row) => row.includes(market.symbol)) ?? "";
    check(Boolean(text), `token-scanner-${platform}`, `Missing curated market ${market.symbol}.`);
    check(!/Unavailable/i.test(text), `token-scanner-${platform}`, `Curated market ${market.symbol} became Unavailable.`);
  }
  for (const market of BROAD_TOKEN_MARKETS) check(rowText.some((text) => text.includes(market.symbol)), `token-scanner-${platform}`, `Missing broad visible market ${market.symbol}.`);
  const hopium = rowText.find((text) => text.includes("HOPIUM")) ?? "";
  const fdvTruthful = /FDV\s+\$/i.test(hopium) && !/MCap\s+\$/i.test(hopium);
  valuationTruthViolations += Number(!fdvTruthful);
  check(fdvTruthful, `token-scanner-${platform}`, "FDV-only fixture market is not labeled as FDV.", { row: hopium });
  await page.evaluate(() => scrollTo(0, 0));
  await legacyUxGuards(page, `token-scanner-${platform}`, { mobileScanner: platform === "mobile" });
  await overflow(page, `token-scanner-${platform}`);
  await capture(page, `token-scanner-${platform}-${viewport.width}x${viewport.height}`);

  if (platform === "mobile") {
    const scannerFocusSizes = await page.locator(".rmtMobileTerminal input,.rmtMobileTerminal select").evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
    check(scannerFocusSizes.length >= 1 && scannerFocusSizes.every((fontSize) => fontSize >= 16), "token-scanner-mobile", "Mobile market controls can trigger iOS focus zoom.", scannerFocusSizes);
    const chainPulse = page.locator('section[aria-label="Robinhood chain pulse"]');
    const capitalFlow = page.locator('section[aria-label="Robinhood Chain capital flow"]');
    await chainPulse.scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "chain-pulse-collapsed-390x844");
    await chainPulse.locator("button").first().click();
    await acceptanceCapture(page, "chain-pulse-expanded-390x844");
    await chainPulse.locator("button").first().click();
    await capitalFlow.scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "capital-flow-collapsed-390x844");
    await capitalFlow.locator("button").first().click();
    await acceptanceCapture(page, "capital-flow-expanded-390x844");
    await overflow(page, "capital-flow-mobile");
    await capitalFlow.locator("button").first().click();
  }

  const pons = rows.filter({ hasText: "PONS" }).first();
  await pons.click();
  await page.locator(platform === "mobile" ? ".rmtMobileAssetView" : ".rmtDesktopAssetView").waitFor();
  await page.locator(".vnChartFrame").waitFor();
  await page.evaluate(() => scrollTo(0, 0));
  await terminalNavigation(page, `token-asset-${platform}`, "Markets");
  check(await page.locator(".vnChartFrame").isVisible(), `token-asset-${platform}`, "Price/chart region is absent.");
  check(await page.getByText("Price Chart", { exact: true }).isVisible(), `token-asset-${platform}`, "Trader-facing Price Chart label is absent.");
  check(await page.getByText("Verified pool chart", { exact: true }).count() === 0, `token-asset-${platform}`, "Internal chart terminology dominates the trader-facing hierarchy.");
  if (platform === "desktop") check(await page.locator(".vnTradePanel").isVisible(), "token-asset-desktop", "Desktop trade rail is absent.");
  else check(await page.locator(".rmtMobileTradeDock").isVisible(), "token-asset-mobile", "Mobile sticky trade/quote control is absent.");
  const body = await page.locator("body").innerText();
  check(!/Submit transaction|Wallet submission enabled/i.test(body), `token-asset-${platform}`, "Public wallet submission appears enabled.");
  await legacyUxGuards(page, `token-asset-${platform}`, { focused: true });
  await overflow(page, `token-asset-${platform}`);
  await capture(page, `token-asset-${platform}-${viewport.width}x${viewport.height}`);

  const headerPrice = (await page.locator(".vnAssetPrice > strong").innerText()).trim();
  const restingChartPrice = (await page.locator("#vn-chart-title").innerText()).trim();
  check(headerPrice === restingChartPrice, `token-asset-${platform}`, "Resting chart price contradicts the selected Token Market headline.", { headerPrice, restingChartPrice });
  await page.locator(".vnChartFrame svg").hover({ position: { x: 120, y: 100 } });
  const historicalHoverPrice = (await page.locator("#vn-chart-title").innerText()).trim();
  check(historicalHoverPrice !== restingChartPrice, `token-asset-${platform}`, "Chart hover does not expose historical candle price.", { restingChartPrice, historicalHoverPrice });
  await page.locator(".vnAssetWorkspaceHeader").hover();

  if (platform === "mobile") {
    await page.locator(".vnChart").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "pons-selected-chart-390x844");
    await page.locator(".vnAssetQuickLinks").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "compact-quick-links-390x844");
    const moreLinks = page.locator(".vnMoreLinksButton");
    if (await moreLinks.count()) {
      await moreLinks.click();
      check(await moreLinks.getAttribute("aria-expanded") === "true", "token-links-mobile", "More links disclosure did not expose its expanded state.");
      await acceptanceCapture(page, "compact-quick-links-open-390x844");
      await moreLinks.click();
    }

    await page.getByRole("tab", { name: "Safety", exact: true }).click();
    await page.locator(".vnEvidencePane").waitFor();
    await page.locator(".vnEvidencePane").scrollIntoViewIfNeeded();
    const readyHoldersText = await page.locator(".vnEvidencePane").innerText();
    const readyHoldersTextLower = readyHoldersText.toLowerCase();
    check(readyHoldersTextLower.includes("largest non-pool holder"), "token-safety-mobile", "Verified address-market concentration is not labeled as the largest non-pool holder.");
    check(!readyHoldersTextLower.includes("largest wallet"), "token-safety-mobile", "Unknown holder classification was inferred to be a wallet in the aggregate label.");
    check(readyHoldersTextLower.includes("classification unknown"), "token-safety-mobile", "Unknown classification is not preserved on the largest holder row.");
    check(readyHoldersText.includes("4.2%"), "token-safety-mobile", "Largest-holder concentration disappeared when classification remained unknown.");
    await acceptanceCapture(page, "safety-holders-ready-390x844");
    await page.getByRole("tab", { name: "liquidity", exact: true }).click();
    await page.getByText("LP ownership/control · Not verified", { exact: true }).evaluate((element) => element.scrollIntoView({ block: "center" }));
    check(await page.locator(".vnEvidenceFact").filter({ hasText: "Pool token share" }).count() === 1, "token-safety-mobile", "No-position pool share did not render as one compact fact.");
    check(await page.locator(".vnEvidenceGrid").filter({ hasText: "Pool token share" }).count() === 0, "token-safety-mobile", "No-position pool share retained the multi-column evidence grid.");
    await acceptanceCapture(page, "safety-liquidity-ready-390x844");
    await page.getByRole("tab", { name: "risk", exact: true }).click();
    check(await page.getByText("Onchain verified", { exact: true }).count() === 1, "token-safety-mobile", "Safety does not reuse the workspace onchain token identity.");
    check(await page.getByText("Complete evidence", { exact: true }).count() >= 1, "token-safety-mobile", "Complete risk coverage is not labeled independently.");
    check(await page.getByText("Fresh", { exact: true }).count() === 1, "token-safety-mobile", "Freshness is not labeled independently from coverage.");
    check(await page.getByText("passed", { exact: true }).count() === 1, "token-safety-mobile", "Complete fixture does not expose its completed sell check.");
    await acceptanceCapture(page, "safety-risk-ready-390x844");

    const reopenPonsAfterFixtureReload = async () => {
      await page.locator(".rmtMobileMarketsView").waitFor();
      await page.locator(".rmtMarketViews button").filter({ hasText: "All" }).click();
      await page.locator(".rmtMobileMarketRow").filter({ hasText: "PONS" }).first().click();
      await page.locator(".rmtMobileAssetView").waitFor();
    };

    fixture.setRiskMode("count-only");
    await page.reload({ waitUntil: "domcontentloaded" });
    await reopenPonsAfterFixtureReload();
    await page.getByRole("tab", { name: "Safety", exact: true }).click();
    await page.getByText("975 holders", { exact: true }).scrollIntoViewIfNeeded();
    check(await page.getByText("Partial evidence", { exact: true }).count() >= 1, "token-safety-count-only", "Count-only evidence did not downgrade coverage to partial.");
    await acceptanceCapture(page, "safety-holders-count-only-390x844");
    await page.getByRole("tab", { name: "risk", exact: true }).click();
    check(await page.getByText("Fresh", { exact: true }).count() === 1, "token-safety-count-only", "Count-only evidence lost truthful fresh provenance.");
    check(await page.getByText("Sell check", { exact: true }).count() === 0, "token-safety-count-only", "Unavailable count-only sell evidence was presented as a completed check.");

    fixture.setRiskMode("verified-position");
    await page.reload({ waitUntil: "domcontentloaded" });
    await reopenPonsAfterFixtureReload();
    await page.getByRole("tab", { name: "Safety", exact: true }).click();
    await page.getByRole("tab", { name: "liquidity", exact: true }).click();
    await page.getByText("launchpad registry", { exact: true }).evaluate((element) => element.scrollIntoView({ block: "center" }));
    await acceptanceCapture(page, "safety-liquidity-verified-position-390x844");

    fixture.setRiskMode("ready");
    await page.reload({ waitUntil: "domcontentloaded" });
    await reopenPonsAfterFixtureReload();
    await page.locator(".rmtMobileTradeDock").waitFor();

    await page.locator(".rmtMobileTradeDock .isBuy").click();
    const tradeSheet = page.locator(".rmtMobileTradeSheet");
    await tradeSheet.waitFor();
    const focusableSizes = await tradeSheet.locator("input,select").evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }).map((element) => ({ tag: element.tagName, fontSize: Number.parseFloat(getComputedStyle(element).fontSize) })));
    check(focusableSizes.length >= 2 && focusableSizes.every((control) => control.fontSize >= 16), "token-trade-mobile", "Focusable Token trade controls can trigger iOS focus zoom.", focusableSizes);
    const amountControl = tradeSheet.locator('input[inputmode="decimal"]').first();
    await amountControl.focus();
    check(await overflow(page, "token-trade-amount-focus") === 0, "token-trade-amount-focus", "Amount focus changed the application width.");
    await acceptanceCapture(page, "trade-buy-amount-focused-390x844");
    const assetSelect = tradeSheet.locator("select").first();
    await assetSelect.focus();
    check(await overflow(page, "token-trade-asset-focus") === 0, "token-trade-asset-focus", "Funding-asset focus changed the application width.");
    await acceptanceCapture(page, "trade-buy-asset-focused-390x844");
    const advancedCard = tradeSheet.locator(".vnRouteCard");
    if (await advancedCard.count()) {
      await advancedCard.locator("summary").click();
      const advanced = advancedCard.locator(".vnRouteDetails");
      const nestedScroll = await advanced.evaluate((element) => {
        const style = getComputedStyle(element);
        return { overflowY: style.overflowY, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
      });
      check(!["auto", "scroll"].includes(nestedScroll.overflowY), "token-trade-mobile", "Advanced Details remains a nested mobile scroll surface.", nestedScroll);
      await acceptanceCapture(page, "trade-advanced-details-390x844");
    }
    await tradeSheet.getByRole("button", { name: "Close trade sheet" }).click();

    await page.getByRole("tab", { name: "Markets", exact: true }).click();
    check(await page.getByRole("tab", { name: "up.", exact: true }).count() === 0, "token-markets-mobile", "up. remains a top-level workspace tab.");
    check(await page.getByText("Other verified venues · 5", { exact: true }).count() === 1, "token-markets-mobile", "Verified venue evidence was not preserved under Markets.");
    check(await page.getByRole("tab", { name: "RWA", exact: true }).count() === 0, "token-markets-mobile", "RWA remains a primary tab without a verified relationship.");
    await page.locator(".vnMarketEvidenceStack").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "other-verified-venues-collapsed-390x844");
    const venueDisclosure = page.locator(".vnVenueDisclosure");
    await venueDisclosure.locator("summary").click();
    check(await page.getByText(/Pool swap fee · 1\.00%/).count() >= 1, "token-markets-mobile", "Venue fee is not explicitly labeled as a pool swap fee.");
    await acceptanceCapture(page, "other-verified-venues-expanded-390x844");

    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    fixture.setChartMode("unavailable");
    await page.getByRole("tab", { name: "5M", exact: true }).click();
    await page.locator(".vnChartState").getByText("Unavailable", { exact: true }).waitFor();
    await page.locator(".vnChart").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "chart-unavailable-390x844");

    fixture.setChartMode("sparse");
    await page.getByRole("tab", { name: "1H", exact: true }).click();
    await page.getByRole("tab", { name: "5M", exact: true }).click();
    await page.getByText("Sparse 5-minute market history", { exact: false }).waitFor();
    await acceptanceCapture(page, "chart-sparse-5m-390x844");

    fixture.setChartMode("stale");
    await page.getByRole("tab", { name: "15M", exact: true }).click();
    await page.getByText("Retrying", { exact: true }).waitFor();
    await acceptanceCapture(page, "chart-stale-retrying-390x844");

    fixture.setChartMode("ready");
    await page.locator(".rmtMobileAssetBack button").click();
    await page.locator(".rmtMobileMarketsView").waitFor();
    await page.locator(".rmtMarketViews button").filter({ hasText: "All" }).click();
    fixture.setRiskMode("unavailable");
    await page.locator(".rmtMobileMarketRow").filter({ hasText: "CASHCAT" }).first().click();
    await page.locator(".vnChartFrame svg").waitFor();
    const cashcatHeader = (await page.locator(".vnAssetPrice > strong").innerText()).trim();
    const cashcatChart = (await page.locator("#vn-chart-title").innerText()).trim();
    check(cashcatHeader === cashcatChart, "cashcat-chart-mobile", "CASHCAT chart headline contradicts its selected-market price.", { cashcatHeader, cashcatChart });
    await page.locator(".vnChart").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "cashcat-selected-chart-390x844");
    await page.getByRole("tab", { name: "Safety", exact: true }).click();
    await page.getByRole("tab", { name: "risk", exact: true }).click();
    await page.getByText("Contract risk evidence unavailable", { exact: true }).waitFor();
    const emptySafetyHeight = await page.locator(".vnEvidencePane").evaluate((element) => element.getBoundingClientRect().height);
    check(emptySafetyHeight < 260, "token-safety-mobile", "Unavailable Safety evidence still reserves excessive vertical space.", { height: emptySafetyHeight });
    await acceptanceCapture(page, "safety-unavailable-compact-390x844");

    await page.locator(".rmtMobileAssetBack button").click();
    await page.locator(".rmtMobileMarketsView").waitFor();
    await page.locator(".rmtMarketViews button").filter({ hasText: "All" }).click();
    fixture.setRiskMode("partial");
    await page.locator(".rmtMobileMarketRow").filter({ hasText: "PIPEDOG" }).first().click();
    await page.getByRole("tab", { name: "Safety", exact: true }).click();
    await page.getByRole("tab", { name: "liquidity", exact: true }).click();
    await page.getByText("Liquidity-control evidence unavailable", { exact: true }).waitFor();
    await acceptanceCapture(page, "safety-partial-390x844");
    await page.getByRole("tab", { name: "risk", exact: true }).click();
    check(await page.getByText("Partial evidence", { exact: true }).count() >= 1, "token-safety-partial-mobile", "Partial coverage is not labeled independently.");
    check(await page.getByText("Fresh", { exact: true }).count() === 1, "token-safety-partial-mobile", "Partial coverage incorrectly replaces freshness.");
    await acceptanceCapture(page, "safety-risk-partial-fresh-390x844");

    const dock = page.locator(".rmtMobileTradeDock");
    const dockOverlap = await page.evaluate(() => {
      const dockElement = document.querySelector(".rmtMobileTradeDock");
      const workspace = document.querySelector(".vnAssetWorkspace");
      if (!dockElement || !workspace) return null;
      const dockRect = dockElement.getBoundingClientRect();
      const finalControl = [...workspace.querySelectorAll("button,a,summary")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).at(-1);
      if (!finalControl) return null;
      finalControl.scrollIntoView({ block: "center" });
      const rect = finalControl.getBoundingClientRect();
      return Math.max(0, rect.bottom - dockRect.top);
    });
    check(dockOverlap === 0, "mobile-trade-dock", "Fixed trade dock obscures the final usable workspace control.", { overlap: dockOverlap });
    check(await dock.isVisible(), "mobile-trade-dock", "Mobile Buy/Sell dock is not reachable.");
    await overflow(page, "token-release-polish-mobile");
  }

  await page.locator('[data-terminal-nav="portfolio"]:visible').click();
  await page.locator(".rmtPortfolioSurface").waitFor();
  const portfolioHeading = await page.getByRole("heading", { name: "Portfolio", exact: true }).isVisible();
  const portfolioActive = await page.locator('[data-terminal-nav="portfolio"]:visible').getAttribute("aria-current") === "page";
  portfolioReturnPathViolations += Number(!portfolioHeading) + Number(!portfolioActive);
  check(portfolioHeading && portfolioActive, `portfolio-${platform}`, "Portfolio is not a coherent ownership return point.", { portfolioHeading, portfolioActive });
  if (platform === "mobile") {
    const walletDetails = page.getByRole("button", { name: "Wallet details", exact: true });
    if (await walletDetails.count()) await walletDetails.click();
    const portfolioText = await page.locator(".rmtPortfolioSurface").innerText();
    if (browserAcceptanceProfile) {
      check(/Wallet ETH[\s\S]*Spendable ETH[\s\S]*Reserved for network gas/i.test(portfolioText), "portfolio-mobile", "Portfolio does not explain the native gas reserve explicitly.", portfolioText.slice(0, 1_200));
      await page.locator(".vnPortfolioTruth").scrollIntoViewIfNeeded();
    }
    check(!/1 onchain assets/.test(portfolioText), "portfolio-mobile", "Portfolio uses incorrect singular asset grammar.");
  }
  await overflow(page, `portfolio-${platform}`);
  if (platform === "mobile") await acceptanceCapture(page, "portfolio-premium-mobile-390x844");
  else await acceptanceCapture(page, "portfolio-premium-desktop-1440x900");
  await page.locator('[data-terminal-nav="markets"]:visible').click();
  await page.locator(platform === "mobile" ? ".rmtMobileMarketsView" : ".rmtDesktopMarketsView").waitFor();
  await context.close();
}

async function registrationCorners(page, state, selector) {
  const frame = page.locator(selector).first();
  await frame.waitFor();
  const corners = await frame.evaluate((element) => {
    const before = getComputedStyle(element, "::before");
    const after = getComputedStyle(element, "::after");
    return { before: { width: before.width, height: before.height, top: before.borderTopColor, left: before.borderLeftColor }, after: { width: after.width, height: after.height, right: after.borderRightColor, bottom: after.borderBottomColor } };
  });
  const authorityGreen = "rgb(147, 232, 142)";
  const technicalNeutral = "rgb(82, 96, 88)";
  const upperLeftAuthority = corners.before.width !== "0px" && corners.before.height !== "0px" && corners.before.top === authorityGreen && corners.before.left === authorityGreen;
  const lowerRightTechnical = corners.after.width !== "0px" && corners.after.height !== "0px" && corners.after.right === technicalNeutral && corners.after.bottom === technicalNeutral;
  registrationCornerRoleViolations += Number(!upperLeftAuthority) + Number(!lowerRightTechnical);
  check(upperLeftAuthority, state, "Upper-left registration corner does not use the RMT green authority role.", { expected: authorityGreen, actual: corners.before });
  check(lowerRightTechnical, state, "Lower-right registration corner does not use the neutral technical role.", { expected: technicalNeutral, actual: corners.after });
}

async function nftPage(browser, viewport, platform, testCase) {
  const { route, state, kind, ownership = "available", marketplace = "available", radar = "ready" } = testCase;
  nftOwnershipMode = ownership;
  nftMarketplaceMode = marketplace;
  nftRadarMode = radar;
  nftReaderDelays = { inventory: 0, onchain: 0, marketplace: 0 };
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator('[data-nft-terminal-shell="v1"]').waitFor();
  await stabilize(page);

  const expectedUrl = new URL(route, base);
  const nftNav = page.locator('nav[aria-label="RMT Terminal navigation"]:visible');
  const nftPrimary = (await nftNav.locator("a").allTextContents()).map((label) => label.trim()).slice(0, 4);
  const nftNavAligned = JSON.stringify(nftPrimary) === JSON.stringify(["Markets", "NFTs", "Portfolio", "Distribution"]);
  const nftActive = await nftNav.locator('[aria-current="page"]').allTextContents();
  const walletReturnTo = await page.locator("[data-nft-wallet-return-to]").getAttribute("data-nft-wallet-return-to");
  crossSurfaceNavigationViolations += Number(!nftNavAligned) + Number(!nftActive.includes("NFTs")) + Number(walletReturnTo !== expectedUrl.pathname);
  check(nftNavAligned, state, "NFT global market navigation is not aligned with the Token surface.", { primary: nftPrimary });
  check(nftActive.includes("NFTs"), state, "NFTs is not the unmistakable active product section.", { active: nftActive });
  check(walletReturnTo === expectedUrl.pathname, state, "NFT wallet flow does not preserve the current market/item path.", { expected: expectedUrl.pathname, actual: walletReturnTo });
  const currentUrl = new URL(page.url());
  check(`${currentUrl.pathname}${currentUrl.search}` === route, state, "NFT route did not resolve exactly.", { actual: `${currentUrl.pathname}${currentUrl.search}`, expected: route });

  const text = await page.locator("body").innerText();
  check(!/\bRarity\b/i.test(text), state, "Rarity was invented for CCFF00.");
  const forbidden = page.locator("a,button").filter({ hasText: /^(Buy|List|Offer|Fulfill|Sign|Submit)$/i });
  const forbiddenCount = await forbidden.count();
  nftExecutionControls += forbiddenCount;
  check(forbiddenCount === 0, state, "NFT execution controls are present.", { count: forbiddenCount });

  if (["active", "active-unavailable", "marketplace-unavailable", "new", "search", "search-item", "watching", "minting", "minting-empty", "empty"].includes(kind)) {
    check(await page.getByRole("heading", { name: "NFTs", exact: true }).count() === 1, state, "Compact NFT market header is absent.");
    check(/ROBINHOOD CHAIN NFT MARKETS/i.test(text), state, "NFT market subtitle is absent.");
    const labels = await page.locator('nav[aria-label="NFT market views"] strong').allTextContents();
    check(JSON.stringify(labels) === JSON.stringify(["Active", "New", "Minting", "Trending", "Watching"]), state, "NFT market view order changed.", { labels });
    check(await page.getByPlaceholder("Search collection, contract or NFT").count() === 1, state, "Compact NFT search control is absent.");
    check(!text.includes("See the collection.\nSee what’s actually happening."), state, "Editorial NFT discovery hero is still present.");
    if (platform === "mobile") {
      const positions = await page.evaluate(() => {
        const heading = document.querySelector("h1")?.getBoundingClientRect();
        const tabs = document.querySelector('nav[aria-label="NFT market views"]')?.getBoundingClientRect();
        const search = document.querySelector('form[role="search"]')?.getBoundingClientRect();
        const row = document.querySelector("[data-nft-collection-row], [data-radar-candidate], [data-nft-search-item], [data-nft-empty-state]")?.getBoundingClientRect();
        return { heading: heading?.top, tabs: tabs?.top, searchBottom: search?.bottom, rowTop: row?.top };
      });
      check((positions.heading ?? 9999) < viewport.height && (positions.tabs ?? 9999) < viewport.height && (positions.searchBottom ?? 9999) < viewport.height && (positions.rowTop ?? 9999) < viewport.height,
        state, "NFT title, tabs, search, and first collection state do not fit in the first useful mobile viewport.", positions);
    }
    if (await page.locator("[data-rmt-registration-frame]").count()) await registrationCorners(page, state, "[data-rmt-registration-frame]");
  }

  if (kind === "active" || kind === "active-unavailable" || kind === "marketplace-unavailable") {
    check(await page.locator('[data-nft-collection-status="ACTIVE"]').count() === 1, state, "Public ACTIVE NFT collection count is not one.");
    check(text.includes("CCFF00"), state, "CCFF00 is absent from Active NFT markets.");
    const row = page.locator('[data-nft-collection-status="ACTIVE"]').first();
    check(await row.locator("[data-ownership-state]").first().getAttribute("data-ownership-state") === (ownership === "available" ? "AVAILABLE" : "UNAVAILABLE"), state, "Ownership progressive state is incorrect.");
    if (marketplace === "unavailable") {
      const metrics = await row.locator("dd").allTextContents();
      check(metrics.length === 2 && metrics.every((value) => value.trim() === "—"), state, "Unavailable marketplace evidence did not preserve the collection row with explicit gaps.", { metrics });
    }
  } else if (kind === "watching") {
    const watchingCards = page.locator('[data-nft-collection-status="WATCHING"]');
    const watchingCount = await watchingCards.count();
    const watchingAdmitted = await watchingCards.locator('a[href^="/nft/"]').count();
    const watchingClassified = text.includes("Robin Rabbits") && text.includes("Gogh Punks") && watchingCount === 2 && watchingAdmitted === 0;
    watchingPublicClassificationViolations += Number(!watchingClassified);
    check(watchingClassified, state, "WATCHING collections are not correctly separated from RMT admission.", { watchingCount, watchingAdmitted });
  } else if (kind === "new") {
    check(await page.locator('[data-new-evidence="TECHNICAL_VERIFICATION_OBSERVED"]').count() === 3, state, "New view is not sourced from technical-verification observation evidence.");
    check(await page.locator('[data-nft-collection-status="WATCHING"]').count() === 2, state, "Verified non-ACTIVE discoveries are missing from New.");
    check(await page.locator('[data-nft-collection-status="WATCHING"] a[href^="/nft/"]').count() === 0, state, "New view promoted WATCHING discovery into an active Project Market.");
  } else if (kind === "minting") {
    const radarSurface = page.locator("[data-nft-mint-radar]");
    check(await radarSurface.getAttribute("data-radar-state") === "READY", state, "Minting fixture is not READY.");
    const candidates = page.locator("[data-radar-candidate]");
    check(await candidates.count() === 1, state, "Verified live Minting row count changed.", { count: await candidates.count() });
    check(await page.locator('[data-radar-candidate][data-radar-state="LIVE_NOW"]').count() === 1, state, "Verified live mint is not classified LIVE_NOW.");
    check(await page.locator('[data-radar-candidate]:not([data-radar-admission="NOT_EVALUATED"])').count() === 0, state, "Minting row crossed into RMT admission authority.");
    check(await page.locator('[data-radar-candidate]:not([data-radar-chain="4663"])').count() === 0, state, "Minting row exposed a non-Robinhood Chain candidate.");
    check(await page.locator('[data-ccff00-access="VERIFIED_COMMUNITY_GATE"]').count() === 1, state, "Verified CCFF00 SeaDrop authority is absent.");
    check(await page.getByText("#CCFF00 ACCESS · VERIFIED", { exact: true }).count() === 1, state, "Verified CCFF00 access badge is absent.");
    const readiness = page.locator("[data-nft-readiness-action]");
    check(await readiness.count() === 1 && (await readiness.first().textContent())?.trim() === "CHECK READINESS", state, "Mint readiness action changed or disappeared.");
    check(await page.locator("[data-nft-mint-readiness] form").count() === 0, state, "Mint readiness introduced an execution form.");
  } else if (kind === "minting-empty") {
    check(await page.locator("[data-radar-candidate]").count() === 0, state, "Empty Minting state contains candidates.");
    check(await page.getByText("No verified live mints", { exact: true }).count() === 1, state, "Compact empty Minting state is absent.");
    check(!text.includes("LIVE MINT FEED UNAVAILABLE"), state, "Large unavailable Mint Radar panel returned.");
  } else if (kind === "search") {
    check(await page.locator("[data-nft-search-results]").count() === 1, state, "NFT search result surface is absent.");
    check(await page.locator('[data-nft-collection-status="ACTIVE"]').count() === 1 && text.includes("CCFF00"), state, "Authoritative collection search did not resolve CCFF00.");
  } else if (kind === "search-item") {
    check(await page.locator('[data-nft-item-lookup="CONFIRMED"] [data-nft-search-item]').count() === 1, state, "Exact NFT search outside the four-item preview did not resolve.");
    check(text.includes("CCFF00 #5") && text.includes("Exact indexed NFT"), state, "Exact NFT search result lacks canonical item identity.");
  } else if (kind === "empty") {
    check(await page.locator("[data-nft-empty-state]").count() === 1, state, "Empty market tab lacks a compact explicit state.");
    check(text.includes("No collections have current authoritative trending evidence"), state, "Trending empty state changed.");
  } else if (kind === "project") {
    check(await page.locator("[data-nft-gallery]").isVisible(), state, "CCFF00 Project Market gallery is absent.");
    check(text.includes("CANONICAL ONCHAIN INVENTORY") && text.includes("PROVIDER MARKETPLACE EVIDENCE"), state, "Chain and marketplace evidence are not visibly separated.");
    check(await page.locator('[data-nft-market-tape] article').count() === 5, state, "Collection metric strip does not expose five evidence-bound metrics.");
    const collectionViews = await page.locator('nav[aria-label="Collection market views"] a').allTextContents();
    check(JSON.stringify(collectionViews) === JSON.stringify(["Items", "Activity", "Holders", "Intelligence"]), state, "Collection market navigation is incomplete.", { collectionViews });
    check(text.includes("COLLECTION SPOTLIGHT") && text.includes("LIVE EVIDENCE LEDGER"), state, "Deep collection intelligence was not preserved below the market header.");
    await registrationCorners(page, state, "[data-nft-gallery] a > div");
  } else if (kind === "item") {
    check(await page.locator("[data-nft-item-workspace]").isVisible(), state, "Representative CCFF00 item workspace is absent.");
    check(/TOKEN-BOUND ACCOUNT\s*·?\s*ERC-6551 ACCOUNT/i.test(text), state, "CCFF00 token-bound account capability is absent.");
    check(text.includes("ONCHAIN TOKENURI"), state, "Fully onchain metadata authority is absent.");
    const breadcrumbLinks = await page.locator('nav[aria-label="NFT Terminal breadcrumb"] a').allTextContents();
    const contextualBreadcrumb = breadcrumbLinks[0]?.trim() === "NFTs" && breadcrumbLinks[1]?.includes("Project Market");
    crossSurfaceNavigationViolations += Number(!contextualBreadcrumb);
    check(contextualBreadcrumb, state, "NFT item breadcrumb does not preserve collection/project context.", { breadcrumbLinks });
    await registrationCorners(page, state, "[data-nft-item-workspace] > div:first-child");
  }

  await overflow(page, state);
  await capture(page, `${state}-${viewport.width}x${viewport.height}`);
  await context.close();
}

async function nftProgressiveLane(browser, viewport, platform, scenario) {
  nftOwnershipMode = "available";
  nftMarketplaceMode = "available";
  nftRadarMode = "ready";
  nftReaderDelays = scenario.delays;
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const started = performance.now();
  await page.goto(`${base}/nft`, { waitUntil: "commit", timeout: 60_000 });
  await page.locator("[data-nft-known-identity]").waitFor();
  const identityMs = Math.round(performance.now() - started);
  const readySelector = scenario.readySelector;
  await page.locator(readySelector).waitFor();
  const independentEvidenceMs = Math.round(performance.now() - started);
  const slowSelector = scenario.slowSelector;
  const slowVisibleEarly = await page.locator(slowSelector).isVisible().catch(() => false);
  check(identityMs < scenario.delays[scenario.slowReader], `${scenario.name}-${platform}`, "Known NFT identity waited for unrelated enrichment.", { identityMs, delays: scenario.delays });
  check(independentEvidenceMs < scenario.delays[scenario.slowReader], `${scenario.name}-${platform}`, "Ready evidence waited for an unrelated slow provider.", { independentEvidenceMs, delays: scenario.delays, readySelector });
  check(!slowVisibleEarly, `${scenario.name}-${platform}`, "Slow-provider evidence appeared before its deterministic delay.", { slowSelector });
  await page.locator(slowSelector).waitFor();
  const slowEvidenceMs = Math.round(performance.now() - started);
  progressiveNftTimings.push({ scenario: scenario.name, platform, identityMs, independentEvidenceMs, slowEvidenceMs, configuredDelayMs: scenario.delays[scenario.slowReader] });
  await overflow(page, `${scenario.name}-${platform}`);
  await context.close();
  nftReaderDelays = { inventory: 0, onchain: 0, marketplace: 0 };
}

async function nftJourneyLane(browser, viewport, platform) {
  nftOwnershipMode = "available";
  nftMarketplaceMode = "available";
  nftReaderDelays = { inventory: 0, onchain: 0, marketplace: 0 };
  const state = `nft-functional-journey-${platform}`;
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${base}/nft`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByPlaceholder("Search collection, contract or NFT").fill("ccff00 #5");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator('[data-nft-item-lookup="CONFIRMED"] [data-nft-search-item]').waitFor();
  check(new URL(page.url()).searchParams.get("q") === "ccff00 #5", state, "Search interaction did not preserve the bounded exact-item query.");
  await page.locator('[data-nft-search-item]').click();
  await page.waitForURL(/\/nft\/ccff00\/5$/);
  await page.getByRole("link", { name: /Back to CCFF00 collection/ }).click();
  await page.waitForURL(/\/nft\/ccff00$/);
  await page.getByRole("link", { name: "← NFTs", exact: true }).click();
  await page.waitForURL(/\/nft$/);
  await page.locator('[data-nft-collection-status="ACTIVE"]').click();
  await page.waitForURL(/\/nft\/ccff00$/);
  await page.locator("[data-nft-gallery] a").first().click();
  await page.waitForURL(/\/nft\/ccff00\/1$/);
  await page.getByRole("link", { name: /Back to CCFF00 collection/ }).click();
  await page.waitForURL(/\/nft\/ccff00$/);
  const forbiddenCount = await page.locator("a,button").filter({ hasText: /^(Buy|List|Offer|Fulfill|Sign|Submit)$/i }).count();
  check(forbiddenCount === 0, state, "Functional NFT journey exposed execution controls.", { forbiddenCount });
  await overflow(page, state);
  await capture(page, `${state}-${viewport.width}x${viewport.height}`);
  await context.close();
}
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu", "--force-device-scale-factor=1"] });
  await startupLane(browser);
  await tokenLane(browser, { width: 1440, height: 900 }, "desktop");
  await tokenLane(browser, { width: 390, height: 844 }, "mobile");
  const nftStates = [
    { route: "/nft", state: "nft-active-available", kind: "active" },
    { route: "/nft", state: "nft-active-ownership-unavailable", kind: "active-unavailable", ownership: "unavailable" },
    { route: "/nft?view=watching", state: "nft-watching", kind: "watching" },
    { route: "/nft?view=new", state: "nft-new-provenance", kind: "new" },
    { route: "/nft?view=minting", state: "nft-minting-verified-live", kind: "minting" },
    { route: "/nft?view=minting&q=NoSuchMint", state: "nft-minting-empty", kind: "minting-empty" },
    { route: "/nft", state: "nft-marketplace-unavailable", kind: "marketplace-unavailable", marketplace: "unavailable" },
    { route: "/nft?q=CCFF00", state: "nft-search", kind: "search" },
    { route: "/nft?q=ccff00%20%235", state: "nft-search-item-beyond-preview", kind: "search-item" },
    { route: "/nft?view=trending", state: "nft-empty-trending", kind: "empty", ownership: "unavailable", marketplace: "unavailable" },
    { route: "/nft/ccff00", state: "nft-project", kind: "project" },
    { route: "/nft/ccff00/1", state: "nft-item", kind: "item" },
  ];
  for (const testCase of nftStates) {
    await nftPage(browser, { width: 1440, height: 900 }, "desktop", { ...testCase, state: `${testCase.state}-desktop` });
    await nftPage(browser, { width: 390, height: 844 }, "mobile", { ...testCase, state: `${testCase.state}-mobile` });
  }
  const progressiveScenarios = [
    { name: "nft-progressive-marketplace-delay", slowReader: "marketplace", delays: { inventory: 0, onchain: 0, marketplace: 1_600 }, readySelector: '[data-ownership-state="AVAILABLE"]', slowSelector: '[data-nft-marketplace-evidence="AVAILABLE"]' },
    { name: "nft-progressive-ownership-delay", slowReader: "onchain", delays: { inventory: 0, onchain: 1_600, marketplace: 0 }, readySelector: '[data-nft-marketplace-evidence="AVAILABLE"]', slowSelector: '[data-ownership-state="AVAILABLE"]' },
    { name: "nft-progressive-inventory-delay", slowReader: "inventory", delays: { inventory: 1_600, onchain: 0, marketplace: 0 }, readySelector: '[data-ownership-state="AVAILABLE"]', slowSelector: '[data-nft-collection-status="ACTIVE"] img' },
  ];
  for (const scenario of progressiveScenarios) {
    await nftProgressiveLane(browser, { width: 1440, height: 900 }, "desktop", scenario);
    await nftProgressiveLane(browser, { width: 390, height: 844 }, "mobile", scenario);
  }
  await nftJourneyLane(browser, { width: 1440, height: 900 }, "desktop");
  await nftJourneyLane(browser, { width: 390, height: 844 }, "mobile");
} catch (error) {
  failures.push({ state: "harness", message: error instanceof Error ? error.stack ?? error.message : String(error) });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => fixtureServer.close(resolve));
}

const summary = {
  schemaVersion: 1,
  platform: process.platform,
  captureOnly,
  fixtureTime: FIXTURE_NOW,
  tokenFixtureMarkets: TOKEN_MARKETS.map(({ name, symbol, address, canonicalMarkets }) => ({ name, symbol, address, pool: canonicalMarkets[0].poolKey })),
  nftPublicActiveProjects: ["ccff00"],
  invariants: {
    tokenCuratedMarketCount: TOKEN_MARKETS.length,
    tokenVisibleMarketCount: VISIBLE_TOKEN_MARKETS.length,
    broadExecutionFixtures: Object.fromEntries(BROAD_TOKEN_MARKETS.map((market) => [market.symbol, market.executionFixture])),
    nftPublicActiveProjectCount: 1,
    watchingPublicClassificationViolations,
    nftExecutionControls,
    horizontalOverflowPixels,
    legacyVisualUxGuards: {
      status: controlHeightViolations + heroClippingViolations + communityOverlapViolations + mobileSignalHeightViolations === 0 ? "PASS" : "FAIL",
      controlHeight: { status: controlHeightViolations === 0 ? "PASS" : "FAIL", controlsAudited, violations: controlHeightViolations },
      heroClipping: { status: heroClippingViolations === 0 ? "PASS" : "FAIL", violations: heroClippingViolations },
      communityOverlap: { status: communityOverlapViolations === 0 ? "PASS" : "FAIL", violations: communityOverlapViolations },
      mobileSignalHeight: { status: mobileSignalHeightViolations === 0 ? "PASS" : "FAIL", violations: mobileSignalHeightViolations, maximumCssPixels: 140 },
    },
    registrationCornerRoles: { status: registrationCornerRoleViolations === 0 ? "PASS" : "FAIL", violations: registrationCornerRoleViolations, authorityGreen: "rgb(147, 232, 142)", technicalNeutral: "rgb(82, 96, 88)" },
    productConvergence: {
      status: crossSurfaceNavigationViolations + portfolioReturnPathViolations + valuationTruthViolations === 0 ? "PASS" : "FAIL",
      crossSurfaceNavigation: { status: crossSurfaceNavigationViolations === 0 ? "PASS" : "FAIL", violations: crossSurfaceNavigationViolations },
      portfolioReturnPath: { status: portfolioReturnPathViolations === 0 ? "PASS" : "FAIL", violations: portfolioReturnPathViolations },
      valuationTruth: { status: valuationTruthViolations === 0 ? "PASS" : "FAIL", violations: valuationTruthViolations },
    },
    publicWalletSubmissionEnabled: (process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED ?? "false").toLowerCase() !== "false",
    startup: startupMetrics,
    nftProgressiveRendering: progressiveNftTimings,
  },
  states: stateResults,
  semantic: { status: failures.length === 0 ? "PASS" : "FAIL", failures },
};
await writeFile(path.join(output, "semantic-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
if (failures.length) {
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} else {
  console.info(`LEGACY_VISUAL_UX_GUARDS: ${summary.invariants.legacyVisualUxGuards.status}`);
  console.info(`REGISTRATION_CORNER_ROLE_GUARD: ${summary.invariants.registrationCornerRoles.status}`);
  console.info(`PRODUCT_CONVERGENCE_GUARDS: ${summary.invariants.productConvergence.status}`);
  console.info(`RMT Legion semantic/capture lane: PASS (${stateResults.length} states)`);
}
