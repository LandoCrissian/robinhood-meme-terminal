import assert from "node:assert/strict";
import { fetchGeckoNewPoolSnapshot, parseGeckoNewPoolPairs } from "./gecko-new-pool-feed";

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

const parsed = parseGeckoNewPoolPairs(payload);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.baseToken.address, base);
assert.equal(parsed[0]?.pairAddress, pair);
assert.equal(parsed[0]?.dexId, "uniswap-v3-robinhood");
assert.equal(parsed[0]?.txns.m5?.buys, 9);
assert.equal(parsed[0]?.liquidity.usd, 9493);
assert.equal(parsed[0]?.pairCreatedAt, Date.parse("2026-08-03T15:49:16Z"));
assert.match(parsed[0]?.info?.imageUrl ?? "", /coin-images\.coingecko\.com/);
assert.deepEqual(parseGeckoNewPoolPairs({ malformed: true }), []);

async function main() {
  let requested = "";
  const snapshot = await fetchGeckoNewPoolSnapshot({
    fetch: async (input) => {
      requested = String(input);
      return Response.json(payload);
    }
  });
  assert.match(requested, /\/networks\/robinhood\/new_pools/);
  assert.equal(snapshot.delayed, false);
  assert.equal(snapshot.pairs.length, 1);

  const validEmpty = await fetchGeckoNewPoolSnapshot({
    fetch: async () => Response.json({ data: [], included: [] })
  });
  assert.equal(validEmpty.delayed, false, "A valid response with no address-based pools is not an outage");
  assert.deepEqual(validEmpty.pairs, []);

  const malformed = await fetchGeckoNewPoolSnapshot({
    fetch: async () => Response.json({ malformed: true })
  });
  assert.equal(malformed.delayed, true);

  const delayed = await fetchGeckoNewPoolSnapshot({
    fetch: async () => new Response("delayed", { status: 503 })
  });
  assert.equal(delayed.delayed, true);
  assert.deepEqual(delayed.pairs, []);
  console.info("GeckoTerminal new-pool feed smoke passed");
}

void main();
