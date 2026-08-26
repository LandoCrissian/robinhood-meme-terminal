import assert from "node:assert/strict";
import {
  externalChartRefreshMs,
  externalOhlcvRequestUrl,
  isExternalChartRange,
  mergeConfirmedTradesIntoOhlcv,
  parseExternalOhlcvList
} from "../external-ohlcv";

const pair = "0x9870C395bfA68C9F23D7c232fA5a37BF063aae35";
const poolId = `0x${"ab".repeat(32)}`;
const request = externalOhlcvRequestUrl(pair, "24H", "base");
const url = new URL(request.url);

assert.equal(url.origin, "https://api.geckoterminal.com");
assert.equal(url.pathname, `/api/v2/networks/robinhood/pools/${pair}/ohlcv/minute`);
assert.equal(url.searchParams.get("aggregate"), "15");
assert.equal(url.searchParams.get("limit"), "96");
assert.equal(url.searchParams.get("currency"), "usd");
assert.equal(url.searchParams.get("token"), "base");
assert.equal(request.revalidate, 90);
assert.equal(isExternalChartRange("LIVE"), true);
assert.equal(isExternalChartRange("5M"), true);
assert.equal(isExternalChartRange("7D"), true);
assert.equal(isExternalChartRange("30D"), false);
assert.equal(externalChartRefreshMs("LIVE"), 60_000);

const liveRequest = externalOhlcvRequestUrl(pair, "LIVE", "base");
const liveUrl = new URL(liveRequest.url);
assert.equal(liveUrl.pathname, `/api/v2/networks/robinhood/pools/${pair}/ohlcv/minute`);
assert.equal(liveUrl.searchParams.get("aggregate"), "1");
assert.equal(liveUrl.searchParams.get("limit"), "15");
assert.equal(liveRequest.revalidate, 3);

const v4Request = externalOhlcvRequestUrl(poolId, "1H", "quote");
const v4Url = new URL(v4Request.url);
assert.equal(v4Url.pathname, `/api/v2/networks/robinhood/pools/${poolId}/ohlcv/minute`);
assert.equal(v4Url.searchParams.get("token"), "quote");

const candles = parseExternalOhlcvList([
  [200, "2", 2.5, 1.8, 2.2, "100"],
  [100, 1, 1.4, 0.9, 1.2, 50],
  [200, 2, 2.6, 1.7, 2.3, 110],
  ["invalid", 1, 1, 1, 1, 1],
  [300, 1, 0.5, 0.8, 1, 1]
]);

assert.deepEqual(candles, [
  { timestamp: 100, open: 1, high: 1.4, low: 0.9, close: 1.2, volume: 50 },
  { timestamp: 200, open: 2, high: 2.6, low: 1.7, close: 2.3, volume: 110 }
]);

const merged = mergeConfirmedTradesIntoOhlcv([
  { timestamp: 120, open: 1, high: 1.4, low: 0.9, close: 1.2, volume: 50 },
  { timestamp: 180, open: 2, high: 2.6, low: 1.7, close: 2.3, volume: 110 }
], [{
  id: "confirmed-1",
  transactionHash: `0x${"ab".repeat(32)}`,
  trader: "0x1111111111111111111111111111111111111111",
  side: "buy",
  tokenAmount: 10,
  quoteAmount: 0.1,
  priceUsd: 2.45,
  volumeUsd: 24.5,
  timestamp: new Date(185_000).toISOString()
}]);
assert.equal(merged.at(-1)?.close, 2.45);
assert.equal(merged.at(-1)?.high, 2.6);
assert.equal(merged.at(-1)?.low, 1.7);
assert.equal(merged.at(-1)?.volume, 110);
const idempotentMerge = mergeConfirmedTradesIntoOhlcv(merged, [{
  id: "confirmed-1",
  transactionHash: `0x${"ab".repeat(32)}`,
  trader: "0x1111111111111111111111111111111111111111",
  side: "buy",
  tokenAmount: 10,
  quoteAmount: 0.1,
  priceUsd: 2.45,
  volumeUsd: 24.5,
  timestamp: new Date(185_000).toISOString()
}]);
assert.equal(idempotentMerge.at(-1)?.volume, 110, "replayed snapshots must not inflate volume");
assert.throws(() => parseExternalOhlcvList({}), /malformed/);
assert.throws(() => externalOhlcvRequestUrl("not-a-pool", "1H", "base"), /Invalid pool/);

console.log("External OHLCV parsing and fixed-host request construction passed.");
