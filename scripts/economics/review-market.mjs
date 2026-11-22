import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
const require = createRequire(
  new URL("../../apps/launch-website/package.json", import.meta.url),
);
const { chromium, webkit, devices } = require("playwright");
const [origin, output] = process.argv.slice(2);
assert.ok(
  /^https:\/\/[a-f0-9]{24}--eclectic-valkyrie-16cb92\.netlify\.app$/.test(
    origin,
  ) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
);
const replay = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/evidence/token-market/market-replay.json",
      import.meta.url,
    ),
  ),
);
const folder = resolve(output);
mkdirSync(folder, { recursive: true });
const results = [];
for (const [engine, options, label] of [
  [chromium, { viewport: { width: 1440, height: 1000 } }, "desktop"],
  [
    webkit,
    {
      ...devices["iPhone 13"],
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    },
    "mobile",
  ],
]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext(options),
      page = await context.newPage(),
      errors = [],
      calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() === "POST") calls.push(new URL(r.url()).pathname);
    });
    const response = await page.goto(origin + "/review/trading", {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response.status(), 200);
    const progress = page.getByRole("progressbar", {
        name: "Net curve tokens sold",
      }),
      selector = page.getByLabel("Isolated fork replay");
    await progress.waitFor();
    assert.equal(await progress.getAttribute("value"), "100");
    await page.locator(".rmCanvas canvas").first().waitFor();
    await page.getByText("Graduated to Uniswap v4", { exact: true }).waitFor();
    await page.getByRole("button", { name: "FDV", exact: true }).click();
    await page
      .getByText("Fully diluted valuation · ETH · 1B fixed supply", {
        exact: true,
      })
      .waitFor();
    await page.getByRole("button", { name: "5m", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "5m", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    await page.getByLabel("Quote amount").selectOption("5000000");
    await page.getByText("Contract quote at this recorded block").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Sell unavailable" }).isDisabled(),
      true,
    );
    await selector.selectOption({ label: "Opening" });
    await page.getByText("No trades in this window").waitFor();
    assert.equal(await progress.getAttribute("value"), "0");
    await selector.selectOption({ label: "Curve buy 4" });
    const bought = Number(await progress.getAttribute("value"));
    await selector.selectOption({ label: "Curve sell 4" });
    await page.waitForFunction(
      (n) => Number(document.querySelector("progress")?.value) < n,
      bought,
    );
    await selector.selectOption({
      label: "Alternate fork · graduation pending",
    });
    await page.getByText("Graduation pending", { exact: true }).waitFor();
    await selector.selectOption({ label: "Atomic graduation" });
    await page.getByText("Graduated to Uniswap v4", { exact: true }).waitFor();
    await selector.selectOption({ label: replay.frames.at(-1).label });
    await page.getByRole("button", { name: "Price", exact: true }).click();
    await page.getByRole("button", { name: "1m", exact: true }).click();
    await page.getByRole("button", { name: "Buy", exact: true }).click();
    const canvas = page.locator(".rmCanvas");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
    await page.mouse.wheel(0, -40);
    if (label === "mobile")
      await page.touchscreen.tap(
        box.x + box.width * 0.5,
        box.y + box.height * 0.5,
      );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .locator(".rmWorkspace")
      .screenshot({
        path: join(folder, label + ".png"),
        animations: "disabled",
      });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Recorded checkpoint", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(calls, []);
    results.push({
      browser: engine.name(),
      width: options.viewport.width,
      priceAndFdv: true,
      sellback: true,
      pendingAndGraduated: true,
      quotes: true,
      reload: true,
      overflow: false,
      walletRequests: 0,
    });
  } finally {
    await browser.close();
  }
}
writeFileSync(
  join(folder, "results.json"),
  JSON.stringify({ origin, at: new Date(), results }, null, 2),
);
console.log(JSON.stringify(results));
