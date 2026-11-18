import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { materializeProjectTreasuryRuntime } from "../../../../packages/launchpad-common/project-treasury-runtime.mjs";
import { handleProjectTreasuryRead, handleProjectTreasuryTest, readTreasuryBody } from "./project-treasury-actions";
import { configuredProjectTreasuryFixture, projectTreasuryControllerKind, type TreasuryRpc } from "./project-treasury-fixture";
import { fixture as claimFixture } from "./claim-profile-test-fixture";

const address = (digit: string): Hex => `0x${digit.repeat(40)}`;
const hash = (digit: string): Hex => `0x${digit.repeat(64)}`;
const names = { "1": "creator", "2": "deploymentFactory", "3": "intentId", "4": "treasuryShareBps", "5": "deploymentChainId" };
const refs = Object.fromEntries(Object.keys(names).map((id, i) => [id, [{ start: 32 * i, length: 32 }]]));
const fields = { creator: address("1"), deploymentFactory: address("2"), intentId: hash("3"), treasuryShareBps: 2250, deploymentChainId: 31337 as const };
const template = ("0x" + "00".repeat(160) + "deadbeef") as Hex;

test("new-controller admission preserves the stricter three-owner two-approval Safe profile", async () => {
  const f = claimFixture("safe-1.4.1"), rpc = f.context.rpc as unknown as TreasuryRpc;
  assert.equal(await projectTreasuryControllerKind(rpc, f.creator, 10n), "safe-1.4.1");
  f.state.threshold = 1n; assert.equal(await projectTreasuryControllerKind(rpc, f.creator, 10n), "unsupported");
  f.state.threshold = 3n; assert.equal(await projectTreasuryControllerKind(rpc, f.creator, 10n), "unsupported");
  f.state.threshold = 2n; f.state.badOwner = true;
  assert.equal(await projectTreasuryControllerKind(rpc, f.creator, 10n), "unsupported");
  f.state.badOwner = false; f.state.badHandler = true;
  assert.equal(await projectTreasuryControllerKind(rpc, f.creator, 10n), "unsupported");
});
test("controller code unavailability is never inferred to be an eligible EOA", async () => {
  const f = claimFixture(), rpc = f.context.rpc as unknown as TreasuryRpc;
  assert.equal(await projectTreasuryControllerKind(rpc, f.creator, 10n), "eoa");
  f.state.malformedCode = true; await assert.rejects(projectTreasuryControllerKind(rpc, f.creator, 10n));
  f.state.malformedCode = false; f.state.throwCode = true; await assert.rejects(projectTreasuryControllerKind(rpc, f.creator, 10n));
});

test("runtime identity covers every constructor immutable and preserves executable bytes", () => {
  const actual = materializeProjectTreasuryRuntime(template, refs, names, fields);
  assert.equal(actual, "0x" + [BigInt(fields.creator), BigInt(fields.deploymentFactory), BigInt(fields.intentId), 2250n, 31337n]
    .map(value => value.toString(16).padStart(64, "0")).join("") + "deadbeef");
  for (const patch of [{ creator: address("4") }, { deploymentFactory: address("5") }, { intentId: hash("6") },
    { treasuryShareBps: 9000 }, { deploymentChainId: 4663 as const }]) {
    assert.notEqual(materializeProjectTreasuryRuntime(template, refs, names, { ...fields, ...patch }), actual);
  }
});
test("runtime materialization rejects overlapping, partial, unknown and oversized layouts", () => {
  for (const [r, n, f, t] of [
    [{ ...refs, "2": [{ start: 16, length: 32 }] }, names, fields, template],
    [{ ...refs, "1": [{ start: 0, length: 20 }] }, names, fields, template],
    [{ ...refs, "1": [{ start: 1000, length: 32 }] }, names, fields, template],
    [refs, { ...names, "1": "controller" }, fields, template],
    [refs, names, { ...fields, treasuryShareBps: 9001 }, template],
    [refs, names, { ...fields, deploymentChainId: 1 }, template],
    [refs, names, fields, "0x" + "00".repeat(24577)],
  ] as const) assert.throws(() => materializeProjectTreasuryRuntime(t as Hex, r as never, n, f as never));
});
test("request reader bounds UTF-8 bytes, closes streams, and rejects invalid encodings", async () => {
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(9)); }, cancel() { cancelled = true; } });
  await assert.rejects(readTreasuryBody(oversized, 8)); assert.equal(cancelled, true);
  for (const value of ["[]", "null", "0", "{", JSON.stringify({ name: "éééé" })]) {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } });
    await assert.rejects(readTreasuryBody(stream, 8));
  }
  const invalid = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([0x7b, 0x22, 0xff])); controller.close(); } });
  await assert.rejects(readTreasuryBody(invalid));
  const valid = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"action":"preview"}')); controller.close(); } });
  assert.deepEqual(await readTreasuryBody(valid), { action: "preview" });
});
test("missing, malformed and hosted fixture flags fail closed without RPC or wallet access", async () => {
  const keys = ["RMT_PROJECT_TREASURY_FIXTURE", "RMT_PROJECT_TREASURY_DEPLOYMENT", "RMT_CURVE_FIXTURE", "NETLIFY", "RAILWAY_ENVIRONMENT_ID"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error("Public treasury must not reach an RPC"); };
  try {
    for (const options of [{}, { RMT_PROJECT_TREASURY_FIXTURE: "1" },
      { RMT_PROJECT_TREASURY_FIXTURE: "local-reviewed-project-treasury-v1", RMT_PROJECT_TREASURY_DEPLOYMENT: "relative.json" },
      { RMT_PROJECT_TREASURY_FIXTURE: "local-reviewed-project-treasury-v1", RMT_CURVE_FIXTURE: "rmt-curve-fixed-supply-security-v2", NETLIFY: "true" },
      { RMT_PROJECT_TREASURY_FIXTURE: "local-reviewed-project-treasury-v1", RMT_CURVE_FIXTURE: "rmt-curve-fixed-supply-security-v2", RAILWAY_ENVIRONMENT_ID: "hosted" }]) {
      for (const key of keys) delete process.env[key]; Object.assign(process.env, options);
      assert.equal(configuredProjectTreasuryFixture(new Headers({ Host: "www.rmtlaunch.fun" })), null);
      const read = await handleProjectTreasuryRead(new Request(`https://www.rmtlaunch.fun/api/launchpad/project-treasury?address=${address("1")}`));
      assert.equal((await read.json()).executionEnabled, false); assert.match(read.headers.get("cache-control")!, /no-store/);
      for (const operation of ["create-treasury", "claim-curve", "set-purchases", "execute-withdrawal"]) {
        const result = await handleProjectTreasuryTest(new Request("https://www.rmtlaunch.fun/api/launchpad/test-project-treasury", {
          method: "POST", headers: { Origin: "https://www.rmtlaunch.fun", "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", operation, account: address("1") }),
        }));
        assert.equal(result.status, 404); assert.equal((await result.json()).executionEnabled, false);
      }
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
