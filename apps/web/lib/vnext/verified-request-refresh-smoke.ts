import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { VerifiedRequestRefresh, isVerifiedRequestFresh, verifiedRequestRefreshDelay, waitForVerifiedRequestRetry } from "./verified-request-refresh";
import { revalidateAfterApproval, TradeJourneyError } from "./trade-journey";

async function main() {
  const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
  const continueTrading = composer.slice(composer.indexOf("const continueTrading"), composer.indexOf("const continueTrading") + 2000);
  assert.match(continueTrading, /walletBusyRef\.current = false/);
  assert.match(continueTrading, /setWalletBusy\(false\)/);
  assert.match(continueTrading, /automaticPreparationKey\.current = ""/);
  const coordinator = new VerifiedRequestRefresh<number>();
  let prepared = 0, handoffs = 0;
  const published: number[] = [];
  let release!: (value: number) => void;
  const ready = (value: number, handoff: boolean) => { published.push(value); if (handoff) handoffs++; };
  const failed = (cause: unknown) => { throw cause; };
  const prepare = async () => { prepared++; return new Promise<number>(resolve => { release = resolve; }); };
  const background = coordinator.run({ key: "4663:wallet:PEEP:buy:1", handoff: false, prepare, ready, failed });
  await Promise.resolve();
  const clicked = coordinator.run({ key: "4663:wallet:PEEP:buy:1", handoff: true, prepare, ready, failed });
  assert.equal(clicked, background, "click attaches to the same in-flight verification");
  coordinator.run({ key: "4663:wallet:PEEP:buy:1", handoff: true, prepare, ready, failed });
  release(1); await background;
  assert.equal(prepared, 1); assert.equal(handoffs, 1); assert.deepEqual(published, [1]);
  for (const changed of ["account", "chain", "amount", "token", "side", "authenticated-user"]) {
    const old = coordinator.run({ key: "old", handoff: true, prepare, ready, failed });
    await Promise.resolve(); const oldRelease = release;
    await coordinator.run({ key: changed, handoff: false, prepare: async () => 2, ready, failed });
    oldRelease(999); await old;
    assert.equal(published.includes(999), false, changed + " rejects superseded response");
    assert.equal(handoffs, 1, "old intent cannot authorize a new context");
  }
  const unmounted = coordinator.run({ key: "unmounted", handoff: true, prepare, ready, failed });
  await Promise.resolve(); coordinator.invalidate(); release(999); await unmounted;
  assert.equal(published.includes(999), false); assert.equal(coordinator.running, false);
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    for (let cycle = 0; cycle < 6; cycle++) {
      const expiresAt = Date.now() + 20_000;
      assert.equal(isVerifiedRequestFresh(expiresAt, Date.now()), true);
      const wait = waitForVerifiedRequestRetry(verifiedRequestRefreshDelay(expiresAt, Date.now()), new AbortController().signal);
      mock.timers.tick(15_000); await wait;
      assert.equal(isVerifiedRequestFresh(expiresAt, Date.now()), false, "unsafe margin is refreshed, not reused");
      await coordinator.run({ key: "steady-intent", handoff: false, prepare: async () => cycle + 10, ready, failed });
    }
    assert.equal(handoffs, 1, "multiple automatic lifetimes never open a wallet");
    const controller = new AbortController();
    const cancelled = waitForVerifiedRequestRetry(60_000, controller.signal);
    controller.abort(); await assert.rejects(cancelled, /superseded/);
    mock.timers.runAll();
    assert.equal(coordinator.running, false);
  } finally { mock.timers.reset(); }
  let attempts = 0;
  const recovered = await revalidateAfterApproval({ current: () => true, onRetry() {}, wait: async () => {},
    attempt: async () => { if (++attempts < 3) throw new TradeJourneyError("ZEROX_PROVIDER_UNAVAILABLE", "fixture"); return 3; } });
  assert.equal(recovered, 3); assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(revalidateAfterApproval({ current: () => true, onRetry() {}, wait: async () => {},
    attempt: async () => { attempts++; throw new TradeJourneyError("ZEROX_PROVIDER_UNAVAILABLE", "fixture"); } }));
  assert.equal(attempts, 4, "persistent failures exhaust a bounded budget before manual retry");
  console.log("Verified-request refresh: deduplication, intent retention, supersession, six lifetimes, cancellation, bounded retries PASS");
}
void main();
