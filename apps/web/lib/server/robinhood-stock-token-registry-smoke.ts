import assert from "node:assert/strict";
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
assert.equal(stockTokenExecutionPolicyFromSnapshot(stockToken, {
  coverage: "stale",
  assetsByAddress: registry
}).status, "verification-unavailable");

async function rejectionStatus(inputAsset: string, outputAsset: string, coverage: "complete" | "unavailable") {
  try {
    await requireVNextStockTokenExecutionEligible({ inputAsset, outputAsset }, async () => ({
      coverage,
      assetsByAddress: coverage === "complete" ? registry : new Map()
    }));
    assert.fail("Expected stock-token execution admission to fail closed.");
  } catch (cause) {
    const response = stockTokenExecutionPolicyErrorResponse(cause);
    assert.ok(response);
    return response.status;
  }
}

async function main() {
  let reads = 0;
  assert.equal(await rejectionStatus(stockToken, launchToken, "complete"), 451);
  assert.equal(await rejectionStatus(launchToken, stockToken, "complete"), 451);
  assert.equal(await rejectionStatus("0x0000000000000000000000000000000000000000", stockToken, "complete"), 451);
  assert.equal(await rejectionStatus(stockToken, "0x0000000000000000000000000000000000000000", "complete"), 451);
  assert.equal(await rejectionStatus(launchToken, anotherStockToken, "unavailable"), 503);
  assert.equal((await requireVNextStockTokenExecutionEligible({
    inputAsset: launchToken,
    outputAsset: "0x4444444444444444444444444444444444444444"
  }, async () => {
    reads += 1;
    return { coverage: "complete", assetsByAddress: registry };
  })).status, "eligible");
  assert.equal(reads, 1);

  console.log("Robinhood Stock Token relationships and exact two-asset VNext execution admission remain canonical and fail closed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
