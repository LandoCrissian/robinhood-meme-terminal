import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Default: loopback checks only. RMT_POLISH_MODE=before captures the exact prior
// preview, and =all explicitly includes both. RMT_POLISH_URL selects loopback;
// RMT_POLISH_ARTIFACTS must be outside the repository. No dependency changes.
// Fixture registrations below never enter the website, indexer, public API,
// or a wallet provider. RMT_POLISH_DEPENDENCY_ROOT can reuse an existing install.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dependencies = resolve(process.env.RMT_POLISH_DEPENDENCY_ROOT ?? root);
const require = createRequire(join(dependencies, "package.json"));
const { chromium, devices, webkit } = require("playwright");
const site = new URL(process.env.RMT_POLISH_URL ?? "http://127.0.0.1:3268/");
assert.equal(site.protocol, "http:");
assert.equal(site.hostname, "127.0.0.1");
assert.ok(site.port);
assert.equal(site.href, `${site.origin}/`);
const before = new URL("https://6afd06ab371403bb3c26a81b--eclectic-valkyrie-16cb92.netlify.app/");
const mode = process.env.RMT_POLISH_MODE ?? "after";
assert.ok(["all", "before", "after"].includes(mode));
const output = resolve(process.env.RMT_POLISH_ARTIFACTS ?? join(tmpdir(), "rmt-task068-evidence"));
const outputRelative = relative(root, output);
assert.ok(outputRelative.startsWith("..") || isAbsolute(outputRelative), "Keep screenshots and reports outside Git.");
await mkdir(output, { recursive: true });

const layouts = [
  { name: "desktop", viewport: { width: 1440, height: 1000 } },
  { ...devices["iPhone 13"], name: "iphone-portrait", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  { ...devices["iPhone 13 landscape"], name: "iphone-landscape", viewport: { width: 750, height: 390 }, deviceScaleFactor: 2 },
  { ...devices["iPhone 13"], name: "narrow", viewport: { width: 320, height: 740 }, deviceScaleFactor: 2 },
];
const reports = [];
const candidate = mode === "before" ? undefined : {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sources: Object.fromEntries(await Promise.all([
    "app/_components/new-engine-launches.tsx", "app/_components/launch-provenance.tsx", "app/_components/wallet-account.tsx",
    "app/_components/launch-shell.tsx", "app/page.tsx", "app/profile-refinement.css", "app/creator-polish.css",
  ].map(async path => {
    const source = await readFile(join(root, "apps/launch-website", path)).catch(error => {
      if (error.code === "ENOENT" && path === "app/creator-polish.css") return null;
      throw error;
    });
    return [path, source === null ? "absent" : createHash("sha256").update(source).digest("hex")];
  }))),
};

async function screenshot(page, name) {
  const path = join(output, `${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  return path;
}

async function instrument(context, allowedOrigins) {
  const operations = [], pageErrors = [];
  await context.addInitScript(() => {
    window.__rmtPolishWalletCalls = [];
    Object.defineProperty(window, "ethereum", { configurable: false, value: {
      request: async ({ method }) => {
        window.__rmtPolishWalletCalls.push(method);
        throw new Error("Read-only polish QA forbids wallet requests");
      }, on() {}, removeListener() {},
    } });
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      operations.push(`${request.method()} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (url.protocol.startsWith("http") && !allowedOrigins.includes(url.origin)) {
      operations.push(`EXTERNAL ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  return { operations, pageErrors };
}

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `Horizontal overflow: ${JSON.stringify(dimensions)}`);
  return dimensions;
}

async function captureBefore(browser, engine, layout) {
  const context = await browser.newContext({ ...layout, name: undefined, colorScheme: "dark", reducedMotion: "reduce" });
  const state = await instrument(context, [before.origin]);
  const page = await context.newPage();
  const captures = [];
  for (const [path, name] of [["/", "launches"], ["/create-token", "create"], ["/my-launches", "my-launches"]]) {
    const response = await page.goto(new URL(path, before).href, { waitUntil: "networkidle" });
    assert.equal(response.status(), 200);
    captures.push(await screenshot(page, `before-${engine}-${layout.name}-${name}`));
  }
  assert.deepEqual(await page.evaluate(() => window.__rmtPolishWalletCalls), []);
  assert.deepEqual(state.operations, []);
  reports.push({ phase: "before", engine, layout: layout.name, viewport: layout.viewport, url: before.href, captures, ...state });
  await context.close();
}

const addr = (digit) => `0x${digit.repeat(40)}`;
const hash = (digit) => `0x${digit.repeat(64)}`;
const creation = { blockNumber: "100", blockHash: hash("a"), timestamp: "2026-11-17T20:00:00.000Z", transactionHash: hash("b"), logIndex: 1 };
const checkpoint = { blockNumber: "120", blockHash: hash("c"), timestamp: "2026-11-17T20:20:00.000Z", confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" };
function registration(name, symbol, token, creator) {
  return { kind: "curve-launch-1b-v2", status: "created", chainId: 4663, engineVersion: 1,
    factory: addr("1"), projectRegistry: addr("2"), token: addr(token), initialCurve: addr("3"), creator: addr(creator),
    name, symbol, totalSupplyWei: "1000000000000000000000000000", tokenDecimals: 18, creation, checkpoint };
}
const curveObservation = { at: { blockNumber: "110", blockHash: hash("d"), timestamp: "2026-11-17T20:10:00.000Z" },
  engine: addr("3"), version: 1, soldWei: "150000000000000000000000000", backingWei: "500000000000000000",
  targetSoldWei: "600000000000000000000000000", targetBackingWei: "2000000000000000000" };
const fixtures = [
  { registration: registration("Synthetic Cedar", "QAONE", "4", "5"), state: "created" },
  { registration: registration("Synthetic Harbor", "QATWO", "6", "7"), state: "active", observation: curveObservation },
  { registration: registration("Synthetic Long Name For Narrow Layout Verification", "QAREADY", "8", "9"), state: "graduating",
    observation: { ...curveObservation, soldWei: curveObservation.targetSoldWei, backingWei: curveObservation.targetBackingWei } },
  { registration: registration("Synthetic Orchard", "QAVFOUR", "a", "b"), state: "graduated", observation: {
    receipt: { blockNumber: "111", blockHash: hash("e"), timestamp: "2026-11-17T20:11:00.000Z", transactionHash: hash("f"), logIndex: 3 },
    engine: addr("3"), version: 1, market: { poolManager: addr("c"), positionManager: addr("d"), poolId: hash("1"),
      poolKey: { currency0: addr("0"), currency1: addr("a"), fee: 3000, tickSpacing: 60, hooks: addr("e") },
      positionId: "1", owner: addr("f"), liquidity: "4000000", nativeDepositedWei: "2000000000000000000", tokenDepositedWei: "400000000000000000000000000" } } },
  { registration: registration("Synthetic Unknown", "QAUNK", "d", "e"), state: "unknown" },
];

async function startFixtureHarness() {
  const appRequire = createRequire(join(dependencies, "apps/launch-website/package.json"));
  const tsxRequire = createRequire(appRequire.resolve("tsx/package.json"));
  const { build } = tsxRequire("esbuild");
  const component = join(root, "apps/launch-website/app/_components/new-engine-launches.tsx");
  const provenance = join(root, "apps/launch-website/app/_components/launch-provenance.tsx");
  const validation = join(root, "apps/launch-website/lib/curve-lifecycle.ts");
  const result = await build({ stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { NewEngineLaunches } from ${JSON.stringify(component)};
    import { LaunchProvenance } from ${JSON.stringify(provenance)};
    import { hasCurveRegistration, describeCurveLifecycle } from ${JSON.stringify(validation)};
    const fixtures = ${JSON.stringify(fixtures)};
    for (const launch of fixtures) {
      if (!hasCurveRegistration(launch.registration) || describeCurveLifecycle(launch).stage !== launch.state)
        throw new Error('Synthetic fixture does not satisfy canonical lifecycle shape: ' + launch.registration.name);
    }
    window.__rmtPolishFixtureStages = fixtures.map(describeCurveLifecycle).map(({stage}) => stage);
    function Harness() {
      const [mode, setMode] = useState('ready');
      const directory = mode === 'prelaunch' || mode === 'unavailable' ? {status: mode}
        : {status: 'ready', launches: mode === 'empty' ? [] : fixtures};
      return <div className="rmtVnext rmtTerminal launchpad" data-theme="dark">
        <main className="lpContent">
          <aside style={{border: '2px solid #f3c77e', padding: 12, marginBottom: 16, color: '#f3c77e'}}>
            <strong>SYNTHETIC QA FIXTURES — LOCAL HARNESS ONLY</strong><br/>
            Canonical-shaped browser test data. These are not live projects or metrics. No wallet, signing, transaction or indexer access.
          </aside>
          <nav aria-label="Synthetic fixture states" style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16}}>
            {['ready', 'prelaunch', 'unavailable', 'empty', 'stale', 'detail-created', 'detail-active', 'detail-graduated'].map(value => <button className="lpButton lpSecondary" key={value} onClick={() => setMode(value)}>{value}</button>)}
          </nav>
          {mode === 'stale' && <details className="lpFeedStatus"><summary>Stale creation records</summary><p>Checkpoint 120 · synthetic observation. Current curve activity and Ethereum L1 finality are unverified.</p></details>}
          {mode.startsWith('detail-') ? <LaunchProvenance launch={fixtures[mode === 'detail-created' ? 0 : mode === 'detail-active' ? 1 : 3]}/>
            : <NewEngineLaunches key={mode} directory={directory}/>}
        </main>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, resolveDir: join(root, "apps/launch-website"), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser",
    jsx: "automatic", nodePaths: [join(dependencies, "apps/launch-website/node_modules"), join(dependencies, "node_modules")],
    plugins: [{ name: "read-only-next-link", setup(build) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "qa" }));
      build.onLoad({ filter: /.*/, namespace: "qa" }, () => ({ contents: `import React from 'react'; export default function Link({children, prefetch, ...props}) { return React.createElement('a', props, children); }`, loader: "js", resolveDir: join(dependencies, "apps/launch-website") }));
    } }], define: { "process.env.NODE_ENV": '"production"' } });
  const cssFiles = ["styles/styles.css", "styles/mobile-polish.css", "styles/desktop-polish.css", "styles/launch-theme.css", "styles/token-detail.css", "launchpad.css", "profile-refinement.css", "creator-polish.css"];
  const css = (await Promise.all(cssFiles.map(path => readFile(join(root, "apps/launch-website/app", path), "utf8")))).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic RMT polish QA harness</title><style>${css}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`;
  const server = createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    const js = request.url === "/harness.js";
    response.writeHead(200, { "content-type": js ? "application/javascript" : "text/html", "cache-control": "no-store" });
    response.end(js ? result.outputFiles[0].contents : html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function checkSearchFocus(page) {
  const search = page.getByRole("searchbox", { name: "Search launches" });
  await search.focus();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Search launches"]');
    return input === document.activeElement && parseFloat(getComputedStyle(input.closest(".lpSearch")).outlineWidth) >= 2;
  }, undefined, { timeout: 5_000 });
  const styles = await search.evaluate(input => {
    const inner = getComputedStyle(input), outer = getComputedStyle(input.closest(".lpSearch"));
    return { innerWidth: inner.outlineWidth, outerWidth: outer.outlineWidth, outerStyle: outer.outlineStyle };
  });
  assert.equal(styles.innerWidth, "0px", "The inner input must not draw a separate outline");
  assert.ok(parseFloat(styles.outerWidth) >= 2 && styles.outerStyle !== "none", `Focus must outline the complete search container: ${JSON.stringify(styles)}`);
  return styles;
}

async function checkAfter(browser, engine, layout, harness) {
  const context = await browser.newContext({ ...layout, name: undefined, colorScheme: "dark", reducedMotion: "reduce" });
  const state = await instrument(context, [site.origin, harness.origin]);
  const page = await context.newPage(), captures = [];
  await page.goto(site.href, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Launches", exact: true }).waitFor();
  const navigation = page.getByRole("navigation", { name: "Launchpad navigation", exact: true });
  assert.deepEqual(await navigation.getByRole("link").allTextContents(), ["Launches", "Create", "My Launches"]);
  assert.equal(await navigation.getByRole("link", { name: "Wallet", exact: true }).count(), 0);
  assert.equal(await page.locator(".lpLaunchSteps, .lpOverview").count(), 0);
  assert.equal(await page.locator('a[href="/create-token"]:visible').count(), 1, "Homepage has one prominent Create action");
  const archive = page.locator("details.lpArchive");
  assert.equal(await archive.getAttribute("open"), null);
  const focus = await checkSearchFocus(page);
  captures.push(await screenshot(page, `after-${engine}-${layout.name}-launches-search-focus`));
  await noOverflow(page);

  const trigger = page.getByRole("button", { name: "Connect wallet and profile", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  const walletMenu = page.getByRole("navigation", { name: "Wallet and profile", exact: true });
  await walletMenu.waitFor({ state: "visible" });
  assert.ok(await walletMenu.getByRole("link", { name: /wallet/i }).count());
  assert.ok(await walletMenu.getByRole("link", { name: /profile/i }).count());
  captures.push(await screenshot(page, `after-${engine}-${layout.name}-wallet-menu`));
  await noOverflow(page);
  await page.keyboard.press("Tab");
  // WebKit follows its platform's native link-tabbing setting. ArrowDown below
  // must always reach Wallet; native Tab may move outside and close the menu.
  const keyboard = await page.evaluate(() => {
    const active = document.activeElement, menu = document.querySelector('nav[aria-label="Wallet and profile"]');
    return { nativeTabInsideMenu: Boolean(menu?.contains(active)), nativeTabTarget: active?.getAttribute("aria-label") ?? active?.tagName,
      expandedAfterTab: document.querySelector("button.lpAccountNav").getAttribute("aria-expanded") };
  });
  assert.equal(keyboard.expandedAfterTab, keyboard.nativeTabInsideMenu ? "true" : "false");
  await trigger.press("ArrowDown");
  await page.waitForFunction(() => document.activeElement?.matches('nav[aria-label="Wallet and profile"] a[aria-label="Wallet"]'));
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  await trigger.press("ArrowDown");
  await page.waitForFunction(() => Boolean(document.activeElement?.closest('nav[aria-label="Wallet and profile"]')));
  // The popup can cover the heading's center at 320px; use the main's
  // left padding, which is a genuinely visible outside pointer target.
  await page.locator("#launch-content").click({ position: { x: 2, y: 2 } });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false", "Clicking outside closes the disclosure");
  await trigger.click();
  await page.getByRole("searchbox", { name: "Search launches" }).focus();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false", "Moving focus outside closes the disclosure");
  for (const [label, path, heading, shot] of [["Create", "/create-token", "Create Token", "create"], ["My Launches", "/my-launches", "My Launches", "my-launches"]]) {
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(new URL(path, site).href);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await noOverflow(page);
    captures.push(await screenshot(page, `after-${engine}-${layout.name}-${shot}`));
  }
  assert.deepEqual(await page.evaluate(() => window.__rmtPolishWalletCalls), []);
  await page.goto(`${harness.origin}/`, { waitUntil: "networkidle" });
  await page.getByText("SYNTHETIC QA FIXTURES — LOCAL HARNESS ONLY", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__rmtPolishFixtureStages), ["created", "active", "graduating", "graduated", "unknown"]);
  const cards = page.locator("article.lpLaunchCard");
  assert.equal(await cards.count(), 5);
  assert.equal(await page.locator(".lpDiscoveryCount").getAttribute("role"), "status");
  assert.equal(await page.locator(".lpDiscoveryCount").textContent(), "5 launches");
  assert.equal(await cards.locator("details").count(), 0, "Card provenance belongs on detail pages");
  for (const label of ["Creation confirmed", "Active bonding curve", "Ready to graduate", "Graduated to Uniswap v4", "Lifecycle unverified"]) {
    assert.equal(await cards.getByText(label, { exact: true }).count(), 1);
  }
  assert.doesNotMatch(await cards.allTextContents().then(parts => parts.join("\n")), /market cap|volume|price|APY|liquidity|PoolManager|Pool key|Pool ID|transaction|L1 finality/i);
  assert.match(await cards.first().textContent(), /Synthetic Cedar/);
  assert.match(await cards.first().textContent(), /QAONE/);
  assert.equal(await cards.first().getByText("Observed backing", { exact: true }).count(), 0);
  assert.equal(await cards.nth(4).getByText("Observed backing", { exact: true }).count(), 0);
  assert.equal(await cards.nth(1).getByText("0.5 / 2 ETH", { exact: true }).count(), 1);
  assert.equal(await cards.nth(2).getByText("2 / 2 ETH", { exact: true }).count(), 1);
  assert.equal(await cards.nth(3).getByText("2 ETH", { exact: true }).count(), 1);
  assert.equal(await cards.nth(3).getByText("0.3%", { exact: true }).count(), 1);
  const fixtureFocus = await checkSearchFocus(page);
  captures.push(await screenshot(page, `after-${engine}-${layout.name}-synthetic-cards`));
  await noOverflow(page);
  const search = page.getByRole("searchbox", { name: "Search launches" });
  for (const [query, name] of [["cedar", "Synthetic Cedar"], ["qatwo", "Synthetic Harbor"], [addr("a"), "Synthetic Orchard"], [addr("5"), "Synthetic Cedar"]]) {
    await search.fill(query);
    assert.equal(await cards.count(), 1, `Search supports ${query}`);
    assert.equal(await cards.getByRole("link", { name, exact: true }).count(), 1);
    assert.equal(await page.locator(".lpDiscoveryCount").textContent(), "1 of 5 launches");
  }
  await search.fill("no-such-synthetic-launch");
  assert.equal(await cards.count(), 0);
  await page.getByRole("heading", { name: "No launches match your search", exact: true }).waitFor();
  captures.push(await screenshot(page, `after-${engine}-${layout.name}-synthetic-no-results`));
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await cards.count(), 5);
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  const fixtureStates = page.getByRole("navigation", { name: "Synthetic fixture states" });
  for (const [name, heading] of [["prelaunch", "No new launches yet"], ["unavailable", "Launch feed unavailable"], ["empty", "No verified launches yet"]]) {
    await fixtureStates.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await cards.count(), 0);
    await noOverflow(page);
    captures.push(await screenshot(page, `after-${engine}-${layout.name}-synthetic-${name}`));
  }
  await fixtureStates.getByRole("button", { name: "stale", exact: true }).click();
  await page.getByText("Stale creation records", { exact: true }).waitFor();
  assert.equal(await cards.count(), 5);
  const stale = page.locator("details.lpFeedStatus");
  assert.equal(await stale.getAttribute("open"), null);
  await stale.locator("summary").click();
  assert.match(await stale.textContent(), /Current curve activity and Ethereum L1 finality are unverified/);
  for (const name of ["detail-created", "detail-active", "detail-graduated"]) {
    await fixtureStates.getByRole("button", { name, exact: true }).click();
    const detail = page.getByRole("region", { name: "Verified launch evidence", exact: true });
    await detail.waitFor();
    for (const label of ["Creation receipt", "Creation block / log", "Creation block hash", "Token address", "Indexed checkpoint", "Ethereum L1 finality"]) {
      assert.equal(await detail.getByText(label, { exact: true }).count(), 1);
    }
    if (name === "detail-active") assert.equal(await detail.getByText("Actual ETH backing", { exact: true }).count(), 1);
    if (name === "detail-graduated") {
      for (const label of ["Graduation receipt", "PoolManager", "Pool ID", "Pool currency0", "Pool currency1", "Pool fee / tick spacing", "Pool hook", "Starting funded deposits", "Observed position liquidity"]) {
        assert.equal(await detail.getByText(label, { exact: true }).count(), 1);
      }
      captures.push(await screenshot(page, `after-${engine}-${layout.name}-synthetic-detail-evidence`));
    }
    await noOverflow(page);
  }
  assert.deepEqual(await page.evaluate(() => window.__rmtPolishWalletCalls), []);
  assert.deepEqual(state.operations, [], "No external infrastructure or write operation may be requested");
  assert.deepEqual(state.pageErrors, []);
  reports.push({ phase: "after", engine, layout: layout.name, viewport: layout.viewport, url: site.href,
    fixture: "Isolated local React harness, actual NewEngineLaunches component, canonical-shaped synthetic registrations; no live project claims",
    focus, fixtureFocus, keyboard, captures, ...state, walletCalls: [] });
  await context.close();
}

let harness;
try {
  if (mode !== "before") harness = await startFixtureHarness();
  for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const layout of layouts) {
        if (mode !== "after") await captureBefore(browser, engine, layout);
        if (mode !== "before") await checkAfter(browser, engine, layout, harness);
        console.log(`${engine} ${layout.name}: ${mode} passed`);
      }
    } finally { await browser.close(); }
  }
  await writeFile(join(output, `${mode}-report.json`), JSON.stringify({ status: "passed", mode, candidate, recordedAt: new Date().toISOString(), reports }, null, 2) + "\n");
} catch (error) {
  await writeFile(join(output, `${mode}-failure.json`), JSON.stringify({ status: "failed", mode, candidate,
    recordedAt: new Date().toISOString(), reports, error: String(error.stack ?? error) }, null, 2) + "\n");
  throw error;
} finally {
  if (harness) await new Promise(resolve => harness.server.close(resolve));
}
