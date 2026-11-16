import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { buildMobileReviewPlan, reviewCurrentMobileObservation, reviewDelegatedMobileObservation }
  from "../../../packages/contracts/scripts/mobile-review-plan.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { getContractAddress } = require("viem");
const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const saved = read("sender-delegation-4663.json");
const archived = read("review-plan-delegated-4663.json");
const asOf = Date.parse(saved.observedAt);

test("the observed sender is eligible for delegated preparation only under the explicit pinned-runtime policy", () => {
  assert.throws(() => reviewCurrentMobileObservation(saved, asOf), /code-empty account/);
  const summary = reviewDelegatedMobileObservation(saved, asOf);
  assert.equal(summary.delegation.status, "PINNED_RUNTIME");
  assert.equal(summary.accountType, "EIP_7702_DELEGATION");
  assert.equal(summary.observedSignerControl, "UNVERIFIED");
  assert.ok(summary.createDestinations.every(({ status }) => status === "VACANT_AT_OBSERVED_BLOCK_ONLY"));
  assert.equal(summary.createDestinations[0].nonce, (BigInt(summary.pendingNonce) + 2n).toString());
  assert.throws(() => reviewDelegatedMobileObservation(saved, asOf + 120_001), /Stale/);
  assert.throws(() => reviewDelegatedMobileObservation({
    ...saved, sender: { ...saved.sender, delegation: { ...saved.sender.delegation, runtimeHash: "0x" + "ff".repeat(32) } },
  }, asOf));
});

test("a read-only observation alone never produces a qualified delegated review packet", () => {
  assert.throws(() => buildMobileReviewPlan(null, null, null, { delegatedObservation: saved }), /must accompany/);
  assert.throws(() => buildMobileReviewPlan(null, null, null, { observation: saved, delegatedObservation: saved }), /Select one/);
});

test("the archived delegated plan preserves exact fork phases without assigning live executable roles", () => {
  assert.equal(archived.status, "BLOCKED_NO_BROADCAST");
  assert.equal(archived.broadcastAuthorized, false);
  assert.deepEqual(archived.target.transactions, []);
  assert.deepEqual(archived.target.productionInputs, read("../fixed-supply-release/unsigned-bundle.json").production);
  assert.equal(archived.releaseGate.highFindings, 22);
  assert.equal(archived.releaseGate.governanceMediumFindings, 7);
  const { delegationProof: receipts, rows: forkRows } = archived.fixture;
  assert.equal(receipts.ownerKeyControl, "UNVERIFIED");
  assert.equal(receipts.safeReceipts.length, 2);
  assert.equal(receipts.constructorReceipts.length, 5);
  assert.equal(receipts.publicationReceipts.length, 4);
  assert.equal(receipts.firstProjectReceipt.transactionHash, forkRows.at(-1).receiptHash);
  assert.equal(receipts.signedDisposableSmoke.reverted.status, "reverted");
  const { observed, rows, costs, observationMode, predictedTreasuriesAreBeneficiaries } = archived.target.delegatedReview;
  assert.equal(observationMode, "ARCHIVED_RECONSTRUCTION_REFRESH_REQUIRED");
  assert.equal(predictedTreasuriesAreBeneficiaries, false);
  assert.deepEqual(rows.map(({ id }) => id), forkRows.map(({ id }) => id));
  for (const [index, row] of rows.slice(0, 7).entries()) {
    assert.equal(row.nonce, (BigInt(observed.pendingNonce) + BigInt(index)).toString());
    assert.equal(row.sender, archived.target.proposedSender);
    if (index > 1) assert.equal(row.predictedAddress, getContractAddress({ from: row.sender, nonce: BigInt(row.nonce) }));
  }
  assert.ok(rows.slice(7).every(({ sender, nonce, inputHash }) => sender === null && nonce === null && inputHash === null));
  assert.equal(BigInt(costs.protocolForkGasAtObservedL2BaseFeeWei), BigInt(costs.protocolObservedForkGasUnits) * BigInt(costs.observedL2BaseFeeWei));
  assert.equal(costs.protocolLiveEstimate, "UNAVAILABLE_UNTIL_EXACT_VERIFIED_DEPLOYMENT_INPUTS");
  const keys = (input) => Object.entries(input).flatMap(([key, child]) =>
    [key, ...(child !== null && typeof child === "object" ? keys(child) : [])]);
  assert.ok(!keys(archived).some((key) => /^(data|calldata|initcode|bytecode|constructorData|authorizationList|signature|rawTransaction)$/i.test(key)));
});
