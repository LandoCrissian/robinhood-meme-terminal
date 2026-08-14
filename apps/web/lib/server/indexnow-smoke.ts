import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexNowUrlsFromSitemapXml } from "../../scripts/indexnow-submit";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS,
  RMT_INDEXNOW_KEY,
  RMT_INDEXNOW_KEY_PATH,
  buildIndexNowPayload,
  canonicalIndexNowUrl
} from "./indexnow";

assert.equal(INDEXNOW_ENDPOINT, "https://api.indexnow.org/indexnow");
assert.equal(INDEXNOW_MAX_URLS, 10_000);
assert.equal(canonicalIndexNowUrl("/robinhood-chain#markets"), "https://www.rmtlaunch.fun/robinhood-chain");
assert.equal(canonicalIndexNowUrl("https://www.rmtlaunch.fun/market/0xabc?side=buy#trade"), "https://www.rmtlaunch.fun/market/0xabc");
assert.equal(canonicalIndexNowUrl("https://rmtlaunch.fun/"), null);
assert.equal(canonicalIndexNowUrl("https://example.com/"), null);
assert.equal(canonicalIndexNowUrl("/api/health"), null);
assert.equal(canonicalIndexNowUrl("/portfolio"), null);
assert.equal(canonicalIndexNowUrl("/vnext"), null);

const payload = buildIndexNowPayload([
  "/robinhood-chain",
  "https://www.rmtlaunch.fun/robinhood-chain#overview",
  "/sources"
]);
assert.equal(payload.host, "www.rmtlaunch.fun");
assert.equal(payload.key, RMT_INDEXNOW_KEY);
assert.equal(payload.keyLocation, `https://www.rmtlaunch.fun${RMT_INDEXNOW_KEY_PATH}`);
assert.deepEqual(payload.urlList, [
  "https://www.rmtlaunch.fun/robinhood-chain",
  "https://www.rmtlaunch.fun/sources"
]);

const keyFile = readFileSync(new URL(`../../public/${RMT_INDEXNOW_KEY}.txt`, import.meta.url), "utf8").trim();
assert.equal(keyFile, RMT_INDEXNOW_KEY);
assert.deepEqual(
  indexNowUrlsFromSitemapXml("<urlset><url><loc>https://www.rmtlaunch.fun/</loc></url><url><loc>https://www.rmtlaunch.fun/robinhood-chain?x=1&amp;y=2</loc></url></urlset>"),
  ["https://www.rmtlaunch.fun/", "https://www.rmtlaunch.fun/robinhood-chain?x=1&y=2"]
);
assert.throws(() => indexNowUrlsFromSitemapXml("<urlset></urlset>"), /no <loc> URLs/);

console.info("IndexNow boundary smoke test passed");
