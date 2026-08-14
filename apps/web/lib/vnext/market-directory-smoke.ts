import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExternalMarketResponse, UniversalMarketResolution } from "../external-market";
import { assetKey } from "./execution-domain";
import { normalizeDirectoryMarkets, resolutionFromLookup, verifiedDirectoryAsset } from "./market-directory";
import { ROBINHOOD_RMT, ROBINHOOD_RMT_ADDRESS } from "./robinhood-assets";

const otherAddress = "0x2222222222222222222222222222222222222222";
const payload = {
  markets: [
    {
      address: ROBINHOOD_RMT_ADDRESS,
      name: "Robinhood Meme Terminal",
      symbol: "RMT",
      priceUsd: 0.004,
      liquidityUsd: 100_000,
      marketCapUsd: 1_000_000,
      volume24h: 20_000,
      priceChange24h: 4.2,
      ageMinutes: 100,
      signal: "moving"
    },
    {
      address: otherAddress,
      name: "Other",
      symbol: "OTH",
      priceUsd: Number.NaN,
      liquidityUsd: -10,
      marketCapUsd: 0,
      volume24h: 0,
      priceChange24h: Number.POSITIVE_INFINITY,
      ageMinutes: null,
      signal: "active"
    },
    { address: otherAddress.toUpperCase(), name: "Duplicate", symbol: "DUP" },
    { address: "not-an-address", name: "Invalid", symbol: "BAD" }
  ]
} as unknown as ExternalMarketResponse;

const markets = normalizeDirectoryMarkets(payload);
assert.equal(markets.length, 2);
assert.equal(markets[1].priceUsd, 0);
assert.equal(markets[1].liquidityUsd, 0);
assert.equal(markets[1].priceChange24h, 0);
assert.equal(assetKey(verifiedDirectoryAsset(markets[0])!.id), assetKey(ROBINHOOD_RMT.id));
assert.equal(verifiedDirectoryAsset(markets[1]), null);

const resolution: UniversalMarketResolution = {
  chainId: 4_663,
  requestedAddress: otherAddress,
  requestedKind: "token",
  status: "token-only",
  token: { address: otherAddress, name: "Other Token", symbol: "OTH", decimals: 18, totalSupply: "1" },
  pools: [],
  marketData: "identity-only",
  execution: "route-check-required",
  provenance: "robinhood-chain-contract-reads",
  resolvedAt: new Date(0).toISOString()
};
const verified = verifiedDirectoryAsset(markets[1], resolution);
assert.equal(verified?.metadataState, "verified");
assert.equal(verified?.decimals, 18);
assert.equal(resolutionFromLookup({ resolution }, otherAddress), resolution);
assert.equal(verifiedDirectoryAsset(markets[1], { ...resolution, chainId: 4_663, token: { ...resolution.token, address: ROBINHOOD_RMT_ADDRESS } }), null);

const hook = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/vnext/market-directory/route.ts", import.meta.url), "utf8");
const identityRoute = readFileSync(new URL("../../app/api/vnext/asset-identity/route.ts", import.meta.url), "utf8");
assert.match(hook, /fetch\("\/api\/vnext\/market-directory"/);
assert.match(hook, /fetch\("\/api\/markets\/external"/);
assert.match(hook, /URLSearchParams\(\{ contract: address \}\)/);
assert.match(hook, /publishMarkets/);
assert.match(hook, /URLSearchParams\(\{ address: selected\.address \}\)/);
assert.match(hook, /fetch\(`\/api\/vnext\/asset-identity/);
assert.match(hook, /setIdentityStatus\("checking"\)/);
assert.match(hook, /directorySnapshot/);
assert.match(hook, /identityCache/);
assert.match(hook, /nextSnapshot !== marketSnapshot\.current/);
assert.doesNotMatch(hook, /external-availability|external-sushi-quote|external-uniswap/);
assert.equal((hook.match(/setInterval/g) ?? []).length, 2);
assert.match(route, /token-pairs\/v1/);
assert.match(route, /Promise\.all\(DIRECTORY_TOKENS/);
assert.match(route, /address\.toLowerCase\(\) === zeroAddress/);
assert.match(route, /stale-while-revalidate=60/);
assert.doesNotMatch(route, /resolveRmtOrigins|external-availability|external-sushi-quote|external-uniswap|router|reactor/);
assert.match(identityRoute, /readRobinhoodTokenIdentity/);
assert.doesNotMatch(identityRoute, /discoverPools|fetchRobinhoodStockRegistry|external-availability|quote/);

console.log("RMT VNext market directory smoke checks passed.");
