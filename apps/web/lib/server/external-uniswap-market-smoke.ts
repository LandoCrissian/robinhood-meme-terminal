import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { ROBINHOOD_V3_FACTORY, ROBINHOOD_WETH } from "../uniswap-v4";
import { verifyExternalUniswapMarket } from "./external-uniswap-market";

const token = getAddress("0x232CDFc415D10b673845D83Dc02ba2eaBe7e30d1");
const pair = getAddress("0x39A200271525E9641e799127bdAB299DAeF21953");
const other = getAddress("0x1111111111111111111111111111111111111111");

function market(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    url: `https://dexscreener.com/robinhood/${pair}`,
    pairAddress: pair,
    baseToken: { address: token },
    quoteToken: { address: ROBINHOOD_WETH },
    liquidity: { usd: 25_000 },
    ...overrides
  };
}

function pool(overrides: Partial<{
  factory: Address;
  token0: Address;
  token1: Address;
  fee: number;
  sqrtPriceX96: bigint;
  canonicalPair: Address;
  code: `0x${string}` | undefined;
}> = {}) {
  return {
    factory: overrides.factory ?? ROBINHOOD_V3_FACTORY,
    token0: overrides.token0 ?? ROBINHOOD_WETH,
    token1: overrides.token1 ?? token,
    fee: overrides.fee ?? 10_000,
    sqrtPriceX96: overrides.sqrtPriceX96 ?? (1n << 96n),
    canonicalPair: overrides.canonicalPair ?? pair,
    code: overrides.code ?? "0x6000" as `0x${string}`
  };
}

async function verify(
  payload: unknown,
  poolOverrides: Parameters<typeof pool>[0] = {}
) {
  return verifyExternalUniswapMarket(
    { token, pair },
    {
      fetch: async () => Response.json(payload),
      readPool: async () => pool(poolOverrides)
    }
  );
}

async function main() {
  let requestedUrl = "";
  const verified = await verifyExternalUniswapMarket(
    { token, pair },
    {
      fetch: async (input) => {
        requestedUrl = input.toString();
        return Response.json([market()]);
      },
      readPool: async () => pool()
    }
  );
  assert.equal(requestedUrl, `https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`);
  assert.equal(verified.token, token);
  assert.equal(verified.pair, pair);
  assert.equal(verified.fee, 10_000);
  assert.equal(verified.token0, ROBINHOOD_WETH);
  assert.equal(verified.token1, token);
  assert.equal(verified.sqrtPriceX96, 1n << 96n);
  assert.equal(verified.liquidityUsd, 25_000);

  await assert.rejects(verify([market({ pairAddress: other })]), /no longer verified/);
  await assert.rejects(verify([market({ chainId: "arbitrum" })]), /no longer eligible/);
  await assert.rejects(verify([market({ dexId: "sushiswap-v3" })]), /no longer eligible/);
  await assert.rejects(verify([market({ url: "https://example.com/pool" })]), /no longer eligible/);
  await assert.rejects(verify([market({
    baseToken: { address: ROBINHOOD_WETH },
    quoteToken: { address: other }
  })]), /no longer eligible/);
  await assert.rejects(verify([market({ liquidity: { usd: 999 } })]), /no longer eligible/);
  await assert.rejects(verify({ pairs: [market()] }), /invalid data/);
  await assert.rejects(verify([market()], { factory: other }), /not a verified canonical/);
  await assert.rejects(verify([market()], { canonicalPair: other }), /not a verified canonical/);
  await assert.rejects(verify([market()], { token0: other }), /not a verified canonical/);
  await assert.rejects(verify([market()], { token1: other }), /not a verified canonical/);
  await assert.rejects(verify([market()], { fee: 0 }), /not a verified canonical/);
  await assert.rejects(verify([market()], { sqrtPriceX96: 0n }), /not a verified canonical/);
  await assert.rejects(verify([market()], { code: "0x" }), /not a verified canonical/);

  console.log("External Uniswap pool verification fails closed against spoofed DEX and onchain data.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
