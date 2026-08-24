import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseRobinhoodStockAssets,
  requireVNextStockTokenExecutionEligible,
  stockTokenExecutionPolicyErrorResponse,
  type RobinhoodStockRegistrySnapshot
} from "./robinhood-stock-token-registry";
import { withVNextStockTokenExecutionAdmission } from "./vnext-execution-engine";

const nativeAsset = "0x0000000000000000000000000000000000000000";
const stockAsset = "0x1111111111111111111111111111111111111111";
const ordinaryAsset = "0x2222222222222222222222222222222222222222";
const ordinaryOutputAsset = "0x3333333333333333333333333333333333333333";

const assetsByAddress = parseRobinhoodStockAssets({
  assets: [{
    id: "stock-fixture",
    tokenSymbol: "STOCK",
    tokenName: "Canonical Stock Token Fixture",
    deployments: [{ contractAddress: stockAsset, chainId: 4_663 }],
    currentMultiplier: "1",
    status: "ASSET_STATUS_ACTIVE"
  }]
});

const readySnapshot: RobinhoodStockRegistrySnapshot = { coverage: "complete", assetsByAddress };
const unavailableSnapshot: RobinhoodStockRegistrySnapshot = { coverage: "unavailable", assetsByAddress: new Map() };

async function invoke(
  inputAsset: string,
  outputAsset: string,
  snapshot: RobinhoodStockRegistrySnapshot
) {
  let providerCalls = 0;
  try {
    const result = await withVNextStockTokenExecutionAdmission(
      { inputAsset, outputAsset },
      async () => {
        providerCalls += 1;
        return { walletPlan: "prepared", transactionTarget: ordinaryAsset } as const;
      },
      (assets) => requireVNextStockTokenExecutionEligible(assets, async () => snapshot)
    );
    return { status: 200, providerCalls, result };
  } catch (cause) {
    const response = stockTokenExecutionPolicyErrorResponse(cause);
    assert.ok(response);
    return { status: response.status, providerCalls, result: undefined };
  }
}

async function main() {
  for (const [inputAsset, outputAsset] of [
    [stockAsset, nativeAsset],
    [nativeAsset, stockAsset],
    [stockAsset, ordinaryAsset],
    [ordinaryAsset, stockAsset]
  ]) {
    const verify = await invoke(inputAsset, outputAsset, readySnapshot);
    const authorize = await invoke(inputAsset, outputAsset, readySnapshot);
    assert.equal(verify.status, 451);
    assert.equal(authorize.status, 451);
    assert.equal(verify.providerCalls, 0);
    assert.equal(authorize.providerCalls, 0);
    assert.equal(authorize.result, undefined);
  }

  const unavailableVerify = await invoke(ordinaryAsset, nativeAsset, unavailableSnapshot);
  const unavailableAuthorize = await invoke(nativeAsset, ordinaryAsset, unavailableSnapshot);
  assert.equal(unavailableVerify.status, 503);
  assert.equal(unavailableAuthorize.status, 503);
  assert.equal(unavailableVerify.providerCalls, 0);
  assert.equal(unavailableAuthorize.providerCalls, 0);

  const ordinary = await invoke(ordinaryAsset, nativeAsset, readySnapshot);
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.providerCalls, 1);
  assert.equal(ordinary.result?.walletPlan, "prepared");

  // A pool may carry pair-level evidence for stockAsset, but only these exact ordinary assets reach admission.
  const pairedMarketEvidence = { relationship: "paired-market-asset", contractAddress: stockAsset } as const;
  assert.equal(pairedMarketEvidence.relationship, "paired-market-asset");
  const pairedMarketAsset = await invoke(ordinaryAsset, ordinaryOutputAsset, readySnapshot);
  assert.equal(pairedMarketAsset.status, 200);
  assert.equal(pairedMarketAsset.providerCalls, 1);

  const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
  const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
  assert.match(verifyRoute, /stockTokenExecutionPolicyErrorResponse/);
  assert.match(authorizeRoute, /stockTokenExecutionPolicyErrorResponse/);

  console.log("VNext stock-token admission rejects exact stock assets before provider verification or authorization while ordinary and merely RWA-paired assets remain eligible.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
