import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionNonceAvailable, assertProductionNonceAboveConsumed, recordProductionConsumedNonce, productionNonceFloorKey } from "../production-nonce";
import { productionAccountLock } from "../production-wallet";

const account = (n: number) => "0x" + (100000 + n).toString(16).padStart(40, "0");
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
function memory() { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => { data.set(k, v); } }; }
test("canonical decimal/hex candidates must stay above every known consumed nonce, including a zero nonce", () => {
  assertProductionNonceAboveConsumed("0", []);
  for (const candidate of [undefined, "0", "0x0", "1", "0x1"]) assert.throws(() => assertProductionNonceAboveConsumed(candidate, ["0", "0x1"]));
  assertProductionNonceAboveConsumed("2", ["0", "0x1"]); assertProductionNonceAboveConsumed("0x2", ["0", "1"]);
  for (const candidate of ["00", "0x00", "01", "-1", "1.5", "0x-1", "9007199254740991", "0x20000000000000"]) assert.throws(() => assertProductionNonceAboveConsumed(candidate, []));
});
test("durable nonce floors survive reload and never decrease when an older receipt is retained or archived", () => {
  const m = memory(); recordProductionConsumedNonce(m, account(1), "0x0", hash(1));
  assert.throws(() => assertProductionNonceAvailable(m, account(1), "0")); assertProductionNonceAvailable(m, account(1), "1");
  recordProductionConsumedNonce(m, account(1), "4", hash(2)); const before = m.getItem(productionNonceFloorKey);
  recordProductionConsumedNonce(m, account(1), "0x2", hash(3)); assert.equal(m.getItem(productionNonceFloorKey), before);
  const reloaded = { getItem: (key: string) => m.data.get(key) ?? null };
  assert.throws(() => assertProductionNonceAvailable(reloaded, account(1), "4")); assertProductionNonceAvailable(reloaded, account(1), "0x5");
  assertProductionNonceAvailable(reloaded, account(2), "0");
});
test("64-account capacity fails before another send and never evicts another account's consumed nonce", () => {
  const m = memory(); for (let n = 1; n <= 64; n++) recordProductionConsumedNonce(m, account(n), "0", hash(n));
  const full = m.getItem(productionNonceFloorKey);
  assert.throws(() => assertProductionNonceAvailable(m, account(65), "0"));
  assert.throws(() => recordProductionConsumedNonce(m, account(65), "0", hash(65))); assert.equal(m.getItem(productionNonceFloorKey), full);
  assert.throws(() => assertProductionNonceAvailable(m, account(1), "0"));
  recordProductionConsumedNonce(m, account(1), "1", hash(66)); assertProductionNonceAvailable(m, account(1), "2");
});
test("corrupt state, invalid receipt identity and failed durable readback remain closed", () => {
  const m = memory(); m.setItem(productionNonceFloorKey, "{}"); assert.throws(() => assertProductionNonceAvailable(m, account(1), "0"));
  const broken = { getItem: () => null, setItem: () => {} }; assert.throws(() => recordProductionConsumedNonce(broken, account(1), "0", hash(1)));
  assert.throws(() => recordProductionConsumedNonce(memory(), account(1), "0", "0x" + "0".repeat(64)));
});
test("different production accounts share the exclusive financial storage lock, preserving both nonce floors across tabs", async () => {
  assert.equal(productionAccountLock(account(1)), productionAccountLock(account(2)));
  const m = memory(), held = new Set<string>();
  async function exclusive(owner: string, action: () => Promise<void>) {
    const key = productionAccountLock(owner); if (held.has(key)) return false;
    held.add(key); try { await action(); return true; } finally { held.delete(key); }
  }
  let release!: () => void;
  const first = exclusive(account(1), async () => { await new Promise<void>(resolve => { release = resolve; }); recordProductionConsumedNonce(m, account(1), "0", hash(1)); });
  const blocked = await exclusive(account(2), async () => { throw Error("A second tab must not enter shared floor mutation"); });
  assert.equal(blocked, false); release(); assert.equal(await first, true);
  assert.equal(await exclusive(account(2), async () => { recordProductionConsumedNonce(m, account(2), "0", hash(2)); }), true);
  assert.throws(() => assertProductionNonceAvailable(m, account(1), "0")); assert.throws(() => assertProductionNonceAvailable(m, account(2), "0"));
});
