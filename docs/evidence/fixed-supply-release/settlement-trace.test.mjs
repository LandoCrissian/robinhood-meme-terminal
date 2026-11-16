import assert from "node:assert/strict";
import test from "node:test";
import { observedMutationGraph } from "../../../packages/contracts/scripts/prove-fixed-supply-settlement-trace.mjs";

const sender = "0x0000000000000000000000000000000000000001";
const engine = "0x0000000000000000000000000000000000000002";
const reader = "0x0000000000000000000000000000000000000003";
const stray = "0x0000000000000000000000000000000000000004";
const admitted = new Set([engine, reader]);
const frame = (type, from, to, overrides = {}) => ({ type, from, to, input: "0x", ...overrides });
const root = (calls = []) => frame("CALL", sender, engine, { calls });

test("keeps all ordinary call edges while omitting admitted static reads", () => {
  const trace = root([frame("STATICCALL", engine, reader, { calls: [frame("STATICCALL", reader, engine)] }), frame("CALL", engine, reader, {
    input: "0x12345678", value: "0x01",
  })]);
  const graph = observedMutationGraph(trace, admitted);
  assert.deepEqual(graph.map(({ depth, to, selector, value }) => [depth, to, selector, value]), [
    [0, engine, "0x", "0"],
    [1, reader, "0x12345678", "1"],
  ]);
});

test("rejects unexpected static targets and static descendants", () => {
  assert.throws(() => observedMutationGraph(root([frame("STATICCALL", engine, stray)]), admitted),
    /Unexpected settlement read target/);
  assert.throws(() => observedMutationGraph(root([frame("STATICCALL", engine, reader, {
    calls: [frame("CALL", reader, engine)],
  })]), admitted), /action beneath a static read/);
});

test("rejects delegatecalls, failed frames, and disconnected caller identities", () => {
  assert.throws(() => observedMutationGraph(root([frame("DELEGATECALL", engine, reader)]), admitted),
    /Unexpected trace operation/);
  assert.throws(() => observedMutationGraph(root([frame("CALL", engine, reader, { error: "revert" })]), admitted),
    /failed internal frame/);
  assert.throws(() => observedMutationGraph(root([frame("CALL", stray, reader)]), admitted),
    /Disconnected trace frame/);
});
