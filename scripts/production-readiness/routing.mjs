import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, isAddressEqual, keccak256, parseAbiParameters, zeroAddress } = require("viem");
const evidence = new URL("../../docs/evidence/fixed-supply-release/", import.meta.url);
const compiler = JSON.parse(readFileSync(new URL("../fixed-supply-security/4663-profile.json", evidence)));
const bundle = JSON.parse(readFileSync(new URL("unsigned-bundle.json", evidence)));
const release = JSON.parse(readFileSync(new URL("release-manifest.json", evidence)));
const fields = parseAbiParameters("address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = /^0x[0-9a-f]{64}$/i;

export function verifyGuardedRoutingFixture(archive) {
  assert.equal(sha256(archive), release.fork.archiveSha256, "Route fixture archive differs from the release manifest");
  const raw = gunzipSync(archive);
  assert.equal(sha256(raw), release.fork.reportSha256);
  const fork = JSON.parse(raw);
  assert.equal(fork.report.execution.host, "127.0.0.1");
  assert.equal(fork.report.execution.chainId, 4663);
  assert.equal(fork.manifest.inputSha256, compiler.inputSha256);
  assert.equal(fork.report.network.blockHash, release.fork.blockHash);
  const targets = fork.report.network.contracts;
  for (const [role, pin] of Object.entries(compiler.externalRuntimePins)) {
    assert.ok(isAddressEqual(targets[role].address, pin.address));
    assert.equal(targets[role].runtimeHash, pin.runtimeHash);
  }
  const first = fork.projects[0];
  assert.equal(first.symbol, "RMT");
  const guard = bundle.fixtureOnly.bootstrapChildren.find((row) => row.contract === "RMTV4CurveInitializationGuardV1");
  assert.equal(fork.deployment.guardRuntimeHash, guard.runtimeHash);
  assert.ok(isAddressEqual(fork.deployment.guard, guard.address));
  const { poolKey, poolId, receipt, positionTokenId, nativeUsed, tokenUsed, liquidity } = first.graduation;
  assert.ok(isAddressEqual(poolKey.currency0, zeroAddress) && isAddressEqual(poolKey.currency1, first.projectAsset));
  assert.ok(isAddressEqual(poolKey.hooks, guard.address));
  assert.equal(BigInt(poolKey.hooks) & 0x3fffn, 0x2000n);
  assert.equal(poolKey.fee, 3000);
  assert.equal(poolKey.tickSpacing, 60);
  assert.equal(keccak256(encodeAbiParameters(fields, fields.map(({ name }) => poolKey[name]))), poolId);
  assert.equal(poolId, bundle.fixtureOnly.firstProject.poolId);
  assert.deepEqual(poolKey, bundle.fixtureOnly.firstProject.poolKey);
  assert.equal(first.principalUnchanged, true);
  assert.ok([nativeUsed, tokenUsed, liquidity, positionTokenId].every((value) => BigInt(value) > 0n));
  assert.equal(receipt.status, "success");
  assert.equal(first.invalidRoutes.wrongPool.status, "reverted");
  assert.equal(first.invalidRoutes.wrongRouter.status, "reverted");
  const swaps = [first.v4Buy, first.v4Sell];
  assert.ok(swaps.every(({ transactionHash, blockHash, trader, output, minimumOut }) =>
    hash.test(transactionHash) && hash.test(blockHash) && isAddressEqual(trader, first.creator) &&
    BigInt(minimumOut) > 0n && BigInt(output) >= BigInt(minimumOut)));
  const [buy, sell] = swaps.map(({ settlement }) => {
    assert.equal(settlement.length, 1, "Expected one native settlement transfer");
    return settlement[0];
  });
  assert.ok(isAddressEqual(buy.from, targets.universalRouter.address) && isAddressEqual(buy.to, targets.poolManager.address));
  assert.ok(isAddressEqual(sell.from, targets.poolManager.address) && isAddressEqual(sell.to, first.creator));
  assert.equal(BigInt(buy.value), BigInt(first.v4Buy.amountIn));
  assert.equal(BigInt(sell.value), BigInt(first.v4Sell.output));
  return {
    status: "LOOPBACK_FORK_VERIFIED", chainId: 4663, blockHash: fork.report.network.blockHash,
    poolManager: targets.poolManager, stateView: targets.stateView, quoter: targets.quoter, router212: targets.universalRouter,
    poolKey, poolId, positionTokenId, graduationReceipt: receipt.transactionHash,
    buyReceipt: first.v4Buy.transactionHash, sellReceipt: first.v4Sell.transactionHash, positiveLiquidity: true,
  };
}

export function routingPrerequisites() {
  // Synthetic addresses never become hosted routing queries or production inputs.
  assert.equal(bundle.broadcastAuthorized, false);
  assert.deepEqual(bundle.production.transactions, []);
  assert.ok(Object.entries(bundle.production).every(([key, value]) => key === "transactions" || value === null));
  const fixture = verifyGuardedRoutingFixture(readFileSync(new URL("fork-4663.json.gz", evidence)));
  return {
    fixture,
    hosted: {
      status: "DEPLOYMENT_DEPENDENT", productionPoolKey: null, productionPoolId: null, quotesObserved: false,
      required: ["verified 4663 factory, graduation engine, guard and token runtimes",
        "canonical graduation and position receipts with actual locked liquidity",
        "full PoolKey and PoolId at the pinned PoolManager and matching StateView liquidity",
        "both onchain Quoter directions with positive output and independently observed hosted route with the exact hook"],
    },
  };
}
