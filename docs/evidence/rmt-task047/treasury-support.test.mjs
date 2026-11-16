import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { reviewTreasurySupport } from "./treasury-support.mjs";

const viem = webTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT ?? fileURLToPath(new URL("../../../", import.meta.url)));
const scope = "SYNTHETIC_4663_FORK";
const fixture = (value) => viem.getAddress(viem.padHex(viem.numberToHex(0x46630000 + value), { size: 20 }));
const bindings = {
  chainId: 4663, operations: fixture(1), reserve: fixture(2), lammbTreasury: fixture(3),
  lammbSupportPayee: fixture(4), rmtSupportPayee: fixture(5), projectToken: fixture(6),
};
function inputs(inbound = false) {
  const request = {
    reference: inbound ? "fixture-rmt-expense" : "fixture-lammb-expense",
    chainId: 4663, direction: inbound ? "LAMMB_SUPPORTS_RMT" : "RMT_SUPPORTS_LAMMB",
    from: inbound ? bindings.lammbTreasury : bindings.operations,
    recipient: inbound ? bindings.rmtSupportPayee : bindings.lammbSupportPayee,
    asset: inbound ? "ETH" : bindings.projectToken, amount: "400", nonce: "0",
  };
  return {
    scope, bindings: { ...bindings }, request,
    approval: { scope, approvedBy: inbound ? "LAMMB_TREASURY" : "RMT_OPERATIONS", intent: { ...request } },
    observed: { chainId: 4663, safe: request.from, nonce: 0n, available: 500n },
  };
}

test("live preparation yields a blocked result with no unsigned executable call", () => {
  const live = JSON.parse(readFileSync(new URL("./treasury-live-bindings.json", import.meta.url), "utf8"));
  const { operatingTreasury, futureReserve, deployer, economicApproval, allocationBps } = live.protocol;
  assert.deepEqual([operatingTreasury, futureReserve, deployer, economicApproval], [null, null, null, null]);
  assert.deepEqual(allocationBps, { project: 9000, operations: 500, reserve: 500 });
  assert.equal(live.unsignedLiveTransaction, null);
  assert.deepEqual(reviewTreasurySupport(viem, { ...inputs(), scope: live.scope }), {
    status: live.status, broadcastAuthorized: false, transaction: null,
  });
});

test("Ops reviews an exact transfer of the bound ERC-20 to its approved LAMMB payee", () => {
  const result = reviewTreasurySupport(viem, inputs());
  assert.equal(result.status, "UNSIGNED_SYNTHETIC_ONLY");
  assert.equal(result.broadcastAuthorized, false);
  const tx = result.transaction;
  assert.equal(tx.to, bindings.projectToken);
  assert.equal(tx.value, 0n);
  assert.equal(tx.operation, 0);
  assert.equal(tx.refundReceiver, viem.zeroAddress);
  assert.deepEqual(viem.decodeFunctionData({ abi: viem.erc20Abi, data: tx.data }), {
    functionName: "transfer", args: [bindings.lammbSupportPayee, 400n],
  });
});

test("LAMMB support is an independent zero-calldata ETH transfer using its own approval and Safe domain", () => {
  const result = reviewTreasurySupport(viem, inputs(true));
  assert.equal(result.transaction.to, bindings.rmtSupportPayee);
  assert.equal(result.transaction.value, 400n);
  assert.equal(result.transaction.data, "0x");
  assert.notEqual(result.safeTxHash, reviewTreasurySupport(viem, inputs()).safeTxHash);
});

test("rejects role conflation and circular Safe-to-Safe or Reserve payment routes", () => {
  for (const alias of [bindings.operations, bindings.reserve, bindings.lammbTreasury, bindings.lammbSupportPayee]) {
    const changed = inputs(true);
    changed.bindings.rmtSupportPayee = alias;
    assert.throws(() => reviewTreasurySupport(viem, changed), /disjoint/);
  }
  const changed = inputs();
  changed.request.from = bindings.reserve;
  assert.throws(() => reviewTreasurySupport(viem, changed), /exact transfer/);
});

test("rejects unapproved purpose, changed amount, substituted token or arbitrary calldata", () => {
  for (const change of [
    (input) => { input.approval.approvedBy = "LAMMB_TREASURY"; },
    (input) => { input.approval.intent.reference = "fixture-wrong-expense"; },
    (input) => { input.request.amount = "401"; },
    (input) => { input.request.asset = fixture(99); },
    (input) => { input.request.data = "0x1234"; },
  ]) {
    const changed = inputs();
    change(changed);
    assert.throws(() => reviewTreasurySupport(viem, changed));
  }
});

test("checks nonce, exact sender, chain and available balance", () => {
  const changed = inputs();
  assert.throws(() => reviewTreasurySupport(viem, { ...changed, observed: { ...changed.observed, nonce: 1n } }), /nonce/);
  assert.throws(() => reviewTreasurySupport(viem, { ...changed, observed: { ...changed.observed, safe: bindings.reserve } }), /source role/);
  assert.throws(() => reviewTreasurySupport(viem, { ...changed, observed: { ...changed.observed, chainId: 1 } }));
  assert.throws(() => reviewTreasurySupport(viem, { ...changed, observed: { ...changed.observed, available: 0n } }), /Insufficient/);
});
