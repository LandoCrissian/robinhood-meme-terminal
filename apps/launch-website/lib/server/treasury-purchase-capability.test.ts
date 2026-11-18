import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreasuryDashboard } from "../../app/_components/treasury-dashboard";
import { TreasuryWalletControls } from "../../app/_components/treasury-wallet-controls";
import { isProjectTreasurySnapshot, projectTreasuryProfile, type ProjectTreasuryProof, type ProjectTreasurySnapshot } from "../project-treasury";
import { treasuryPurchaseIntentAction, treasuryPurchaseIntentLabel, treasuryPurchaseV2Capability } from "../treasury-purchase-capability";
import { ea, eh } from "./earnings-test-fixture";

function snapshot(enabled = false): ProjectTreasurySnapshot {
  const point = { blockNumber: "10", blockHash: eh(10), timestamp: "2026-11-18T12:00:00.000Z" };
  const creator = ea(100001), treasury = ea(100002), factory = ea(100003), core = ea(100004);
  const proof: ProjectTreasuryProof = { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, creator,
    controller: creator, intentId: eh(77), treasuryShareBps: 2250, treasury, treasuryFactory: factory,
    coreFactory: core, factoryRuntimeHash: eh(81), runtimeHash: eh(82),
    deployment: { ...point, transactionHash: eh(83), logIndex: 0 } };
  return { status: "ready", schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false,
    proof, treasury, creator, controller: creator, controllerEpoch: "1", intentId: proof.intentId, treasuryShareBps: 2250, controllerKind: "eoa",
    project: { status: "unbound", token: null, originalCurve: null, activeCurve: null, curveLedger: null, lpLedger: null, graduated: false },
    assets: [{ address: null, symbol: "ETH", heldWei: "17", availableWei: "17", unclassifiedWei: "0", manualWei: "17",
      declaredFundingWei: "0", unsolicitedWei: "0", feesReceivedWei: "0", purchasedWei: "0", withdrawnWei: "0", reservedWei: "0", support: "native" }],
    earnings: { status: "not-bound", curveNativeWei: null, lpNativeWei: null, lpTokenWei: null },
    purchases: { enabled, available: false, reason: "V1 cannot execute purchases.", pendingAuthorization: "none",
      rules: { perTransactionWei: "100", perPeriodWei: "200", minimumWei: "10", cooldownSeconds: "3600", periodSeconds: "86400",
        maxSlippageBps: 100, maxImpactBps: 100, lastPurchaseAt: "0" } }, rotation: null, withdrawals: [], events: [],
    history: { indexed: false, status: "pending" }, observed: point, notices: [] };
}

test("V2 prototype capability is an immutable no-go policy, not a deployed or spending-enabled observation", () => {
  assert.deepEqual(treasuryPurchaseV2Capability, { profile: "rmt-project-treasury-purchase-v2-prototype", status: "NOT_EXECUTABLE",
    reason: "INDEPENDENT_REFERENCE_NOT_ADMITTED", scope: "development-policy", deployed: false, spendingAuthority: false, executionAvailable: false });
  assert.equal(Object.isFrozen(treasuryPurchaseV2Capability), true);
  for (const field of ["balance", "router", "token", "runtimeHash", "price", "liquidity", "treasury"])
    assert.equal(Reflect.has(treasuryPurchaseV2Capability, field), false, `Policy must not invent ${field} evidence`);
});

test("V1 may record revocable intent without accepting an executable capability or invented purchase evidence", () => {
  assert.equal(isProjectTreasurySnapshot(snapshot(false)), true); assert.equal(isProjectTreasurySnapshot(snapshot(true)), true);
  const mutations = [
    (s: ProjectTreasurySnapshot) => { s.purchases.available = true as never; },
    (s: ProjectTreasurySnapshot) => { s.purchases.rules.lastPurchaseAt = "1"; },
    (s: ProjectTreasurySnapshot) => { s.assets[0].purchasedWei = "1"; },
    (s: ProjectTreasurySnapshot) => { s.assets[0].purchasedWei = "00"; },
    (s: ProjectTreasurySnapshot) => { s.events.push({ event: "PurchaseExecuted", blockNumber: "10", blockHash: eh(10),
      transactionHash: eh(84), logIndex: 0, timestamp: s.observed.timestamp }); },
    (s: ProjectTreasurySnapshot) => { s.profile = treasuryPurchaseV2Capability.profile as never; },
  ];
  for (const mutate of mutations) { const s = snapshot(); mutate(s); assert.equal(isProjectTreasurySnapshot(s), false); }
});

test("controller buttons describe recording or revoking intent, never activating buys", () => {
  assert.equal(treasuryPurchaseIntentLabel(false), "OFF");
  assert.equal(treasuryPurchaseIntentLabel(true), "Recorded · cannot execute buys");
  for (const enabled of [false, true]) {
    const html = renderToStaticMarkup(createElement(TreasuryWalletControls, { snapshot: snapshot(enabled), onChanged() {} }));
    assert.ok(html.includes(treasuryPurchaseIntentAction(enabled)));
    assert.match(html, /Buy execution unavailable/);
    assert.match(html, /cannot activate buys/);
    assert.doesNotMatch(html, />Review purchase permission<|>Review disabling purchases<|>Enable purchases</);
    assert.match(html, /Read-only\. Controller transactions and wallet signing are not activated/);
  }
});

test("public treasury page reports V1 immutable limitation and V2 no-go without fabricating assets or requiring a wallet", () => {
  const html = renderToStaticMarkup(createElement(TreasuryDashboard));
  assert.match(html, /Buy execution unavailable/); assert.match(html, /NOT EXECUTABLE/);
  assert.match(html, /not deployed and has no treasury spending authority/);
  assert.match(html, /Token-denominated earnings do not supply ETH/);
  assert.doesNotMatch(html, /Actual held assets|>Connect synthetic treasury controller<|>Confirm synthetic treasury transaction</);
});
