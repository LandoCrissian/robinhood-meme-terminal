import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildPublicationAction, publicationActionTypes, publicationDigest, prepareGovernancePublication } from "./prepare-governance-publication.mjs";
import { verifyGovernanceAuthorization } from "./verify-governance-authorization.mjs";
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
// These deterministic keys exist only inside this local unit test. No network provider or wallet is connected.
const accounts = [1, 2, 3, 4].map((n) => privateKeyToAccount("0x" + n.toString(16).padStart(64, "0")));
const now = 1805550000000;
const base = { action: "publish-factory", directory: "0x1000000000000000000000000000000000000001",
  target: "0x2000000000000000000000000000000000000002", runtimeHash: "0x" + "ab".repeat(32),
  nonce: "0", signerSetEpoch: "1", blockTimestamp: Math.floor(now / 1000), owners: accounts.slice(0, 3).map((a) => a.address), testOnly: true };
function publication(overrides = {}) { return buildPublicationAction({ ...base, ...overrides }, { allowTestFixture: true }); }
async function responses(p, pair = [0, 1]) {
  const signatureResponses = [];
  for (const index of pair) signatureResponses.push({ signer: accounts[index].address,
    signature: await accounts[index].signTypedData({ ...p.typedData, types: publicationActionTypes }) });
  return { schemaVersion: 1, scope: "OWNER_COLLECTED_DIRECTORY_TYPED_SIGNATURES", directory: p.directory,
    digest: p.digest, typedData: p.typedData, signatureResponses };
}

test("typed publication pins chain/domain/schema, action and real bounded notice", () => {
  const p = publication(); assert.equal(p.typedData.domain.chainId, 4663);
  assert.equal(p.typedData.message.kind, 0); assert.equal(p.typedData.message.version, 1);
  assert.equal(BigInt(p.typedData.message.deadline) - BigInt(base.blockTimestamp), 777600n);
  assert.equal(p.digest, publicationDigest(p.typedData));
  const v3 = publication({ action: "publish-v3-template", nonce: "1" });
  assert.equal(v3.typedData.message.kind, 4); assert.equal(v3.typedData.message.version, 3);
  assert.throws(() => buildPublicationAction(base), /Test-only/);
  assert.throws(() => publication({ deadline: BigInt(base.blockTimestamp) + 172799n }));
  assert.throws(() => publication({ deadline: BigInt(base.blockTimestamp) + 777601n }));
  assert.throws(() => publication({ nonce: "18446744073709551616" }));
  assert.throws(() => publication({ signerSetEpoch: "0" }));
});

test("two actual synthetic test-key signatures recover distinct admitted owners and exact schedule calldata", async () => {
  const p = publication(), authorization = await responses(p);
  const result = await verifyGovernanceAuthorization(p, authorization, { now, allowTestFixture: true });
  assert.equal(result.status, "TWO_DISTINCT_GOVERNANCE_SIGNATURES_VERIFIED");
  assert.deepEqual(result.signers.map((a) => a.toLowerCase()), accounts.slice(0, 2).map((a) => a.address.toLowerCase()));
  const abi = parseAbi(["function schedule((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline),bytes,bytes)"]);
  const decoded = decodeFunctionData({ abi, data: result.scheduleCalldata });
  assert.equal(decoded.functionName, "schedule"); assert.equal(decoded.args[0].kind, 0);
  assert.equal(decoded.args[0].nonce, 0n); assert.equal(decoded.args[0].signerSetEpoch, 1n);
  assert.equal(decoded.args[1], authorization.signatureResponses[0].signature); assert.equal(result.broadcastAuthorized, false);
  await assert.rejects(verifyGovernanceAuthorization(p, authorization, { now }), /Test-only/);
});

test("duplicate, unauthorized, mislabeled and malformed signatures cannot prepare scheduling", async () => {
  const p = publication();
  for (const pair of [[0, 0], [0, 3]]) await assert.rejects(verifyGovernanceAuthorization(p, await responses(p, pair), { now, allowTestFixture: true }));
  const wrong = await responses(p); wrong.signatureResponses[0].signer = accounts[2].address;
  await assert.rejects(verifyGovernanceAuthorization(p, wrong, { now, allowTestFixture: true }), /attribution/);
  const malformed = await responses(p); malformed.signatureResponses[0].signature = "0x" + "11".repeat(65);
  await assert.rejects(verifyGovernanceAuthorization(p, malformed, { now, allowTestFixture: true }));
});

test("old epoch, nonce, cross-chain, cross-directory and conflicting target signatures fail", async () => {
  const p = publication(), signed = await responses(p);
  for (const change of [
    (next) => { next.typedData.message.nonce = "1"; }, (next) => { next.typedData.message.signerSetEpoch = "2"; },
    (next) => { next.typedData.domain.chainId = 31337; },
    (next) => { next.typedData.domain.verifyingContract = accounts[3].address; next.directory = accounts[3].address; },
    (next) => { next.typedData.message.factory = accounts[3].address; },
  ]) {
    const next = structuredClone(p); change(next); next.digest = publicationDigest(next.typedData);
    const replay = { ...signed, digest: next.digest, typedData: next.typedData, directory: next.directory };
    await assert.rejects(verifyGovernanceAuthorization(next, replay, { now, allowTestFixture: true }));
  }
});

test("insufficient remaining notice and missing real deployment proofs remain blocked", async () => {
  const p = publication();
  await assert.rejects(verifyGovernanceAuthorization(p, await responses(p), { now: now + 8 * 86400000, allowTestFixture: true }), /remaining notice/);
  await assert.rejects(prepareGovernancePublication({ packet: { testOnly: true } }));
});
