import assert from "node:assert/strict";
import {
  acknowledgePrincipalRecovery,
  advancePositionGuard,
  createPositionGuard,
  evaluatePositionGuard,
  normalizePositionGuard,
  resetPositionGuardTrigger,
  tokenAmountForExit
} from "./position-guard";

const wallet = ["0x11111111111111111111", "11111111111111111111"].join("");
const token = ["0x22222222222222222222", "22222222222222222222"].join("");
const guard = createPositionGuard({ wallet, token, basisUsd: 100, currentValueUsd: 100, now: 1_000 });
assert.ok(guard);

const initial = evaluatePositionGuard(guard!, 100)!;
assert.equal(initial.effectiveStopUsd, 80);
assert.equal(initial.breakEvenArmed, false);
assert.equal(initial.stopTriggered, false);

const doubled = advancePositionGuard(guard!, 200, 2_000);
const doubledState = evaluatePositionGuard(doubled, 200)!;
assert.equal(doubledState.highWatermarkUsd, 200);
assert.equal(doubledState.breakEvenArmed, true);
assert.equal(doubledState.effectiveStopUsd, 160);
assert.equal(doubledState.principalRecoveryReady, true);
assert.equal(doubledState.principalRecoveryBps, 5_000);

const runner = advancePositionGuard(doubled, 13_000, 3_000);
const runnerState = evaluatePositionGuard(runner, 13_000)!;
assert.equal(runnerState.effectiveStopUsd, 10_400);
assert.equal(runnerState.distanceToStopBps, 2_000);
assert.equal(runnerState.principalRecoveryBps, 77);

const retrace = advancePositionGuard(runner, 10_300, 4_000);
assert.equal(retrace.highWatermarkUsd, 13_000);
assert.equal(retrace.triggeredAt, 4_000);
assert.equal(evaluatePositionGuard(retrace, 10_300)?.stopTriggered, true);

const reset = resetPositionGuardTrigger(retrace, 10_300, 5_000);
assert.equal(reset.highWatermarkUsd, 10_300);
assert.equal(reset.triggeredAt, null);
assert.equal(acknowledgePrincipalRecovery(reset, 6_000).principalRecovered, true);

assert.equal(tokenAmountForExit(400, 2_500), "100");
assert.equal(tokenAmountForExit(1.23456789, 10_000), "1.23456789");
assert.equal(tokenAmountForExit(0, 5_000), null);
assert.equal(normalizePositionGuard({ ...guard, wallet: "invalid" }), null);
assert.equal(normalizePositionGuard({ ...guard, stopLossBps: 9_999 }), null);
assert.equal(createPositionGuard({ wallet, token, basisUsd: -1, currentValueUsd: 1 }), null);

console.log("Position Guard smoke checks passed");
