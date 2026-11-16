import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pinnedSafeCreationRows } from "../../../packages/contracts/scripts/mobile-review-plan.mjs";
import { assertFreshUnsignedBinding, assertUnsignedDependencyEvidence, assertUnsignedGovernanceEvidence, privateOutputPath }
  from "../../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { deriveFutureCreateDestinations } from "../../../scripts/production-readiness/mobile-sender.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, keccak256, parseAbi } = require("viem");
const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const recorded = read("sender-delegation-4663.json");
const now = Date.parse(recorded.observedAt) + 1_000;
const next = () => ({ ...structuredClone(recorded), observedAt: new Date(now).toISOString(),
  expiresAt: new Date(Date.parse(recorded.expiresAt) + 1_000).toISOString() });

test("unsigned package binds two current observations and rejects staleness, reuse and nonce drift", () => {
  const later = next();
  assert.equal(assertFreshUnsignedBinding(recorded, later, now).pendingNonce, recorded.sender.pendingNonce);
  assert.throws(() => assertFreshUnsignedBinding(recorded, recorded, now), /independent later/);
  assert.throws(() => assertFreshUnsignedBinding(recorded, later, now + 121_000), /Stale/);
  const changed = (BigInt(recorded.sender.pendingNonce) + 1n).toString();
  later.sender.confirmedNonce = changed;
  later.sender.pendingNonce = changed;
  for (const provider of later.sender.providers) {
    for (const field of ["pendingBefore", "pendingAfter", "confirmedNonce"]) {
      if (provider[field] !== undefined) provider[field] = changed;
    }
  }
  later.sender.createDestinations = deriveFutureCreateDestinations(changed)
    .map((destination, i) => ({ ...later.sender.createDestinations[i], ...destination }));
  assert.throws(() => assertFreshUnsignedBinding(recorded, later, now), /nonce drift/);
});

test("dependency attestation must match the exact sender anchor and frozen runtime pins", () => {
  const { externalRuntimePins } = read("../fixed-supply-security/4663-profile.json");
  const evidence = { scope: "READ_ONLY_4663_DEPENDENCY_BINDING", chainId: 4663, broadcastAuthorized: false,
    anchor: recorded.sender.anchor, expiresAt: recorded.expiresAt, status: "CORROBORATED",
    providers: ["official", "pocket"], runtimePins: externalRuntimePins };
  assert.equal(assertUnsignedDependencyEvidence(evidence, recorded, externalRuntimePins, now), evidence);
  for (const invalid of [
    { status: "UNVERIFIED" }, { chainId: 31337 }, { broadcastAuthorized: true }, { providers: ["pocket", "pinax"] },
    { providers: ["official", "official"] }, { expiresAt: recorded.observedAt }, { runtimePins: [] },
    { anchor: { ...evidence.anchor, number: "1" } },
  ]) assert.throws(() => assertUnsignedDependencyEvidence({ ...evidence, ...invalid }, recorded, externalRuntimePins, now));
});

test("governance evidence requires all three exact accounts code-empty on both pinned providers and the same block", () => {
  const { owners } = pinnedSafeCreationRows()[0].details;
  const anchor = recorded.sender.anchor;
  const evidence = { status: "ELIGIBLE_AT_PINNED_BLOCK", anchor: { ...anchor, timestamp: anchor.blockTimeUtc },
    wallets: owners.map((address) => ({ address, codeState: "EMPTY", codes: { official: "0x", pinax: "0x" },
      keyControl: "UNVERIFIED", policyEligible: true })) };
  assert.equal(assertUnsignedGovernanceEvidence(evidence, anchor, owners), evidence);
  for (const replacement of [
    { policyEligible: false }, { codeState: "EIP_7702_DELEGATION" }, { codes: { official: "0x", pinax: "0x01" } },
    { codes: { official: "0x" } }, { keyControl: "PRESUMED" }, { address: owners[1] },
  ]) {
    const changed = [{ ...evidence.wallets[0], ...replacement }, ...evidence.wallets.slice(1)];
    assert.throws(() => assertUnsignedGovernanceEvidence({ ...evidence, wallets: changed }, anchor, owners));
  }
  assert.throws(() => assertUnsignedGovernanceEvidence({ ...evidence, anchor: { ...evidence.anchor, number: "1" } },
    anchor, owners));
});

test("only explicitly private Safe rows contain exact initializer calldata", () => {
  const publicRows = pinnedSafeCreationRows();
  const privateRows = pinnedSafeCreationRows({ includePrivateCalldata: true });
  const abi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns(address proxy)"]);
  assert.notEqual(privateRows[0].expectedAddress, privateRows[1].expectedAddress);
  for (const [index, { calldata, ...row }] of privateRows.entries()) {
    assert.deepEqual(publicRows[index], row);
    assert.equal(keccak256(calldata), row.dataHash);
    const { functionName, args: [singleton, initializer, saltNonce] } = decodeFunctionData({ abi, data: calldata });
    assert.equal(functionName, "createProxyWithNonce");
    assert.equal(singleton.toLowerCase(), row.details.singleton.toLowerCase());
    assert.equal(keccak256(initializer), row.details.initializerHash);
    assert.equal(saltNonce, BigInt(row.details.saltNonce));
    assert.equal(row.details.threshold, 2);
    assert.equal(row.details.owners.length, 3);
    assert.equal(row.details.beneficiaryStatus, "UNASSIGNED");
  }
});

test("the generator requires fresh absolute paths outside source control", (context) => {
  const outside = mkdtempSync(join(tmpdir(), "rmt-unsigned-path-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const newOutput = join(outside, "unsigned.json");
  context.after(() => {
    rmSync(newOutput, { force: true });
    rmSync(join(outside, ".git"), { force: true });
    rmdirSync(outside);
  });
  assert.throws(() => privateOutputPath("unsigned.json"), /absolute/);
  assert.throws(() => privateOutputPath(join(root, "unsigned.json")), /outside the checkout/);
  assert.equal(privateOutputPath(newOutput), newOutput);
  assert.equal(existsSync(newOutput), false);
  writeFileSync(newOutput, "existing");
  assert.throws(() => privateOutputPath(newOutput), /fresh/);
  writeFileSync(join(outside, ".git"), "simulated Git worktree marker");
  assert.throws(() => privateOutputPath(join(outside, "another.json")), /outside Git worktrees/);
});
