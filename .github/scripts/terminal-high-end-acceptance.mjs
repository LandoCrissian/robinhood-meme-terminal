import { chromium, devices } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const base = process.env.RMT_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.RMT_ACCEPTANCE_OUTPUT
  ?? `${process.env.GITHUB_WORKSPACE}/terminal-high-end-evidence`;
const focusDebug = process.env.RMT_ACCEPTANCE_FOCUS_DEBUG === "true";
const now = new Date().toISOString();
const address = (seed) => `0x${seed.toString(16).padStart(40, "0")}`;
const txHash = (seed) => `0x${seed.toString(16).repeat(64).slice(0, 64)}`;
const token = address(0x1001);
const pair = address(0x2001);
const factory = address(0x3001);
const creator = address(0x4001);
const exactIdentityToken = address(0x1ffe);
const stonkBrokerToken = `0x${["e934e36a", "439c9401", "7b64a3fe", "ce66af12", "099abf50"].join("")}`;
const stonkBrokerPoolId = `0x${"ab".repeat(32)}`;
const spcxToken = ["0x4a0e65a3", "eccec6db", "e60ae065", "f2e7bb85", "fae35eea"].join("");
const nvdaToken = ["0xd0601ce1", "57db5bdc", "3162bbac", "2a2c8af5", "320d9eec"].join("");
const universalSearchQueries = new WeakMap();
const chainPulseRequests = new WeakMap();
const telemetryRequests = new WeakMap();

await mkdir(output, { recursive: true });

function market(index) {
  const sourceId = index % 3 === 0 ? "sushi" : index % 3 === 1 ? "lemon" : "pons";
  const sourceName = sourceId === "sushi" ? "Sushi Launch" : sourceId === "lemon" ? "Lemon" : "Pons";
  const marketToken = index === 0 ? token : address(0x1001 + index);
  const marketPair = index === 0 ? pair : address(0x2001 + index);
  const change5m = ((index * 17) % 31) - 12;
  const change1h = ((index * 11) % 43) - 9;
  const liquidity = 58_000 + index * 19_000;
  const recentlyQuiet = index === 51;
  const momentumSignal = index < 2 ? "moving" : index < 4 ? "early" : "active";
  const volume1h = recentlyQuiet ? 0 : index < 4 ? 920_000 - index * 20_000 : 46_000 + index * 7_300;
  const priceUsd = 0.00072 + index * 0.000083;
  const volume24h = 420_000 + index * 97_000;
  const priceChange24h = change1h * 1.9;
  const marketEvidence = {
    chainId: 4_663,
    assetId: `eip155:4663/contract:${marketToken}`,
    token: { address: marketToken, name: `RMT Market ${String(index + 1).padStart(2, "0")}`, symbol: `R${String(index + 1).padStart(2, "0")}` },
    venue: index % 2 === 0 ? "sushiswap" : "uniswap-v3",
    protocolVersion: index % 2 === 0 ? 2 : 3,
    pool: { kind: "evm-address", value: marketPair },
    baseToken: { address: marketToken, name: `RMT Market ${String(index + 1).padStart(2, "0")}`, symbol: `R${String(index + 1).padStart(2, "0")}` },
    quoteToken: { address: address(0x9002), name: "Wrapped Ether", symbol: "WETH" },
    assetSide: "BASE",
    displayEligibility: "eligible",
    chartEligibility: "eligible",
    executionEligibility: "view-only",
    provenance: "dexscreener-token-pairs",
    priceUsd,
    liquidityUsd: liquidity,
    marketCapUsd: 390_000 + index * 235_000,
    fdvUsd: 480_000 + index * 280_000,
    volume24h,
    priceChange24h,
    pairCreatedAt: Date.now() - (index + 1) * 3_600_000
  };
  const stockAssetRelationships = index === 2
    ? [{
        relationship: "canonical-stock-token",
        assetId: "fixture-stock",
        tokenSymbol: `R${String(index + 1).padStart(2, "0")}`,
        tokenName: `RMT Market ${String(index + 1).padStart(2, "0")}`,
        contractAddress: marketToken,
        currentMultiplier: "1",
        status: "active",
        logoUrl: null,
        provenance: "robinhood-live-asset-registry"
      }]
    : index === 1
      ? [{
          relationship: "paired-market-asset",
          assetId: "fixture-stock",
          tokenSymbol: "STOCK",
          tokenName: "Verified Stock Fixture",
          contractAddress: address(0x9001),
          currentMultiplier: "1",
          status: "active",
          logoUrl: null,
          provenance: "robinhood-live-asset-registry"
        }]
      : [];
  return {
    address: marketToken,
    name: `RMT Market ${String(index + 1).padStart(2, "0")}`,
    symbol: `R${String(index + 1).padStart(2, "0")}`,
    pairAddress: marketPair,
    url: `https://robinhoodchain.blockscout.com/address/${marketPair}`,
    dexId: index % 2 === 0 ? "sushiswap" : "uniswap-v3",
    project: {
      sourceId,
      sourceName,
      provenance: sourceId === "sushi"
        ? "public-api-and-dex-pool-cross-checked"
        : "factory-and-token-cross-checked",
      creator,
      launchPool: marketPair,
      name: `RMT Market ${String(index + 1).padStart(2, "0")}`,
      symbol: `R${String(index + 1).padStart(2, "0")}`,
      description: "Deterministic high-end terminal acceptance fixture.",
      imageUri: null,
      socials: {
        x: "https://x.com/RMTLaunch",
        telegram: null,
        discord: null,
        website: "https://www.rmtlaunch.fun",
        farcaster: null
      }
    },
    socials: {
      x: "https://x.com/RMTLaunch",
      telegram: null,
      discord: null,
      website: "https://www.rmtlaunch.fun",
      farcaster: null,
      provenance: "dex-pair-metadata"
    },
    origin: {
      kind: "external",
      state: "attributed",
      sourceId,
      sourceName,
      coverage: "complete",
      claim: {
        claimKind: "token-created",
        sourceId,
        sourceName,
        factory,
        transactionHash: txHash(index + 1),
        blockNumber: String(12_400_000 + index),
        evidenceHash: txHash(index + 101)
      }
    },
    venue: {
      kind: "dex",
      dexId: index % 2 === 0 ? "sushiswap" : "uniswap-v3",
      pairAddress: marketPair,
      url: `https://robinhoodchain.blockscout.com/address/${marketPair}`,
      execution: "read-only"
    },
    priceUsd,
    liquidityUsd: liquidity,
    marketCapUsd: 390_000 + index * 235_000,
    fdvUsd: 480_000 + index * 280_000,
    volume5m: recentlyQuiet ? 0 : Math.max(12_000, volume1h * 0.36),
    volume1h,
    volume24h,
    priceChange5m: change5m,
    priceChange1h: change1h,
    priceChange24h,
    buys5m: recentlyQuiet ? 0 : index < 4 ? 1_300 - index * 40 : 24 + index,
    sells5m: recentlyQuiet ? 0 : index < 4 ? 420 - index * 15 : 8 + index % 5,
    buys1h: recentlyQuiet ? 0 : index < 4 ? 5_000 - index * 100 : 138 + index * 7,
    sells1h: recentlyQuiet ? 0 : index < 4 ? 2_000 - index * 50 : 67 + index * 3,
    buys24h: 1_120 + index * 31,
    sells24h: 610 + index * 19,
    pairCreatedAt: Date.now() - (index + 1) * 3_600_000,
    ageMinutes: 52 + index * 83,
    momentumScore: 58 + (index * 7) % 39,
    buyPressureBps: 6_400 + index * 75,
    signal: momentumSignal,
    riskFlags: index % 7 === 0 ? ["thin-liquidity"] : [],
    primaryMarket: marketEvidence,
    verifiedMarkets: [marketEvidence],
    stockAssetRelationships
  };
}

const markets = Array.from({ length: 52 }, (_, index) => market(index));
const legacyActiveMarkets = markets.filter((item) => item.signal === "active" && item.volume24h > 0);
const correctedActiveMarkets = markets.filter((item) => item.volume1h > 0 || item.buys1h + item.sells1h > 0);
const legacyTrendingMarkets = markets.filter((item) => item.signal === "moving" || item.signal === "early");
const correctedTrendingMarkets = [...legacyTrendingMarkets];
const productAcceptanceEvidence = {
  activeCountBefore: legacyActiveMarkets.length,
  activeCountAfter: correctedActiveMarkets.length,
  trendingCountBefore: legacyTrendingMarkets.length,
  trendingCountAfter: correctedTrendingMarkets.length,
  searchStonkBrokerBefore: "inventory_unavailable",
  searchStonkBrokerAfter: "found",
  movingWithRealActivityVisibleInActiveBefore: legacyActiveMarkets.some((item) => item.signal === "moving"),
  movingWithRealActivityVisibleInActiveAfter: correctedActiveMarkets.some((item) => item.signal === "moving"),
  earlyWithRealActivityVisibleInActiveBefore: legacyActiveMarkets.some((item) => item.signal === "early"),
  earlyWithRealActivityVisibleInActiveAfter: correctedActiveMarkets.some((item) => item.signal === "early"),
  zeroActivityMarketsInActiveBefore: legacyActiveMarkets.filter((item) => item.volume1h === 0 && item.buys1h + item.sells1h === 0).length,
  zeroActivityMarketsInActiveAfter: correctedActiveMarkets.filter((item) => item.volume1h === 0 && item.buys1h + item.sells1h === 0).length
};
const trades = Array.from({ length: 14 }, (_, index) => ({
  id: `fixture-${index}`,
  transactionHash: txHash(index + 300),
  trader: address(0x5000 + index % 7),
  side: index % 4 === 0 ? "sell" : "buy",
  tokenAmount: 130_000 + index * 23_000,
  quoteAmount: 0.08 + index * 0.014,
  priceUsd: 0.00141 + index * 0.000013,
  volumeUsd: 390 + index * 215,
  timestamp: new Date(Date.now() - index * 24_000).toISOString()
}));

function candles(range) {
  const count = range === "7D" ? 84 : range === "24H" ? 72 : 48;
  const step = range === "7D" ? 7_200 : range === "24H" ? 1_200 : 60;
  const start = Math.floor(Date.now() / 1_000) - count * step;
  return Array.from({ length: count }, (_, index) => {
    const close = 0.00122 + index * 0.000009 + Math.sin(index / 3.1) * 0.000047;
    const open = close - Math.cos(index / 2.7) * 0.000019;
    return {
      timestamp: start + index * step,
      open,
      high: Math.max(open, close) + 0.000024,
      low: Math.min(open, close) - 0.000022,
      close,
      volume: 2_700 + Math.abs(Math.sin(index / 2.1)) * 8_800
    };
  });
}

const riskPayload = {
  token,
  pair,
  marketVerified: true,
  coverage: "complete",
  contract: {
    sourcePublished: true,
    isProxy: false,
    bytecodeChanged: false,
    controls: {
      assessment: "no-common-controls-found",
      detected: [],
      customWriteFunctions: [],
      administrator: null,
      activeLaunchRestrictions: false,
      restrictionEndBlock: null,
      maxTransactionBps: null,
      maxWalletBps: null
    }
  },
  liquidity: {
    controlStatus: "contract-held",
    evidenceSource: "launchpad-registry",
    positionManager: factory,
    positionId: "1842",
    owner: factory,
    approvedOperator: null,
    creatorCanTransfer: false,
    positionLiquidity: "842000000000000000000"
  },
  holders: {
    count: 1_842,
    poolShareBps: 4_200,
    topNonPoolShareBps: 740,
    topNonPoolHolders: [],
    largestNonPoolHolder: { address: address(0x7001), shareBps: 210 },
    creator,
    creatorShareBps: 95
  },
  sellSimulation: {
    status: "passed",
    method: "holder-to-pool-transfer",
    holder: address(0x7001),
    amount: "1000000000000000000",
    returnStyle: "boolean-true"
  },
  warnings: [],
  checkedAt: now
};

function canonicalDirectoryMarket(market) {
  const version = market.primaryMarket.protocolVersion;
  const poolKey = market.primaryMarket.pool.value.toLowerCase();
  return {
    address: market.address,
    assetId: market.assetId,
    name: market.name,
    symbol: market.symbol,
    priceUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    volume5m: null,
    volume1h: null,
    volume24h: null,
    priceChange5m: null,
    priceChange1h: null,
    priceChange24h: null,
    buys5m: null,
    sells5m: null,
    buys1h: null,
    sells1h: null,
    buys24h: null,
    sells24h: null,
    pairCreatedAt: null,
    ageMinutes: null,
    momentumScore: null,
    buyPressureBps: null,
    riskFlags: null,
    signal: null,
    stockAssetRelationships: market.stockAssetRelationships,
    canonicalMarkets: [{
      sourceId: version === 2 ? "sushiswap-v2" : "uniswap-v3",
      protocol: version === 2 ? "sushiswap" : "uniswap",
      version,
      poolKey,
      poolAddress: poolKey,
      token0: market.address.toLowerCase(),
      token1: market.primaryMarket.quoteToken.address.toLowerCase(),
      stable: null,
      fee: version === 2 ? null : 3_000,
      tickSpacing: version === 2 ? null : 60,
      hooks: null,
      transactionHash: market.origin.claim.transactionHash,
      blockNumber: "100",
      blockHash: market.origin.claim.evidenceHash,
      stateStatus: null,
      liveFee: null,
      feeDenominator: null,
      gaugeAddress: null,
      gaugeAlive: null,
      gaugeWeight: null,
      gaugeClaimable: null,
      feesAddress: null,
      bribeAddress: null,
      stateObservedBlock: null,
      stateObservedBlockHash: null
    }]
  };
}

function stonkBrokerSearchResponse(query) {
  const normalized = query.trim().replace(/^\$/, "").toLowerCase().replace(/[\s_-]+/g, "");
  const isAddress = query.trim().toLowerCase() === stonkBrokerToken;
  const isPoolId = query.trim().toLowerCase() === stonkBrokerPoolId;
  const isText = normalized === "stonkbroker" || normalized === "stonkbrokers";
  if (!isAddress && !isPoolId && !isText) return null;
  return {
    query,
    queryKind: isPoolId ? "v4-pool-id" : isAddress ? "token-or-pool-address" : "text",
    status: "found",
    results: [{
      address: stonkBrokerToken,
      name: "StonkBroker",
      symbol: "STONKBROKER",
      decimals: 18,
      matchedBy: isPoolId ? "pool-id" : isAddress ? "token" : "symbol",
      markets: [{
        sourceId: "uniswap-v4",
        protocol: "uniswap",
        version: 4,
        poolKey: stonkBrokerPoolId,
        poolAddress: null,
        token0: stonkBrokerToken,
        token1: address(0x9002),
        stable: null,
        fee: 3_000,
        tickSpacing: 60,
        hooks: address(0x9003),
        transactionHash: txHash(0x5151),
        blockNumber: "12451515",
        blockHash: txHash(0x6161),
        stateStatus: null,
        liveFee: null,
        feeDenominator: null,
        gaugeAddress: null,
        gaugeAlive: null,
        gaugeWeight: null,
        gaugeClaimable: null,
        feesAddress: null,
        bribeAddress: null,
        stateObservedBlock: null,
        stateObservedBlockHash: null
      }]
    }]
  };
}

async function installRoutes(page) {
  chainPulseRequests.set(page, 0);
  telemetryRequests.set(page, 0);
  await page.route(/\/api\/vnext\/chain-pulse(?:\?.*)?$/, async (route) => {
    chainPulseRequests.set(page, (chainPulseRequests.get(page) ?? 0) + 1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chainId: 4_663,
        chain: "Robinhood Chain",
        source: "DEFILLAMA",
        authoritative: false,
        status: "ready",
        tvlUsd: 583_000_000,
        dexVolume24hUsd: 644_000_000,
        dexVolume7dUsd: 3_460_000_000,
        dexChange1dPct: 33.4,
        dexChange7dPct: 18.2,
        fees24hUsd: 1_920_000,
        fees7dUsd: 9_840_000,
        revenue24hUsd: 642_000,
        revenue7dUsd: 3_120_000,
        protocolRevenue24hUsd: 214_000,
        protocolRevenue7dUsd: 1_080_000
      })
    });
  });
  await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        canonical: true,
        coverage: "complete",
        nextCursor: null,
        markets: markets.map(canonicalDirectoryMarket),
        updatedAt: now
      })
    });
  });
  await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/, async (route) => {
    const requestedAddress = new URL(route.request().url()).searchParams.get("address")?.toLowerCase();
    const selected = requestedAddress === exactIdentityToken.toLowerCase()
      ? { address: exactIdentityToken, name: "Exact Identity Token", symbol: "EXACT" }
      : markets.find((item) => item.address.toLowerCase() === requestedAddress);
    if (!selected) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Token identity could not be verified on Robinhood Chain." })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        resolution: {
          chainId: 4_663,
          requestedAddress: selected.address,
          requestedKind: "token",
          status: "token-only",
          token: {
            address: selected.address,
            name: selected.name,
            symbol: selected.symbol,
            decimals: 18,
            totalSupply: "1000000000000000000000000"
          },
          pools: [],
          marketData: "identity-only",
          execution: "view-only",
          provenance: "robinhood-chain-contract-reads",
          resolvedAt: now
        }
      })
    });
  });
  await page.route(/\/api\/vnext\/market-search(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const exactIdentityUnavailable = query.toLowerCase() === exactIdentityToken.toLowerCase();
    const stonkBrokerResult = stonkBrokerSearchResponse(query);
    universalSearchQueries.set(page, [...(universalSearchQueries.get(page) ?? []), query]);
    await route.fulfill({
      status: exactIdentityUnavailable ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(stonkBrokerResult ?? {
        query,
        queryKind: "token-or-pool-address",
        status: exactIdentityUnavailable ? "inventory_unavailable" : "not_found",
        results: []
      })
    });
  });
  await page.route(/\/api\/markets\/external(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const contract = url.searchParams.get("contract")?.toLowerCase();
    const selected = contract
      ? markets.filter((item) => (
          item.address.toLowerCase() === contract
          || item.pairAddress.toLowerCase() === contract
        ))
      : markets;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        markets: selected,
        source: "high-end-acceptance",
        rankingVersion: "terminal-v10",
        thresholds: {},
        originCoverage: "complete",
        rmtOriginCoverage: "complete",
        stockAssetCoverage: "complete",
        delayedSources: [],
        updatedAt: now,
        stale: false
      })
    });
  });
  await page.route(/\/api\/trade\/external-availability(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const tokens = (url.searchParams.get("tokens") ?? "").split(",").filter(Boolean);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: tokens.map((item) => ({ token: item, status: "ready", venues: ["sushi"] }))
      })
    });
  });
  await page.route(/\/api\/trade\/external-venues(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      token,
      venues: [{
        venue: "sushi",
        pair,
        dexId: "sushiswap",
        liquidityUsd: markets[0].liquidityUsd,
        verification: "dex-and-route"
      }]
    })
  }));
  await page.route(/\/api\/markets\/ohlcv(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const range = query.get("range") ?? "LIVE";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: query.get("token") ?? token,
        pair: query.get("pair") ?? pair,
        range,
        candles: candles(range),
        source: "GeckoTerminal",
        updatedAt: now,
        lastTradeAt: trades[0].timestamp,
        refreshMs: 60_000
      })
    });
  });
  await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/, (route) => {
    telemetryRequests.set(page, (telemetryRequests.get(page) ?? 0) + 1);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token, pair, source: "GeckoTerminal", updatedAt: now, trades })
    });
  });
  await page.route(/\/api\/markets\/external-stream(?:\?.*)?$/, (route) => {
    telemetryRequests.set(page, (telemetryRequests.get(page) ?? 0) + 1);
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(/\/api\/markets\/token-risk(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(riskPayload)
  }));
}

async function createContext(browser, options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    localStorage.setItem(
      "rmt:trading-terms",
      JSON.stringify({ version: "2026-07-28", acceptedAt: new Date().toISOString() })
    );
    localStorage.setItem(
      "rmt:experience-preferences",
      JSON.stringify({
        schemaVersion: 1,
        onboardingVersion: 1,
        diagnosticsEnabled: false,
        updatedAt: Date.now()
      })
    );
  });
  return context;
}

async function gotoReady(page, url, selector) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      body: document.body.innerText.slice(0, 1_500),
      desktop: Boolean(document.querySelector(".rmtDesktopTerminal")),
      mobile: Boolean(document.querySelector(".rmtMobileTerminal")),
      context: document.querySelector(".rmtTerminal")?.getAttribute("data-terminal-context") ?? null,
      rows: document.querySelectorAll(".rmtMarketTableRow, .rmtMobileMarketRow").length
    }));
    throw new Error(`Terminal did not reach ${selector}: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  await page.waitForTimeout(900);
}

function visibleAudit() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity) > 0
      && rect.width > 0
      && rect.height > 0;
  };
  const controlsUnder32 = [...document.querySelectorAll("button,a,input,summary")]
    .filter(visible)
    .map((element) => ({
      text: (element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 70),
      height: Math.round(element.getBoundingClientRect().height),
      exempt: Boolean(element.closest(".siteFooter"))
    }))
    .filter((item) => !item.exempt && item.height < 32)
    .slice(0, 30);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    marketRowsAboveFold: [...document.querySelectorAll(".rmtMarketTableRow, .rmtMobileMarketRow")]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      }).length,
    controlsUnder32
  };
}

async function inspectAssetQuickLinks(page, label) {
  const links = page.locator(".vnAssetQuickLinks");
  await links.waitFor({ state: "visible" });
  await links.locator(".vnProjectLinkGroup").first().waitFor({ state: "visible", timeout: 5_000 });
  const audit = await links.evaluate((root) => {
    const market = new URLSearchParams(window.location.search).get("market")?.toLowerCase() ?? null;
    const anchors = [...root.querySelectorAll("a[href]")];
    return {
      market,
      fullContractVisible: Boolean(market && root.textContent?.toLowerCase().includes(market)),
      copyAvailable: Boolean(root.querySelector('button[aria-label^="Copy full token contract"]')),
      provenance: [...root.querySelectorAll("small")].map((entry) => entry.textContent?.trim()).filter(Boolean),
      anchors: anchors.map((anchor) => ({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        rel: anchor.getAttribute("rel"),
        name: anchor.getAttribute("aria-label") ?? anchor.textContent?.trim()
      }))
    };
  });
  if (!audit.fullContractVisible || !audit.copyAvailable) throw new Error(`${label}: selected asset contract is not fully accessible/copyable ${JSON.stringify(audit)}`);
  if (!audit.provenance.some((entry) => entry?.startsWith("Project links ·"))) throw new Error(`${label}: project-link provenance is missing ${JSON.stringify(audit)}`);
  if (audit.anchors.length < 3) throw new Error(`${label}: selected asset quick links are unexpectedly sparse ${JSON.stringify(audit)}`);
  for (const anchor of audit.anchors) {
    if (!anchor.href?.startsWith("https://") || anchor.target !== "_blank" || !anchor.rel?.includes("noopener") || !anchor.rel?.includes("noreferrer") || !anchor.name) {
      throw new Error(`${label}: unsafe or inaccessible external quick link ${JSON.stringify(anchor)}`);
    }
  }
  return audit;
}

async function inspectMarketsHierarchy(browser, phase) {
  const mobileContext = await createContext(browser, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(mobilePage);
  await gotoReady(mobilePage, base, ".rmtMobileTerminal .rmtMobileMarketRow");
  const measure = () => {
    const content = document.querySelector(".rmtMobileMarketsView");
    const tabs = document.querySelector(".rmtMobileMarketsView .rmtMarketViews");
    const search = document.querySelector(".rmtMobileMarketsView .rmtMarketSearch");
    const firstRow = document.querySelector(".rmtMobileMarketRow");
    const pulse = document.querySelector('[aria-label="Robinhood chain pulse"]');
    const pulseControl = pulse?.querySelector('button[aria-expanded]');
    if (!content || !tabs || !search || !firstRow || !pulse) return null;
    const contentTop = content.getBoundingClientRect().top;
    const relativeTop = (element) => Math.round(element.getBoundingClientRect().top - contentTop);
    const rowRect = firstRow.getBoundingClientRect();
    return {
      viewportHeight: innerHeight,
      tabY: relativeTop(tabs),
      searchY: relativeTop(search),
      firstRowY: relativeTop(firstRow),
      pulseY: relativeTop(pulse),
      pulseHeight: Math.round(pulse.getBoundingClientRect().height),
      firstMarketRowVisibleWithoutScroll: rowRect.top < innerHeight && rowRect.bottom > 0,
      pulseExpanded: pulseControl?.getAttribute("aria-expanded") ?? null,
      pulseControlLabel: pulseControl?.getAttribute("aria-label") ?? null,
      pulseText: pulse.textContent?.replace(/\s+/g, " ").trim() ?? ""
    };
  };
  const collapsed = await mobilePage.evaluate(measure);
  if (!collapsed) throw new Error(`${phase}: mobile Markets hierarchy could not be measured`);
  await mobilePage.screenshot({
    path: `${output}/markets-hierarchy-${phase}-mobile-390x844.png`,
    fullPage: false,
    animations: "disabled"
  });

  let expanded = null;
  let statePreserved = null;
  if (phase === "after") {
    if (collapsed.pulseExpanded !== "false") throw new Error(`mobile Chain Pulse is not collapsed by default ${JSON.stringify(collapsed)}`);
    if (!(collapsed.tabY < collapsed.searchY && collapsed.searchY < collapsed.firstRowY && collapsed.firstRowY < collapsed.pulseY)) {
      throw new Error(`mobile Markets hierarchy is not categories -> search -> rows -> Pulse ${JSON.stringify(collapsed)}`);
    }
    if (!collapsed.firstMarketRowVisibleWithoutScroll) throw new Error(`mobile first market row is below the first viewport ${JSON.stringify(collapsed)}`);
    if (collapsed.pulseHeight < 48 || collapsed.pulseHeight > 72) throw new Error(`mobile collapsed Chain Pulse footprint is outside 48-72px ${JSON.stringify(collapsed)}`);

    const search = mobilePage.getByRole("textbox", { name: "Search Robinhood Chain markets" });
    await mobilePage.getByRole("button", { name: /^Trending\s+/ }).click();
    await search.fill("RMT");
    const rowCountBefore = await mobilePage.locator(".rmtMobileMarketRow").count();
    const requestsBefore = chainPulseRequests.get(mobilePage) ?? 0;
    const disclosure = mobilePage.getByRole("button", { name: "Expand Robinhood Chain Pulse details" });
    await disclosure.scrollIntoViewIfNeeded();
    await mobilePage.screenshot({
      path: `${output}/markets-hierarchy-after-mobile-collapsed-pulse-390x844.png`,
      fullPage: false,
      animations: "disabled"
    });
    await disclosure.click();
    await mobilePage.getByRole("button", { name: "Collapse Robinhood Chain Pulse details" }).waitFor({ state: "visible" });
    expanded = await mobilePage.evaluate(measure);
    const metricLabels = await mobilePage.locator('[aria-label="Robinhood chain pulse"] dt').allTextContents();
    const provenance = await mobilePage.locator('[aria-label="Robinhood chain pulse"] footer').textContent();
    const rowCountAfter = await mobilePage.locator(".rmtMobileMarketRow").count();
    const searchValueAfterExpansion = await search.inputValue();
    await search.fill("");
    const trendingRestoredAfterClearingSearch = await mobilePage.getByRole("button", { name: /^Trending\s+/ }).getAttribute("aria-pressed");
    statePreserved = {
      trendingRestoredAfterClearingSearch,
      searchValueAfterExpansion,
      rowCountBefore,
      rowCountAfter,
      chainPulseRequestsBefore: requestsBefore,
      chainPulseRequestsAfter: chainPulseRequests.get(mobilePage) ?? 0
    };
    const requiredMetrics = [
      "TVL",
      "DEX volume 24h",
      "DEX volume 7d",
      "DEX change 24h",
      "DEX change 7d",
      "Fees 24h",
      "Revenue 24h",
      "Protocol revenue 24h"
    ];
    if (JSON.stringify(metricLabels) !== JSON.stringify(requiredMetrics)) throw new Error(`expanded Chain Pulse lost metrics ${JSON.stringify(metricLabels)}`);
    if (!provenance?.includes("Third-party market context") || !provenance.includes("Non-authoritative")) throw new Error(`expanded Chain Pulse lost provenance ${provenance}`);
    if (statePreserved.trendingRestoredAfterClearingSearch !== "true" || statePreserved.searchValueAfterExpansion !== "RMT" || rowCountBefore !== rowCountAfter || statePreserved.chainPulseRequestsAfter !== requestsBefore) {
      throw new Error(`Chain Pulse expansion reset/refetched market state ${JSON.stringify(statePreserved)}`);
    }
    await mobilePage.screenshot({
      path: `${output}/markets-hierarchy-after-mobile-expanded-390x844.png`,
      fullPage: false,
      animations: "disabled"
    });
  }
  await mobileContext.close();

  const desktopContext = await createContext(browser, { viewport: { width: 1_440, height: 900 }, deviceScaleFactor: 1 });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(desktopPage);
  await gotoReady(desktopPage, base, ".rmtDesktopTerminal .rmtMarketTableRow");
  const desktop = await desktopPage.evaluate(() => {
    const content = document.querySelector(".rmtDesktopMarketsView");
    const tabs = document.querySelector(".rmtDesktopMarketsView .rmtMarketViews");
    const firstRow = document.querySelector(".rmtMarketTableRow");
    const pulse = document.querySelector('[aria-label="Robinhood chain pulse"]');
    if (!content || !tabs || !firstRow || !pulse) return null;
    const contentTop = content.getBoundingClientRect().top;
    return {
      tabY: Math.round(tabs.getBoundingClientRect().top - contentTop),
      firstRowY: Math.round(firstRow.getBoundingClientRect().top - contentTop),
      pulseY: Math.round(pulse.getBoundingClientRect().top - contentTop),
      pulseHeight: Math.round(pulse.getBoundingClientRect().height),
      firstRowVisible: firstRow.getBoundingClientRect().top < innerHeight
    };
  });
  if (!desktop) throw new Error(`${phase}: desktop Markets hierarchy could not be measured`);
  if (phase === "after" && !(desktop.tabY < desktop.firstRowY && desktop.firstRowY < desktop.pulseY && desktop.firstRowVisible)) {
    throw new Error(`desktop Markets do not precede Chain Pulse context ${JSON.stringify(desktop)}`);
  }
  await desktopPage.screenshot({
    path: `${output}/markets-hierarchy-${phase}-desktop-1440x900.png`,
    fullPage: false,
    animations: "disabled"
  });
  await desktopContext.close();
  return { phase, mobile: { collapsed, expanded, statePreserved }, desktop };
}

async function inspectDesktop(browser, viewport, label) {
  const context = await createContext(browser, { viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, base, ".rmtDesktopTerminal .rmtMarketTableRow");

  const audit = await page.evaluate(visibleAudit);
  if (audit.horizontalOverflow > 2) throw new Error(`${label}: page horizontal overflow ${audit.horizontalOverflow}px`);
  if (audit.marketRowsAboveFold < 2) {
    throw new Error(`${label}: only ${audit.marketRowsAboveFold} market rows are above the fold`);
  }
  if (audit.controlsUnder32.length) {
    throw new Error(`${label}: undersized controls ${JSON.stringify(audit.controlsUnder32)}`);
  }

  const marketsComposition = await page.evaluate(() => ({
    desktop: Boolean(document.querySelector(".rmtDesktopTerminal")),
    mobile: Boolean(document.querySelector(".rmtMobileTerminal")),
    context: document.querySelector(".rmtDesktopTerminal")?.getAttribute("data-terminal-context"),
    scanner: Boolean(document.querySelector(".rmtMarketTable")),
    workstation: Boolean(document.querySelector(".rmtDesktopWorkstation")),
    portfolio: Boolean(document.querySelector(".rmtPortfolioSurface"))
  }));
  if (!marketsComposition.desktop || marketsComposition.mobile || marketsComposition.context !== "markets" || !marketsComposition.scanner || marketsComposition.workstation || marketsComposition.portfolio) {
    throw new Error(`${label}: default desktop context is not the dedicated Markets scanner ${JSON.stringify(marketsComposition)}`);
  }

  const initialRows = page.locator(".rmtDesktopTerminal .rmtMarketTableRow");
  if (await initialRows.count() !== 24) throw new Error(`${label}: directory did not start with a bounded 24-market page`);
  await page.screenshot({ path: `${output}/markets-${label}.png`, fullPage: false, animations: "disabled" });
  const loadMore = page.getByRole("button", { name: /^Load 24 more/ });
  await loadMore.click();
  if (await initialRows.count() !== 48) throw new Error(`${label}: local market pagination did not reveal the next 24 markets`);

  const headerNavigation = page.locator(".rmtDesktopHeader nav");
  const headerMarkets = headerNavigation.locator('[data-terminal-nav="markets"]');
  const headerPortfolio = headerNavigation.locator('[data-terminal-nav="portfolio"]');
  const headerRwa = headerNavigation.locator('[data-terminal-nav="rwa"]');
  const search = page.getByRole("textbox", { name: "Search Robinhood Chain markets" });
  if (!(await headerNavigation.isVisible())) throw new Error(`${label}: desktop header navigation is unexpectedly hidden`);
  await headerMarkets.click();
  if (new URL(page.url()).pathname !== "/" || await page.locator('.rmtDesktopTerminal[data-terminal-context="markets"]').count() !== 1) throw new Error(`${label}: Markets header control left the canonical terminal`);
  await headerPortfolio.click();
  if (new URL(page.url()).pathname !== "/" || new URL(page.url()).searchParams.get("panel") !== "portfolio" || await page.locator('.rmtDesktopTerminal[data-terminal-context="portfolio"] #vnext-portfolio').count() !== 1) throw new Error(`${label}: Portfolio header control did not enter the dedicated terminal context`);
  await page.screenshot({ path: `${output}/portfolio-${label}.png`, fullPage: false, animations: "disabled" });
  await headerMarkets.click();
  await search.fill("R02");
  await headerRwa.click();
  await page.waitForTimeout(100);
  const rwaNavigation = await page.evaluate(() => ({
    pathname: window.location.pathname,
    terminalActive: Boolean(document.querySelector('.rmtDesktopTerminal[data-terminal-context="markets"]')),
    publicChromePresent: Boolean(document.querySelector(".publicHeader, .mobileDock")),
    notFound: Boolean(document.querySelector(".next-error-h1")) || document.body.innerText.includes("This page could not be found"),
    activeCategory: document.querySelector('.rmtMarketViews button[aria-pressed="true"] span')?.textContent ?? "",
    searchValue: document.querySelector("#rmt-desktop-market-search")?.value ?? null
  }));
  if (rwaNavigation.pathname !== "/") throw new Error(`${label}: RWA header control navigated away from /`);
  if (!rwaNavigation.terminalActive || rwaNavigation.publicChromePresent || rwaNavigation.notFound) throw new Error(`${label}: RWA header control escaped the canonical terminal ${JSON.stringify(rwaNavigation)}`);
  if (rwaNavigation.activeCategory !== "RWA" || rwaNavigation.searchValue !== "") throw new Error(`${label}: RWA header control did not activate the RWA view and clear stale search ${JSON.stringify(rwaNavigation)}`);
  const rwaRows = page.locator(".rmtMarketTableRow");
  if (await rwaRows.count() !== 2) throw new Error(`${label}: RWA directory did not preserve both verified classifications`);
  if (!(await rwaRows.nth(0).textContent())?.includes("Stock Token")) throw new Error(`${label}: canonical Stock Token was not first or clearly labeled`);
  if (!(await rwaRows.nth(1).textContent())?.includes("RWA Pair")) throw new Error(`${label}: paired market asset was not clearly labeled`);
  await page.screenshot({ path: `${output}/rwa-${label}.png`, fullPage: false, animations: "disabled" });
  await headerMarkets.click();
  await page.getByRole("button", { name: /^Active\s+/ }).click();
  if (await page.getByRole("button", { name: /^Active\s+/ }).getAttribute("aria-pressed") !== "true") throw new Error(`${label}: Markets navigation did not restore the default market view`);
  if (await page.locator(".rmtDesktopTerminal .rmtMarketTableRow").count() !== 24) throw new Error(`${label}: changing category did not reset the bounded market page`);

  await search.fill("R02");
  await page.waitForTimeout(100);
  if (await page.locator(".rmtMarketTableRow").count() !== 1) throw new Error(`${label}: market search did not narrow the directory`);
  if (!(await page.locator(".rmtMarketTableRow").first().textContent())?.includes("R02")) throw new Error(`${label}: market search returned the wrong asset`);
  await page.locator(".rmtMarketTableRow").first().click();
  await page.locator('.rmtDesktopTerminal[data-terminal-context="asset"]').waitFor({ state: "visible" });
  if (!(await page.locator("#vn-asset-heading").textContent())?.includes("R02")) throw new Error(`${label}: selected asset did not update the VNext workspace`);
  const assetQuickLinks = await inspectAssetQuickLinks(page, label);
  const assetComposition = await page.evaluate(() => ({
    chart: document.querySelector(".vnChart")?.getBoundingClientRect().height ?? 0,
    rail: document.querySelector(".rmtDesktopExecution")?.getBoundingClientRect().toJSON(),
    workspace: document.querySelector(".rmtDesktopAsset")?.getBoundingClientRect().toJSON(),
    navigator: document.querySelector(".rmtAssetNavigator")?.getBoundingClientRect().toJSON(),
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
  }));
  if (assetComposition.chart < 280) throw new Error(`${label}: chart lacks workstation authority (${assetComposition.chart}px)`);
  if (!assetComposition.rail || !assetComposition.workspace || !assetComposition.navigator || assetComposition.overflow > 2) throw new Error(`${label}: Asset workstation is incomplete ${JSON.stringify(assetComposition)}`);
  if (assetComposition.rail.x < assetComposition.workspace.x + assetComposition.workspace.width - 2) throw new Error(`${label}: execution rail overlaps the asset workspace`);
  await page.screenshot({ path: `${output}/asset-${label}.png`, fullPage: false, animations: "disabled" });

  await page.evaluate(() => window.history.back());
  await page.locator('.rmtDesktopTerminal[data-terminal-context="markets"] .rmtMarketTable').waitFor({ state: "visible" });
  if (await search.inputValue() !== "R02") throw new Error(`${label}: browser Back did not preserve the market search`);
  await search.fill(markets[0].address);
  await search.press("Enter");
  await page.locator('.rmtDesktopTerminal[data-terminal-context="asset"] #vn-asset-heading').waitFor({ state: "visible" });
  if (!(await page.locator("#vn-asset-heading").textContent())?.includes(markets[0].symbol)) throw new Error(`${label}: exact-contract search did not enter the matching Asset context`);
  if ((universalSearchQueries.get(page) ?? []).length !== 0) throw new Error(`${label}: loaded exact contract unexpectedly used universal search`);
  await page.evaluate(() => window.history.back());
  await page.locator('.rmtDesktopTerminal[data-terminal-context="markets"] .rmtMarketTable').waitFor({ state: "visible" });
  await search.fill(exactIdentityToken);
  await search.press("Enter");
  await page.locator('.rmtDesktopTerminal[data-terminal-context="asset"] #vn-asset-heading').waitFor({ state: "visible" });
  if (!(await page.locator("#vn-asset-heading").textContent())?.includes("EXACT")) throw new Error(`${label}: verified identity-only contract did not enter Asset context`);
  if (new URL(page.url()).searchParams.get("market")?.toLowerCase() !== exactIdentityToken.toLowerCase()) throw new Error(`${label}: verified identity-only contract was not preserved in terminal history`);
  const exactIdentityQueries = universalSearchQueries.get(page) ?? [];
  if (exactIdentityQueries.length !== 1 || exactIdentityQueries[0]?.toLowerCase() !== exactIdentityToken.toLowerCase()) throw new Error(`${label}: identity-only fallback did not follow exactly one universal inventory attempt ${JSON.stringify(exactIdentityQueries)}`);
  await context.close();
  return { ...audit, marketsComposition, assetComposition, assetQuickLinks };
}

async function inspectDiscoveryAcceptance(browser, options, label, mobile) {
  const context = await createContext(browser, options);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  const terminalSelector = mobile ? ".rmtMobileTerminal" : ".rmtDesktopTerminal";
  const rowSelector = mobile ? ".rmtMobileMarketRow" : ".rmtMarketTableRow";
  await gotoReady(page, base, `${terminalSelector} ${rowSelector}`);

  await page.waitForFunction(({ terminalSelector, activeCount, trendingCount }) => {
    const counts = Object.fromEntries([...document.querySelectorAll(`${terminalSelector} .rmtMarketViews button`)].map((button) => [
      button.querySelector("span")?.textContent?.trim(),
      Number(button.querySelector("small")?.textContent)
    ]));
    return counts.Active === activeCount && counts.Trending === trendingCount;
  }, {
    terminalSelector,
    activeCount: productAcceptanceEvidence.activeCountAfter,
    trendingCount: productAcceptanceEvidence.trendingCountAfter
  });

  const navigation = page.locator(`${terminalSelector} .rmtMarketViews button`);
  const labels = await navigation.locator("span").allTextContents();
  if (labels[0] !== "Active" || labels[1] !== "Trending") {
    throw new Error(`${label}: Active is not before Trending ${JSON.stringify(labels)}`);
  }
  const activeButton = page.locator(terminalSelector).getByRole("button", { name: new RegExp(`^Active\\s+${productAcceptanceEvidence.activeCountAfter}$`) });
  const trendingButton = page.locator(terminalSelector).getByRole("button", { name: new RegExp(`^Trending\\s+${productAcceptanceEvidence.trendingCountAfter}$`) });
  if (await activeButton.getAttribute("aria-pressed") !== "true") throw new Error(`${label}: Active is not the default browse view`);

  const activeRows = page.locator(`${terminalSelector} ${rowSelector}`);
  const activeSymbols = (await activeRows.allTextContents()).map((value) => value.match(/R\d{2}/)?.[0]).filter(Boolean);
  const expectedActiveLeaders = ["R01", "R02", "R03", "R04"];
  if (JSON.stringify(activeSymbols.slice(0, 4)) !== JSON.stringify(expectedActiveLeaders)) {
    throw new Error(`${label}: Active ordering did not preserve hottest moving/early markets ${JSON.stringify(activeSymbols.slice(0, 6))}`);
  }
  await page.screenshot({ path: `${output}/discovery-active-${label}.png`, fullPage: false, animations: "disabled" });

  await trendingButton.click();
  await page.waitForFunction(({ terminalSelector, rowSelector, count }) => (
    document.querySelectorAll(`${terminalSelector} ${rowSelector}`).length === count
  ), { terminalSelector, rowSelector, count: productAcceptanceEvidence.trendingCountAfter });
  if (await trendingButton.getAttribute("aria-pressed") !== "true") throw new Error(`${label}: Trending did not become active`);
  const trendingSymbols = (await page.locator(`${terminalSelector} ${rowSelector}`).allTextContents())
    .map((value) => value.match(/R\d{2}/)?.[0]).filter(Boolean);
  const expectedTrending = ["R04", "R03", "R02", "R01"];
  if (JSON.stringify(trendingSymbols) !== JSON.stringify(expectedTrending)) {
    throw new Error(`${label}: Trending momentum order regressed ${JSON.stringify(trendingSymbols)}`);
  }
  await page.screenshot({ path: `${output}/discovery-trending-${label}.png`, fullPage: false, animations: "disabled" });

  await activeButton.click();
  await page.waitForFunction(({ terminalSelector, rowSelector }) => (
    document.querySelectorAll(`${terminalSelector} ${rowSelector}`).length === 24
  ), { terminalSelector, rowSelector });
  if (await activeButton.getAttribute("aria-pressed") !== "true") throw new Error(`${label}: Active did not restore after Trending`);

  const search = page.getByRole("textbox", { name: "Search Robinhood Chain markets" });
  await search.fill("STONKBROKER");
  await search.press("Enter");
  await page.locator(`${terminalSelector}[data-terminal-context="asset"] #vn-asset-heading`).waitFor({ state: "visible" });
  if (!(await page.locator("#vn-asset-heading").textContent())?.includes("STONKBROKER")) throw new Error(`${label}: STONKBROKER search did not open Asset context`);
  if (new URL(page.url()).searchParams.get("market")?.toLowerCase() !== stonkBrokerToken) throw new Error(`${label}: STONKBROKER selection did not preserve its exact contract`);
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  await page.locator(".vnMarketsCard").waitFor({ state: "visible" });
  const poolEvidence = await page.evaluate(({ poolId, transactionHash }) => {
    const shortPoolId = `${poolId.slice(0, 6)}…${poolId.slice(-4)}`;
    const canonicalLink = [...document.querySelectorAll("a")].find((link) => link.textContent?.includes(`PoolId ${shortPoolId}`));
    return {
      poolVisible: Boolean(canonicalLink),
      transactionEvidenceLink: canonicalLink?.getAttribute("href")?.toLowerCase().endsWith(`/tx/${transactionHash}`) ?? false,
      fakeAddressLink: [...document.querySelectorAll("a")].some((link) => link.getAttribute("href")?.toLowerCase().includes(`/address/${poolId}`)),
      marketsText: document.querySelector(".vnMarketsCard")?.textContent?.trim().slice(0, 500) ?? null
    };
  }, { poolId: stonkBrokerPoolId, transactionHash: txHash(0x5151) });
  await page.screenshot({ path: `${output}/discovery-stonkbroker-${label}.png`, fullPage: false, animations: "disabled" });
  if (!poolEvidence.poolVisible || !poolEvidence.transactionEvidenceLink || poolEvidence.fakeAddressLink) throw new Error(`${label}: STONKBROKER V4 evidence was not preserved ${JSON.stringify(poolEvidence)}`);
  await page.locator(".vnMarketsCard").screenshot({ path: `${output}/discovery-stonkbroker-evidence-${label}.png`, animations: "disabled" });

  await page.evaluate(() => window.history.back());
  await page.locator(`${terminalSelector}[data-terminal-context="markets"] ${rowSelector}`).first().waitFor({ state: "visible" });
  await search.fill("");
  await page.waitForTimeout(50);
  await search.fill(stonkBrokerPoolId);
  await search.press("Enter");
  await page.locator(`${terminalSelector}[data-terminal-context="asset"] #vn-asset-heading`).waitFor({ state: "visible" });
  if (new URL(page.url()).searchParams.get("market")?.toLowerCase() !== stonkBrokerToken) throw new Error(`${label}: V4 PoolId search did not select STONKBROKER`);
  const submittedQueries = universalSearchQueries.get(page) ?? [];
  if (!submittedQueries.includes("STONKBROKER") || !submittedQueries.includes(stonkBrokerPoolId)) {
    throw new Error(`${label}: explicit text and V4 PoolId searches did not use the same-origin universal route ${JSON.stringify(submittedQueries)}`);
  }
  await page.screenshot({ path: `${output}/discovery-poolid-${label}.png`, fullPage: false, animations: "disabled" });

  const result = {
    activeDefault: true,
    activeBeforeTrending: true,
    activeSymbols: activeSymbols.slice(0, 4),
    trendingSymbols,
    stonkBrokerTextResult: "found",
    stonkBrokerSelectedAddress: stonkBrokerToken,
    v4PoolId: stonkBrokerPoolId,
    v4PoolAddress: null
  };
  await context.close();
  return result;
}

async function inspectMarket(browser) {
  const context = await createContext(browser, {
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, `${base}/?market=${token}`, ".vnChartFrame svg");

  const candlesButton = page.getByRole("button", { name: "Candles" });
  const lineButton = page.getByRole("button", { name: "Line" });
  if (await candlesButton.getAttribute("aria-pressed") !== "true") {
    throw new Error("Candlestick chart is not the default desktop mode");
  }
  if (await page.locator(".vnChartCandle").count() < 10) {
    throw new Error("Candlestick chart did not render enough OHLC candles");
  }
  await lineButton.click();
  if (await lineButton.getAttribute("aria-pressed") !== "true") {
    throw new Error("Line chart mode did not activate");
  }
  await candlesButton.click();
  const chart = page.locator(".vnChartFrame svg");
  await chart.scrollIntoViewIfNeeded();
  const chartBox = await chart.boundingBox();
  if (!chartBox) throw new Error("Chart bounds are unavailable");
  await page.mouse.move(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.4);
  await page.locator(".vnChartTooltip").waitFor({ state: "visible" });
  await page.screenshot({ path: `${output}/market-1440x900.png`, fullPage: false, animations: "disabled" });
  await page.locator(".vnChartFrame").screenshot({ path: `${output}/chart-candles.png`, animations: "disabled" });
  await context.close();
  return { candles: true, line: true, crosshair: true };
}

async function inspectCompatibilityEntries(browser) {
  const desktopContext = await createContext(browser, {
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(desktopPage);
  const requestedMarket = markets[1];
  await gotoReady(
    desktopPage,
    `${base}/market/${requestedMarket.address}?side=sell`,
    ".rmtDesktopTerminal #vn-asset-heading"
  );
  await desktopPage.waitForFunction(
    (symbol) => document.querySelector("#vn-asset-heading")?.textContent?.includes(symbol),
    requestedMarket.symbol
  );
  const desktopSell = desktopPage.locator(".rmtDesktopExecution").getByRole("tab", { name: "Sell" });
  await desktopPage.waitForFunction(
    () => document.querySelector('.rmtDesktopExecution [role="tab"][aria-selected="true"]')?.textContent?.trim() === "Sell"
  );
  const marketEntry = await desktopPage.evaluate(() => ({
    pathname: window.location.pathname,
    market: new URLSearchParams(window.location.search).get("market"),
    side: new URLSearchParams(window.location.search).get("side"),
    terminal: Boolean(document.querySelector(".rmtDesktopTerminal")),
    publicChrome: Boolean(document.querySelector(".publicHeader, .mobileDock")),
    notFound: Boolean(document.querySelector(".next-error-h1")) || document.body.innerText.includes("This page could not be found")
  }));
  if (
    marketEntry.pathname !== "/"
    || marketEntry.market?.toLowerCase() !== requestedMarket.address.toLowerCase()
    || marketEntry.side !== "sell"
    || !marketEntry.terminal
    || marketEntry.publicChrome
    || marketEntry.notFound
    || await desktopSell.getAttribute("aria-selected") !== "true"
  ) throw new Error(`market compatibility entry did not restore exact VNext intent ${JSON.stringify(marketEntry)}`);
  await desktopPage.screenshot({ path: `${output}/compat-market-1440x900.png`, fullPage: false, animations: "disabled" });
  await desktopContext.close();

  const mobileContext = await createContext(browser, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(mobilePage);
  await gotoReady(mobilePage, `${base}/portfolio`, ".rmtMobileTerminal #vnext-portfolio");
  const portfolioEntry = await mobilePage.evaluate(() => ({
    pathname: window.location.pathname,
    panel: new URLSearchParams(window.location.search).get("panel"),
    terminal: Boolean(document.querySelector(".rmtMobileTerminal")),
    portfolio: Boolean(document.querySelector("#vnext-portfolio")),
    publicChrome: Boolean(document.querySelector(".publicHeader, .mobileDock")),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    notFound: Boolean(document.querySelector(".next-error-h1")) || document.body.innerText.includes("This page could not be found")
  }));
  if (
    portfolioEntry.pathname !== "/"
    || portfolioEntry.panel !== "portfolio"
    || !portfolioEntry.terminal
    || !portfolioEntry.portfolio
    || portfolioEntry.publicChrome
    || portfolioEntry.horizontalOverflow > 2
    || portfolioEntry.notFound
  ) throw new Error(`portfolio compatibility entry did not restore VNext holdings ${JSON.stringify(portfolioEntry)}`);
  await mobilePage.screenshot({ path: `${output}/compat-portfolio-390x844.png`, fullPage: false, animations: "disabled" });
  await mobileContext.close();
  return { marketEntry, portfolioEntry };
}

async function inspectCurrentPublicRoutes(browser) {
  const routes = [
    "/robinhood-chain",
    "/markets/robinhood-chain",
    "/markets/robinhood-chain/trending",
    "/markets/robinhood-chain/new",
    "/markets/robinhood-chain/active",
    "/rmt",
    "/status",
    "/sources",
    "/support",
    "/risks",
    "/terms",
    "/experience",
    "/privacy"
  ];
  const results = [];
  for (const pathname of routes) {
    const context = await createContext(browser, { viewport: { width: 1_280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installRoutes(page);
    await gotoReady(page, `${base}${pathname}`, "main");
    const audit = await page.evaluate(() => ({
      pathname: window.location.pathname,
      publicChrome: Boolean(document.querySelector(".publicHeader")),
      terminal: Boolean(document.querySelector(".rmtDesktopTerminal, .rmtMobileTerminal")),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      notFound: Boolean(document.querySelector(".next-error-h1")) || document.body.innerText.includes("This page could not be found")
    }));
    if (audit.pathname !== pathname || !audit.publicChrome || audit.terminal || audit.horizontalOverflow > 2 || audit.notFound) {
      throw new Error(`${pathname}: public route regressed after legacy CSS retirement ${JSON.stringify(audit)}`);
    }
    await page.screenshot({
      path: `${output}/public-${pathname.slice(1).replaceAll("/", "-")}-1280x800.png`,
      fullPage: false,
      animations: "disabled"
    });
    results.push(audit);
    await context.close();
  }

  for (const pathname of ["/explore", "/launch", "/sushi", "/rescue", "/deploy-mainnet"]) {
    const context = await createContext(browser, { viewport: { width: 1_280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installRoutes(page);
    await gotoReady(page, `${base}${pathname}?launch=0&official=true`, ".rmtDesktopTerminal, .rmtMobileTerminal");
    const audit = await page.evaluate(() => ({
      requestedLegacyPath: true,
      pathname: window.location.pathname,
      query: window.location.search,
      terminal: Boolean(document.querySelector(".rmtDesktopTerminal, .rmtMobileTerminal")),
      publicChrome: Boolean(document.querySelector(".publicHeader, .mobileDock")),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      notFound: Boolean(document.querySelector(".next-error-h1")) || document.body.innerText.includes("This page could not be found")
    }));
    if (audit.pathname !== "/" || audit.query || !audit.terminal || audit.publicChrome || audit.horizontalOverflow > 2 || audit.notFound) {
      throw new Error(`${pathname}: legacy product route did not resolve cleanly to the Terminal ${JSON.stringify(audit)}`);
    }
    results.push(audit);
    await context.close();
  }
  return results;
}

async function createWalletAcceptanceContext(browser, options) {
  const context = await createContext(browser, options);
  await context.addInitScript(({ wallet }) => {
    const listeners = new Map();
    let pendingWalletRequest = null;
    window.__RMT_ACCEPTANCE_WALLET_METHODS__ = [];
    const emit = (event, value) => {
      for (const listener of listeners.get(event) ?? []) listener(value);
    };
    window.__RMT_ACCEPTANCE_RELEASE_WALLET__ = (mode = "approve") => {
      if (!pendingWalletRequest) return false;
      const request = pendingWalletRequest;
      pendingWalletRequest = null;
      if (mode === "cancel") request.reject(new Error("User rejected the request"));
      else request.resolve(request.hash);
      return true;
    };
    window.ethereum = {
      isMetaMask: true,
      on(event, listener) {
        const entries = listeners.get(event) ?? [];
        entries.push(listener);
        listeners.set(event, entries);
      },
      removeListener(event, listener) {
        listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener));
      },
      async request({ method, params }) {
        window.__RMT_ACCEPTANCE_WALLET_METHODS__.push(method);
        if (method === "eth_chainId") return "0x1237";
        if (method === "eth_accounts" || method === "eth_requestAccounts") {
          emit("accountsChanged", [wallet]);
          return [wallet];
        }
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
          emit("chainChanged", "0x1237");
          return null;
        }
        if (method === "eth_sendTransaction") {
          const transaction = params?.[0] ?? {};
          const approval = String(transaction.to ?? "").toLowerCase() !== "0x5555555555555555555555555555555555555555";
          const canonicalHash = `0x${(approval ? "b" : "c").repeat(64)}`;
          return await new Promise((resolve, reject) => {
            pendingWalletRequest = { resolve, reject, hash: canonicalHash };
          });
        }
        if (method === "eth_getBlockByNumber") return { number: "0x2faf090", baseFeePerGas: "0x3b9aca00" };
        if (method === "eth_getTransactionCount") return "0x1";
        if (method === "eth_estimateGas") return "0x1d4c0";
        return null;
      }
    };
  }, { wallet: "0x3333333333333333333333333333333333333333" });
  return context;
}

function rpcReceipt(hash, fixture, state) {
  const approval = hash.toLowerCase() === `0x${"b".repeat(64)}`;
  if (!state.receiptsAvailable) return null;
  const logs = approval || state.missingSettlementEvent ? [] : [{
    ...fixture.erc20.settlementLog,
    blockHash: `0x${"d".repeat(64)}`,
    blockNumber: "0x2faf080",
    logIndex: "0x0",
    transactionHash: hash,
    transactionIndex: "0x0",
    removed: false
  }];
  return {
    blockHash: `0x${"d".repeat(64)}`,
    blockNumber: "0x2faf080",
    contractAddress: null,
    cumulativeGasUsed: "0x30d40",
    effectiveGasPrice: "0x3b9aca00",
    from: fixture.wallet,
    gasUsed: approval ? "0xc350" : "0x186a0",
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    to: approval ? fixture.erc20.approvalPlan.target : fixture.executor,
    transactionHash: hash,
    transactionIndex: "0x0",
    type: "0x2"
  };
}

async function installV2WalletAcceptanceRoutes(page, fixture, state) {
  const freshQuote = (quote) => {
    const now = Date.now();
    return {
      ...quote,
      requestedAtMs: now,
      completedAtMs: now + 1,
      attempts: quote.attempts.map((attempt) => ({ ...attempt, quotedAtMs: now, expiresAtMs: now + 1_800_000 }))
    };
  };
  const freshEvidence = (evidence) => {
    const now = Date.now();
    return { ...evidence, verifiedAtMs: now, expiresAtMs: Math.min(now + 300_000, Number(BigInt(evidence.deadline) * 1_000n)) };
  };
  const freshPlan = (plan) => {
    const now = Date.now();
    return { ...plan, preparedAtMs: now, expiresAtMs: Math.min(now + 60_000, Number(BigInt(plan.deadline) * 1_000n)) };
  };
  await page.route("https://browser-acceptance.invalid/**", async (route) => {
    const requests = route.request().postDataJSON();
    const respond = (request) => {
      const method = request?.method;
      state.rpcMethods = [...(state.rpcMethods ?? []), method].slice(-40);
      const hash = String(request?.params?.[0] ?? "");
      let result = null;
      if (method === "eth_chainId") result = "0x1237";
      else if (method === "eth_getBalance") result = "0x8ac7230489e80000";
      else if (method === "eth_gasPrice") result = "0x3b9aca00";
      else if (method === "eth_blockNumber") {
        state.blockNumber += 1;
        result = `0x${state.blockNumber.toString(16)}`;
      }
      else if (method === "eth_getTransactionReceipt") result = rpcReceipt(hash, fixture, state);
      else if (method === "eth_getTransactionByHash") {
        const approval = hash.toLowerCase() === `0x${"b".repeat(64)}`;
        result = {
          blockHash: `0x${"d".repeat(64)}`,
          blockNumber: "0x2faf080",
          chainId: "0x1237",
          from: fixture.wallet,
          gas: approval ? "0xea60" : "0x1d4c0",
          gasPrice: "0x3b9aca00",
          hash,
          input: approval ? fixture.erc20.approvalPlan.data : fixture.erc20.swapPlan.data,
          nonce: approval ? "0x1" : "0x2",
          to: approval ? fixture.erc20.approvalPlan.target : fixture.executor,
          transactionIndex: "0x0",
          type: "0x0",
          value: "0x0",
          v: "0x1b",
          r: `0x${"1".repeat(64)}`,
          s: `0x${"2".repeat(64)}`
        };
      }
      else if (method === "eth_getBlockByNumber") result = { number: "0x2faf090", baseFeePerGas: "0x3b9aca00", timestamp: "0x68a00000" };
      else if (method === "eth_call") result = "0x";
      return { jsonrpc: "2.0", id: request?.id ?? 1, result };
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(requests) ? requests.map(respond) : respond(requests))
    });
  });
  await page.route(/\/api\/vnext\/quotes$/, async (route) => {
    state.quotes = (state.quotes ?? 0) + 1;
    const request = route.request().postDataJSON();
    const selected = String(request.inputAsset).toLowerCase() === fixture.native.quote.inputAsset.toLowerCase()
      ? fixture.native
      : fixture.erc20;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(freshQuote(selected.quote)) });
  });
  await page.route(/\/api\/vnext\/verify$/, async (route) => {
    state.verifications = (state.verifications ?? 0) + 1;
    const request = route.request().postDataJSON();
    const nativeInput = String(request.inputAsset).toLowerCase() === fixture.native.quote.inputAsset.toLowerCase();
    const evidence = nativeInput
      ? fixture.native.swapEvidence
      : state.approved ? fixture.erc20.swapEvidence : fixture.erc20.approvalEvidence;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(freshEvidence(evidence)) });
  });
  await page.route(/\/api\/vnext\/authorize$/, async (route) => {
    state.authorizations = (state.authorizations ?? 0) + 1;
    const request = route.request().postDataJSON();
    const nativeInput = String(request.inputAsset).toLowerCase() === fixture.native.quote.inputAsset.toLowerCase();
    const evidence = nativeInput
      ? fixture.native.swapEvidence
      : state.approved ? fixture.erc20.swapEvidence : fixture.erc20.approvalEvidence;
    const plan = nativeInput
      ? fixture.native.swapPlan
      : state.approved ? fixture.erc20.swapPlan : fixture.erc20.approvalPlan;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ evidence: freshEvidence(evidence), plan: freshPlan(plan) }) });
  });
}

async function openFixtureTrade(page, nativeInput = false) {
  await installRoutes(page);
  await gotoReady(page, `${base}/?market=${token}&side=buy`, ".vnTradePanel");
  if (nativeInput) await page.getByLabel("Pay with asset").selectOption("eip155:4663/native");
  await page.locator(".vnReviewButton").click();
}

async function inspectV2WalletBrowserJourney(browser, fixture, options, label, mode) {
  const state = { approved: mode === "native" || mode === "missing-event" || mode === "cancel", receiptsAvailable: false, missingSettlementEvent: mode === "missing-event", quotes: 0, verifications: 0, authorizations: 0, rpcMethods: [], blockNumber: 50_000_016 };
  const context = await createWalletAcceptanceContext(browser, options);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installV2WalletAcceptanceRoutes(page, fixture, state);
  await openFixtureTrade(page, mode === "native");
  await page.locator(".vnRouteCard summary").click();
  try {
    await page.locator(".vnWalletFeeDisclosure").last().waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const advanced = page.locator(".vnRouteCard");
    if (await advanced.count()) await advanced.evaluate((element) => { element.open = true; });
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      body: document.body.innerText.slice(-4_000),
      buttons: [...document.querySelectorAll("button")].map((entry) => entry.textContent?.trim()).filter(Boolean).slice(-30)
    }));
    await page.screenshot({ path: `${output}/v2-wallet-diagnostic-${label}.png`, fullPage: true });
    throw new Error(`${label}: V2 wallet review did not render ${JSON.stringify({ ...diagnostic, requests: state })}`, { cause: error });
  }
  const review = page.locator(".vnWalletFeeDisclosure").last();
  const reviewText = await review.innerText();
  for (const required of ["Gross input", "Exact fee / asset", "Provider input", "Expected receive", "Protected minimum", "Uniswap V3", "Atomic with swap", "Treasury", "Execution target"]) {
    if (!reviewText.includes(required)) throw new Error(`${label}: V2 wallet review omitted ${required}`);
  }
  await page.getByText("Your wallet displays and authorizes this exact request. RMT cannot sign or submit it for you.", { exact: true }).waitFor({ state: "visible" });

  if (mode === "native") {
    await page.screenshot({ path: `${output}/v2-wallet-review-${label}.png`, fullPage: false, animations: "disabled" });
    await page.evaluate(() => window.__RMT_ACCEPTANCE_RELEASE_WALLET__("cancel"));
    await page.getByText("Wallet review was cancelled. Nothing was submitted.", { exact: true }).waitFor({ state: "visible" });
    await context.close();
    return { nativeReview: true, cancellation: true };
  }

  if (mode === "cancel") {
    await page.evaluate(() => window.__RMT_ACCEPTANCE_RELEASE_WALLET__("cancel"));
    await page.getByText("Wallet review was cancelled. Nothing was submitted.", { exact: true }).waitFor({ state: "visible" });
    await context.close();
    return { cancellation: true };
  }

  if (!state.approved) {
    const approvalText = await page.locator(".vnWalletFeeDisclosure").last().innerText();
    for (const required of ["RMT execution fee on this approval: 0", "Planned trade fee: 0.25%", "It is not collected during approval"]) {
      if (!approvalText.includes(required)) throw new Error(`${label}: approval review omitted ${required}`);
    }
    if (/unlimited/i.test(approvalText)) throw new Error(`${label}: approval review mentions unlimited authority`);
    await page.screenshot({ path: `${output}/v2-approval-review-${label}.png`, fullPage: false, animations: "disabled" });
    await page.evaluate(() => window.__RMT_ACCEPTANCE_RELEASE_WALLET__("approve"));
    await page.getByText("Transaction submitted · confirmation pending", { exact: true }).waitFor({ state: "visible" });
    state.approved = true;
    state.receiptsAvailable = true;
    try {
      await page.getByText("Exact approval confirmed", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      const body = await page.locator("body").innerText();
      throw new Error(`${label}: approval receipt did not resolve ${JSON.stringify({ body: body.slice(-2500), state })}`, { cause: error });
    }
    await page.locator(".vnWalletFeeDisclosure").last().waitFor({ state: "visible", timeout: 30_000 });
    await page.screenshot({ path: `${output}/v2-wallet-review-${label}.png`, fullPage: false, animations: "disabled" });
  }

  state.receiptsAvailable = false;
  await page.evaluate(() => window.__RMT_ACCEPTANCE_RELEASE_WALLET__("approve"));
  await page.getByText("Transaction submitted · confirmation pending", { exact: true }).waitFor({ state: "visible" });
  state.receiptsAvailable = true;
  if (mode === "missing-event") {
    await page.getByText("Settlement evidence requires review", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    const failureText = await page.locator(".vnRecoveryBanner.isreconciliation_failed").innerText();
    if (!failureText.includes("Do not resubmit") || !failureText.includes("View transaction")) throw new Error(`${label}: reconciliation failure guidance is incomplete`);
    if (await page.getByRole("dialog", { name: /confirmed/i }).count()) throw new Error(`${label}: invalid settlement rendered a success receipt`);
    await page.screenshot({ path: `${output}/v2-reconciliation-failed-${label}.png`, fullPage: false, animations: "disabled" });
    await context.close();
    return { reconciliationFailed: true, duplicateBlocked: true };
  }

  try {
    await page.getByRole("dialog", { name: "Buy confirmed" }).waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const body = await page.locator("body").innerText();
    throw new Error(`${label}: V2 receipt did not render ${JSON.stringify({ body: body.slice(-2800), state })}`, { cause: error });
  }
  const receiptText = await page.getByRole("dialog", { name: "Buy confirmed" }).innerText();
  for (const required of ["Gross input", "Asset received", "RMT fee", "0.25%", "Uniswap V3", "View confirmed transaction"]) {
    if (!receiptText.toLowerCase().includes(required.toLowerCase())) throw new Error(`${label}: receipt omitted ${required}: ${JSON.stringify(receiptText)}`);
  }
  await page.screenshot({ path: `${output}/v2-confirmed-receipt-${label}.png`, fullPage: false, animations: "disabled" });
  await context.close();
  return { approval: true, swap: true, receipt: true };
}

async function inspectV4PoolIdWorkspace(browser) {
  const context = await createContext(browser, { viewport: { width: 1_440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, `${base}/?market=${stonkBrokerToken}`, ".rmtDesktopTerminal #vn-asset-heading");
  if (!(await page.locator("#vn-asset-heading").innerText()).includes("STONKBROKER")) throw new Error("V4 deep link did not preserve the canonical token identity");
  await page.locator(".rmtWorkspaceTabs").getByRole("tab", { name: "Markets", exact: true }).click();
  const evidence = await page.locator(".rmtWorkspaceIntelligence").innerText();
  const shortPoolId = `${stonkBrokerPoolId.slice(0, 6)}…${stonkBrokerPoolId.slice(-4)}`;
  if (!/Uniswap V4/i.test(evidence) || !/PoolId/i.test(evidence) || !evidence.includes(shortPoolId)) {
    throw new Error(`V4 Markets tab omitted canonical PoolId evidence: ${evidence}`);
  }
  if (/0 canonical markets|primary pool ↗/i.test(evidence)) throw new Error(`V4 Markets tab fabricated or erased canonical evidence: ${evidence}`);
  await page.waitForTimeout(1_500);
  const requests = telemetryRequests.get(page) ?? 0;
  if (requests !== 0) throw new Error(`V4 PoolId-only workspace started ${requests} unsupported telemetry requests`);
  await page.screenshot({ path: `${output}/v4-pool-id-workspace-desktop-1440x900.png`, fullPage: false, animations: "disabled" });
  await context.close();
  return { token: stonkBrokerToken, poolId: stonkBrokerPoolId, telemetryRequests: requests };
}

function stockWorkspaceFixture(contractAddress, tokenName, tokenSymbol, currentMultiplier, index) {
  const baseMarket = market(index);
  const relationship = {
    relationship: "canonical-stock-token",
    assetId: `stock:${tokenSymbol.toLowerCase()}`,
    tokenSymbol,
    tokenName,
    contractAddress,
    currentMultiplier,
    status: "active",
    logoUrl: null,
    provenance: "robinhood-live-asset-registry"
  };
  const primaryMarket = {
    ...baseMarket.primaryMarket,
    assetId: `eip155:4663/contract:${contractAddress}`,
    token: { address: contractAddress, name: tokenName, symbol: tokenSymbol },
    baseToken: { address: contractAddress, name: tokenName, symbol: tokenSymbol },
    executionEligibility: "view-only"
  };
  return {
    ...baseMarket,
    address: contractAddress,
    assetId: `eip155:4663/contract:${contractAddress}`,
    name: tokenName,
    symbol: tokenSymbol,
    primaryMarket,
    verifiedMarkets: [primaryMarket],
    stockAssetRelationships: [relationship],
    rwaRelationship: "canonical-stock-token"
  };
}

async function inspectStockWorkspace(browser, control, mobile = false) {
  const contextOptions = mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1_440, height: 900 }, deviceScaleFactor: 1 };
  const context = await createContext(browser, contextOptions);
  const page = await context.newPage();
  const fixtureMarket = stockWorkspaceFixture(control.address, control.name, control.symbol, control.multiplier, control.index);
  const state = { approved: true, receiptsAvailable: false, missingSettlementEvent: false, quotes: 0, verifications: 0, authorizations: 0, rpcMethods: [], blockNumber: 50_000_016 };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await page.route(/\/api\/vnext\/verify$/, async (route) => {
    state.verifications += 1;
    await route.fulfill({ status: 451, contentType: "application/json", body: JSON.stringify({ error: "View only" }) });
  });
  await page.route(/\/api\/vnext\/authorize$/, async (route) => {
    state.authorizations += 1;
    await route.fulfill({ status: 451, contentType: "application/json", body: JSON.stringify({ error: "View only" }) });
  });
  await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ canonical: true, coverage: "complete", nextCursor: null, markets: [canonicalDirectoryMarket(fixtureMarket)], updatedAt: now })
  }));
  await page.route(/\/api\/markets\/external(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ markets: [fixtureMarket], source: "stock-workspace-acceptance", rankingVersion: "terminal-v10", thresholds: {}, stockAssetCoverage: "complete", delayedSources: [], updatedAt: now, stale: false })
  }));
  const resolution = {
    chainId: 4_663,
    requestedAddress: control.address,
    requestedKind: "token",
    status: "token-only",
    token: { address: control.address, name: control.name, symbol: control.symbol, decimals: 18, totalSupply: "1000000000000000000000000" },
    pools: [],
    marketData: "identity-only",
    execution: "view-only",
    provenance: "robinhood-chain-contract-reads",
    resolvedAt: now
  };
  await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ resolution }) }));
  await page.route(/\/api\/vnext\/asset-workspace(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ resolution, stockAssetRelationships: fixtureMarket.stockAssetRelationships, stockAssetCoverage: "complete", updatedAt: now })
  }));
  await gotoReady(page, `${base}/?market=${control.address}&side=buy`, `${mobile ? ".rmtMobileTerminal" : ".rmtDesktopTerminal"} #vn-asset-heading`);
  const heading = await page.locator("#vn-asset-heading").innerText();
  if (!heading.includes(control.name) || !heading.includes(control.symbol) || heading.includes(`${control.address.slice(0, 6)}…`)) throw new Error(`${control.symbol}: verified workspace identity did not win ${heading}`);
  await page.locator(".rmtWorkspaceTabs").getByRole("tab", { name: "RWA", exact: true }).click();
  const rwa = await page.locator(".rmtWorkspaceIntelligence").innerText();
  for (const expected of ["Canonical stock token", control.name, control.symbol, control.multiplier, "Robinhood live asset registry", "Active"]) {
    if (!rwa.toLowerCase().includes(expected.toLowerCase())) throw new Error(`${control.symbol}: RWA workspace omitted ${expected}: ${rwa}`);
  }
  const multiplierOccurrences = rwa.split(control.multiplier).length - 1;
  if (multiplierOccurrences !== 1) throw new Error(`${control.symbol}: multiplier rendered ${multiplierOccurrences} times`);
  const viewOnlyBadges = page.getByText("View only", { exact: true });
  if (await viewOnlyBadges.count() === 0) throw new Error(`${control.symbol}: stock-token view-only badge is absent`);
  const body = await page.locator("body").innerText();
  if (/Live trading|Connect & buy|Connect & sell/i.test(body)) throw new Error(`${control.symbol}: executable stock-token language remains visible`);
  if (await page.locator(".vnWalletReview").count()) throw new Error(`${control.symbol}: stock token opened wallet review`);
  if (mobile) {
    const mobileAction = page.locator(".rmtMobileTradeDock button");
    if (await mobileAction.count() !== 1 || (await mobileAction.innerText()) !== "View only" || !(await mobileAction.isDisabled())) {
      throw new Error(`${control.symbol}: mobile stock-token dock still exposes an executable action`);
    }
  } else {
    const reviewAction = page.locator(".vnReviewButton");
    if ((await reviewAction.innerText()) !== "View only" || !(await reviewAction.isDisabled())) throw new Error(`${control.symbol}: persistent composer is not view-only`);
    await page.locator(".rmtWorkspaceTabs").getByRole("tab", { name: "Position", exact: true }).click();
    if (await page.getByRole("button", { name: /^(Buy|Sell)$/ }).count()) throw new Error(`${control.symbol}: workspace position exposes stock execution actions`);
    await page.locator(".rmtWorkspaceTabs").getByRole("tab", { name: "RWA", exact: true }).click();
  }
  if (!mobile) {
    await page.getByRole("tab", { name: "Sell quote", exact: true }).click();
    await page.getByRole("tab", { name: "Buy quote", exact: true }).click();
  }
  await page.waitForTimeout(750);
  if (state.quotes > 0 && await page.locator(".vnQuoteAttempts .isReady").count() === 0) {
    throw new Error(`${control.symbol}: an observed stock quote was not rendered informationally`);
  }
  if (state.verifications !== 0 || state.authorizations !== 0) throw new Error(`${control.symbol}: stock selection called execution APIs ${JSON.stringify(state)}`);
  const walletSideEffects = await page.evaluate(() => ({
    walletProviderPresent: Boolean(window.ethereum),
    walletReview: Boolean(document.querySelector(".vnWalletReview, .vnWalletReviewOverlay"))
  }));
  if (walletSideEffects.walletProviderPresent || walletSideEffects.walletReview) {
    throw new Error(`${control.symbol}: stock informational controls caused a wallet side effect ${JSON.stringify(walletSideEffects)}`);
  }
  const viewportLabel = mobile ? "mobile-390x844" : "desktop-1440x900";
  await page.screenshot({ path: `${output}/${control.symbol.toLowerCase()}-stock-workspace-${viewportLabel}.png`, fullPage: false, animations: "disabled" });
  await context.close();
  return {
    symbol: control.symbol,
    address: control.address,
    multiplier: control.multiplier,
    viewOnly: resolution.execution === "view-only",
    quoteRequests: state.quotes,
    verificationRequests: state.verifications,
    authorizationRequests: state.authorizations,
    mobile
  };
}

async function inspectMobile(browser, viewport, label) {
  const context = await createContext(browser, { viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, base, ".rmtMobileTerminal .rmtMobileMarketRow");
  const initialMobileRows = page.locator(".rmtMobileTerminal .rmtMobileMarketRow");
  if (await initialMobileRows.count() !== 24) throw new Error(`${label}: mobile directory did not start with a bounded 24-market page`);
  const defaultContext = await page.evaluate(() => ({
    context: document.querySelector(".rmtMobileTerminal")?.getAttribute("data-terminal-context"),
    scanner: Boolean(document.querySelector(".rmtMobileMarketsView")),
    asset: Boolean(document.querySelector(".rmtMobileAssetView")),
    dock: Boolean(document.querySelector(".rmtMobileTradeDock")),
    desktop: Boolean(document.querySelector(".rmtDesktopTerminal"))
  }));
  if (defaultContext.context !== "markets" || !defaultContext.scanner || defaultContext.asset || defaultContext.dock || defaultContext.desktop) {
    throw new Error(`${label}: mobile does not default to the dedicated Markets screen ${JSON.stringify(defaultContext)}`);
  }
  await page.screenshot({ path: `${output}/markets-${label}.png`, fullPage: false, animations: "disabled" });
  await page.getByRole("button", { name: /^Load 24 more/ }).click();
  if (await initialMobileRows.count() !== 48) throw new Error(`${label}: mobile local pagination did not reveal the next 24 markets`);
  await page.getByRole("button", { name: /^RWA\s+2$/ }).click();
  const mobileRwaRows = page.locator(".rmtMobileTerminal .rmtMobileMarketRow");
  if (await mobileRwaRows.count() !== 2) throw new Error(`${label}: mobile RWA directory lost a verified classification`);
  if (!(await mobileRwaRows.nth(0).textContent())?.includes("Stock Token")) throw new Error(`${label}: mobile canonical Stock Token is not first or clearly labeled`);
  if (!(await mobileRwaRows.nth(1).textContent())?.includes("RWA Pair")) throw new Error(`${label}: mobile paired market asset is not clearly labeled`);

  await page.screenshot({ path: `${output}/rwa-${label}.png`, fullPage: false, animations: "disabled" });
  await page.getByRole("button", { name: /^Active\s+/ }).click();
  await page.getByRole("button", { name: /^Load 24 more/ }).click();
  if (await page.locator(".rmtMobileMarketRow").count() !== 48) throw new Error(`${label}: mobile page depth was not established for navigation restoration`);
  const marketsAudit = await page.evaluate(() => {
    const marketRow = document.querySelector(".rmtMobileMarketRow");
    const desktop = document.querySelector(".rmtDesktopTerminal");
    const mobile = document.querySelector(".rmtMobileTerminal");
    const mobileDock = document.querySelector(".rmtMobileTradeDock");
    const mobileWalletControls = [...document.querySelectorAll(".rmtMobileHeader .wallet")]
      .filter((element) => element instanceof HTMLElement && element.getBoundingClientRect().height > 0);
    return {
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      marketRowVisible: Boolean(marketRow && marketRow.getBoundingClientRect().height > 0),
      desktopRendered: Boolean(desktop),
      mobileRendered: Boolean(mobile),
      mobileDockVisible: Boolean(mobileDock && mobileDock.getBoundingClientRect().height > 0),
      mobileWalletControlCount: mobileWalletControls.length,
      assetPresent: Boolean(document.querySelector(".rmtMobileAssetView"))
    };
  });
  if (marketsAudit.horizontalOverflow > 2) {
    throw new Error(`mobile: horizontal overflow ${marketsAudit.horizontalOverflow}px`);
  }
  if (!marketsAudit.marketRowVisible || marketsAudit.desktopRendered || !marketsAudit.mobileRendered || marketsAudit.mobileDockVisible || marketsAudit.assetPresent) {
    throw new Error(`mobile: Markets composition is not isolated from Asset/workstation UI ${JSON.stringify(marketsAudit)}`);
  }
  if (marketsAudit.mobileWalletControlCount !== 1) throw new Error(`${label}: mobile header must expose exactly one wallet control ${JSON.stringify(marketsAudit)}`);

  await page.locator(".rmtMobileMarketRow").first().click();
  await page.locator('.rmtMobileTerminal[data-terminal-context="asset"] #vn-asset-heading').waitFor({ state: "visible" });
  const assetQuickLinks = await inspectAssetQuickLinks(page, label);
  const assetAudit = await page.evaluate(() => ({
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    scannerPresent: Boolean(document.querySelector(".rmtMobileMarketsView")),
    assetPresent: Boolean(document.querySelector(".rmtMobileAssetView")),
    dockVisible: Boolean(document.querySelector(".rmtMobileTradeDock")),
    chartWidth: document.querySelector(".vnChart")?.getBoundingClientRect().width ?? 0,
    pathname: window.location.pathname,
    market: new URLSearchParams(window.location.search).get("market")
  }));
  if (assetAudit.horizontalOverflow > 2 || assetAudit.scannerPresent || !assetAudit.assetPresent || !assetAudit.dockVisible || assetAudit.chartWidth > viewport.width + 2 || assetAudit.pathname !== "/" || !assetAudit.market) {
    throw new Error(`${label}: mobile Asset context is incomplete ${JSON.stringify(assetAudit)}`);
  }
  await page.screenshot({ path: `${output}/asset-${label}.png`, fullPage: false, animations: "disabled" });

  await page.evaluate(() => window.history.back());
  await page.locator('.rmtMobileTerminal[data-terminal-context="markets"] .rmtMobileMarketList').waitFor({ state: "visible" });
  if (await page.locator(".rmtMobileMarketRow").count() !== 48) throw new Error(`${label}: browser Back did not preserve the loaded market page depth`);
  await page.evaluate(() => window.history.forward());
  await page.locator('.rmtMobileTerminal[data-terminal-context="asset"] #vn-asset-heading').waitFor({ state: "visible" });

  const mobileBuyAction = page.locator(".rmtMobileTradeDock .isBuy");
  const mobileBuyActionHandle = await mobileBuyAction.elementHandle();
  if (!mobileBuyActionHandle) throw new Error(`${label}: mobile Buy action was unavailable`);
  const selectedSymbol = (await page.locator("#vn-asset-heading b").innerText()).trim();
  if (!selectedSymbol) throw new Error(`${label}: selected asset symbol is unavailable`);
  await mobileBuyAction.click();
  const mobileDialog = page.getByRole("dialog", { name: `Trade ${selectedSymbol}` });
  await mobileDialog.waitFor({ state: "visible" });
  const tradeAudit = await page.evaluate(() => {
    const trade = document.querySelector(".rmtMobileTradeSheet");
    if (!trade) return null;
    const rect = trade.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      bodyLocked: document.body.style.overflow === "hidden" && document.documentElement.style.overflow === "hidden",
      backdropVisible: Boolean(document.querySelector(".rmtMobileSheetLayer.isOpen .rmtMobileSheetBackdrop"))
    };
  });
  if (!tradeAudit || tradeAudit.width > tradeAudit.viewportWidth + 2 || tradeAudit.height > tradeAudit.viewportHeight || tradeAudit.horizontalOverflow > 2 || !tradeAudit.bodyLocked || !tradeAudit.backdropVisible) throw new Error(`${label}: trade sheet failed its viewport/containment contract ${JSON.stringify(tradeAudit)}`);
  const sell = page.getByRole("tab", { name: "Sell" });
  await sell.click();
  if (await sell.getAttribute("aria-selected") !== "true") throw new Error("mobile: Sell tab did not activate");
  await page.screenshot({ path: `${output}/sheet-sell-${label}.png`, fullPage: false, animations: "disabled" });
  const buy = page.getByRole("tab", { name: "Buy" });
  await buy.click();
  if (await buy.getAttribute("aria-selected") !== "true") throw new Error("mobile: Buy tab did not activate");
  await page.screenshot({ path: `${output}/sheet-${label}.png`, fullPage: false, animations: "disabled" });
  await page.keyboard.press("Escape");
  await mobileDialog.waitFor({ state: "hidden" });
  await page.waitForTimeout(50);
  const unlocked = await page.evaluate(() => document.body.style.overflow === "" && document.documentElement.style.overflow === "");
  if (!unlocked) throw new Error(`${label}: page scroll did not unlock after closing the sheet`);
  if (!(await mobileBuyAction.evaluate((button) => document.activeElement === button))) throw new Error(`${label}: focus did not return to the Buy action`);
  await mobileBuyAction.click();
  await mobileDialog.waitFor({ state: "visible" });
  await page.locator(".rmtMobileSheetBackdrop").click({ position: { x: 4, y: 4 } });
  await mobileDialog.waitFor({ state: "hidden" });
  if (!(await page.evaluate(() => document.body.style.overflow === "" && document.documentElement.style.overflow === ""))) throw new Error(`${label}: backdrop close did not restore page scrolling`);
  let returnedToBuyAfterBackdrop = false;
  try {
    await page.waitForFunction((button) => document.activeElement === button, mobileBuyActionHandle, { timeout: 1_000 });
    returnedToBuyAfterBackdrop = true;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
  }
  if (!returnedToBuyAfterBackdrop) {
    if (focusDebug) {
      const activeElement = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return { tag: "none", id: null, text: "" };

        return {
          tag: active.tagName,
          id: active.id || null,
          text: (active.textContent || "").trim().slice(0, 120)
        };
      });

      if (output) {
        await page.screenshot({
          path: `${output}/focus-failure-${label}-backdrop-close.png`,
          fullPage: true
        });
      }

      console.error(`${label}: backdrop close did not return focus to the Buy action`, activeElement);
    }
    throw new Error(`${label}: backdrop close did not return focus to the Buy action`);
  }
  await page.getByRole("button", { name: "Portfolio", exact: true }).click();
  await page.locator('.rmtMobileTerminal[data-terminal-context="portfolio"] #vnext-portfolio').waitFor({ state: "visible" });
  const portfolioAudit = await page.evaluate(() => ({
    pathname: window.location.pathname,
    panel: new URLSearchParams(window.location.search).get("panel"),
    scanner: Boolean(document.querySelector(".rmtMobileMarketsView")),
    asset: Boolean(document.querySelector(".rmtMobileAssetView")),
    dock: Boolean(document.querySelector(".rmtMobileTradeDock")),
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
  }));
  if (portfolioAudit.pathname !== "/" || portfolioAudit.panel !== "portfolio" || portfolioAudit.scanner || portfolioAudit.asset || portfolioAudit.dock || portfolioAudit.overflow > 2) throw new Error(`${label}: mobile Portfolio is not a dedicated context ${JSON.stringify(portfolioAudit)}`);
  await page.screenshot({ path: `${output}/portfolio-${label}.png`, fullPage: false, animations: "disabled" });
  await context.close();
  return { markets: marketsAudit, asset: assetAudit, assetQuickLinks, tradePanel: tradeAudit, portfolio: portfolioAudit };
}

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { channel: "chrome" } : {})
});
try {
  const mobileOnly = process.env.RMT_ACCEPTANCE_ONLY_MOBILE === "true";
  const exploratory = process.env.RMT_ACCEPTANCE_EXPLORATORY === "true";
  const hierarchyPhase = process.env.RMT_ACCEPTANCE_LAYOUT_PHASE === "before" ? "before" : "after";
  const browserAcceptanceFixture = process.env.NEXT_PUBLIC_RMT_BROWSER_ACCEPTANCE_PROFILE === "true"
    ? JSON.parse(await readFile(`${output}/v2-fixture.json`, "utf8"))
    : null;
  const v2BrowserEvidence = browserAcceptanceFixture
    ? await (async () => {
        return {
          desktopNative: mobileOnly ? null : await inspectV2WalletBrowserJourney(browser, browserAcceptanceFixture, { viewport: { width: 1_440, height: 900 } }, "desktop-1440x900-native", "native"),
          desktopSuccess: mobileOnly ? null : await inspectV2WalletBrowserJourney(browser, browserAcceptanceFixture, { viewport: { width: 1_440, height: 900 } }, "desktop-1440x900", "success"),
          desktopFailure: mobileOnly ? null : await inspectV2WalletBrowserJourney(browser, browserAcceptanceFixture, { viewport: { width: 1_440, height: 900 } }, "desktop-1440x900", "missing-event"),
          desktopCancellation: mobileOnly ? null : await inspectV2WalletBrowserJourney(browser, browserAcceptanceFixture, { viewport: { width: 1_440, height: 900 } }, "desktop-1440x900-cancel", "cancel"),
          mobileSuccess: await inspectV2WalletBrowserJourney(browser, browserAcceptanceFixture, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "mobile-390x844", "success"),
          mobileFailure: await inspectV2WalletBrowserJourney(browser, browserAcceptanceFixture, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "mobile-390x844", "missing-event")
        };
      })()
    : null;
  const workspaceEvidence = mobileOnly ? null : {
    v4: await inspectV4PoolIdWorkspace(browser),
    spcx: await inspectStockWorkspace(browser, { address: spcxToken, name: "SpaceX Stock Token", symbol: "SPCX", multiplier: "1", index: 6 }),
    nvda: await inspectStockWorkspace(browser, { address: nvdaToken, name: "NVIDIA Stock Token", symbol: "NVDA", multiplier: "1", index: 8 }),
    spcxMobile: await inspectStockWorkspace(browser, { address: spcxToken, name: "SpaceX Stock Token", symbol: "SPCX", multiplier: "1", index: 6 }, true)
  };
  const marketsHierarchy = await inspectMarketsHierarchy(browser, hierarchyPhase);
  if (process.env.RMT_ACCEPTANCE_ONLY_MARKETS_HIERARCHY === "true") {
    await writeFile(`${output}/report.json`, JSON.stringify({ marketsHierarchy }, null, 2));
    console.log(`Terminal Markets hierarchy acceptance passed: ${JSON.stringify(marketsHierarchy)}`);
    process.exitCode = 0;
  } else {
  const discoveryDesktop = mobileOnly ? null : await inspectDiscoveryAcceptance(
    browser,
    { viewport: { width: 1_440, height: 900 }, deviceScaleFactor: 1 },
    "desktop-1440x900",
    false
  );
  const discoveryMobile = await inspectDiscoveryAcceptance(
    browser,
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    "mobile-390x844",
    true
  );
  const desktop = mobileOnly ? null : await inspectDesktop(browser, { width: 1_440, height: 900 }, "1440x900");
  const laptop = mobileOnly ? null : await inspectDesktop(browser, { width: 1_280, height: 800 }, "1280x800");
  const laptop720 = mobileOnly ? null : await inspectDesktop(browser, { width: 1_280, height: 720 }, "1280x720");
  const compact = mobileOnly ? null : await inspectDesktop(browser, { width: 1_024, height: 768 }, "1024x768");
  const wide = mobileOnly ? null : await inspectDesktop(browser, { width: 1_920, height: 1_080 }, "1920x1080");
  const seamDesktop = !mobileOnly && exploratory ? await inspectDesktop(browser, { width: 1_025, height: 900 }, "1025x900") : null;
  const marketAudit = mobileOnly ? null : await inspectMarket(browser);
  const compatibilityEntries = mobileOnly ? null : await inspectCompatibilityEntries(browser);
  const publicRoutes = process.env.RMT_ACCEPTANCE_SKIP_PUBLIC_ROUTES === "true"
    ? []
    : await inspectCurrentPublicRoutes(browser);
  const mobile430 = await inspectMobile(browser, { width: 430, height: 932 }, "430x932");
  const touch1023 = await inspectMobile(browser, { width: 1_023, height: 900 }, "1023x900");
  const mobile390 = await inspectMobile(browser, { width: 390, height: 844 }, "390x844");
  const mobile393 = await inspectMobile(browser, { width: 393, height: 852 }, "393x852");
  const mobile375 = await inspectMobile(browser, { width: 375, height: 812 }, "375x812");
  const mobile360 = await inspectMobile(browser, { width: 360, height: 800 }, "360x800");
  const exploratoryTouch = {};
  if (exploratory) {
    for (const [entryLabel, entryViewport] of [
      ["1000x900", { width: 1_000, height: 900 }],
      ["960x900", { width: 960, height: 900 }],
      ["900x900", { width: 900, height: 900 }],
      ["820x900", { width: 820, height: 900 }],
      ["768x900", { width: 768, height: 900 }],
      ["414x896", { width: 414, height: 896 }]
    ]) exploratoryTouch[entryLabel] = await inspectMobile(browser, entryViewport, entryLabel);
  }
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ productAcceptanceEvidence, workspaceEvidence, marketsHierarchy, discoveryDesktop, discoveryMobile, desktop, laptop, laptop720, compact, wide, seamDesktop, marketAudit, compatibilityEntries, publicRoutes, touch1023, mobile430, mobile393, mobile390, mobile375, mobile360, v2BrowserEvidence, exploratoryTouch }, null, 2)
  );
  console.log(`Terminal active discovery product acceptance passed: ${JSON.stringify(productAcceptanceEvidence)}`);
  }
} finally {
  await browser.close();
}
