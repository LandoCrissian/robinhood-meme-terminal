import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fixtureRpc, fixtureRpcTimeoutMs, type CurveFixture } from "./curve-fixture";
import { atLifecycleStage, lifecycleFailureDiagnostic } from "./test-lifecycle-diagnostics";

async function withRpcRead(delayMs: number | null, work: (fixture: CurveFixture, methods: string[]) => Promise<void>) {
  const methods: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw) as { id: number; method: string };
      methods.push(body.method);
      if (delayMs === null) return; // Deliberately unavailable read; never a synthetic success.
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: body.id, jsonrpc: "2.0", result: "0x" }));
      }, delayMs);
      timers.add(timer);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const binding = server.address();
  assert.ok(binding && typeof binding === "object");
  const fixture: CurveFixture = {
    origin: "http://127.0.0.1:3100", rpcUrl: `http://127.0.0.1:${binding.port}`,
    indexerUrl: "http://127.0.0.1:3300", factory: "0x1111111111111111111111111111111111111111",
    factoryRuntimeHash: `0x${"a".repeat(64)}`, registry: "0x2222222222222222222222222222222222222222",
    registryRuntimeHash: `0x${"b".repeat(64)}`, deploymentBlock: 1n, deploymentBlockHash: `0x${"c".repeat(64)}`,
    feeRecipient: "0x3333333333333333333333333333333333333333",
  };
  try { await work(fixture, methods); }
  finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const call = {
  account: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222",
  data: "0x", blockNumber: 1n,
} as const;

test("loopback simulation accepts a three-second read without retrying or broadcasting", async () => {
  assert.equal(fixtureRpcTimeoutMs, 10_000);
  await withRpcRead(3_200, async (fixture, methods) => {
    const result = await atLifecycleStage("simulation", () => fixtureRpc(fixture).call(call));
    assert.equal(result.data, undefined);
    assert.deepEqual(methods, ["eth_call"]);
  });
});

test("loopback simulation retains a finite timeout, fails closed and does not retry", async () => {
  await withRpcRead(null, async (fixture, methods) => {
    await assert.rejects(atLifecycleStage("simulation", () => fixtureRpc(fixture).call(call)), error => {
      assert.deepEqual(lifecycleFailureDiagnostic(error), { stage: "simulation", kind: "TimeoutError" });
      return true;
    });
    assert.deepEqual(methods, ["eth_call"]);
  });
});
