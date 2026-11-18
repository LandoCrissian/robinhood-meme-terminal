import assert from "node:assert/strict";
import test from "node:test";
import { readEarningsContracts, readFactoryCreationFees } from "./earnings-contracts";
import { ea, earningsTestFixture } from "./earnings-test-fixture";

test("curve earnings use exact contract credits and beneficiary-specific cumulative paid amounts", async () => {
  const f = earningsTestFixture();
  const data = await readEarningsContracts(f.context, f.registration, f.creator);
  assert.equal(data.status, "ready"); if (data.status !== "ready") return;
  assert.equal(data.curve.accruedNativeWei, "90"); assert.equal(data.curve.claimableNativeWei, "70");
  assert.equal(data.curve.claimedNativeWei, "20"); assert.equal(data.curve.totalClaimedNativeWei, "20");
  assert.equal(data.lp.status, "not-graduated"); assert.deepEqual(data.rights.roles, ["creator"]);
  assert.equal(data.observed.blockHash, f.context.checkpoint.blockHash);
  const reserve = await readEarningsContracts(f.context, f.registration, f.reserve);
  assert.equal(reserve.status, "ready"); if (reserve.status === "ready") {
    assert.equal(reserve.curve.claimedNativeWei, "0", "Global claims must never become another beneficiary's claimed total");
    assert.equal(reserve.curve.claimableNativeWei, "5");
  }
});

test("overlapping immutable roles are summed without allocating another wallet's credits", async () => {
  const f = earningsTestFixture({ overlap: true });
  const data = await readEarningsContracts(f.context, f.registration, f.creator);
  assert.equal(data.status, "ready"); if (data.status !== "ready") return;
  assert.deepEqual(data.rights.roles, ["creator", "operations"]);
  assert.equal(data.curve.accruedNativeWei, "95"); assert.equal(data.curve.claimableNativeWei, "75"); assert.equal(data.curve.claimedNativeWei, "20");
  const unrelated = await readEarningsContracts(f.context, f.registration, ea(999999));
  assert.equal(unrelated.status, "ready"); if (unrelated.status === "ready") { assert.deepEqual(unrelated.rights.roles, []); assert.equal(unrelated.curve.claimableNativeWei, "0"); }
});

test("independent treasury credits are read from their own ledger address, including contract wallets", async () => {
  const f = earningsTestFixture({ treasury: true });
  const data = await readEarningsContracts(f.context, f.registration, f.registration.treasury as `0x${string}`);
  assert.equal(data.status, "ready"); if (data.status !== "ready") return;
  assert.deepEqual(data.rights.roles, ["treasury"]); assert.equal(data.rights.accountType, "contract");
  assert.equal(data.rights.treasuryShareBps, 2250); assert.equal(data.curve.claimableNativeWei, "22"); assert.equal(data.curve.claimedNativeWei, "0");
});

test("V2 and V3 routing preserve discovery and the original curve ledger rights", async () => {
  const f = earningsTestFixture();
  for (const version of [2, 3]) {
    f.state.activeCurve = ea(200000 + version); f.state.version = version; f.state.migrated = true;
    const data = await readEarningsContracts(f.context, f.registration, f.creator);
    assert.equal(data.status, "ready"); if (data.status !== "ready") return;
    assert.equal(data.engineVersion, version); assert.equal(data.activeCurve.toLowerCase(), f.state.activeCurve.toLowerCase());
    assert.equal(data.originalCurve.toLowerCase(), f.origin.toLowerCase()); assert.equal(data.curve.ledger.toLowerCase(), f.ledger.toLowerCase());
    assert.equal(data.curve.claimableNativeWei, "70");
  }
});

test("LP earnings distinguish gross uncollected position fees from beneficiary credits and principal", async () => {
  const f = earningsTestFixture({ graduated: true });
  const data = await readEarningsContracts(f.context, f.registration, f.creator);
  assert.equal(data.status, "ready"); if (data.status !== "ready" || data.lp.status !== "ready") return;
  assert.equal(data.lp.claimableNativeWei, "70"); assert.equal(data.lp.claimableTokenWei, "150");
  assert.equal(data.lp.claimedNativeWei, "20"); assert.equal(data.lp.claimedTokenWei, "30");
  assert.equal(data.lp.uncollectedNativeWei, "4"); assert.equal(data.lp.uncollectedTokenWei, "7");
  assert.equal(data.lp.uncollectedScope, "gross-original-position-not-claimable");
  assert.equal(data.lp.liquidityWei, "1000"); assert.equal(data.lp.custody, "original-position-permanently-locked");
  assert.equal(data.lp.poolKey.fee, 3000); assert.equal(data.lp.poolKey.tickSpacing, 60);
});

test("missing or conflicting provider, policy, runtime, asset and custody evidence never fabricates zero earnings", async () => {
  for (const flag of ["failReads", "wrongRuntime", "wrongPolicy", "wrongReceipt", "wrongToken", "wrongPosition", "wrongPool"] as const) {
    const f = earningsTestFixture({ graduated: true }); f.state[flag] = true;
    const result = await readEarningsContracts(f.context, f.registration, f.creator);
    assert.deepEqual(result, { status: "unavailable" }, flag);
    assert.equal("curve" in result, false, "An unavailable read must not publish zero credits");
  }
});

test("creation fees are one factory-global amount and are readable with zero indexed projects", async () => {
  const f = earningsTestFixture(); f.state.factoryFees = 0n;
  const zero = await readFactoryCreationFees(f.context, f.operations);
  assert.equal(zero.status, "ready"); if (zero.status !== "ready") return;
  assert.equal(zero.availableNativeWei, "0"); assert.equal(zero.scope, "factory-global"); assert.equal(zero.permissionlessRelease, true);
  f.state.factoryFees = 400000000000000n;
  const fees = await readFactoryCreationFees(f.context, f.operations);
  assert.equal(fees.status, "ready"); if (fees.status === "ready") { assert.equal(fees.availableNativeWei, "400000000000000"); assert.equal(fees.recipient.toLowerCase(), f.operations.toLowerCase()); }
});

test("wrong chain and reorged canonical checkpoint return unavailable", async () => {
  const f = earningsTestFixture();
  assert.deepEqual(await readEarningsContracts({ ...f.context, chainId: 4663 }, f.registration, f.creator), { status: "unavailable" });
  f.state.reorgReview = true;
  assert.deepEqual(await readEarningsContracts(f.context, f.registration, f.creator), { status: "unavailable" });
});

test("EIP-7702 code designators are disclosed as delegated EOAs rather than Safe accounts", async () => {
  const f = earningsTestFixture(); f.state.delegatedBeneficiary = true;
  const read = await readEarningsContracts(f.context, f.registration, f.creator);
  assert.equal(read.status, "ready"); if (read.status === "ready") assert.equal(read.rights.accountType, "delegated-eoa");
});
