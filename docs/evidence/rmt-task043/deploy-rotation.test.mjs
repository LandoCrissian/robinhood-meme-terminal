import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { webTools } from "./compile-rotation-profile.mjs";
import { governanceTypedData, validateInputs } from "./deploy-rotation.mjs";

const viem = webTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT || fileURLToPath(new URL("../../../", import.meta.url)));
const template = JSON.parse(readFileSync(new URL("./deploy-rotation-inputs.json", import.meta.url), "utf8"));
const address = (number) => viem.getAddress(viem.toHex(0xabc1230000n + BigInt(number), { size: 20 }));
const directoryAction = {
  schema: "action", verifyingContract: address(1),
  message: { kind: 0, nonce: 2n, version: 1, factory: address(2), runtimeHash: viem.zeroHash,
    signerSetEpoch: 1n, deadline: 246_000n },
};
const migration = {
  schema: "migration", verifyingContract: address(3),
  message: { token: address(4), sourceCurve: address(5), nonce: 2n, fromVersion: 1, nextCurve: address(6),
    runtimeHash: viem.zeroHash, signerSetEpoch: 1n, deadline: 246_000n },
};
const cli = (...args) => spawnSync(process.execPath,
  [fileURLToPath(new URL("./deploy-rotation.mjs", import.meta.url)), ...args], { encoding: "utf8" });

test("owner allocations stay unassigned and direct output is blocked", () => {
  assert.equal(validateInputs(template, viem.getAddress).length, 22);
  assert.throws(() => validateInputs({ ...template, profile: "rmt-curve-v1-4663-treasury-review-v1" }, viem.getAddress), /rotation profile/);
  const result = cli();
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.state, "BLOCKED_NO_BROADCAST");
  assert.equal(status.broadcastAuthorized, false);
  assert.equal(status.derivedDeployment, null);
  const output = resolve(tmpdir(), "rmt-rotation-must-not-emit-" + process.pid + ".json");
  const denied = cli("--output", output);
  assert.equal(denied.status, 1, denied.stderr);
  assert.match(denied.stderr, /unassigned inputs/);
  assert.equal(statSync(output, { throwIfNoEntry: false }), undefined);
});

test("action and migration bind to distinct domains and signer epochs", () => {
  const action = governanceTypedData(directoryAction, viem);
  const proposal = governanceTypedData(migration, viem);
  assert.deepEqual(action.domain, { name: "RMT Launch Curve Directory", version: "2", chainId: 4663, verifyingContract: address(1) });
  assert.deepEqual(proposal.domain, { name: "RMT Launch Project Registry", version: "3", chainId: 4663, verifyingContract: address(3) });
  assert.deepEqual(proposal.types.EIP712Domain.map(({ name }) => name), ["name", "version", "chainId", "verifyingContract"]);
  for (const [unsigned, typed] of [[directoryAction, action], [migration, proposal]]) {
    assert.notEqual(typed.digest, viem.hashTypedData({ ...typed, domain: { ...typed.domain, chainId: 31337 } }));
    assert.notEqual(typed.digest, governanceTypedData({ ...unsigned, verifyingContract: address(7) }, viem).digest);
    assert.notEqual(typed.digest, governanceTypedData({ ...unsigned, message: { ...unsigned.message, signerSetEpoch: 2 } }, viem).digest);
    assert.equal(typed.message.signerSetEpoch, "1");
  }
});

test("rotation, acceptance and cancellation carry different complete typed data", () => {
  const input = {
    schema: "rotation", verifyingContract: address(1),
    message: { departingSigner: address(8), incomingSigner: address(9), signerSetEpoch: 1, nonce: 0, deadline: 246_000 },
  };
  const rotation = governanceTypedData(input, viem);
  const acceptance = governanceTypedData({ ...input, schema: "acceptance", message: { rotationDigest: rotation.digest } }, viem);
  const cancellation = governanceTypedData({ ...input, schema: "cancellation", message: {
    rotationDigest: rotation.digest, signerSetEpoch: 1, nonce: 0, deadline: 245_000,
  } }, viem);
  assert.equal(rotation.primaryType, "SignerRotation");
  assert.equal(acceptance.primaryType, "RotationAcceptance");
  assert.equal(cancellation.primaryType, "RotationCancellation");
  assert.equal(new Set([rotation.digest, acceptance.digest, cancellation.digest]).size, 3);
});

test("typed data rejects another chain field, noncanonical numbers and the old migration schema", () => {
  assert.throws(() => governanceTypedData({ ...directoryAction, chainId: 1 }, viem), /Exact governance input/);
  const { signerSetEpoch, ...oldMigration } = migration.message;
  assert.equal(signerSetEpoch, 1n);
  assert.throws(() => governanceTypedData({ ...migration, message: oldMigration }, viem), /Exact governance fields/);
  for (const signerSetEpoch of ["01", "1e3", 1.5, -1, 1n << 64n]) {
    assert.throws(() => governanceTypedData({ ...migration, message: { ...migration.message, signerSetEpoch } }, viem), /unsigned integer|overflow/);
  }
});
