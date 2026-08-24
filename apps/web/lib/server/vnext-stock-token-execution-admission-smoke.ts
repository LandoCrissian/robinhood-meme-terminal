import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import {
  createRobinhoodStockRegistryCache,
  parseRobinhoodStockAssets,
  requireVNextStockTokenExecutionEligible,
  StockTokenExecutionPolicyError,
  stockTokenExecutionPolicyErrorResponse,
  type RobinhoodStockRegistryReader,
  type RobinhoodStockRegistrySnapshot
} from "./robinhood-stock-token-registry";
import { prepareRobinhoodVNextUniswapXIntent, withVNextStockTokenExecutionAdmission } from "./vnext-execution-engine";
import type { VNextProviderQuoteRequest } from "./vnext-provider-adapter";

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

const readySnapshot: RobinhoodStockRegistrySnapshot & { coverage: "complete" } = { coverage: "complete", assetsByAddress };
const unavailableSnapshot: RobinhoodStockRegistrySnapshot = { coverage: "unavailable", assetsByAddress: new Map() };

async function invoke(
  inputAsset: string,
  outputAsset: string,
  snapshot: RobinhoodStockRegistrySnapshot | RobinhoodStockRegistryReader
) {
  let providerCalls = 0;
  try {
    const result = await withVNextStockTokenExecutionAdmission(
      { inputAsset, outputAsset },
      async () => {
        providerCalls += 1;
        return { walletPlan: "prepared", transactionTarget: ordinaryAsset } as const;
      },
      (assets) => requireVNextStockTokenExecutionEligible(
        assets,
        typeof snapshot === "function" ? snapshot : async () => snapshot
      )
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

  let now = 1_000;
  let refreshFails = false;
  const expiringCache = createRobinhoodStockRegistryCache({
    nowMs: () => now,
    ttlMs: 100,
    readLiveSnapshot: async () => {
      if (refreshFails) throw new Error("offline");
      return readySnapshot;
    }
  });
  assert.equal((await expiringCache.readForExecution()).coverage, "complete");
  now += 101;
  refreshFails = true;
  const expiredVerify = await invoke(ordinaryAsset, nativeAsset, expiringCache.readForExecution);
  const expiredAuthorize = await invoke(nativeAsset, ordinaryAsset, expiringCache.readForExecution);
  assert.equal(expiredVerify.status, 503);
  assert.equal(expiredAuthorize.status, 503);
  assert.equal(expiredVerify.providerCalls, 0);
  assert.equal(expiredAuthorize.providerCalls, 0);
  assert.equal(expiredAuthorize.result, undefined);

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

  const uniswapXRequest: VNextProviderQuoteRequest = {
    chainId: 4_663,
    inputAsset: getAddress(ordinaryAsset),
    outputAsset: getAddress(ordinaryOutputAsset),
    inputAmountAtomic: "1000000",
    amountIn: 1_000_000n,
    recipient: getAddress("0x4444444444444444444444444444444444444444"),
    inputIdentity: { address: getAddress(ordinaryAsset), symbol: "IN", decimals: 6 },
    outputIdentity: { address: getAddress(ordinaryOutputAsset), symbol: "OUT", decimals: 18 }
  };
  let executableIntentAdmissionCalls = 0;
  await assert.rejects(
    () => prepareRobinhoodVNextUniswapXIntent(uniswapXRequest, 1n, async () => {
      executableIntentAdmissionCalls += 1;
      throw new StockTokenExecutionPolicyError("Registry unavailable.", 503);
    }),
    (cause: unknown) => cause instanceof StockTokenExecutionPolicyError && cause.status === 503
  );
  assert.equal(executableIntentAdmissionCalls, 1);

  const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
  const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
  const legacyV4Route = readFileSync(new URL("../../app/api/trade/rmt-v4/route.ts", import.meta.url), "utf8");
  const externalUniswapRoute = readFileSync(new URL("../../app/api/trade/external-uniswap/route.ts", import.meta.url), "utf8");
  const externalUniswapV4Route = readFileSync(new URL("../../app/api/trade/external-uniswap-v4/route.ts", import.meta.url), "utf8");
  const externalSushiRoute = readFileSync(new URL("../../app/api/trade/external-sushi-quote/route.ts", import.meta.url), "utf8");
  const engine = readFileSync(new URL("./vnext-execution-engine.ts", import.meta.url), "utf8");
  assert.match(verifyRoute, /stockTokenExecutionPolicyErrorResponse/);
  assert.match(authorizeRoute, /stockTokenExecutionPolicyErrorResponse/);
  for (const guardedTransactionRoute of [legacyV4Route, externalUniswapRoute, externalUniswapV4Route, externalSushiRoute]) {
    assert.match(guardedTransactionRoute, /requireStockTokenExecutionEligible/);
  }
  assert.match(engine, /quoteRobinhoodVNextExecution[\s\S]*quoteVNextExecutionProviders/);
  assert.match(engine, /prepareRobinhoodVNextUniswapXIntent[\s\S]*prepareVNextUniswapXIntent\(input, protectedOutputFloorAtomic, requireAdmission\)/);

  console.log("VNext stock-token admission rejects exact stock assets before provider verification or authorization while ordinary and merely RWA-paired assets remain eligible.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
