import assert from "node:assert/strict";
import {
  parseRobinhoodStockAssets,
  stockAssetRelationshipsForPair,
  stockAssetRelationshipsForToken,
  stockTokenExecutionPolicyFromSnapshot
} from "./robinhood-stock-token-registry";

const stockToken = "0x1111111111111111111111111111111111111111";
const launchToken = "0x2222222222222222222222222222222222222222";
const anotherStockToken = "0x3333333333333333333333333333333333333333";

const registry = parseRobinhoodStockAssets({
  assets: [
    {
      id: "0xasset-aapl",
      tokenSymbol: "AAPL",
      tokenName: "Apple · Robinhood Token",
      deployments: [{ contractAddress: stockToken, chainId: 4663 }],
      currentMultiplier: "1.000000000000000000",
      status: "ASSET_STATUS_ACTIVE",
      logoUrl: "https://cdn.robinhood.com/aapl.png"
    },
    {
      id: "0xasset-msft",
      tokenSymbol: "MSFT",
      tokenName: "Microsoft · Robinhood Token",
      deployments: [{ contractAddress: anotherStockToken, chainId: 4663 }],
      currentMultiplier: "1.020000000000000000",
      status: "ASSET_STATUS_INACTIVE"
    },
    {
      id: "0xwrong-chain",
      tokenSymbol: "NVDA",
      tokenName: "NVIDIA · Robinhood Token",
      deployments: [{ contractAddress: launchToken, chainId: 42161 }],
      currentMultiplier: "1.000000000000000000",
      status: "ASSET_STATUS_ACTIVE"
    }
  ]
});

assert.equal(registry.size, 2);
assert.equal(registry.get(stockToken.toLowerCase())?.tokenSymbol, "AAPL");
const selectedTokenRelationship = stockAssetRelationshipsForToken(stockToken, registry);
assert.equal(selectedTokenRelationship.length, 1);
assert.equal(selectedTokenRelationship[0]?.relationship, "canonical-stock-token");
assert.equal(selectedTokenRelationship[0]?.provenance, "robinhood-live-asset-registry");
assert.equal(stockAssetRelationshipsForToken(launchToken, registry).length, 0);

const paired = stockAssetRelationshipsForPair(launchToken, launchToken, stockToken, registry);
assert.equal(paired.length, 1);
assert.equal(paired[0]?.relationship, "paired-market-asset");
assert.equal(paired[0]?.tokenSymbol, "AAPL");

const canonical = stockAssetRelationshipsForPair(stockToken, stockToken, launchToken, registry);
assert.equal(canonical.length, 1);
assert.equal(canonical[0]?.relationship, "canonical-stock-token");

const multiple = [
  ...stockAssetRelationshipsForPair(launchToken, launchToken, stockToken, registry),
  ...stockAssetRelationshipsForPair(launchToken, launchToken, anotherStockToken, registry)
];
assert.deepEqual(multiple.map((item) => item.tokenSymbol), ["AAPL", "MSFT"]);

assert.equal(stockTokenExecutionPolicyFromSnapshot(stockToken, {
  coverage: "complete",
  assetsByAddress: registry
}).status, "view-only");
assert.equal(stockTokenExecutionPolicyFromSnapshot(launchToken, {
  coverage: "complete",
  assetsByAddress: registry
}).status, "eligible");
assert.equal(stockTokenExecutionPolicyFromSnapshot(launchToken, {
  coverage: "unavailable",
  assetsByAddress: new Map()
}).status, "verification-unavailable");

console.log("Robinhood Stock Token relationships remain canonical, support multiple assets, and stay view-only.");
