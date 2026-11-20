import assert from "node:assert/strict";
import test from "node:test";
import type { EarningsRpc } from "./earnings-contracts";
import { readNitroZeroPosterPolicy } from "./nitro-zero-poster";

function fixture() {
  const state = { chain: 4663, l1: 0n, prices: [0n, 0n, 1n, 20n, 2n, 22n], baseFee: 22n, reorg: false, offline: false, reads: 0 };
  const rpc = { async getChainId() { return state.chain; }, async getBlock({ blockNumber }: { blockNumber: bigint }) {
    return { number: blockNumber, hash: "0x" + (state.reorg && state.reads++ ? "b" : "a").repeat(64), baseFeePerGas: state.baseFee };
  }, async readContract({ functionName }: { functionName: string }) {
    if (state.offline) throw Error("Provider unavailable");
    return functionName === "getL1BaseFeeEstimate" ? state.l1 : state.prices;
  } } as unknown as EarningsRpc;
  return { state, rpc };
}
test("zero posting rate requires exact native parameters and a positive canonical L2 base fee", async () => {
  const f = fixture(), policy = await readNitroZeroPosterPolicy(f.rpc, 123n);
  assert.deepEqual(policy, { profile: "nitro-zero-poster-v1", chainId: 4663, l1BaseFeeWei: "0", l1CalldataUnitWei: "0",
    l2BaseFeeWei: "22", nativeL2BaseFeeWei: "22", blockNumber: "123", blockHash: "0x" + "a".repeat(64) });
  f.state.baseFee = 23n;
  assert.deepEqual(await readNitroZeroPosterPolicy(f.rpc, 123n), { ...policy, l2BaseFeeWei: "23" });
});
test("partial zero, missing/outage, foreign chain, base mismatch and reorg never become zero fee evidence", async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.state.l1 = 1n; },
    (f: ReturnType<typeof fixture>) => { f.state.prices[1] = 1n; }, (f: ReturnType<typeof fixture>) => { f.state.baseFee = 0n; },
    (f: ReturnType<typeof fixture>) => { f.state.prices[5] = 0n; }, (f: ReturnType<typeof fixture>) => { f.state.chain = 31337; },
    (f: ReturnType<typeof fixture>) => { f.state.offline = true; }, (f: ReturnType<typeof fixture>) => { f.state.reorg = true; },
    (f: ReturnType<typeof fixture>) => { f.state.prices.pop(); }]) {
    const f = fixture(); mutate(f); await assert.rejects(readNitroZeroPosterPolicy(f.rpc, 123n));
  }
});
