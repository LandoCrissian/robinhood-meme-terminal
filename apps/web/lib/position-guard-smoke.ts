import assert from "node:assert/strict";
import {
  acknowledgeProfitTarget,
  acknowledgePrincipalRecovery,
  advancePositionGuard,
  createPositionGuard,
  exactTokenAmountForExit,
  evaluatePositionGuard,
  normalizePositionGuard,
  positionGuardAfterConfirmedExit,
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
assert.equal(doubledState.activeProfitTarget?.key, "principal-2x");
assert.deepEqual(doubledState.profitTargets.map((target) => target.key), ["principal-2x", "bank-3x", "bank-5x"]);

const principalHandled = acknowledgePrincipalRecovery(doubled, 2_100);
const tripledState = evaluatePositionGuard(advancePositionGuard(principalHandled, 300, 2_200), 300)!;
assert.equal(tripledState.activeProfitTarget?.key, "bank-3x");
assert.equal(tripledState.activeProfitTarget?.exitBps, 2_500);
const firstProfitHandled = acknowledgeProfitTarget(principalHandled, "bank-3x", 2_300);
const fiveXState = evaluatePositionGuard(advancePositionGuard(firstProfitHandled, 500, 2_400), 500)!;
assert.equal(fiveXState.activeProfitTarget?.key, "bank-5x");
assert.equal(fiveXState.activeProfitTarget?.exitBps, 2_000);

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
assert.ok(acknowledgePrincipalRecovery(reset, 6_000).handledProfitTargets.includes("principal-2x"));

assert.equal(tokenAmountForExit(400, 2_500), "100");
assert.equal(tokenAmountForExit(1.23456789, 10_000), "1.23456789");
assert.equal(tokenAmountForExit(0, 5_000), null);
assert.equal(exactTokenAmountForExit(1_234_567_890_123_456_789n, 18, 10_000), "1.234567890123456789");
assert.equal(exactTokenAmountForExit(1_234_567_890_123_456_789n, 18, 2_500), "0.308641972530864197");
assert.equal(exactTokenAmountForExit(100n, 0, 2_500), "25");
assert.equal(exactTokenAmountForExit(1n, 18, 2_500), null);
assert.equal(exactTokenAmountForExit(100n, 18, 0), null);
assert.equal(positionGuardAfterConfirmedExit(doubled, "protected-floor", 10_000), null);
assert.ok(positionGuardAfterConfirmedExit(doubled, "principal-2x", 10_000)?.handledProfitTargets.includes("principal-2x"));
assert.ok(positionGuardAfterConfirmedExit(doubled, "bank-3x", 10_000)?.handledProfitTargets.includes("bank-3x"));
assert.equal(normalizePositionGuard({ ...guard, wallet: "invalid" }), null);
assert.equal(normalizePositionGuard({ ...guard, stopLossBps: 9_999 }), null);
assert.deepEqual(normalizePositionGuard({ ...guard, handledProfitTargets: ["bank-3x", "invalid", "bank-3x"] })?.handledProfitTargets, ["bank-3x"]);
assert.equal(createPositionGuard({ wallet, token, basisUsd: -1, currentValueUsd: 1 }), null);

const priceTracked = createPositionGuard({
  wallet,
  token,
  basisUsd: 100,
  currentValueUsd: 100,
  tokenBalance: 1_000,
  now: 7_000
})!;
const priceTripled = advancePositionGuard(priceTracked, 300, 8_000, 1_000);
const afterHalfExit = advancePositionGuard(priceTripled, 150, 9_000, 500);
const afterHalfExitState = evaluatePositionGuard(afterHalfExit, 150, 500)!;
assert.equal(afterHalfExitState.gainBps, 20_000);
assert.equal(afterHalfExitState.priceTracked, true);
assert.equal(afterHalfExitState.highWatermarkPriceUsd, 0.3);
assert.equal(afterHalfExitState.stopTriggered, false);
assert.equal(afterHalfExitState.effectiveStopUsd, 120);
assert.equal(afterHalfExitState.activeProfitTarget?.key, "principal-2x");

console.log("Position Guard smoke checks passed");
