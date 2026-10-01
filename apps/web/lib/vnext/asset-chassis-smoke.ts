import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartComposition } from "./chart-composition";
import { assetPresentationClasses } from "./asset-presentation";
import type { VNextDirectoryMarket } from "./market-directory";
import { ROBINHOOD_USDG_ADDRESS } from "./robinhood-assets";
const ordinary = { address: "0x14C51bB55592372eAC7141A1D0527D1dD7Fbd42F", name: "Stock Stablecoin Project", symbol: "USDG", launchpadEvidence: [] } as unknown as VNextDirectoryMarket;
assert.deepEqual(assetPresentationClasses(ordinary), ["TOKEN"], "Names do not establish stock, stablecoin or project classification");
assert.deepEqual(assetPresentationClasses({ ...ordinary, rwaRelationship: "paired-market-asset" }), ["TOKEN"], "A stock pair does not classify this token as stock or RWA");
assert.deepEqual(assetPresentationClasses({ ...ordinary, rwaRelationship: "canonical-stock-token" }), ["STOCK_TOKEN"]);
assert.deepEqual(assetPresentationClasses({ ...ordinary, address: ROBINHOOD_USDG_ADDRESS }), ["TOKEN", "STABLECOIN"]);
assert.deepEqual(assetPresentationClasses({ ...ordinary, address: "bad" }), []);
const observations = [{ timestamp: 1, open: .12, high: .14, low: .11, close: .13, volume: 200 }, { timestamp: 2, open: .13, high: .17, low: .12, close: .16, volume: 500 }];
const realProviderReplays = JSON.parse(readFileSync(new URL("../server/chart-cold-cache-fixtures.json", import.meta.url), "utf8")) as { candles: typeof observations }[];
for (const [width, height] of [[345,196],[360,196],[400,196],[720,340]]) {
  for (const candles of [observations, ...realProviderReplays.map(replay => replay.candles), [observations[0]], [{ ...observations[0], high: .12, low: .12, close: .12, open: .12 }]]) {
    const plot = chartComposition(candles, width, height);
    assert.ok(plot.minimum <= Math.min(...candles.map(c => c.low)) && plot.maximum >= Math.max(...candles.map(c => c.high)));
    for (const [i,c] of candles.entries()) {
      assert.ok(plot.x(i) > plot.left && plot.x(i) < width - plot.right, "First/last bodies have inside padding");
      for (const value of [c.open,c.high,c.low,c.close]) assert.ok(plot.y(value) >= plot.top && plot.y(value) <= plot.priceBottom, "Every OHLC value is inside the price plot");
    }
    assert.ok(plot.volumeBottom < height && plot.volumeTop > plot.priceBottom);
  }
}
const chart = readFileSync(new URL("../../app/vnext/vnext-market-chart.tsx", import.meta.url), "utf8");
assert.match(chart, /Market data delayed/);
assert.match(chart, /payload\?\.updatedAt/, "Sources retain the observation timestamp");
assert.match(chart, /externalChartRefreshMs\(range\)/, "Existing refresh cadence remains");
assert.doesNotMatch(chart, /eth_send|signTransaction|wallet_send/);
console.log("Asset chassis: evidence taxonomy, screen-space OHLC domain, bounded bars, timestamp and passive refresh protections passed.");
