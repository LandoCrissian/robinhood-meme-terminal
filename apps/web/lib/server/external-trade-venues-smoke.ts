import assert from "node:assert/strict";
import { getAddress, zeroAddress } from "viem";
import { discoverExternalTradeVenues } from "./external-trade-venues";

const token = getAddress("0xcC333d246c75C14B087561F39F8c6FEf958CE54f");
const weth = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const sushiPair = getAddress("0x247bC73e70EBDecf6221B1A6E0564580938C5FFE");
const uniPair = getAddress("0x39A200271525E9641e799127bdAB299DAeF21953");
const rejectedPair = getAddress("0x1111111111111111111111111111111111111111");
const uniV4Pool = "0xe3fcfc2539add7e0eb6788d033c77a9cb1a677d567267888726c54371e43f67d";
const unsupportedV4Pool = "0x662bbbae2d918568073a03e840679961b9379f72f7c6e44657e0da3e6391399b";

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
        pair(unsupportedV4Pool, "uniswap", 70_000),
        pair(uniV4Pool, "uniswap", 60_000),
        pair(sushiPair, "sushiswap-v3", 50_000),
        pair(uniPair, "uniswap", 40_000),
        pair(getAddress("0x2222222222222222222222222222222222222222"), "unknown", 90_000)
      ]);
    },
    verifySushi: async ({ pair }) => {
      if (pair === rejectedPair) throw new Error("spoofed");
      return { pair, dexId: "sushiswap-v3", liquidityUsd: 50_000 };
    },
    verifyUniswap: async ({ pair }) => ({ pair, liquidityUsd: 40_000 }),
    verifyUniswapV4: async ({ poolId }) => ({
      poolId,
      liquidityUsd: poolId === unsupportedV4Pool ? 70_000 : 60_000,
      poolKey: poolId === unsupportedV4Pool
        ? { currency0: token, currency1: weth }
        : { currency0: zeroAddress, currency1: token }
    }),
    resolveOnchain: async () => []
  });

  assert.equal(requestedUrl, `https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`);
  assert.deepEqual(venues.map((venue) => venue.venue), ["uniswap-v4", "sushi", "uniswap-v3"]);
  assert.equal(venues[0]?.pair, uniV4Pool);
  assert.equal(venues[0]?.verification, "dex-and-onchain");
  assert.equal(venues[1]?.pair, sushiPair);
  assert.equal(venues[1]?.verification, "dex-and-route");
  assert.equal(venues[2]?.pair, uniPair);
  assert.equal(venues[2]?.verification, "dex-and-onchain");

  const none = await discoverExternalTradeVenues(token, {
    fetch: async () => Response.json([pair(sushiPair, "sushiswap-v3", 50_000)]),
    verifySushi: async () => { throw new Error("not verified"); },
    resolveOnchain: async () => []
  });
  assert.deepEqual(none, []);

  const recovered = await discoverExternalTradeVenues(token, {
    fetch: async () => new Response("down", { status: 503 }),
    resolveOnchain: async () => [{
      venue: "uniswap-v3",
      protocolVersion: 3,
      poolAddress: uniPair,
      token0: token,
      token1: weth,
      quoteToken: weth,
      fee: 3_000,
      canonical: true,
      execution: "route-check-required"
    }]
  });
  assert.equal(recovered[0]?.venue, "uniswap-v3");
  assert.equal(recovered[0]?.verification, "onchain-route");
  assert.equal(recovered[0]?.liquidityUsd, 0);

  const malformed = await discoverExternalTradeVenues(token, {
    fetch: async () => Response.json({ pairs: [] }),
    resolveOnchain: async () => []
  });
  assert.deepEqual(malformed, []);

  console.log("External venue discovery recovers canonical onchain routes when provider discovery is unavailable.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
