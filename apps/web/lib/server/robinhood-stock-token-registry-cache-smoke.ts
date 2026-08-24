import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createRobinhoodStockRegistryCache,
  parseRobinhoodStockAssets,
  requireStockTokenExecutionEligible,
  requireVNextStockTokenExecutionEligible,
  stockTokenExecutionPolicyErrorResponse,
  type RobinhoodStockRegistryReader,
  type RobinhoodStockRegistrySnapshot
} from "./robinhood-stock-token-registry";

const knownStock = "0x1111111111111111111111111111111111111111";
const newStock = "0x2222222222222222222222222222222222222222";
const ordinaryAsset = "0x3333333333333333333333333333333333333333";
const nativeAsset = "0x0000000000000000000000000000000000000000";
const ttlMs = 1_000;

function assets(addresses: string[]) {
  return parseRobinhoodStockAssets({
    assets: addresses.map((contractAddress, index) => ({
      id: `stock-${index}`,
      tokenSymbol: `STK${index}`,
      tokenName: `Stock fixture ${index}`,
      deployments: [{ contractAddress, chainId: 4_663 }],
      currentMultiplier: "1",
      status: "ASSET_STATUS_ACTIVE"
    }))
  });
}

function complete(addresses: string[]): RobinhoodStockRegistrySnapshot & { coverage: "complete" } {
  return { coverage: "complete", assetsByAddress: assets(addresses) };
}

async function status(operation: () => Promise<unknown>) {
  try {
    await operation();
    return 200;
  } catch (cause) {
    const response = stockTokenExecutionPolicyErrorResponse(cause);
    assert.ok(response);
    return response.status;
  }
}

async function main() {
  const implementation = readFileSync(new URL("./robinhood-stock-token-registry.ts", import.meta.url), "utf8");
  assert.match(implementation, /cache: "no-store"/);
  assert.doesNotMatch(implementation, /next:\s*\{\s*revalidate/);

  let now = 10_000;
  let networkCalls = 0;
  let mode: "success" | "failure" = "failure";
  let liveSnapshot = complete([knownStock]);
  const cache = createRobinhoodStockRegistryCache({
    nowMs: () => now,
    ttlMs,
    readLiveSnapshot: async () => {
      networkCalls += 1;
      if (mode === "failure") throw new Error("offline");
      return liveSnapshot;
    }
  });

  assert.equal(await status(() => requireStockTokenExecutionEligible(ordinaryAsset, cache.readForExecution)), 503);
  assert.equal(networkCalls, 1);

  mode = "success";
  assert.equal(await status(() => requireStockTokenExecutionEligible(ordinaryAsset, cache.readForExecution)), 200);
  assert.equal(await status(() => requireStockTokenExecutionEligible(knownStock, cache.readForExecution)), 451);
  assert.equal(await status(() => requireVNextStockTokenExecutionEligible({ inputAsset: nativeAsset, outputAsset: knownStock }, cache.readForExecution)), 451);
  assert.equal(networkCalls, 2);

  now += ttlMs - 1;
  assert.equal(await status(() => requireVNextStockTokenExecutionEligible({ inputAsset: ordinaryAsset, outputAsset: nativeAsset }, cache.readForExecution)), 200);
  assert.equal(networkCalls, 2);

  now += 2;
  mode = "failure";
  // NEW_STOCK is absent from the expired snapshot. A failed refresh must not
  // classify that unseen address as an ordinary executable asset.
  assert.equal(await status(() => requireStockTokenExecutionEligible(newStock, cache.readForExecution)), 503);
  assert.equal(networkCalls, 3);

  mode = "success";
  liveSnapshot = complete([knownStock, newStock]);
  assert.equal(await status(() => requireStockTokenExecutionEligible(ordinaryAsset, cache.readForExecution)), 200);
  assert.equal(await status(() => requireVNextStockTokenExecutionEligible({ inputAsset: ordinaryAsset, outputAsset: newStock }, cache.readForExecution)), 451);
  assert.equal(networkCalls, 4);

  now += ttlMs + 1;
  mode = "failure";
  assert.equal(await status(() => requireStockTokenExecutionEligible(ordinaryAsset, cache.readForExecution)), 503);
  assert.equal(await status(() => requireStockTokenExecutionEligible(knownStock, cache.readForExecution)), 503);
  assert.equal(await status(() => requireVNextStockTokenExecutionEligible({ inputAsset: ordinaryAsset, outputAsset: newStock }, cache.readForExecution)), 503);
  const callsAfterThreeFailedRefreshes = networkCalls;
  assert.equal(callsAfterThreeFailedRefreshes, 7);

  const stalePresentation = await cache.readForPresentation();
  assert.equal(stalePresentation.coverage, "stale");
  assert.ok(stalePresentation.assetsByAddress.has(newStock.toLowerCase()));
  assert.equal(networkCalls, 8);

  // A failed refresh did not extend the TTL: the very next execution read retries.
  assert.equal(await status(() => requireStockTokenExecutionEligible(ordinaryAsset, cache.readForExecution)), 503);
  assert.equal(networkCalls, 9);

  mode = "success";
  liveSnapshot = complete([knownStock, newStock]);
  assert.equal(await status(() => requireStockTokenExecutionEligible(newStock, cache.readForExecution)), 451);
  assert.equal(networkCalls, 10);

  const oneReadSnapshots: RobinhoodStockRegistrySnapshot[] = [];
  const oneRead: RobinhoodStockRegistryReader = async () => {
    oneReadSnapshots.push(liveSnapshot);
    return liveSnapshot;
  };
  assert.equal(await status(() => requireVNextStockTokenExecutionEligible({ inputAsset: ordinaryAsset, outputAsset: ordinaryAsset }, oneRead)), 200);
  assert.equal(oneReadSnapshots.length, 1);

  console.log("Robinhood Stock Token execution cache rejects expired authority, preserves explicitly stale presentation evidence, and recovers after a later successful refresh.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
