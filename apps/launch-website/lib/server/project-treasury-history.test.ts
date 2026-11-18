import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { projectTreasuryProfile, type ProjectTreasuryProof } from "../project-treasury";
import { validateIndexedTreasuryHistory } from "./project-treasury-history";
import { ea, eh } from "./earnings-test-fixture";

const point = (n: number) => ({ blockNumber: String(n), blockHash: eh(n), timestamp: new Date(n * 1000).toISOString() });
function fixture() {
  const proof: ProjectTreasuryProof = { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337,
    treasury: ea(100001), creator: ea(100002), controller: ea(100003), intentId: eh(44), treasuryShareBps: 2250,
    treasuryFactory: ea(100004), coreFactory: ea(100005), factoryRuntimeHash: eh(45), runtimeHash: eh(46),
    deployment: { ...point(10), transactionHash: eh(47), logIndex: 3 } };
  const data = { schemaVersion: 1, chainId: 31337, profile: projectTreasuryProfile, treasuryFactory: proof.treasuryFactory,
    checkpoint: point(12), treasuries: [structuredClone(proof)], events: [{ ...point(11), treasury: proof.treasury,
      event: "FundingReceived", transactionHash: eh(48), logIndex: 0, asset: ea(100006), amountWei: "17", source: eh(0) }] };
  let calls = 0;
  const header = async (n: bigint) => { calls++; return { number: n, hash: eh(Number(n)), timestamp: n }; };
  return { proof, data, header, calls: () => calls };
}
test("indexed history independently corroborates the current checkpoint, exact birth and each event block", async () => {
  const f = fixture(), actual = await validateIndexedTreasuryHistory(f.data, f.proof, 14n, f.header);
  assert.equal(actual.history.indexed, true); assert.equal(actual.events.length, 1); assert.equal(f.calls(), 3);
});
test("wrong chain, factory, birth, duplicated and malformed events never become indexed evidence", async () => {
  const mutations = [
    (v: ReturnType<typeof fixture>["data"]) => { v.chainId = 4663; },
    (v: ReturnType<typeof fixture>["data"]) => { v.treasuryFactory = ea(100007); },
    (v: ReturnType<typeof fixture>["data"]) => { v.treasuries[0].creator = ea(100007); },
    (v: ReturnType<typeof fixture>["data"]) => { v.treasuries[0].deployment.transactionHash = eh(99); },
    (v: ReturnType<typeof fixture>["data"]) => { v.treasuries[0].runtimeHash = eh(99); },
    (v: ReturnType<typeof fixture>["data"]) => { v.events.push(structuredClone(v.events[0])); },
    (v: ReturnType<typeof fixture>["data"]) => { v.events[0].treasury = ea(100007); },
    (v: ReturnType<typeof fixture>["data"]) => { v.events[0].event = "PurchaseExecuted"; },
    (v: ReturnType<typeof fixture>["data"]) => { v.events[0].amountWei = "-1"; },
    (v: ReturnType<typeof fixture>["data"]) => { v.events[0].transactionHash = "invalid" as Hex; },
    (v: ReturnType<typeof fixture>["data"]) => { v.events[0].blockNumber = "13"; },
    (v: ReturnType<typeof fixture>["data"]) => { v.events[0].timestamp = "invalid"; },
  ];
  for (const mutation of mutations) { const f = fixture(); mutation(f.data);
    await assert.rejects(validateIndexedTreasuryHistory(f.data, f.proof, 14n, f.header)); assert.equal(f.calls(), 0); }
});
test("provider failure, orphan hashes, future checkpoints and inconsistent block timestamps fail closed", async () => {
  for (const change of ["hash", "time", "height", "missing"] as const) {
    const f = fixture();
    await assert.rejects(validateIndexedTreasuryHistory(f.data, f.proof, 14n, async height => {
      if (change === "missing") throw Error("Archive unavailable");
      return { number: change === "height" ? height + 1n : height,
        hash: change === "hash" ? eh(98) : eh(Number(height)), timestamp: change === "time" ? height + 1n : height };
    }));
  }
  const f = fixture(); await assert.rejects(validateIndexedTreasuryHistory(f.data, f.proof, 11n, f.header)); assert.equal(f.calls(), 0);
});
