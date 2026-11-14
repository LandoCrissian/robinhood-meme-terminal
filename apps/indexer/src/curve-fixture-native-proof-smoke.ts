import assert from "node:assert/strict";
import { assertFixtureNativeProof } from "./curve-fixture-native-proof.js";

export function testFixtureNativeProof() {
  const wallet = "0x1000000000000000000000000000000000000000";
  const curve = "0x2000000000000000000000000000000000000000";
  const ledger = "0x3000000000000000000000000000000000000000";
  const root = { type: "CALL", from: wallet, to: curve, input: "0x12345678", value: "0x0" } as const;
  const origin = { from: wallet, to: curve, input: root.input, value: 0n } as const;
  const payments: Parameters<typeof assertFixtureNativeProof>[2] = [
    { from: curve, to: wallet, amount: 99n },
    { from: curve, to: ledger, amount: 1n },
  ];
  const payout = { type: "CALL", from: curve, to: wallet, value: "0x63" };
  const credit = { type: "CALL", from: curve, to: ledger, value: "0x1" };
  const reverted = { type: "CALL", error: "execution reverted", calls: [payout] };
  assert.doesNotThrow(() => assertFixtureNativeProof({ ...root, calls: [payout, credit, reverted] }, origin, payments));
  assert.throws(() => assertFixtureNativeProof(null, origin, payments), /malformed native trace/);
  assert.throws(() => assertFixtureNativeProof({ ...root, input: "0xdeadbeef", calls: [payout, credit] }, origin, payments), /transaction mismatch/);
  assert.throws(() => assertFixtureNativeProof({ ...root, calls: [reverted, credit] }, origin, payments), /not independently proven/);
  assert.throws(() => assertFixtureNativeProof({ ...root, calls: [payout, { ...credit, to: wallet }] }, origin, payments), /not independently proven/);
  assert.throws(() => assertFixtureNativeProof({ ...root, calls: [payout, payout, credit] }, origin, payments), /not independently proven/);
  const routerInput = `0x${"01".repeat(1600)}` as const;
  const tooLarge = `0x${"01".repeat(1601)}` as const;
  assert.doesNotThrow(() => assertFixtureNativeProof({ ...root, input: routerInput, calls: [payout, credit] }, { ...origin, input: routerInput }, payments));
  assert.throws(() => assertFixtureNativeProof({ ...root, input: tooLarge, calls: [payout, credit] }, { ...origin, input: tooLarge }, payments), /transaction mismatch/);
}
