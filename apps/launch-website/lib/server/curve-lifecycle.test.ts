import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describeCurveLifecycle, hasCurveRegistration, proposedCurveLifecycle, type CurveLaunch, type CurveRegistration } from "../curve-lifecycle";
import { LaunchProvenance } from "../../app/_components/launch-provenance";

const address = (digit: string) => "0x" + digit.repeat(40);
const hash = (digit: string) => "0x" + digit.repeat(64);
const height = { blockNumber: "100", blockHash: hash("a"), timestamp: "2026-11-14T12:00:00.000Z" };
const observed = { blockNumber: "101", blockHash: hash("b"), timestamp: "2026-11-14T12:00:02.000Z" };
const registration: CurveRegistration = {
  kind: "curve-launch-1b-v2", status: "created", chainId: 4663, engineVersion: 1,
  factory: address("1"), projectRegistry: address("2"), token: address("3"), initialCurve: address("4"), creator: address("5"),
  name: "Fixture token", symbol: "FIX", totalSupplyWei: "1000000000000000000000000000", tokenDecimals: 18,
  creation: { ...height, transactionHash: hash("c"), logIndex: 4 },
  checkpoint: { ...observed, confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" },
};

const activeObservation = {
  at: observed, engine: address("6"), version: 2, soldWei: "2", backingWei: "4", targetSoldWei: "6", targetBackingWei: "8",
};
const graduatedObservation = {
  engine: address("6"), version: 2, receipt: { ...observed, transactionHash: hash("d"), logIndex: 5 },
  market: {
    poolManager: address("7"), positionManager: address("8"), poolId: hash("e"), owner: address("9"), positionId: "42",
    poolKey: { currency0: address("0"), currency1: registration.token, fee: 3000, tickSpacing: 60, hooks: address("a") },
    liquidity: "500", nativeDepositedWei: "200", tokenDepositedWei: "800",
  },
};

test("keeps proposed, created and observed curve states distinct", () => {
  assert.deepEqual(proposedCurveLifecycle, { stage: "proposed", label: "Proposed token draft" });
  assert.equal(describeCurveLifecycle({ registration, state: "created" }).stage, "created");
  assert.equal(describeCurveLifecycle({ registration, state: "unknown" }).stage, "unknown");
  assert.equal(describeCurveLifecycle({ registration, state: "active", observation: activeObservation }).stage, "active");
  const ready = { ...activeObservation, soldWei: "6", backingWei: "8" };
  assert.equal(describeCurveLifecycle({ registration, state: "graduating", observation: ready }).stage, "graduating");
  assert.equal(describeCurveLifecycle({ registration, state: "active", observation: ready }).stage, "unknown");
  assert.equal(describeCurveLifecycle({ registration, state: "graduating", observation: activeObservation }).stage, "unknown");
});

test("rejects historical, immature and conflicting registration observations", () => {
  const legacy = { ...registration, kind: "historical-rmt" } as unknown as CurveRegistration;
  assert.equal(hasCurveRegistration(legacy), false);
  assert.equal(hasCurveRegistration({ ...registration, totalSupplyWei: "100000000000000000000000000" }), false);
  assert.equal(hasCurveRegistration({ ...registration, tokenDecimals: 6 } as unknown as CurveRegistration), false);
  assert.equal(hasCurveRegistration({ ...registration, checkpoint: { ...registration.checkpoint, confirmations: 19 } }), false);
  assert.equal(hasCurveRegistration({ ...registration, checkpoint: { ...height, confirmations: 20,
    finality: "l2-confirmed", l1Finality: "unverified", blockHash: hash("f") } }), false);
  assert.equal(describeCurveLifecycle({ registration, state: "active", observation: {
    ...activeObservation, at: { ...observed, blockHash: hash("f") },
  } }).stage, "unknown");
});

test("graduation display requires a receipt, a complete v4 pool key and positive position evidence", () => {
  const launch: CurveLaunch = { registration, state: "graduated", observation: graduatedObservation };
  assert.equal(describeCurveLifecycle(launch).stage, "graduated");
  assert.equal(describeCurveLifecycle({ ...launch, observation: { ...graduatedObservation, receipt: registration.creation } }).stage, "unknown");
  assert.equal(describeCurveLifecycle({ ...launch, observation: { ...graduatedObservation, engine: registration.initialCurve } }).stage, "unknown");
  assert.equal(describeCurveLifecycle({ ...launch, observation: { ...graduatedObservation, market: {
    ...graduatedObservation.market, liquidity: "0",
  } } }).stage, "unknown");
  assert.equal(describeCurveLifecycle({ ...launch, observation: { ...graduatedObservation, market: {
    ...graduatedObservation.market, poolKey: { ...graduatedObservation.market.poolKey, currency1: address("f") },
  } } }).stage, "unknown");
});

test("detail evidence retains complete identities and never promotes an invalid lifecycle to funded liquidity", () => {
  const markup = renderToStaticMarkup(createElement(LaunchProvenance, { launch: { registration, state: "graduated", observation: graduatedObservation } }));
  for (const value of [registration.factory, registration.projectRegistry, registration.initialCurve, registration.token,
    registration.creation.transactionHash, registration.creation.blockHash, registration.checkpoint.blockHash,
    graduatedObservation.receipt.transactionHash, graduatedObservation.market.poolManager, graduatedObservation.market.positionManager,
    graduatedObservation.market.poolId, graduatedObservation.market.poolKey.currency0, graduatedObservation.market.poolKey.currency1,
    graduatedObservation.market.poolKey.hooks, graduatedObservation.market.owner]) assert.ok(markup.includes(value));
  assert.match(markup, /Ethereum L1 finality/); assert.match(markup, /Unverified/);
  const invalid = renderToStaticMarkup(createElement(LaunchProvenance, { launch: { registration, state: "graduated", observation: {
    ...graduatedObservation, market: { ...graduatedObservation.market, liquidity: "0" },
  } } }));
  assert.match(invalid, /Lifecycle unverified/);
  assert.doesNotMatch(invalid, /Starting funded deposits|Observed position owner/);
  const wrongChain = renderToStaticMarkup(createElement(LaunchProvenance, { launch: {
    registration: { ...registration, chainId: 1 } as unknown as CurveRegistration, state: "created",
  } }));
  assert.match(wrongChain, /evidence is unavailable/); assert.ok(!wrongChain.includes(registration.token));
});


test("decimal block identities remain strings and bind hashes at equal heights", () => {
  assert.equal(hasCurveRegistration({ ...registration, checkpoint: {
    ...registration.checkpoint, ...height, timestamp: height.timestamp.replace(".000Z", "Z"),
  } }), true, "equivalent ISO timestamp spellings identify the same canonical block");
  const conflicting = { ...registration,
    creation: { ...registration.creation, blockNumber: Number(height.blockNumber) },
    checkpoint: { ...registration.checkpoint, ...height, blockHash: hash("f") },
  } as unknown as CurveRegistration;
  assert.equal(hasCurveRegistration(conflicting), false);
  assert.equal(hasCurveRegistration({ ...registration,
    checkpoint: { ...registration.checkpoint, blockNumber: Number(observed.blockNumber) },
  } as unknown as CurveRegistration), false);
  assert.equal(describeCurveLifecycle({ registration, state: "graduated", observation: {
    ...graduatedObservation, receipt: { ...graduatedObservation.receipt,
      blockNumber: Number(observed.blockNumber), blockHash: hash("f") },
  } } as unknown as CurveLaunch).stage, "unknown");
});
