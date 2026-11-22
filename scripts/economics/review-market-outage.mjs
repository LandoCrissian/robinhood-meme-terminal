import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Mount the real polling component with a closed, intercepted network and canonical fork frames.
const app = fileURLToPath(new URL("../../apps/launch-website/", import.meta.url));
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium, webkit, devices } = require("playwright");
const replay = JSON.parse(await readFile(new URL("../../docs/evidence/token-market/market-replay.json", import.meta.url)));
const code = await build({
  stdin: {
    contents: `import { createRoot } from 'react-dom/client';
      import { TokenMarket } from './app/_components/token-market';
      createRoot(document.getElementById('root')).render(<TokenMarket token={${JSON.stringify(replay.token.toLowerCase())}} symbol="ECON" />);`,
    loader: "tsx", resolveDir: app,
  },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: 'var process={env:{NODE_ENV:"production"},platform:"browser",browser:true};' },
});
const selected = process.argv[2];
assert.ok(selected === undefined || ["chromium", "webkit"].includes(selected));
for (const [engine, options] of [[chromium, {}], [webkit, devices["iPhone 13"]]]) {
  if (selected && engine.name() !== selected) continue;
  const browser = await engine.launch();
  try {
    const page = await browser.newPage(options);
    // Headless Chromium on Linux can expose this POSIX locale, which Intl rejects.
    await page.addInitScript(() => Object.defineProperty(navigator, "language", { get: () => "en-US@posix" }));
    const buy = replay.frames.find(f => f.label === "Curve buy 4");
    const sell = replay.frames.find(f => f.label === "Curve sell 4");
    let frame = buy;
    const origin = "http://127.0.0.1:31279";
    const status = page.locator(".rmStatus");
    const progress = page.getByRole("progressbar", { name: "Net curve tokens sold" });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin);
      if (url.pathname === "/")
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
      if (url.pathname === "/bundle.js")
        return route.fulfill({ contentType: "application/javascript", body: code.outputFiles[0].text });
      assert.equal(url.pathname, "/api/launchpad/market/" + replay.token.toLowerCase());
      return frame ? route.fulfill({ json: { ...frame, candles: frame.charts[60], interval: 60, earlier: false } })
        : route.fulfill({ status: 503, json: { status: "unavailable" } });
    });
    // Freeze the browser to the recorded time, then advance its real polling/expiry timers.
    await page.clock.install({ time: new Date(buy.checkpoint.timestamp) });
    await page.goto(origin);
    await status.getByText("Live · confirmed L2").waitFor();
    const peak = Number(await progress.getAttribute("value"));
    frame = null;
    await page.clock.fastForward(16000);
    await status.getByText("Last verified · stale").waitFor();
    assert.equal(Number(await progress.getAttribute("value")), peak);
    await page.reload();
    await status.getByText("Feed unavailable").waitFor();
    assert.equal(await progress.count(), 0);
    frame = sell;
    await page.clock.setSystemTime(new Date(sell.checkpoint.timestamp));
    await page.clock.fastForward(16000);
    await status.getByText("Live · confirmed L2").waitFor();
    assert.ok(Number(await progress.getAttribute("value")) < peak);
    await page.clock.fastForward(125000);
    await status.getByText("Last verified · stale").waitFor();
    console.log(engine.name() + " passed feed loss, elapsed freshness, refresh and canonical sellback recovery");
  } finally {
    await browser.close();
  }
}
