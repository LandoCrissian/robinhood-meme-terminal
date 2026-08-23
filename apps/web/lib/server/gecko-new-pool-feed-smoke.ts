import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import {
  GECKO_POOL_FEEDS,
  fetchGeckoPoolSnapshot,
  geckoPoolFeedUrl,
  parseGeckoPoolPairs
} from "./gecko-new-pool-feed";

const base = "0x1111111111111111111111111111111111111111";
const quote = "0x2222222222222222222222222222222222222222";
const pair = "0x3333333333333333333333333333333333333333";
const payload = {
  data: [{
    id: `robinhood_${pair}`,
    type: "pool",
    attributes: {
      address: pair,
      base_token_price_usd: "0.00012",
      pool_created_at: "2026-08-03T15:49:16Z",
      fdv_usd: "12000",
      market_cap_usd: null,
      price_change_percentage: { m5: "12.5", h1: "18" },
      transactions: { m5: { buys: 9, sells: 2 }, h1: { buys: 20, sells: 8 } },
      volume_usd: { m5: "740", h1: "2200", h24: "2200" },
      reserve_in_usd: "9493"
    },
    relationships: {
      base_token: { data: { id: `robinhood_${base}`, type: "token" } },
      quote_token: { data: { id: `robinhood_${quote}`, type: "token" } },
      dex: { data: { id: "uniswap-v3-robinhood", type: "dex" } }
    }
  }],
  included: [
    { id: `robinhood_${base}`, type: "token", attributes: { address: base, name: "Fresh Runner", symbol: "FRESH", image_url: "https://coin-images.coingecko.com/coins/images/1/small/fresh.png" } },
    { id: `robinhood_${quote}`, type: "token", attributes: { address: quote, name: "Wrapped Ether", symbol: "WETH", image_url: null } },
    { id: "uniswap-v3-robinhood", type: "dex", attributes: { name: "Uniswap V3" } }
  ]
};

const parsed = parseGeckoPoolPairs(payload, "new");
assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.baseToken.address.toLowerCase(), base);
assert.equal(parsed[0]?.pairAddress, pair);
assert.equal(parsed[0]?.dexId, "uniswap-v3-robinhood");
assert.equal(parsed[0]?.txns.m5?.buys, 9);
assert.equal(parsed[0]?.liquidity.usd, 9493);
assert.equal(parsed[0]?.pairCreatedAt, Date.parse("2026-08-03T15:49:16Z"));
assert.match(parsed[0]?.info?.imageUrl ?? "", /coin-images\.coingecko\.com/);
assert.deepEqual(parsed[0]?.discoveryFeeds, ["new"]);
assert.deepEqual(parseGeckoPoolPairs({ malformed: true }, "new"), []);

const missingMetrics = {
  ...payload,
  data: [{
    ...payload.data[0]!,
    attributes: {
      ...payload.data[0]!.attributes,
      base_token_price_usd: null,
      market_cap_usd: null,
      volume_usd: { m5: null, h1: null, h24: null },
      reserve_in_usd: null
    }
  }]
};
const withoutMetrics = parseGeckoPoolPairs(missingMetrics, "top")[0];
assert.equal(withoutMetrics?.priceUsd, null);
assert.equal(withoutMetrics?.volume.h1, null);
assert.equal(withoutMetrics?.liquidity.usd, null);

const nativeV4Payload = {
  ...payload,
  data: [{
    ...payload.data[0]!,
    attributes: {
      ...payload.data[0]!.attributes,
      base_token_price_usd: "3200",
      quote_token_price_usd: "0.00012"
    },
    relationships: {
      ...payload.data[0]!.relationships,
      base_token: { data: { id: `robinhood_${zeroAddress}`, type: "token" } },
      quote_token: { data: { id: `robinhood_${base}`, type: "token" } }
    }
  }],
  included: [
    { id: `robinhood_${zeroAddress}`, type: "token", attributes: { address: zeroAddress, name: "Ether", symbol: "ETH", image_url: null } },
    payload.included[0]!,
    payload.included[2]!
  ]
};
const nativeV4 = parseGeckoPoolPairs(nativeV4Payload, "trending-1h")[0];
assert.equal(nativeV4?.baseToken.address.toLowerCase(), base);
assert.equal(nativeV4?.quoteToken.address.toLowerCase(), zeroAddress);
assert.equal(nativeV4?.priceUsd, 0.00012);

const expectedRequests = GECKO_POOL_FEEDS.reduce((total, feed) => total + feed.pages.length, 0);
assert.equal(expectedRequests, 11, "The broad provider fan-in must remain explicitly bounded");
for (const feed of GECKO_POOL_FEEDS) {
  for (const page of feed.pages) {
    const url = geckoPoolFeedUrl(feed, page);
    assert.equal(url.searchParams.get("include"), "base_token,quote_token,dex");
    assert.equal(url.searchParams.get("page"), String(page));
    assert.equal(url.searchParams.get("duration"), feed.duration ?? null);
  }
}

async function main() {
  const requested: string[] = [];
  const snapshot = await fetchGeckoPoolSnapshot({
    fetch: async (input) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.pathname.endsWith("/trending_pools") && url.searchParams.get("duration") === "5m") {
        return new Response("delayed", { status: 503 });
      }
      return Response.json(payload);
    }
  });
  assert.equal(requested.length, expectedRequests);
  assert.equal(requested.filter((url) => url.includes("/new_pools?")).length, 2);
  assert.equal(requested.filter((url) => url.includes("/pools?") && !url.includes("trending_pools")).length, 3);
  assert.equal(requested.filter((url) => url.includes("duration=5m")).length, 1);
  assert.equal(requested.filter((url) => url.includes("duration=1h")).length, 3);
  assert.equal(requested.filter((url) => url.includes("duration=24h")).length, 2);
  assert.equal(snapshot.delayed, true);
  assert.deepEqual(snapshot.delayedFeeds, ["trending-5m"]);
  assert.equal(snapshot.pairs.length, 1, "Duplicate chain + pool observations must collapse deterministically");
  assert.deepEqual(snapshot.pairs[0]?.discoveryFeeds, ["new", "top", "trending-1h", "trending-24h"]);

  const allDelayed = await fetchGeckoPoolSnapshot({
    fetch: async () => new Response("delayed", { status: 503 })
  });
  assert.equal(allDelayed.delayed, true);
  assert.deepEqual(allDelayed.pairs, []);
  assert.deepEqual(new Set(allDelayed.delayedFeeds), new Set(GECKO_POOL_FEEDS.map((feed) => feed.id)));
  console.info("GeckoTerminal broad pool feed smoke passed");
}

void main();
