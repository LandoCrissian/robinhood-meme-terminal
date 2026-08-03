import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import type { UniversalMarketPool } from "../external-market";
import {
  marketFromUniversalResolution,
  resolveUniversalMarketAddress
} from "./universal-market-resolver";
import type { RobinhoodStockRegistrySnapshot } from "./robinhood-stock-token-registry";

const token = getAddress("0xcC333d246c75C14B087561F39F8c6FEf958CE54f");
const pool = getAddress("0x39A200271525E9641e799127bdAB299DAeF21953");
const weth = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const identity = {
  address: token,
  name: "Resolver Token",
  symbol: "RSLV",
  decimals: 18,
  totalSupply: "1000000000000000000000000"
};
const canonicalPool: UniversalMarketPool = {
  venue: "uniswap-v3",
  protocolVersion: 3,
  poolAddress: pool,
  token0: token,
  token1: weth,
  quoteToken: weth,
  fee: 3_000,
  canonical: true,
  execution: "route-check-required"
};
const registry: RobinhoodStockRegistrySnapshot = {
  coverage: "complete",
  assetsByAddress: new Map()
};

async function main() {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const resolved = await resolveUniversalMarketAddress(token, registry, {
    readToken: async (address) => address.toLowerCase() === token.toLowerCase() ? identity : null,
    readPool: async () => null,
    discoverPools: async () => [canonicalPool],
    now: () => now
  });
  assert.equal(resolved?.status, "pool-found");
  assert.equal(resolved?.requestedKind, "token");
  assert.equal(resolved?.execution, "route-check-required");
  assert.equal(resolved?.resolvedAt, now.toISOString());
  const market = marketFromUniversalResolution(resolved!, registry);
  assert.equal(market?.address, token);
  assert.equal(market?.pairAddress, pool);
  assert.equal(market?.resolution?.marketData, "identity-only");
  assert.equal(market?.liquidityUsd, 0);

  const fromPool = await resolveUniversalMarketAddress(pool, registry, {
    readToken: async (address: Address) => address.toLowerCase() === token.toLowerCase() ? identity : null,
    readPool: async (address) => address.toLowerCase() === pool.toLowerCase() ? canonicalPool : null,
    discoverPools: async () => [],
    now: () => now
  });
  assert.equal(fromPool?.requestedKind, "pool");
  assert.equal(fromPool?.token.address, token);
  assert.equal(fromPool?.pools[0]?.canonical, true);

  const tokenOnly = await resolveUniversalMarketAddress(token, registry, {
    readToken: async () => identity,
    readPool: async () => null,
    discoverPools: async () => []
  });
  assert.equal(tokenOnly?.status, "token-only");
  assert.equal(tokenOnly?.execution, "view-only");
  assert.equal(marketFromUniversalResolution(tokenOnly!, registry), null);

  assert.equal(await resolveUniversalMarketAddress("not-an-address", registry), null);
  assert.equal(await resolveUniversalMarketAddress(getAddress("0x1111111111111111111111111111111111111111"), registry, {
    readToken: async () => null,
    readPool: async () => null,
    discoverPools: async () => []
  }), null);

  console.log("Universal Market Resolver distinguishes canonical pools, token-only contracts, pool inputs, and invalid addresses.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
