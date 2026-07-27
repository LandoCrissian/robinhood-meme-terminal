import assert from "node:assert/strict";
import { getAddress } from "viem";
import { verifyExternalSushiMarket } from "./external-sushi-market";

const token = getAddress("0xcC333d246c75C14B087561F39F8c6FEf958CE54f");
const pair = getAddress("0x247bC73e70EBDecf6221B1A6E0564580938C5FFE");
const weth = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");

function market(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "robinhood",
    dexId: "sushiswap-v3",
    url: `https://dexscreener.com/robinhood/${pair}`,
    pairAddress: pair,
    baseToken: { address: token, name: "Lemon Cat", symbol: "LEMONCAT" },
    quoteToken: { address: weth, name: "Wrapped Ether", symbol: "WETH" },
    liquidity: { usd: 25_000 },
    ...overrides
  };
}

async function verify(payload: unknown) {
  return verifyExternalSushiMarket(
    { token, pair },
    { fetch: async () => Response.json(payload) }
  );
}

async function main() {
  let requestedUrl = "";
  const verified = await verifyExternalSushiMarket(
    { token, pair },
    {
      fetch: async (input) => {
        requestedUrl = input.toString();
        return Response.json([market()]);
      }
    }
  );
  assert.equal(requestedUrl, `https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`);
  assert.equal(verified.token, token);
  assert.equal(verified.pair, pair);
  assert.equal(verified.dexId, "sushiswap-v3");
  assert.equal(verified.liquidityUsd, 25_000);

  await assert.rejects(verify([market({ pairAddress: weth })]), /no longer verified/);
  await assert.rejects(verify([market({ chainId: "arbitrum" })]), /no longer eligible/);
  await assert.rejects(verify([market({ dexId: "uniswap" })]), /no longer eligible/);
  await assert.rejects(verify([market({ url: "https://example.com/pool" })]), /no longer eligible/);
  await assert.rejects(verify([market({
    baseToken: { address: weth },
    quoteToken: { address: "0x1111111111111111111111111111111111111111" }
  })]), /no longer eligible/);
  await assert.rejects(verify([market({ liquidity: { usd: 999 } })]), /no longer eligible/);
  await assert.rejects(verify({ pairs: [market()] }), /invalid data/);
  await assert.rejects(
    verifyExternalSushiMarket(
      { token, pair },
      { fetch: async () => new Response("unavailable", { status: 503 }) }
    ),
    /verification is unavailable/
  );

  console.log("External Sushi pool verification fails closed against spoofed market data.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
