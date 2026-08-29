import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FIXTURE_EPOCH_MS, FIXTURE_NOW, BROAD_TOKEN_MARKETS, TOKEN_MARKETS, VISIBLE_TOKEN_MARKETS, canonicalDirectoryMarkets,
  CCFF00_COLLECTION, NFT_ITEM, NFT_MARKETPLACE, NFT_MINT_RADAR_DETAILS, NFT_MINT_RADAR_PAGES, NFT_ONCHAIN,
  RADAR_DROP_COLLECTION, RADAR_SEADROP, RADAR_SEADROP_CODE, nftInventory,
} from "./legion-fixtures.mjs";

const argv = process.argv.slice(2);
const captureOnly = argv.includes("--capture-only");
const option = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const base = option("--base-url") ?? process.env.RMT_VISUAL_BASE_URL ?? "http://127.0.0.1:3111";
const output = path.resolve(option("--output") ?? process.env.RMT_VISUAL_OUTPUT ?? ".artifacts/legion-visual-qa/latest/actual");
const acceptanceOutput = path.join(output, "release-polish-acceptance");
const fixturePort = Number(process.env.RMT_VISUAL_FIXTURE_PORT ?? 43111);
const token = TOKEN_MARKETS[1].address;
const pair = TOKEN_MARKETS[1].pairAddress;
const failures = [];
const stateResults = [];
let horizontalOverflowPixels = 0;
let watchingPublicLeaks = 0;
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
    return json(response, NFT_MINT_RADAR_PAGES[type]);
  }
  if (url.pathname.startsWith("/api/v2/drops/")) {
    if (request.headers["x-api-key"] !== "legion-radar-fixture") return json(response, { error: "unauthorized" }, 401);
    const slug = decodeURIComponent(url.pathname.slice("/api/v2/drops/".length));
    return slug in NFT_MINT_RADAR_DETAILS ? json(response, NFT_MINT_RADAR_DETAILS[slug]) : json(response, { error: "not_found" }, 404);
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
      if (target === RADAR_SEADROP.toLowerCase() && data.startsWith("0x2db526eb")) {
        return rpcResult(response, payload.id, `0x${word(32)}${word(1)}${addressWord(CCFF00_COLLECTION)}`);
      }
      if (target === RADAR_SEADROP.toLowerCase() && data.startsWith("0x0b0e8a6e")) {
        return rpcResult(response, payload.id, `0x${word(12_500_000_000_000_000n)}${word(2)}${word(1_789_488_000)}${word(1_789_495_200)}${word(7)}${word(500)}${word(0)}${word(0)}`);
      }
      return rpcResult(response, payload.id, "0x");
    }
    return json(response, { jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "method_not_found" } }, 400);
  }
  if (request.headers.authorization !== `Bearer ${"a".repeat(64)}`) return json(response, { error: "unauthorized" }, 401);
  if (/^\/internal\/v1\/projects\/ccff00\/inventory$/.test(url.pathname)) return json(response, nftInventory(Number(url.searchParams.get("limit") ?? 24)));
  if (url.pathname === "/internal/v1/projects/ccff00/items/1") return json(response, NFT_ITEM);
  if (url.pathname === "/internal/v1/projects/ccff00/onchain") return json(response, NFT_ONCHAIN);
  if (url.pathname === "/internal/v1/projects/ccff00/marketplace") return json(response, NFT_MARKETPLACE);
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
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: requestUrl.searchParams.get("token"), pair: requestUrl.searchParams.get("pair"), range, candles: candles(range, referencePrice), source: "GeckoTerminal", updatedAt: FIXTURE_NOW, lastTradeAt: trades[0].timestamp, refreshMs: 60_000, stale: chartMode === "stale" }) });
  });
  await page.route(/\/api\/trade\/external-venues(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, venues: [{ venue: "uniswap-v3", pair, dexId: "uniswap-v3", liquidityUsd: TOKEN_MARKETS[1].liquidityUsd, verification: "dex-and-route" }] }) }));
  await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, pair, source: "LEGION_FIXTURE", updatedAt: FIXTURE_NOW, trades }) }));
  await page.route(/\/api\/markets\/external-stream(?:\?.*)?$/, (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(/\/api\/markets\/token-risk(?:\?.*)?$/, (route) => {
    if (riskMode === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable" }) });
    const requestUrl = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: requestUrl.searchParams.get("token"), pair: requestUrl.searchParams.get("pair"), marketVerified: true, coverage: riskMode === "partial" ? "partial" : "complete", freshness: "fresh", domains: { token: "ready", holders: "ready", contract: "ready", abi: "ready", creator: "not-applicable", liquidity: riskMode === "partial" ? "unavailable" : "ready", sell: "ready" }, contract: { sourcePublished: true, isProxy: false, bytecodeChanged: false, controls: { assessment: "no-common-controls-found", detected: [], customWriteFunctions: [], administrator: null, activeLaunchRestrictions: false, restrictionEndBlock: null, maxTransactionBps: null, maxWalletBps: null } }, liquidity: { controlStatus: "not-proven", evidenceSource: "none", positionManager: null, positionId: null, owner: null, approvedOperator: null, creatorCanTransfer: null, positionLiquidity: null }, holders: { count: 975, poolShareBps: 4200, topNonPoolShareBps: 740, topNonPoolHolders: [], largestNonPoolHolder: null, creator: null, creatorShareBps: null }, sellSimulation: { status: "not-run", method: "holder-to-pool-transfer", holder: null, amount: null, returnStyle: null }, warnings: [], checkedAt: FIXTURE_NOW }) });
  });
  await page.route(/\/api\/vnext\/chain-pulse(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chainId: 4663, chain: "Robinhood Chain", source: "LEGION_FIXTURE", authoritative: false, status: "ready", tvlUsd: 580000000, dexVolume24hUsd: 640000000, dexVolume7dUsd: 3460000000, dexChange1dPct: 3.4, dexChange7dPct: 8.2, fees24hUsd: null, fees7dUsd: null, revenue24hUsd: null, revenue7dUsd: null, protocolRevenue24hUsd: null, protocolRevenue7dUsd: null }) }));
  await page.route(/\/api\/vnext\/capital-flow(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, chainId: 4663, chain: "Robinhood Chain", source: "DEFILLAMA", authoritative: false, status: "ready", asOf: FIXTURE_NOW, stablecoinMarketCapUsd: 148000000, stablecoinChange7dPct: 2.3, usdgMarketCapUsd: 91000000, usdgDominancePct: 61.5 }) }));
  return { setChartMode: (mode) => { chartMode = mode; }, setRiskMode: (mode) => { riskMode = mode; } };
}

async function createContext(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark", locale: "en-US", timezoneId: "UTC" });
  await context.addInitScript(({ fixedNow }) => {
    Date.now = () => fixedNow;
    localStorage.setItem("rmt:trading-terms", JSON.stringify({ version: "2026-07-28", acceptedAt: new Date(fixedNow).toISOString() }));
    localStorage.setItem("rmt:experience-preferences", JSON.stringify({ schemaVersion: 1, onboardingVersion: 1, diagnosticsEnabled: false, updatedAt: fixedNow }));
  }, { fixedNow: FIXTURE_EPOCH_MS });
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
  check(labels[0] === "Active" && labels[1] === "Trending", `token-scanner-${platform}`, "ACTIVE must precede TRENDING.", { labels });
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
    await acceptanceCapture(page, "safety-holders-ready-390x844");
    await page.getByRole("tab", { name: "liquidity", exact: true }).click();
    await acceptanceCapture(page, "safety-liquidity-ready-390x844");
    await page.getByRole("tab", { name: "risk", exact: true }).click();
    check(await page.getByText("Onchain verified", { exact: true }).count() === 1, "token-safety-mobile", "Safety does not reuse the workspace onchain token identity.");
    await acceptanceCapture(page, "safety-risk-ready-390x844");

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
    check(await page.getByRole("heading", { name: "up. markets & gauge evidence", exact: true }).count() === 1, "token-markets-mobile", "up. venue evidence was not preserved under Markets.");
    await page.locator(".vnMarketEvidenceStack").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "markets-with-up-evidence-390x844");

    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    fixture.setChartMode("unavailable");
    await page.getByRole("tab", { name: "5M", exact: true }).click();
    await page.getByText("Unavailable", { exact: true }).waitFor();
    await page.locator(".vnChart").scrollIntoViewIfNeeded();
    await acceptanceCapture(page, "chart-unavailable-390x844");

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

async function nftPage(browser, viewport, platform, route, state) {
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator('[data-nft-terminal-shell="v1"]').waitFor();
  await stabilize(page);
  const nftNav = page.locator('nav[aria-label="RMT Terminal navigation"]:visible');
  const nftPrimary = (await nftNav.locator("a").allTextContents()).map((label) => label.trim()).slice(0, 4);
  const nftNavAligned = JSON.stringify(nftPrimary) === JSON.stringify(["Markets", "NFTs", "Portfolio", "Distribution"]);
  const nftActive = await nftNav.locator('[aria-current="page"]').allTextContents();
  const walletReturnTo = await page.locator("[data-nft-wallet-return-to]").getAttribute("data-nft-wallet-return-to");
  crossSurfaceNavigationViolations += Number(!nftNavAligned) + Number(!nftActive.includes("NFTs")) + Number(walletReturnTo !== route);
  check(nftNavAligned, state, "NFT global market navigation is not aligned with the Token surface.", { primary: nftPrimary });
  check(nftActive.includes("NFTs"), state, "NFTs is not the unmistakable active product section.", { active: nftActive });
  check(walletReturnTo === route, state, "NFT wallet flow does not preserve the current market/item deep link.", { expected: route, actual: walletReturnTo });
  const text = await page.locator("body").innerText();
  check(page.url().endsWith(route), state, "NFT route did not resolve exactly.", { actual: page.url(), expected: route });
  check(text.includes("CCFF00"), state, "CCFF00 is absent from its public lane.");
  const leakedWatching = Number(text.includes("Robin Rabbits")) + Number(text.includes("Gogh Punks"));
  watchingPublicLeaks += leakedWatching;
  check(leakedWatching === 0, state, "WATCHING project leaked publicly.");
  check(!/\bRarity\b/i.test(text), state, "Rarity was invented for CCFF00.");
  const forbidden = page.locator("a,button").filter({ hasText: /^(Buy|List|Offer|Fulfill|Sign|Submit)$/i });
  const forbiddenCount = await forbidden.count();
  nftExecutionControls += forbiddenCount;
  check(forbiddenCount === 0, state, "NFT execution controls are present.", { count: forbiddenCount });
  if (route === "/nft") {
    check(await page.locator("[data-nft-project-stage]").count() === 1, state, "Public ACTIVE NFT project count is not one.");
    const radar = page.locator("[data-nft-mint-radar]");
    check(await radar.getAttribute("data-radar-state") === "READY", state, "Mint Radar fixture is not READY.");
    check(await page.getByRole("heading", { name: "Live Now", exact: true }).count() === 1, state, "Mint Radar Live Now state is absent.");
    check(await page.getByRole("heading", { name: "Upcoming", exact: true }).count() === 1, state, "Mint Radar Upcoming state is absent.");
    check(await page.getByRole("heading", { name: "Recently Minted", exact: true }).count() === 1, state, "Mint Radar Recently Minted state is absent.");
    const radarCandidates = page.locator("[data-radar-candidate]");
    check(await radarCandidates.count() === 4, state, "Deterministic Mint Radar candidate count changed.", { count: await radarCandidates.count() });
    const liveReadinessActions = page.locator('[data-radar-candidate][data-radar-state="LIVE_NOW"] [data-nft-readiness-action]');
    check(await liveReadinessActions.count() === 1, state, "Live Mint Radar candidate is missing its non-executing readiness action.");
    check((await liveReadinessActions.first().textContent())?.trim() === "CHECK READINESS", state, "Mint readiness action changed into an execution-like control.");
    check(await page.locator("[data-nft-mint-readiness] form").count() === 0, state, "Mint readiness introduced a transaction submission form.");
    check(await page.locator('[data-radar-candidate]:not([data-radar-admission="NOT_EVALUATED"])').count() === 0, state, "Radar candidate crossed into RMT admission authority.");
    check(await page.locator('[data-radar-candidate]:not([data-radar-chain="4663"])').count() === 0, state, "Mint Radar exposed a non-Robinhood Chain candidate.");
    check(await page.locator('[data-ccff00-access="VERIFIED_COMMUNITY_GATE"]').count() === 1, state, "Exact CCFF00 token-gate fixture is not independently classified as verified.");
    check(await page.getByText("#CCFF00 ACCESS · VERIFIED", { exact: true }).count() === 1, state, "Verified CCFF00 access badge is absent.");
    check(await page.locator('[data-ccff00-access="UNKNOWN"]').count() >= 1, state, "Mint Radar fixture no longer preserves unknown access evidence.");
    check(await page.getByText(/Access · Unknown/i).count() === 0, state, "Unknown access was promoted into a noisy card-level warning.");
    check(!/Token relationship/i.test(text), state, "Mint Radar inferred a Token relationship.");
    await registrationCorners(page, state, "[data-rmt-registration-frame]");
  } else if (route === "/nft/ccff00") {
    check(await page.locator("[data-nft-gallery]").isVisible(), state, "CCFF00 Project Market gallery is absent.");
    check(text.includes("CANONICAL ONCHAIN INVENTORY") && text.includes("PROVIDER MARKETPLACE EVIDENCE"), state, "Chain and marketplace evidence are not visibly separated.");
    await registrationCorners(page, state, "[data-nft-gallery] a > div");
  } else {
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

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu", "--force-device-scale-factor=1"] });
  await startupLane(browser);
  await tokenLane(browser, { width: 1440, height: 900 }, "desktop");
  await tokenLane(browser, { width: 390, height: 844 }, "mobile");
  for (const [route, suffix] of [["/nft", "nft-catalog"], ["/nft/ccff00", "nft-project"], ["/nft/ccff00/1", "nft-item"]]) {
    await nftPage(browser, { width: 1440, height: 900 }, "desktop", route, `${suffix}-desktop`);
    await nftPage(browser, { width: 390, height: 844 }, "mobile", route, `${suffix}-mobile`);
  }
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
    watchingPublicLeaks,
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
