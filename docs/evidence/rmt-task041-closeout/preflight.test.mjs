import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { observePreflight } from "./preflight.mjs";

const checkout = process.env.RMT_DEPLOYMENT_TEST_CHECKOUT || fileURLToPath(new URL("../../../", import.meta.url));
const baseViem = webTools(checkout);
const template = JSON.parse(readFileSync(new URL("../rmt-task043/deploy-rotation-inputs.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../rmt-task043/4663-rotation-profile.json", import.meta.url), "utf8"));
const { approved, ...economics } = manifest.provisionalTerms;
assert.equal(approved, false);
const address = (number) => baseViem.getAddress(baseViem.toHex(0xa0421200n + BigInt(number), { size: 20 }));
const confirmations = {
  ...template, operatingTreasury: address(1), futureReserve: address(2), deployer: address(3),
  governanceSigners: [address(4), address(5), address(6)], governanceQuorum: 2, economics,
  ownerApprovalReference: "test-fixture/approved-exact-values",
};
const names = ["directory", "projectRegistry", "v2Template", "bootstrap", "initializationGuard",
  "graduationEngine", "factory", "v3Template"];
const deployment = { prediction: Object.fromEntries(names.map((name, i) => [name, address(i + 20)])) };
const head = { number: "0x12bc", hash: "0x" + "ab".repeat(32), stateRoot: "0x" + "cd".repeat(32),
  timestamp: "0x67223000", gasLimit: "0x1e84800", baseFeePerGas: "0x100" };

function fixture(overrides = {}) {
  const calls = [];
  const pins = Object.values(manifest.externalRuntimePins).map(({ address, runtimeHash }, i) => ({
    address, runtimeHash, code: "0x6001600" + (i + 1),
  }));
  const codeByAddress = new Map(pins.map((pin) => [pin.address.toLowerCase(), pin.code]));
  const hashByCode = new Map(pins.map((pin) => [pin.code, pin.runtimeHash]));
  const viem = { ...baseViem, keccak256: (code) => hashByCode.get(code) ?? baseViem.keccak256(code) };
  async function read(method, params) {
    calls.push([method, params]);
    if (overrides[method]) {
      const value = overrides[method](params, calls);
      if (value !== undefined) return value;
    }
    switch (method) {
      case "eth_chainId": return "0x1237";
      case "eth_getBlockByNumber": return head;
      case "eth_getTransactionCount": return params[0] === confirmations.deployer ? "0x7" : "0x0";
      case "eth_getCode": return codeByAddress.get(params[0].toLowerCase()) ?? "0x";
      case "eth_getBalance": return "0x10";
      case "eth_gasPrice": return "0x200";
      case "eth_estimateGas": return "0x1000";
      default: assert.fail("Unallowlisted method " + method);
    }
  }
  return { calls, read, viem };
}

test("binds direct latest, pending and numbered nonce reads to one rechecked canonical block", async () => {
  const { calls, read, viem } = fixture();
  const result = await observePreflight({ read, viem, input: confirmations });
  assert.equal(result.state, "BLOCKED_NO_BROADCAST");
  assert.equal(result.broadcastAuthorized, false);
  assert.deepEqual(result.deploymentInput, { ...confirmations, confirmedDeployerNonce: "7" });
  assert.deepEqual(result.observation.nonce,
    { latest: "7", pending: "7", anchored: "7", recheckedLatest: "7", recheckedPending: "7" });
  assert.equal(result.observation.block.hash, head.hash);
  assert.equal(result.observation.dependencyPins.length, 6);
  assert.deepEqual(calls.filter(([method]) => method === "eth_getBlockByNumber").map(([, params]) => params),
    [["latest", false], [head.number, false]]);
  for (const role of result.observation.roles) assert.equal(role.ownerControl, "unverified");
});

test("rejects missing approvals, missing roles and unexpected networks before inspecting an account", async () => {
  const wrong = fixture({ eth_chainId: () => "0x1" });
  await assert.rejects(observePreflight({ ...wrong, input: confirmations }), /Unexpected chain ID/);
  assert.deepEqual(wrong.calls, [["eth_chainId", []]]);
  const standard = fixture();
  await assert.rejects(observePreflight({ ...standard, input: template }), /Missing owner inputs/);
  await assert.rejects(observePreflight({ ...standard, input: { ...confirmations, ownerApprovalReference: null } }),
    /explicit owner approval reference/);
  assert.deepEqual(standard.calls, []);
});

test("rejects the known incoming rotation fixture key without inspecting an account", async () => {
  const matrix = JSON.parse(readFileSync(new URL("../rmt-task043/4663-rotation-treasury-matrix.json", import.meta.url), "utf8"));
  const incoming = matrix.cases[0].curve.migrations[0].rotation.rotation.incomingSigner;
  const context = fixture();
  await assert.rejects(observePreflight({ ...context, input: { ...confirmations,
    governanceSigners: [address(4), address(5), incoming] } }), /Known rehearsal account/);
  assert.deepEqual(context.calls, []);
});

test("rejects pending transactions, a lagging snapshot, and drift against an unsigned plan", async () => {
  for (const [tag, reason] of [["pending", /Pending deployer nonce differs/], [head.number, /Anchored deployer nonce differs/]]) {
    const context = fixture({ eth_getTransactionCount: ([, blockTag]) => blockTag === tag ? "0x8" : undefined });
    await assert.rejects(observePreflight({ ...context, input: confirmations }), reason);
  }
  await assert.rejects(observePreflight({ ...fixture(), input: { ...confirmations, confirmedDeployerNonce: "6" }, deployment }),
    /nonce has changed/);
});

test("rejects nonce drift and a changed canonical block during the preflight", async () => {
  for (const tag of ["latest", "pending"]) {
    const context = fixture({ eth_getTransactionCount: ([, blockTag], calls) => blockTag === tag &&
      calls.filter(([method, params]) => method === "eth_getTransactionCount" && params[1] === tag).length === 2 ? "0x8" : undefined });
    await assert.rejects(observePreflight({ ...context, input: confirmations }), /nonce changed during observation/);
  }
  const context = fixture({ eth_getBlockByNumber: ([blockTag]) => blockTag === head.number
    ? { ...head, hash: "0x" + "ef".repeat(32) } : undefined });
  await assert.rejects(observePreflight({ ...context, input: confirmations }), /Canonical observation block changed/);
});

test("fails unsupported governance or deployer accounts and changed dependency pins", async () => {
  for (const role of [confirmations.deployer, confirmations.governanceSigners[1]]) {
    const context = fixture({ eth_getCode: ([target]) => target === role ? "0xef0100" + "01".repeat(20) : undefined });
    await assert.rejects(observePreflight({ ...context, input: confirmations }), /admitted code-empty EOA/);
  }
  const pool = manifest.externalRuntimePins.poolManager.address;
  const wrongPin = fixture({ eth_getCode: ([target]) => target === pool ? "0x60" : undefined });
  await assert.rejects(observePreflight({ ...wrongPin, input: confirmations }), /poolManager runtime pin changed/);
  const sameBeneficiary = fixture();
  await assert.rejects(observePreflight({ ...sameBeneficiary,
    input: { ...confirmations, futureReserve: confirmations.operatingTreasury } }), /reserve must differ/);
  assert.deepEqual(sameBeneficiary.calls, []);
});

test("keeps smart treasury claim eligibility unverified, checks eight vacancies, and separates cost boundaries", async () => {
  const input = { ...confirmations, confirmedDeployerNonce: "7" };
  const firstCreate = { from: input.deployer, nonce: "0x7", data: "0x6001", value: "0x0" };
  const context = fixture({ eth_getCode: ([target]) => target === input.operatingTreasury ? "0x60" : undefined });
  const result = await observePreflight({ ...context, input, deployment, firstCreate });
  assert.equal(result.observation.vacantCreationTargets.length, 8);
  const operating = result.observation.roles.find(({ role }) => role === "operatingTreasury");
  assert.equal(operating.accountCode, "present");
  assert.match(operating.receiveAndClaim, /input-specific wallet/);
  assert.deepEqual(result.observation.fees.firstCreateEstimate,
    { status: "observed", estimatedGas: "4096", gasPriceWei: "512", illustratedCostWei: "2097152",
      illustratedCostEth: "0.000000000002097152" });
  assert.match(result.observation.fees.sequentialEstimate, /exact owner-input fork/);
  const deniedEstimate = fixture({ eth_estimateGas: () => { throw new Error("RPC declined the unfunded request"); } });
  const unavailable = await observePreflight({ ...deniedEstimate, input, deployment, firstCreate });
  assert.equal(unavailable.observation.fees.firstCreateEstimate.status, "unavailable");
  assert.equal(unavailable.broadcastAuthorized, false);
});

test("rejects existing code and an otherwise code-empty account with a nonzero CREATE destination nonce", async () => {
  const input = { ...confirmations, confirmedDeployerNonce: "7" };
  const code = fixture({ eth_getCode: ([target]) => target === deployment.prediction.factory ? "0x6000" : undefined });
  await assert.rejects(observePreflight({ ...code, input, deployment }), /factory CREATE\/CREATE2 destination is occupied/);
  const nonzero = fixture({ eth_getTransactionCount: ([target]) => target === deployment.prediction.initializationGuard
    ? "0x1" : undefined });
  await assert.rejects(observePreflight({ ...nonzero, input, deployment }), /initializationGuard CREATE\/CREATE2 destination is occupied/);
});

test("CLI rejects an unassigned owner sheet without trying the official RPC", () => {
  const script = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
  const blank = fileURLToPath(new URL("../rmt-task043/deploy-rotation-inputs.json", import.meta.url));
  const failure = spawnSync(process.execPath, [script, "--checkout", checkout, "--inputs", blank], {
    encoding: "utf8", timeout: 5_000,
  });
  assert.equal(failure.status, 1, failure.stderr);
  assert.match(failure.stderr, /Missing owner inputs/);
  assert.equal(failure.stdout, "");
});

test("CLI rejects an unsigned plan with a substituted release-gate identity before compilation", () => {
  const folder = mkdtempSync(join(tmpdir(), "rmt-preflight-plan-"));
  const planPath = join(folder, "plan.json");
  const script = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
  try {
    writeFileSync(planPath, JSON.stringify({ profile: manifest.profile, chainId: 4663, state: "BLOCKED_NO_BROADCAST",
      broadcastAuthorized: false, missingInputs: [], releaseManifestSha256Lf: "ff".repeat(32) }), { flag: "wx" });
    const failure = spawnSync(process.execPath,
      [script, "--checkout", checkout, "--plan", planPath, "--solc", "not-used.exe"], { encoding: "utf8", timeout: 5_000 });
    assert.equal(failure.status, 1, failure.stderr);
    assert.match(failure.stderr, /Unsigned plan release manifest mismatch/);
  } finally {
    unlinkSync(planPath);
    rmdirSync(folder);
  }
});
