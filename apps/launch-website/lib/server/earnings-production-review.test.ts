import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { keccak256, type Address, type Hex } from "viem";
import { launchTokenSupplyWei } from "../launch-terms";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { earningsClaimReadiness, handleProductionEarningsClaim, prepareEarningsClaim, prepareUnsignedProductionEarningsReview } from "./earnings-claims";
import { productionEarningsContext, type EarningsReadContext, type EarningsRpc } from "./earnings-contracts";
import { ea, eh } from "./earnings-test-fixture";

const archive = JSON.parse(gunzipSync(readFileSync(new URL("./earnings-production-runtime.test.json.gz", import.meta.url))).toString("utf8")) as {
  schemaVersion: number; chainId: number; providers: string[]; scope: string;
  evidence: { blockNumber: string; blockHash: Hex; finality: string; l1Finality: string };
  runtimes: Record<string, { address: Address; runtimeHash: Hex; code: Hex }>;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Only the archived public runtime preimages are real. Balances, nonces, head
// blocks, factory fees and simulations below are synthetic, with no network IO.
function syntheticProduction() {
  const account = ea(100006), head = curveProductionDeployment.blockNumber + 8n;
  const timestamp = BigInt(Math.floor(Date.now() / 1000)), blockHash = eh(850);
  const calls: string[] = [], state = { wrongRuntime: false, delegated: false, chain: 4663 };
  const block = (number: bigint) => ({ number, hash: number === curveProductionDeployment.blockNumber ? curveProductionDeployment.blockHash : blockHash, timestamp, transactions: [] });
  const rpc = {
    getChainId: async () => { calls.push("getChainId"); return state.chain; },
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => { calls.push("getBlock"); return block(blockNumber ?? head); },
    getCode: async ({ address }: { address: Address }) => {
      calls.push("getCode");
      if (same(address, account)) return state.delegated ? "0xef0100" + ea(777777).slice(2) : "0x";
      const entry = Object.values(archive.runtimes).find(value => same(value.address, address));
      if (!entry) throw Error("Unexpected code read");
      return state.wrongRuntime ? "0x6002" : entry.code;
    },
    getTransactionCount: async () => { calls.push("getTransactionCount"); return 0; },
    getGasPrice: async () => { calls.push("getGasPrice"); return 2n; },
    getBalance: async () => { calls.push("getBalance"); return 10n ** 18n; },
    estimateGas: async () => { calls.push("estimateGas"); return 30000n; },
    call: async () => { calls.push("call"); return { data: "0x" }; },
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push("readContract");
      switch (functionName) {
        case "projectRegistry": return curveProductionPins.registry[0];
        case "graduationEngine": return curveProductionPins.engine[0];
        case "tokenSupply": return launchTokenSupplyWei;
        case "factory": return curveProductionPins.factory[0];
        case "poolManager": return curveProductionPins.poolManager[0];
        case "positionManager": return curveProductionPins.positionManager[0];
        case "initializationGuard": return curveProductionPins.guard[0];
        case "operatingRecipient": return curveProductionDeployment.operating;
        case "creationFeesAccrued": return 400000000000000n;
        default: throw Error("Unexpected ABI read");
      }
    },
  } as unknown as EarningsRpc;
  const context = productionEarningsContext(rpc, { blockNumber: head.toString(), blockHash, timestamp: new Date(Number(timestamp) * 1000).toISOString() });
  return { account, context, calls, state, input: { context, account, beneficiary: curveProductionDeployment.operating, operation: "creation-fees" as const } };
}

test("archived public runtime preimages match every exact production manifest pin", () => {
  assert.equal(archive.schemaVersion, 1); assert.equal(archive.chainId, 4663); assert.equal(archive.scope, "public-runtime-preimages-only");
  assert.deepEqual(archive.providers, ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.api.pocket.network"]);
  assert.equal(archive.evidence.finality, "observed-l2"); assert.equal(archive.evidence.l1Finality, "unverified");
  for (const name of ["factory", "registry", "engine", "guard"] as const) {
    const entry = archive.runtimes[name];
    assert.equal(same(entry.address, curveProductionPins[name][0]), true); assert.equal(entry.runtimeHash, curveProductionPins[name][1]);
    assert.equal(keccak256(entry.code), curveProductionPins[name][1]);
  }
});

test("unsigned 4663 review uses synthetic state and real runtime pins without exposing execution or complete-fee claims", async () => {
  const f = syntheticProduction();
  const result = await prepareUnsignedProductionEarningsReview(f.input);
  assert.equal(result.status, "review-only"); if (result.status !== "review-only") return;
  assert.equal(result.executionEnabled, false); assert.equal(result.request.chainId, "0x1237");
  assert.equal(result.request.to, curveProductionPins.factory[0]); assert.equal(result.request.data, "0x60fd947d");
  assert.equal(result.request.beneficiary, curveProductionDeployment.operating); assert.equal(result.request.value, "0x0");
  assert.equal(result.request.expectedNativeWei, "400000000000000"); assert.equal(result.quote.estimatedNetworkFeeWei, "60000");
  assert.deepEqual(result.feeEstimate, { scope: "execution-gas-estimate-only", l1DataFee: "unverified", totalNetworkCost: "unverified" });
  assert.deepEqual(result.holds, earningsClaimReadiness().holds);
  assert.equal(f.calls.includes("call"), true); assert.equal(f.calls.includes("estimateGas"), true);
  assert.equal(f.calls.some(method => /send|sign|broadcast/i.test(method)), false);
  const count = f.calls.length;
  assert.deepEqual(await prepareEarningsClaim(f.input), { status: "unavailable", reason: "production-disabled" });
  const response = await handleProductionEarningsClaim(new Request("https://www.rmtlaunch.fun/api/launchpad/production-earnings", { method: "POST" }));
  assert.equal(response.status, 404); assert.equal(f.calls.length, count, "Public/fixture production paths make no RPC request");
});

test("unsigned production review rejects alternate manifests before RPC and fails closed on runtime, chain and delegated actors", async () => {
  const mutations = [
    (c: EarningsReadContext) => ({ ...c, chainId: 31337 as const }),
    (c: EarningsReadContext) => ({ ...c, factory: ea(888888) }),
    (c: EarningsReadContext) => ({ ...c, factoryRuntimeHash: eh(888) }),
    (c: EarningsReadContext) => ({ ...c, registry: ea(888888) }),
    (c: EarningsReadContext) => ({ ...c, registryRuntimeHash: eh(888) }),
    (c: EarningsReadContext) => ({ ...c, deploymentBlock: c.deploymentBlock + 1n }),
    (c: EarningsReadContext) => ({ ...c, deploymentBlockHash: eh(888) }),
    ...(["address", "runtimeHash", "guard", "guardRuntimeHash"] as const).map(key => (c: EarningsReadContext) => ({ ...c,
      graduation: { ...c.graduation, [key]: key.endsWith("Hash") ? eh(888) : ea(888888) } })),
    (c: EarningsReadContext) => ({ ...c, poolManager: { ...c.poolManager, address: ea(888888) } }),
    (c: EarningsReadContext) => ({ ...c, poolManager: { ...c.poolManager, runtimeHash: eh(888) } }),
    (c: EarningsReadContext) => ({ ...c, positionManager: { ...c.positionManager, address: ea(888888) } }),
    (c: EarningsReadContext) => ({ ...c, positionManager: { ...c.positionManager, runtimeHash: eh(888) } }),
    (c: EarningsReadContext) => ({ ...c, historicalReceipt: true as const }),
  ];
  for (const mutate of mutations) {
    const f = syntheticProduction();
    const result = await prepareUnsignedProductionEarningsReview({ ...f.input, context: mutate(f.context) });
    assert.equal(result.status, "unavailable"); assert.equal(result.executionEnabled, false); assert.equal(f.calls.length, 0);
  }
  for (const mode of ["runtime", "chain", "delegated"] as const) {
    const f = syntheticProduction(); f.state.wrongRuntime = mode === "runtime"; f.state.chain = mode === "chain" ? 31337 : 4663; f.state.delegated = mode === "delegated";
    const result = await prepareUnsignedProductionEarningsReview(f.input);
    assert.notEqual(result.status, "review-only"); assert.equal(result.executionEnabled, false);
    if (mode === "delegated") assert.equal("reason" in result && result.reason, "delegation-profile-required");
  }
});
