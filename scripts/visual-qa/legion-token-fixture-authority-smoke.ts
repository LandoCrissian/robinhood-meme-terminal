import assert from "node:assert/strict";
import { RMT_CURATED_MARKET_REGISTRY } from "../../apps/web/lib/vnext/curated-market-registry";
import { TOKEN_MARKETS } from "./legion-fixtures.mjs";

const CANONICAL_FIELDS = [
  "chainId",
  "token",
  "sourceId",
  "protocol",
  "version",
  "poolKey",
  "poolAddress",
  "token0",
  "token1",
  "fee",
  "tickSpacing",
  "hooks",
  "transactionHash",
  "blockNumber",
  "blockHash",
] as const;

function normalized(value: unknown) {
  return typeof value === "string" && value.startsWith("0x") ? value.toLowerCase() : value;
}

function sorted(values: Iterable<string>) {
  return [...values].map((value) => value.toLowerCase()).sort();
}

assert.equal(RMT_CURATED_MARKET_REGISTRY.length, 8, "Production curated registry must contain exactly eight entries");
assert.equal(TOKEN_MARKETS.length, 8, "Legion Token fixture must contain exactly eight entries");

const fixtureByToken = new Map(TOKEN_MARKETS.map((market) => [market.address.toLowerCase(), market]));
assert.equal(fixtureByToken.size, TOKEN_MARKETS.length, "Legion Token fixture contains a duplicate token contract");

for (const production of RMT_CURATED_MARKET_REGISTRY) {
  const token = production.token.toLowerCase();
  const fixture = fixtureByToken.get(token);
  assert.ok(fixture, `Legion Token fixture is missing production token ${production.token}`);
  assert.equal(fixture.canonicalMarkets.length, 1, `Legion Token fixture ${production.token} must expose exactly one canonical market`);
  const canonical = fixture.canonicalMarkets[0];
  const actual = {
    chainId: fixture.primaryMarket.chainId,
    token: fixture.address,
    sourceId: canonical.sourceId,
    protocol: canonical.protocol,
    version: canonical.version,
    poolKey: canonical.poolKey,
    poolAddress: canonical.poolAddress,
    token0: canonical.token0,
    token1: canonical.token1,
    fee: canonical.fee,
    tickSpacing: canonical.tickSpacing,
    hooks: canonical.hooks,
    transactionHash: canonical.transactionHash,
    blockNumber: canonical.blockNumber,
    blockHash: canonical.blockHash,
  };
  const expected = { chainId: production.chainId, token: production.token, ...production.market };

  for (const field of CANONICAL_FIELDS) {
    assert.deepEqual(
      normalized(actual[field]),
      normalized(expected[field]),
      `Legion Token fixture ${production.token} canonical field mismatch: ${field}`,
    );
  }
}

assert.deepEqual(
  sorted(fixtureByToken.keys()),
  sorted(RMT_CURATED_MARKET_REGISTRY.map((entry) => entry.token)),
  "Legion and production token-contract sets differ",
);
assert.deepEqual(
  sorted(TOKEN_MARKETS.map((market) => market.canonicalMarkets[0].poolKey)),
  sorted(RMT_CURATED_MARKET_REGISTRY.map((entry) => entry.market.poolKey)),
  "Legion and production canonical pool/PoolId sets differ",
);

console.log(`TOKEN_FIXTURE_AUTHORITY: PASS (${TOKEN_MARKETS.length} markets; ${CANONICAL_FIELDS.length} fields each)`);
