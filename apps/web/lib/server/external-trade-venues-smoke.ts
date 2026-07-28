import assert from "node:assert/strict";
import { getAddress } from "viem";
import { discoverExternalTradeVenues } from "./external-trade-venues";

const token = getAddress("0xcC333d246c75C14B087561F39F8c6FEf958CE54f");
const weth = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const sushiPair = getAddress("0x247bC73e70EBDecf6221B1A6E0564580938C5FFE");
const uniPair = getAddress("0x39A200271525E9641e799127bdAB299DAeF21953");
const rejectedPair = getAddress("0x1111111111111111111111111111111111111111");

function pair(pairAddress: string, dexId: string, liquidity: number) {
  return {
    chainId: "robinhood",
    dexId,
    pairAddress,
    baseToken: { address: token },
    quoteToken: { address: weth },
    liquidity: { usd: liquidity }
  };
}

async function main() {
  let requestedUrl = "";
  const venues = await discoverExternalTradeVenues(token, {
    fetch: async (input) => {
      requestedUrl = input.toString();
      return Response.json([
        pair(rejectedPair, "sushiswap-v3", 80_000),
        pair(sushiPair, "sushiswap-v3", 50_000),
        pair(uniPair, "uniswap", 40_000),
        pair(getAddress("0x2222222222222222222222222222222222222222"), "unknown", 90_000)
      ]);
    },
    verifySushi: async ({ pair }) => {
      if (pair === rejectedPair) throw new Error("spoofed");
      return { pair, dexId: "sushiswap-v3", liquidityUsd: 50_000 };
    },
    verifyUniswap: async ({ pair }) => ({ pair, liquidityUsd: 40_000 })
  });

  assert.equal(requestedUrl, `https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`);
  assert.deepEqual(venues.map((venue) => venue.venue), ["sushi", "uniswap"]);
  assert.equal(venues[0]?.pair, sushiPair);
  assert.equal(venues[0]?.verification, "dex-and-route");
  assert.equal(venues[1]?.pair, uniPair);
  assert.equal(venues[1]?.verification, "dex-and-onchain");

  const none = await discoverExternalTradeVenues(token, {
    fetch: async () => Response.json([pair(sushiPair, "sushiswap-v3", 50_000)]),
    verifySushi: async () => { throw new Error("not verified"); }
  });
  assert.deepEqual(none, []);

  await assert.rejects(
    discoverExternalTradeVenues(token, { fetch: async () => Response.json({ pairs: [] }) }),
    /invalid data/
  );
  await assert.rejects(
    discoverExternalTradeVenues(token, { fetch: async () => new Response("down", { status: 503 }) }),
    /discovery is unavailable/
  );

  console.log("External venue discovery exposes only independently verified executable pools.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
