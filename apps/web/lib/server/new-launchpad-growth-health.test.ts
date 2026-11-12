import assert from "node:assert/strict";
import { test } from "node:test";
import { toHex, zeroAddress, type PublicClient } from "viem";
import { launchPoolId, type LaunchHealth, type NewLaunchRecord } from "../launchpad/launch-record";
import { readGrowthVaultHealth } from "./new-launchpad-growth-health";

const address = (value: number) => toHex(value, { size: 20 });
const poolKey = { currency0: zeroAddress, currency1: address(6), fee: 3000, tickSpacing: 60, hooks: address(0x2000) };
const vault = address(7);
const creator = address(8);
const factory = address(9);
const deployer = address(10);
const positionManager = address(11);
const policy = { creator, treasury: zeroAddress, reserve: vault, creatorBps: 6000, treasuryBps: 0, reserveBps: 4000 };
const launch = { engineVersion: 2, token: poolKey.currency1, creator, factory, poolId: launchPoolId(poolKey),
  intentId: toHex(42, { size: 32 }), blockNumber: "10", tickLower: -887220, tickUpper: 887220, feePolicy: policy } as NewLaunchRecord;
const fees: LaunchHealth["fees"] = {
  status: "verified", policy, totals: null, buckets: [{ bucket: 2, recipient: vault,
    nativeClaimable: "6", tokenClaimable: "15", nativeDistributed: "20", tokenDistributed: "40" }],
};
const state = {
  nativeCollected: 20n, tokenCollected: 40n, nativePositionFees: 3n, tokenPositionFees: 2n,
  nativeHeld: 11n, tokenHeld: 20n, nativeAdded: 12n, tokenAdded: 22n, liquidityAdded: 95n,
  positionTokenId: 31n, lastAttemptAt: 500n, outcome: 1,
};
const info = BigInt.asUintN(24, -887220n) << 8n | 887220n << 32n;
const results = {
  vaultFor: vault, factory, creator, intentId: launch.intentId, launchContext: [launch.token, launch.poolId], snapshot: state,
  balanceOf: 21n, ownerOf: vault, getPositionLiquidity: 95n, getPoolAndPositionInfo: [poolKey, info],
};
const client = (overrides: Partial<typeof results> = {}) => ({
  getCode: async () => "0x6000", getBalance: async () => 13n,
  readContract: async ({ functionName, blockNumber }: { functionName: keyof typeof results; blockNumber: bigint }) => {
    assert.equal(blockNumber, 30n);
    return overrides[functionName] ?? results[functionName];
  },
}) as unknown as PublicClient;
const read = (rpc: PublicClient) => readGrowthVaultHealth(rpc, deployer, positionManager, launch, fees, 30n, 510n);

test("publishes reconciled accrued, collected, held, added and locked amounts separately", async () => {
  const growth = await read(client());
  assert.equal(growth?.status, "verified");
  assert.deepEqual(growth.feesAccrued, { nativeWei: "26", tokenBaseUnits: "55" });
  assert.deepEqual(growth.feesCollected, { nativeWei: "20", tokenBaseUnits: "40" });
  assert.deepEqual(growth.reserveHeld, { nativeWei: "11", tokenBaseUnits: "20" });
  assert.deepEqual(growth.liquidityAdded, { nativeWei: "12", tokenBaseUnits: "22", units: "95" });
  assert.deepEqual(growth.positionCustody, { status: "locked", positionTokenId: "31", owner: vault });
});

test("does not infer growth from a reserve recipient or unauditable accounting", async () => {
  assert.equal(await read(client({ vaultFor: address(12) })), undefined);
  for (const rpc of [client({ ownerOf: address(12) }), client({ getPoolAndPositionInfo: [poolKey, info + 1n] }),
    client({ snapshot: { ...state, nativeCollected: 21n } }), client({ snapshot: { ...state, nativeHeld: 12n } })]) {
    assert.equal((await read(rpc))?.status, "unknown");
  }
});

test("retains a reviewed deferral without treating holdings as added liquidity", async () => {
  const growth = await read(client({ snapshot: {
    ...state, nativePositionFees: 0n, tokenPositionFees: 0n, nativeHeld: 20n, tokenHeld: 40n,
    nativeAdded: 0n, tokenAdded: 0n, liquidityAdded: 0n, positionTokenId: 0n, outcome: 3,
  }, balanceOf: 40n }));
  // The mock reports only 13 wei of backing, so an otherwise valid deferral must remain unknown.
  assert.equal(growth?.status, "unknown");
  const rpc = { ...client({ snapshot: {
    ...state, nativePositionFees: 0n, tokenPositionFees: 0n, nativeHeld: 20n, tokenHeld: 40n,
    nativeAdded: 0n, tokenAdded: 0n, liquidityAdded: 0n, positionTokenId: 0n, outcome: 3,
  }, balanceOf: 40n }), getBalance: async () => 20n } as PublicClient;
  const held = await read(rpc);
  assert.equal(held?.status, "verified");
  assert.equal(held.lastReinvestment.outcome, "price_outside_review");
  assert.equal(held.positionCustody.status, "not_minted");
  assert.equal(held.liquidityAdded.units, "0");
});
