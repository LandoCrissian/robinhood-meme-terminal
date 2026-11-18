import assert from "node:assert/strict";
import test from "node:test";
import { atLifecycleStage, lifecycleFailureDiagnostic } from "./test-lifecycle-diagnostics";

test("fixture diagnostics preserve the exact inner stage and allowlisted invariant only", async () => {
  await assert.rejects(atLifecycleStage("curve-state", () => atLifecycleStage("indexed-discovery", async () => {
    throw new Error("Indexed curve unavailable");
  })), error => {
    assert.deepEqual(lifecycleFailureDiagnostic(error), {
      stage: "indexed-discovery", kind: "unknown", reason: "indexed-curve-unavailable",
    });
    return true;
  });
});

test("fixture gas diagnostics identify a nested RPC timeout without exposing its request", async () => {
  const timeout = Object.assign(new Error("https://private.invalid/?apikey=never-return-this"), {
    name: "TimeoutError", requestBody: { privateKey: "never-return-this" },
  });
  const upstream = Object.assign(new Error("rpc request includes secrets"), { name: "EstimateGasExecutionError", cause: timeout });
  await assert.rejects(atLifecycleStage("gas-estimate", async () => { throw upstream; }), error => {
    assert.deepEqual(lifecycleFailureDiagnostic(error), { stage: "gas-estimate", kind: "TimeoutError" });
    assert.doesNotMatch(JSON.stringify(lifecycleFailureDiagnostic(error)), /private|apikey|secret|never-return/);
    return true;
  });
});

test("fixture diagnostics disclose only a four-byte revert selector, never encoded arguments", async () => {
  const revert = { name: "ContractFunctionRevertedError", data: "0x12345678" + "ab".repeat(32), message: "private revert text" };
  await assert.rejects(atLifecycleStage("simulation", async () => { throw revert; }), error => {
    assert.deepEqual(lifecycleFailureDiagnostic(error), {
      stage: "simulation", kind: "ContractFunctionRevertedError", revertSelector: "0x12345678",
    });
    return true;
  });
});

test("fixture diagnostics bound malformed, cyclic and oversized upstream data", () => {
  const cyclic: { cause?: unknown; name: string; message: string; data: string } = {
    name: "https://secret.invalid", message: "not an admitted invariant", data: "0x12345678" + "aa".repeat(513),
  };
  cyclic.cause = cyclic;
  for (const value of [cyclic, null, undefined, "sensitive provider message"]) {
    assert.deepEqual(lifecycleFailureDiagnostic(value), { stage: "request", kind: "unknown" });
  }
});

test("diagnostic wrapping does not retry, alter return values or convert failures to success", async () => {
  let calls = 0;
  assert.equal(await atLifecycleStage("simulation", async () => { calls++; return 42; }), 42);
  await assert.rejects(atLifecycleStage("simulation", async () => { calls++; throw new Error("failure"); }));
  assert.equal(calls, 2);
});
