import assert from "node:assert/strict";
import {
  evaluateLivePositionGuard,
  livePositionGuardAuthorityMatchesPlan,
  livePositionGuardCancellationDisposition,
  livePositionGuardCanReplaceOrder,
  livePositionGuardHeartbeatIsFresh,
  livePositionGuardOrderId,
  livePositionGuardPublicConfiguration,
  normalizeLivePositionGuardSettings,
  unitQuoteX18
} from "./live-position-guard";

const settings = normalizeLivePositionGuardSettings({
  stopLossBps: 2_000,
  trailingStopBps: 2_000,
  breakEvenActivationBps: 5_000,
  maxPriceImpactBps: 400,
  expiresAfterHours: 24
});
assert.ok(settings);
assert.equal(normalizeLivePositionGuardSettings({ ...settings, maxPriceImpactBps: 401 }), null);
assert.equal(normalizeLivePositionGuardSettings({ ...settings, expiresAfterHours: 169 }), null);
assert.equal(unitQuoteX18(50n, 100n), 500_000_000_000_000_000n);
assert.equal(livePositionGuardHeartbeatIsFresh(970_000, 1_000_000), true);
assert.equal(livePositionGuardHeartbeatIsFresh(969_999, 1_000_000), false);
assert.equal(livePositionGuardHeartbeatIsFresh(1_000_001, 1_000_000), false);
assert.equal(livePositionGuardCancellationDisposition("active"), "cancel");
assert.equal(livePositionGuardCancellationDisposition("submitted"), "reconcile");
assert.equal(livePositionGuardCancellationDisposition("executing"), "reconcile");
assert.equal(livePositionGuardCancellationDisposition("no_position"), "cancel");
assert.equal(livePositionGuardCancellationDisposition("unknown_state"), "review");

assert.equal(livePositionGuardCanReplaceOrder("active", 1_000), false);
assert.equal(livePositionGuardCanReplaceOrder("confirming", 1_000), false);
assert.equal(livePositionGuardCanReplaceOrder("executing", 1_000), false);
assert.equal(livePositionGuardCanReplaceOrder("submitted", 1_000), false);
assert.equal(livePositionGuardCanReplaceOrder("review_required", 1_000), false);
assert.equal(livePositionGuardCanReplaceOrder("cancelled", null), false);
assert.equal(livePositionGuardCanReplaceOrder("cancelled", 0), false);
assert.equal(livePositionGuardCanReplaceOrder("cancelled", 1_000), true);
assert.equal(livePositionGuardCanReplaceOrder("executed", 1_000), true);
assert.equal(livePositionGuardCanReplaceOrder("expired", 1_000), true);
assert.equal(livePositionGuardCanReplaceOrder("inactive", 1_000), true);

assert.equal(livePositionGuardAuthorityMatchesPlan({
  allowance: 100n,
  balance: 100n,
  amountIn: 100n
}), true);
assert.equal(livePositionGuardAuthorityMatchesPlan({
  allowance: 101n,
  balance: 100n,
  amountIn: 100n
}), false);
assert.equal(livePositionGuardAuthorityMatchesPlan({
  allowance: 99n,
  balance: 100n,
  amountIn: 100n
}), false);
assert.equal(livePositionGuardAuthorityMatchesPlan({
  allowance: 100n,
  balance: 99n,
  amountIn: 100n
}), false);
assert.equal(livePositionGuardAuthorityMatchesPlan({
  allowance: 0n,
  balance: 100n,
  amountIn: 0n
}), false);

const base = {
  entryUnitQuoteX18: 100n,
  highWatermarkUnitQuoteX18: 100n,
  firstBelowFloorAt: null,
  firstBelowFloorBlock: null
};
const rising = evaluateLivePositionGuard({
  currentBlock: 10n,
  currentUnitQuoteX18: 200n,
  now: 10_000,
  observation: base,
  settings: settings!
});
assert.equal(rising.state, "healthy");
assert.equal(rising.highWatermarkUnitQuoteX18, 200n);
assert.equal(rising.effectiveFloorUnitQuoteX18, 160n);

const firstDrop = evaluateLivePositionGuard({
  currentBlock: 11n,
  currentUnitQuoteX18: 159n,
  now: 14_000,
  observation: {
    ...base,
    highWatermarkUnitQuoteX18: rising.highWatermarkUnitQuoteX18
  },
  settings: settings!
});
assert.equal(firstDrop.state, "confirming");

const sameBlock = evaluateLivePositionGuard({
  currentBlock: 11n,
  currentUnitQuoteX18: 150n,
  now: 18_000,
  observation: {
    ...base,
    highWatermarkUnitQuoteX18: rising.highWatermarkUnitQuoteX18,
    firstBelowFloorAt: firstDrop.firstBelowFloorAt,
    firstBelowFloorBlock: firstDrop.firstBelowFloorBlock
  },
  settings: settings!
});
assert.equal(sameBlock.state, "confirming");

const confirmed = evaluateLivePositionGuard({
  currentBlock: 12n,
  currentUnitQuoteX18: 150n,
  now: 18_000,
  observation: {
    ...base,
    highWatermarkUnitQuoteX18: rising.highWatermarkUnitQuoteX18,
    firstBelowFloorAt: firstDrop.firstBelowFloorAt,
    firstBelowFloorBlock: firstDrop.firstBelowFloorBlock
  },
  settings: settings!
});
assert.equal(confirmed.state, "triggered");

const recovered = evaluateLivePositionGuard({
  currentBlock: 13n,
  currentUnitQuoteX18: 170n,
  now: 19_000,
  observation: {
    ...base,
    highWatermarkUnitQuoteX18: rising.highWatermarkUnitQuoteX18,
    firstBelowFloorAt: firstDrop.firstBelowFloorAt,
    firstBelowFloorBlock: firstDrop.firstBelowFloorBlock
  },
  settings: settings!
});
assert.equal(recovered.state, "healthy");
assert.equal(recovered.firstBelowFloorAt, null);

assert.equal(livePositionGuardPublicConfiguration({}), null);
const revokeOnlyConfiguration = livePositionGuardPublicConfiguration({
  NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID: "policy_12345678",
  NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID: "signer_12345678"
});
assert.equal(revokeOnlyConfiguration?.enabled, false);
assert.equal(revokeOnlyConfiguration?.executor, "0x0000000000000000000000000000000000000001");
const enabledConfiguration = livePositionGuardPublicConfiguration({
  NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED: "true",
  NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID: "policy_12345678",
  NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID: "signer_12345678"
});
assert.equal(enabledConfiguration?.enabled, true);
assert.equal(enabledConfiguration?.executor, "0x0000000000000000000000000000000000000001");

assert.match(livePositionGuardOrderId({
  authorizationId: "authorization_12345678",
  documentId: "order_12345678",
  wallet: "0x0000000000000000000000000000000000000002",
  token: "0x0000000000000000000000000000000000000003"
}), /^0x[0-9a-f]{64}$/);
assert.notEqual(livePositionGuardOrderId({
  authorizationId: "authorization_12345678",
  documentId: "order_12345678",
  wallet: "0x0000000000000000000000000000000000000002",
  token: "0x0000000000000000000000000000000000000003"
}), livePositionGuardOrderId({
  authorizationId: "authorization_87654321",
  documentId: "order_12345678",
  wallet: "0x0000000000000000000000000000000000000002",
  token: "0x0000000000000000000000000000000000000003"
}));

console.log("live position guard smoke checks passed");
