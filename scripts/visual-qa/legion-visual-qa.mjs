import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FIXTURE_EPOCH_MS, FIXTURE_NOW, TOKEN_MARKETS, canonicalDirectoryMarkets,
  NFT_ITEM, NFT_MARKETPLACE, NFT_ONCHAIN, nftInventory,
} from "./legion-fixtures.mjs";

const argv = process.argv.slice(2);
const captureOnly = argv.includes("--capture-only");
const option = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const base = option("--base-url") ?? process.env.RMT_VISUAL_BASE_URL ?? "http://127.0.0.1:3111";
const output = path.resolve(option("--output") ?? process.env.RMT_VISUAL_OUTPUT ?? ".artifacts/legion-visual-qa/latest/actual");
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

await mkdir(output, { recursive: true });

function check(condition, state, message, evidence = null) {
  if (condition) return;
  failures.push({ state, message, evidence });
}

const json = (response, body, status = 200) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

const fixtureServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${fixturePort}`);
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

function candles(range) {
  const count = range === "7D" ? 84 : range === "24H" ? 72 : 42;
  const step = range === "7D" ? 7200 : range === "24H" ? 1200 : 60;
  const start = Math.floor(FIXTURE_EPOCH_MS / 1000) - count * step;
  return Array.from({ length: count }, (_, index) => {
    const close = 0.000072 + index * 0.00000035 + Math.sin(index / 3.2) * 0.0000012;
    const open = close - Math.cos(index / 2.8) * 0.0000005;
    return { timestamp: start + index * step, open, high: Math.max(open, close) + 0.0000007, low: Math.min(open, close) - 0.0000006, close, volume: 3200 + Math.abs(Math.sin(index / 2)) * 9600 };
  });
}

async function installTokenRoutes(page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "fixture_route_not_registered" }) }));
  await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true, coverage: "complete", nextCursor: null, markets: canonicalDirectoryMarkets(), updatedAt: FIXTURE_NOW }) }));
  await page.route(/\/api\/markets\/external(?:\?.*)?$/, (route) => {
    const contract = new URL(route.request().url()).searchParams.get("contract")?.toLowerCase();
    const markets = contract ? TOKEN_MARKETS.filter((market) => market.address === contract || market.pairAddress === contract) : TOKEN_MARKETS;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets, source: "legion-visual-fixture", rankingVersion: "deterministic-v1", thresholds: {}, originCoverage: "complete", rmtOriginCoverage: "complete", stockAssetCoverage: "complete", delayedSources: [], updatedAt: FIXTURE_NOW, stale: false }) });
  });
  await page.route(/\/api\/markets\/ohlcv(?:\?.*)?$/, (route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "LIVE";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, pair, range, candles: candles(range), source: "LEGION_FIXTURE", updatedAt: FIXTURE_NOW, lastTradeAt: trades[0].timestamp, refreshMs: 60_000 }) });
  });
  await page.route(/\/api\/trade\/external-venues(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, venues: [{ venue: "uniswap-v3", pair, dexId: "uniswap-v3", liquidityUsd: TOKEN_MARKETS[1].liquidityUsd, verification: "dex-and-route" }] }) }));
  await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, pair, source: "LEGION_FIXTURE", updatedAt: FIXTURE_NOW, trades }) }));
  await page.route(/\/api\/markets\/external-stream(?:\?.*)?$/, (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(/\/api\/markets\/token-risk(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, pair, marketVerified: true, coverage: "complete", contract: { sourcePublished: true, isProxy: false, bytecodeChanged: false, controls: { assessment: "no-common-controls-found", detected: [], customWriteFunctions: [], administrator: null, activeLaunchRestrictions: false, restrictionEndBlock: null, maxTransactionBps: null, maxWalletBps: null } }, liquidity: { controlStatus: "not-proven", evidenceSource: "none", positionManager: null, positionId: null, owner: null, approvedOperator: null, creatorCanTransfer: null, positionLiquidity: null }, holders: { count: 975, poolShareBps: 4200, topNonPoolShareBps: 740, topNonPoolHolders: [], largestNonPoolHolder: null, creator: null, creatorShareBps: null }, sellSimulation: { status: "not-run", method: "holder-to-pool-transfer", holder: null, amount: null, returnStyle: null }, warnings: [], checkedAt: FIXTURE_NOW }) }));
  await page.route(/\/api\/vnext\/chain-pulse(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chainId: 4663, chain: "Robinhood Chain", source: "LEGION_FIXTURE", authoritative: false, status: "ready", tvlUsd: 580000000, dexVolume24hUsd: 640000000, dexVolume7dUsd: 3460000000, dexChange1dPct: 3.4, dexChange7dPct: 8.2, fees24hUsd: null, fees7dUsd: null, revenue24hUsd: null, revenue7dUsd: null, protocolRevenue24hUsd: null, protocolRevenue7dUsd: null }) }));
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

async function tokenLane(browser, viewport, platform) {
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await installTokenRoutes(page);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(platform === "mobile" ? ".rmtMobileTerminal" : ".rmtDesktopTerminal").waitFor();
  await stabilize(page);
  const categoryButtons = page.locator(".rmtMarketViews button");
  const labels = await categoryButtons.locator("span").allTextContents();
  check(labels[0] === "Active" && labels[1] === "Trending", `token-scanner-${platform}`, "ACTIVE must precede TRENDING.", { labels });
  await categoryButtons.filter({ hasText: "Trending" }).click();
  check(await page.locator(platform === "mobile" ? ".rmtMobileMarketRow" : ".rmtMarketTableRow").count() === 0, `token-scanner-${platform}`, "TRENDING fixture must remain empty.");
  await categoryButtons.filter({ hasText: "New" }).click();
  check(await page.locator(platform === "mobile" ? ".rmtMobileMarketRow" : ".rmtMarketTableRow").count() === 0, `token-scanner-${platform}`, "NEW fixture must remain empty.");
  await categoryButtons.filter({ hasText: "All" }).click();
  const rows = page.locator(platform === "mobile" ? ".rmtMobileMarketRow" : ".rmtMarketTableRow");
  await rows.first().waitFor();
  check(await rows.count() === 8, `token-scanner-${platform}`, "ALL must expose exactly eight curated markets.", { count: await rows.count() });
  const rowText = await rows.allTextContents();
  for (const market of TOKEN_MARKETS) check(rowText.some((text) => text.includes(market.symbol)), `token-scanner-${platform}`, `Missing curated market ${market.symbol}.`);
  check(!rowText.some((text) => /Unavailable/i.test(text)), `token-scanner-${platform}`, "An admitted fixture row became Unavailable.");
  await legacyUxGuards(page, `token-scanner-${platform}`, { mobileScanner: platform === "mobile" });
  await overflow(page, `token-scanner-${platform}`);
  await capture(page, `token-scanner-${platform}-${viewport.width}x${viewport.height}`);

  const pons = rows.filter({ hasText: "PONS" }).first();
  await pons.click();
  await page.locator(platform === "mobile" ? ".rmtMobileAssetView" : ".rmtDesktopAssetView").waitFor();
  await page.locator(".vnChartFrame").waitFor();
  check(await page.locator(".vnChartFrame").isVisible(), `token-asset-${platform}`, "Price/chart region is absent.");
  if (platform === "desktop") check(await page.locator(".vnTradePanel").isVisible(), "token-asset-desktop", "Desktop trade rail is absent.");
  else check(await page.locator(".rmtMobileTradeDock").isVisible(), "token-asset-mobile", "Mobile sticky trade/quote control is absent.");
  const body = await page.locator("body").innerText();
  check(!/Submit transaction|Wallet submission enabled/i.test(body), `token-asset-${platform}`, "Public wallet submission appears enabled.");
  await legacyUxGuards(page, `token-asset-${platform}`, { focused: true });
  await overflow(page, `token-asset-${platform}`);
  await capture(page, `token-asset-${platform}-${viewport.width}x${viewport.height}`);
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
    await registrationCorners(page, state, "[data-rmt-registration-frame]");
  } else if (route === "/nft/ccff00") {
    check(await page.locator("[data-nft-gallery]").isVisible(), state, "CCFF00 Project Market gallery is absent.");
    check(text.includes("CANONICAL ONCHAIN INVENTORY") && text.includes("PROVIDER MARKETPLACE EVIDENCE"), state, "Chain and marketplace evidence are not visibly separated.");
    await registrationCorners(page, state, "[data-nft-gallery] a > div");
  } else {
    check(await page.locator("[data-nft-item-workspace]").isVisible(), state, "Representative CCFF00 item workspace is absent.");
    check(/TOKEN-BOUND ACCOUNT\s*·?\s*ERC-6551 ACCOUNT/i.test(text), state, "CCFF00 token-bound account capability is absent.");
    check(text.includes("ONCHAIN TOKENURI"), state, "Fully onchain metadata authority is absent.");
    await registrationCorners(page, state, "[data-nft-item-workspace] > div:first-child");
  }
  await overflow(page, state);
  await capture(page, `${state}-${viewport.width}x${viewport.height}`);
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu", "--force-device-scale-factor=1"] });
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
    publicWalletSubmissionEnabled: (process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED ?? "false").toLowerCase() !== "false",
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
  console.info(`RMT Legion semantic/capture lane: PASS (${stateResults.length} states)`);
}
