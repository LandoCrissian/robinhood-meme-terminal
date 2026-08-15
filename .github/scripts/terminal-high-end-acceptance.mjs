import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.RMT_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.RMT_ACCEPTANCE_OUTPUT
  ?? `${process.env.GITHUB_WORKSPACE}/terminal-high-end-evidence`;
const now = new Date().toISOString();
const address = (seed) => `0x${seed.toString(16).padStart(40, "0")}`;
const txHash = (seed) => `0x${seed.toString(16).repeat(64).slice(0, 64)}`;
const token = address(0x1001);
const pair = address(0x2001);
const factory = address(0x3001);
const creator = address(0x4001);

await mkdir(output, { recursive: true });

function market(index) {
  const sourceId = index % 3 === 0 ? "sushi" : index % 3 === 1 ? "lemon" : "pons";
  const sourceName = sourceId === "sushi" ? "Sushi Launch" : sourceId === "lemon" ? "Lemon" : "Pons";
  const marketToken = index === 0 ? token : address(0x1001 + index);
  const marketPair = index === 0 ? pair : address(0x2001 + index);
  const change5m = ((index * 17) % 31) - 12;
  const change1h = ((index * 11) % 43) - 9;
  const liquidity = 58_000 + index * 19_000;
  const volume1h = 46_000 + index * 7_300;
  const stockAssetRelationships = index === 0
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
    priceUsd: 0.00072 + index * 0.000083,
    liquidityUsd: liquidity,
    marketCapUsd: 390_000 + index * 235_000,
    fdvUsd: 480_000 + index * 280_000,
    volume5m: Math.max(12_000, volume1h * 0.36),
    volume1h,
    volume24h: 420_000 + index * 97_000,
    priceChange5m: change5m,
    priceChange1h: change1h,
    priceChange24h: change1h * 1.9,
    buys5m: 24 + index,
    sells5m: 8 + index % 5,
    buys1h: 138 + index * 7,
    sells1h: 67 + index * 3,
    buys24h: 1_120 + index * 31,
    sells24h: 610 + index * 19,
    pairCreatedAt: Date.now() - (index + 1) * 3_600_000,
    ageMinutes: 52 + index * 83,
    momentumScore: 58 + (index * 7) % 39,
    buyPressureBps: 6_400 + index * 75,
    signal: "moving",
    riskFlags: index % 7 === 0 ? ["thin-liquidity"] : [],
    stockAssetRelationships
  };
}

const markets = Array.from({ length: 52 }, (_, index) => market(index));
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

async function installRoutes(page) {
  await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ markets, updatedAt: now, stale: false })
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
  await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ token, pair, source: "GeckoTerminal", updatedAt: now, trades })
  }));
  await page.route(/\/api\/markets\/external-stream(?:\?.*)?$/, (route) => route.fulfill({
    status: 204,
    body: ""
  }));
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
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
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
    marketRowsAboveFold: [...document.querySelectorAll(".rmtMarketItem")]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      }).length,
    controlsUnder32
  };
}

async function inspectDesktop(browser, viewport, label) {
  const context = await createContext(browser, { viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, base, ".rmtDesktopTerminal .rmtMarketItem");

  const audit = await page.evaluate(visibleAudit);
  if (audit.horizontalOverflow > 2) throw new Error(`${label}: page horizontal overflow ${audit.horizontalOverflow}px`);
  if (audit.marketRowsAboveFold < 2) {
    throw new Error(`${label}: only ${audit.marketRowsAboveFold} market rows are above the fold`);
  }
  if (audit.controlsUnder32.length) {
    throw new Error(`${label}: undersized controls ${JSON.stringify(audit.controlsUnder32)}`);
  }

  const composition = await page.evaluate(() => ({
    desktop: Boolean(document.querySelector(".rmtDesktopTerminal")),
    mobile: Boolean(document.querySelector(".rmtMobileTerminal")),
    chart: document.querySelector(".vnChart")?.getBoundingClientRect().height ?? 0,
    rail: document.querySelector(".rmtDesktopExecution")?.getBoundingClientRect(),
    workspace: document.querySelector(".rmtDesktopAsset")?.getBoundingClientRect(),
    directory: document.querySelector(".rmtDesktopMarkets")?.getBoundingClientRect()
  }));
  if (!composition.desktop || composition.mobile) throw new Error(`${label}: dedicated desktop composition was not selected`);
  if (composition.chart < 280) throw new Error(`${label}: chart lacks workstation authority (${composition.chart}px)`);
  if (!composition.rail || !composition.workspace || !composition.directory) throw new Error(`${label}: workstation columns are incomplete`);
  if (composition.rail.x < composition.workspace.x + composition.workspace.width - 2) throw new Error(`${label}: execution rail overlaps the asset workspace`);

  const initialRows = page.locator(".rmtDesktopTerminal .rmtMarketItem");
  if (await initialRows.count() !== 24) throw new Error(`${label}: directory did not start with a bounded 24-market page`);
  const loadMore = page.getByRole("button", { name: "Load 24 more" });
  await loadMore.click();
  if (await initialRows.count() !== 48) throw new Error(`${label}: local market pagination did not reveal the next 24 markets`);

  const headerNavigation = page.locator(".rmtDesktopHeader nav");
  const headerMarkets = headerNavigation.locator('[data-terminal-nav="markets"]');
  const headerPortfolio = headerNavigation.locator('[data-terminal-nav="portfolio"]');
  const headerRwa = headerNavigation.locator('[data-terminal-nav="rwa"]');
  const search = page.getByRole("textbox", { name: "Search Robinhood Chain markets" });
  const headerNavigationVisible = await headerNavigation.isVisible();
  if (viewport.width > 1_180 && !headerNavigationVisible) throw new Error(`${label}: desktop header navigation is unexpectedly hidden`);
  if (headerNavigationVisible) {
    await headerMarkets.click();
    if (new URL(page.url()).pathname !== "/" || await page.locator(".rmtDesktopTerminal").count() !== 1) throw new Error(`${label}: Markets header control left the canonical terminal`);
    await headerPortfolio.click();
    if (new URL(page.url()).pathname !== "/" || await page.locator("#vnext-portfolio").count() !== 1) throw new Error(`${label}: Portfolio header control left the canonical terminal or lost its target`);
    await search.fill("R02");
    await headerRwa.click();
    await page.waitForTimeout(100);
    const rwaNavigation = await page.evaluate(() => ({
      pathname: window.location.pathname,
      terminalActive: Boolean(document.querySelector(".rmtDesktopTerminal")),
      publicChromePresent: Boolean(document.querySelector(".publicHeader, .mobileDock")),
      notFound: Boolean(document.querySelector(".next-error-h1")) || document.body.innerText.includes("This page could not be found"),
      activeCategory: document.querySelector('.rmtMarketViews button[aria-pressed="true"] span')?.textContent ?? "",
      searchValue: document.querySelector("#rmt-market-search")?.value ?? null
    }));
    if (rwaNavigation.pathname !== "/") throw new Error(`${label}: RWA header control navigated away from /`);
    if (!rwaNavigation.terminalActive || rwaNavigation.publicChromePresent || rwaNavigation.notFound) throw new Error(`${label}: RWA header control escaped the canonical terminal ${JSON.stringify(rwaNavigation)}`);
    if (rwaNavigation.activeCategory !== "RWA" || rwaNavigation.searchValue !== "") throw new Error(`${label}: RWA header control did not activate the RWA view and clear stale search ${JSON.stringify(rwaNavigation)}`);
  } else {
    await page.getByRole("button", { name: /^RWA\s+2$/ }).click();
  }
  const rwaRows = page.locator(".rmtMarketItem");
  if (await rwaRows.count() !== 2) throw new Error(`${label}: RWA directory did not preserve both verified classifications`);
  if (!(await rwaRows.nth(0).textContent())?.includes("Stock Token")) throw new Error(`${label}: canonical Stock Token was not first or clearly labeled`);
  if (!(await rwaRows.nth(1).textContent())?.includes("RWA Pair")) throw new Error(`${label}: paired market asset was not clearly labeled`);
  await page.screenshot({ path: `${output}/rwa-${label}.png`, fullPage: false, animations: "disabled" });
  if (headerNavigationVisible) await headerMarkets.click();
  else await page.getByRole("button", { name: /^Trending\s+/ }).click();
  if (await page.getByRole("button", { name: /^Trending\s+/ }).getAttribute("aria-pressed") !== "true") throw new Error(`${label}: Markets navigation did not restore the default market view`);
  if (await page.locator(".rmtDesktopTerminal .rmtMarketItem").count() !== 24) throw new Error(`${label}: changing category did not reset the bounded market page`);

  await search.fill("R02");
  await page.waitForTimeout(100);
  if (await page.locator(".rmtMarketItem").count() !== 1) throw new Error(`${label}: market search did not narrow the directory`);
  if (!(await page.locator(".rmtMarketItem").first().textContent())?.includes("R02")) throw new Error(`${label}: market search returned the wrong asset`);
  await page.locator(".rmtMarketItem").first().click();
  if (!(await page.locator("#vn-asset-heading").textContent())?.includes("R02")) throw new Error(`${label}: selected asset did not update the VNext workspace`);
  await search.fill("");
  await page.waitForTimeout(100);

  await page.screenshot({ path: `${output}/home-${label}.png`, fullPage: false, animations: "disabled" });
  await context.close();
  return { ...audit, composition };
}

async function inspectMarket(browser) {
  const context = await createContext(browser, {
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, base, ".vnChartFrame svg");

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
    "/explore",
    "/status",
    "/sources",
    "/sushi",
    "/support",
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
  return results;
}

async function inspectMobile(browser, viewport, label) {
  const context = await createContext(browser, { viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page);
  await gotoReady(page, base, ".rmtMobileTerminal #vn-asset-heading");
  await page.locator(".rmtMobileDiscovery > summary").click();
  await page.locator(".rmtMobileTerminal .rmtMarketItem").first().waitFor({ state: "visible" });
  const initialMobileRows = page.locator(".rmtMobileTerminal .rmtMarketItem");
  if (await initialMobileRows.count() !== 24) throw new Error(`${label}: mobile directory did not start with a bounded 24-market page`);
  await page.getByRole("button", { name: "Load 24 more" }).click();
  if (await initialMobileRows.count() !== 48) throw new Error(`${label}: mobile local pagination did not reveal the next 24 markets`);
  await page.getByRole("button", { name: /^RWA\s+2$/ }).click();
  const mobileRwaRows = page.locator(".rmtMobileTerminal .rmtMarketItem");
  if (await mobileRwaRows.count() !== 2) throw new Error(`${label}: mobile RWA directory lost a verified classification`);
  if (!(await mobileRwaRows.nth(0).textContent())?.includes("Stock Token")) throw new Error(`${label}: mobile canonical Stock Token is not first or clearly labeled`);
  if (!(await mobileRwaRows.nth(1).textContent())?.includes("RWA Pair")) throw new Error(`${label}: mobile paired market asset is not clearly labeled`);

  const homeAudit = await page.evaluate(() => {
    const marketRow = document.querySelector(".rmtMarketDirectory.ismobile .rmtMarketItem");
    const desktop = document.querySelector(".rmtDesktopTerminal");
    const mobile = document.querySelector(".rmtMobileTerminal");
    const mobileDock = document.querySelector(".rmtMobileTradeDock");
    return {
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      marketRowVisible: Boolean(marketRow && marketRow.getBoundingClientRect().height > 0),
      desktopRendered: Boolean(desktop),
      mobileRendered: Boolean(mobile),
      mobileDockVisible: Boolean(mobileDock && mobileDock.getBoundingClientRect().height > 0),
      chartWidth: document.querySelector(".vnChart")?.getBoundingClientRect().width ?? 0
    };
  });
  if (homeAudit.horizontalOverflow > 2) {
    throw new Error(`mobile: horizontal overflow ${homeAudit.horizontalOverflow}px`);
  }
  if (!homeAudit.marketRowVisible || homeAudit.desktopRendered || !homeAudit.mobileRendered || !homeAudit.mobileDockVisible) {
    throw new Error(`mobile: desktop workstation leaked into mobile layout ${JSON.stringify(homeAudit)}`);
  }
  if (homeAudit.chartWidth > viewport.width + 2) throw new Error(`${label}: chart escaped the viewport`);
  await page.screenshot({ path: `${output}/discovery-${label}.png`, fullPage: false, animations: "disabled" });
  await page.locator(".rmtMobileDiscovery > summary").click();
  await page.screenshot({ path: `${output}/home-${label}.png`, fullPage: false, animations: "disabled" });

  const mobileBuyAction = page.locator(".rmtMobileTradeDock .isBuy");
  const selectedSymbol = (await mobileBuyAction.textContent())?.replace(/^Buy\s+/, "").trim();
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
  await context.close();
  return { home: homeAudit, tradePanel: tradeAudit };
}

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { channel: "chrome" } : {})
});
try {
  const desktop = await inspectDesktop(browser, { width: 1_440, height: 900 }, "1440x900");
  const laptop = await inspectDesktop(browser, { width: 1_280, height: 800 }, "1280x800");
  const compact = await inspectDesktop(browser, { width: 1_024, height: 768 }, "1024x768");
  const marketAudit = await inspectMarket(browser);
  const compatibilityEntries = await inspectCompatibilityEntries(browser);
  const publicRoutes = await inspectCurrentPublicRoutes(browser);
  const mobile430 = await inspectMobile(browser, { width: 430, height: 932 }, "430x932");
  const mobile390 = await inspectMobile(browser, { width: 390, height: 844 }, "390x844");
  const mobile375 = await inspectMobile(browser, { width: 375, height: 812 }, "375x812");
  const mobile360 = await inspectMobile(browser, { width: 360, height: 800 }, "360x800");
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ desktop, laptop, compact, marketAudit, compatibilityEntries, publicRoutes, mobile430, mobile390, mobile375, mobile360 }, null, 2)
  );
} finally {
  await browser.close();
}
