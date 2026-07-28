import assert from "node:assert/strict";
import {
  externalOhlcvRequestUrl,
  isExternalChartRange,
  parseExternalOhlcvList
} from "../external-ohlcv";

const pair = "0x9870C395bfA68C9F23D7c232fA5a37BF063aae35";
const request = externalOhlcvRequestUrl(pair, "24H", "base");
const url = new URL(request.url);

assert.equal(url.origin, "https://api.geckoterminal.com");
assert.equal(url.pathname, `/api/v2/networks/robinhood/pools/${pair}/ohlcv/minute`);
assert.equal(url.searchParams.get("aggregate"), "15");
assert.equal(url.searchParams.get("limit"), "96");
assert.equal(url.searchParams.get("currency"), "usd");
assert.equal(url.searchParams.get("token"), "base");
assert.equal(request.revalidate, 90);
assert.equal(isExternalChartRange("7D"), true);
assert.equal(isExternalChartRange("30D"), false);

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
assert.throws(() => parseExternalOhlcvList({}), /malformed/);
assert.throws(() => externalOhlcvRequestUrl("not-an-address", "1H", "base"), /Invalid pool/);

console.log("External OHLCV parsing and fixed-host request construction passed.");
