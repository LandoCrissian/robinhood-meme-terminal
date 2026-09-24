import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ROBINHOOD_STOCK_TOKEN_POSITIVE_DENY_ADDRESSES,
  ROBINHOOD_STOCK_TOKEN_POSITIVE_DENY_SNAPSHOT
} from "./robinhood-stock-token-positive-deny";
import {
  parseRobinhoodStockAssets,
  requireVNextStockTokenExecutionEligible,
  stockAssetRelationshipsForPair,
  stockAssetRelationshipsForToken,
  stockTokenExecutionPolicyErrorResponse,
  stockTokenExecutionPolicyFromSnapshot
} from "./robinhood-stock-token-registry";

const stockToken = "0x1111111111111111111111111111111111111111";
const launchToken = "0x2222222222222222222222222222222222222222";
const anotherStockToken = "0x3333333333333333333333333333333333333333";
const durableStockAddress = "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea";

const durableAddresses = [...ROBINHOOD_STOCK_TOKEN_POSITIVE_DENY_ADDRESSES];
assert.equal(durableAddresses.length, ROBINHOOD_STOCK_TOKEN_POSITIVE_DENY_SNAPSHOT.addressCount);
assert.equal(new Set(durableAddresses).size, durableAddresses.length);
assert.deepEqual(durableAddresses, [...durableAddresses].sort());
assert.ok(durableAddresses.every((address) => /^0x[0-9a-f]{40}$/.test(address)));
assert.ok(durableAddresses.includes(durableStockAddress));
assert.equal(
  createHash("sha256").update(durableAddresses.join("\n")).digest("hex"),
  ROBINHOOD_STOCK_TOKEN_POSITIVE_DENY_SNAPSHOT.canonicalAddressSetSha256
);

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
}).status, "eligible");
assert.equal(stockTokenExecutionPolicyFromSnapshot(stockToken, {
  coverage: "stale",
  assetsByAddress: registry
}).status, "view-only");
assert.equal(stockTokenExecutionPolicyFromSnapshot(durableStockAddress, {
  coverage: "unavailable",
  assetsByAddress: new Map()
}).status, "view-only");

async function executionStatus(
  inputAsset: string,
  outputAsset: string,
  coverage: "complete" | "unavailable",
  knownAssets = registry
) {
  try {
    await requireVNextStockTokenExecutionEligible({ inputAsset, outputAsset }, async () => ({
      coverage,
      assetsByAddress: knownAssets
    }));
    return 200;
  } catch (cause) {
    const response = stockTokenExecutionPolicyErrorResponse(cause);
    assert.ok(response);
    return response.status;
  }
}

async function main() {
  let reads = 0;
  assert.equal(await executionStatus(stockToken, launchToken, "complete"), 451);
  assert.equal(await executionStatus(launchToken, stockToken, "complete"), 451);
  assert.equal(await executionStatus("0x0000000000000000000000000000000000000000", stockToken, "complete"), 451);
  assert.equal(await executionStatus(stockToken, "0x0000000000000000000000000000000000000000", "complete"), 451);
  assert.equal(await executionStatus(launchToken, anotherStockToken, "unavailable"), 451);
  assert.equal(await executionStatus(launchToken, "0x4444444444444444444444444444444444444444", "unavailable", new Map()), 200);
  assert.equal((await requireVNextStockTokenExecutionEligible({
    inputAsset: launchToken,
    outputAsset: "0x4444444444444444444444444444444444444444"
  }, async () => {
    reads += 1;
    return { coverage: "complete", assetsByAddress: registry };
  })).status, "eligible");
  assert.equal(reads, 1);

  console.log("Robinhood Stock Token relationships and exact two-asset VNext execution admission preserve known-stock exclusion without making outages a general veto.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
