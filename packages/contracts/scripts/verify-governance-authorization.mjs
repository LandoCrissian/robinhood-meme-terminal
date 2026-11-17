import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { publicationDigest, publicationActionTypes, publicationDomainTypes, prepareGovernancePublication } from "./prepare-governance-publication.mjs";
import { privateOutputPath } from "./prepare-unsigned-4663.mjs";
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, isAddressEqual, parseAbi, parseSignature, recoverTypedDataAddress } = require("viem");
const policy = JSON.parse(readFileSync(new URL("../../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations;
const halfOrder = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Cryptographically validates responses; it does not approve, sign or submit the later schedule transaction. */
export async function verifyGovernanceAuthorization(publication, authorization, { now = Date.now(), allowTestFixture = false } = {}) {
  assert.ok(!publication.testOnly || allowTestFixture, "Test-only governance signatures cannot prepare production scheduling");
  assert.equal(publication.scope, "UNSIGNED_DIRECTORY_PUBLICATION_AUTHORIZATION");
  assert.equal(publication.chainId, 4663); assert.equal(publication.broadcastAuthorized, false);
  assert.equal(publication.requiredSignatures, 2);
  if (!publication.testOnly) assert.deepEqual(publication.owners, policy.owners);
  assert.ok(publication.action === "publish-factory" || publication.action === "publish-v3-template");
  assert.equal(publication.typedData.message.kind, publication.action === "publish-factory" ? 0 : 4);
  assert.equal(publication.typedData.message.version, publication.action === "publish-factory" ? 1 : 3);
  assert.deepEqual(publication.typedData.types, { EIP712Domain: publicationDomainTypes, ...publicationActionTypes });
  assert.equal(publication.typedData.primaryType, "Action");
  assert.equal(publication.typedData.domain.chainId, 4663);
  assert.equal(publication.typedData.domain.name, "RMT Launch Curve Directory");
  assert.equal(publication.typedData.domain.version, "2");
  assert.ok(isAddressEqual(publication.typedData.domain.verifyingContract, publication.directory));
  assert.equal(publicationDigest(publication.typedData), publication.digest);
  const message = publication.typedData.message;
  assert.ok(BigInt(message.deadline) >= BigInt(Math.floor(now / 1000)) + 172800n, "Insufficient remaining notice time; reprepare and recollect both approvals");
  assert.equal(authorization?.schemaVersion, 1);
  assert.equal(authorization.scope, "OWNER_COLLECTED_DIRECTORY_TYPED_SIGNATURES");
  assert.equal(authorization.digest, publication.digest);
  assert.equal(authorization.directory.toLowerCase(), publication.directory.toLowerCase());
  assert.deepEqual(authorization.typedData, publication.typedData, "Signed action or EIP-712 domain differs");
  assert.ok(Array.isArray(authorization.signatureResponses) && authorization.signatureResponses.length === 2, "Exactly two responses are required");
  const checked = [];
  for (const response of authorization.signatureResponses) {
    assert.match(response.signature, /^0x[0-9a-f]{130}$/i, "Directory admits canonical 65-byte ECDSA signatures");
    const parsed = parseSignature(response.signature);
    assert.ok(parsed.s && BigInt(parsed.s) > 0n && BigInt(parsed.s) <= halfOrder, "High-s or zero signatures are not admitted by the Directory");
    assert.ok(parsed.v === 27n || parsed.v === 28n);
    const signer = await recoverTypedDataAddress({ ...publication.typedData, types: publicationActionTypes, signature: response.signature });
    assert.ok(isAddressEqual(signer, response.signer), "Wallet response attribution does not match recovered signer");
    assert.ok(publication.owners.some((owner) => isAddressEqual(owner, signer)), "Signature is not from a current approved governance owner");
    assert.ok(!checked.some((item) => isAddressEqual(item.signer, signer)), "Duplicate governance signer");
    checked.push({ signer, signature: response.signature });
  }
  const abi = parseAbi(["function schedule((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline),bytes,bytes)"]);
  const data = encodeFunctionData({ abi, functionName: "schedule", args: [{ ...message, nonce: BigInt(message.nonce),
    signerSetEpoch: BigInt(message.signerSetEpoch), deadline: BigInt(message.deadline) }, checked[0].signature, checked[1].signature] });
  return { schemaVersion: 1, status: "TWO_DISTINCT_GOVERNANCE_SIGNATURES_VERIFIED", digest: publication.digest,
    directory: publication.directory, signers: checked.map((x) => x.signer), signatureSha256: checked.map((x) => sha256(x.signature)),
    scheduleCalldata: data, scheduleValueWei: "0", signingAuthorized: false, broadcastAuthorized: false,
    execution: "Schedule remains a separate owner-approved wallet transaction. Verify its canonical receipt and wait the real two-day notice before execution." };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { publication: { type: "string" }, authorization: { type: "string" }, packet: { type: "string" },
    proofs: { type: "string" }, output: { type: "string" } } });
  const output = privateOutputPath(values.output), publication = JSON.parse(readFileSync(values.publication));
  assert.ok(!publication.testOnly);
  const verified = await verifyGovernanceAuthorization(publication, JSON.parse(readFileSync(values.authorization)));
  const refreshed = await prepareGovernancePublication({ packet: JSON.parse(readFileSync(values.packet)), deploymentProofs: JSON.parse(readFileSync(values.proofs)),
    action: publication.action, deadline: publication.typedData.message.deadline });
  assert.equal(refreshed.digest, publication.digest, "Governance authority changed; both signatures must be recollected");
  writeFileSync(output, JSON.stringify({ ...verified, authorityRecheckedAt: refreshed.observedAt,
    authorityObservationBlock: refreshed.observationBlock }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Verified two current typed signatures and fresh authority. Private schedule calldata prepared; no wallet request or transaction submitted.");
}
