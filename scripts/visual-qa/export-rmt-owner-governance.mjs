import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildOwnerTransactionReview } from "./export-rmt-owner-safe.mjs";
import { ownerProtocolConfiguration } from "./export-rmt-owner-protocol.mjs";
import { prepareGovernanceTransaction, governanceTransactionAbi } from "../../packages/contracts/scripts/prepare-governance-transaction.mjs";
import { publicationDigest } from "../../packages/contracts/scripts/prepare-governance-publication.mjs";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, encodeFunctionData, keccak256, parseAbi } = require("viem");
const nonceSelector = encodeFunctionData({ abi: parseAbi(["function nonce() view returns(uint256)"]), functionName: "nonce" });
const normalize = (a) => ({ kind: Number(a.kind), nonce: String(a.nonce), version: Number(a.version), factory: a.factory.toLowerCase(),
  runtimeHash: a.runtimeHash.toLowerCase(), signerSetEpoch: String(a.signerSetEpoch), deadline: String(a.deadline) });
export function ownerGovernanceTransactionConfiguration(endpoint, { review, packet, runtimes, directoryRuntime }, options = {}) {
  assert.ok(!review.publication?.testOnly || options.allowTestFixture, "Test-only governance cannot prepare owner transaction pages");
  assert.equal(review.scope, "UNSIGNED_DIRECTORY_GOVERNANCE_TRANSACTION"); assert.equal(review.chainId, 4663);
  assert.equal(review.signingAuthorized, false); assert.equal(review.broadcastAuthorized, false); assert.equal(review.valueWei, "0");
  const publication = review.publication, phase = review.phase, suffix = publication.action === "publish-factory" ? "factory" : "v3-template";
  assert.ok(phase === "schedule" || phase === "execute"); assert.equal(review.id, phase + "-" + suffix);
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === "/governance-" + phase + "-" + suffix + ".html", "Use the exact separate governance transaction HTTPS path");
  const base = ownerProtocolConfiguration(new URL("/protocol-deployment.html", url).href, packet, runtimes, directoryRuntime, options);
  assert.equal(publication.sourcePlanSha256, packet.plan.planSha256); assert.equal(publication.compilerInputSha256, base.compilerInputSha256);
  assert.equal(publication.directory.toLowerCase(), packet.plan.constructors[0].address.toLowerCase());
  assert.equal(review.to.toLowerCase(), publication.directory.toLowerCase()); assert.equal(review.from, base.sender);
  assert.equal(publicationDigest(publication.typedData), publication.digest); assert.equal(review.governance.digest, publication.digest);
  const decoded = decodeFunctionData({ abi: governanceTransactionAbi, data: review.data }); assert.equal(decoded.functionName, phase);
  assert.deepEqual(normalize(decoded.args[0]), normalize(publication.typedData.message)); assert.equal(keccak256(review.data), review.dataHash);
  assert.equal(review.governance.phase, phase); assert.equal(review.governance.actionNonce, publication.typedData.message.nonce);
  assert.equal(review.governance.deadline, publication.typedData.message.deadline);
  assert.equal(publication.protocolReceipts.length, 5); assert.equal(publication.runtimePins.length, 8);
  assert.ok(Array.isArray(review.beforeChecks) && review.beforeChecks.length >= 12 && Array.isArray(review.afterChecks) && review.afterChecks.length >= 11);
  const directoryPin = publication.runtimePins.find((p) => p.address.toLowerCase() === publication.directory.toLowerCase());
  assert.equal(directoryPin.runtimeHash, packet.plan.constructors[0].runtimeHash);
  const protocolPrerequisites = publication.protocolReceipts.map((proof, index) => {
    const candidate = packet.plan.constructors[index]; assert.equal(proof.id, candidate.id);
    assert.equal(proof.address.toLowerCase(), candidate.address.toLowerCase()); assert.equal(proof.input, candidate.initcode);
    const runtime = publication.runtimePins.find((p) => p.address.toLowerCase() === proof.address.toLowerCase()); assert.equal(runtime.runtimeHash, candidate.runtimeHash);
    return { ...proof, receiptBlock: proof.blockNumber, runtime, postState: [] };
  });
  const prerequisites = base.prerequisites.map((p) => ({ ...p, postState: p.postState.filter((s) => s.data !== nonceSelector) }));
  const governance = { ...review.governance, kind: publication.typedData.message.kind, version: publication.typedData.message.version };
  if (phase === "execute") assert.ok(review.governancePredecessor &&
    BigInt(governance.executeAfter) === BigInt(review.governancePredecessor.executeAfter) && BigInt(governance.executeBy) === BigInt(review.governancePredecessor.executeBy));
  return { ...base, endpoint: url.href, mode: "GOVERNANCE_CALL", task: phase === "schedule" ? "OWNER_CONTROLLED_GOVERNANCE_SCHEDULE" : "OWNER_CONTROLLED_GOVERNANCE_EXECUTE",
    role: "GOVERNANCE-" + phase.toUpperCase(), prerequisites, safeNonceGetterData: nonceSelector, protocolPrerequisites,
    preflightContracts: publication.runtimePins.map((p) => ({ address: p.address, runtime: p,
      postState: p.address.toLowerCase() === publication.directory.toLowerCase() ? review.beforeChecks : [] })),
    directoryRuntime: directoryPin, childVacancies: [], createdChildren: [],
    operation: { id: review.id, label: (phase === "schedule" ? "Schedule " : "Execute ") + publication.action,
      reviewTitle: (phase === "schedule" ? "Schedule publication" : "Execute publication"),
      summary: "Exact previously authorized Directory action; existing infrastructure, economics and custody are unchanged. No token is created.",
      to: publication.directory, expectedAddress: publication.directory, data: review.data, dataHash: review.dataHash, owners: publication.owners,
      reviewFields: [["Action digest", publication.digest], ["Target", publication.typedData.message.factory], ["Target runtime hash", publication.typedData.message.runtimeHash],
        ["Directory nonce / signer epoch", publication.typedData.message.nonce + " / " + publication.typedData.message.signerSetEpoch],
        ["Signing deadline UTC", publication.signingDeadlineUtc], ["Notice", phase === "schedule" ? "Two real days from this transaction's canonical block" :
          "Executable only within the verified canonical schedule window"], ...(phase === "execute" ? [["Execute after UTC", new Date(Number(governance.executeAfter) * 1000).toISOString()],
          ["Execute by UTC", new Date(Number(governance.executeBy) * 1000).toISOString()]] : [])] },
    governance, governancePredecessor: review.governancePredecessor, nitroData: review.nitroData, postState: review.afterChecks,
  };
}
export function buildOwnerGovernanceTransactionReview(endpoint, inputs, options) {
  const config = ownerGovernanceTransactionConfiguration(endpoint, inputs, options), result = buildOwnerTransactionReview(config);
  return { ...result, manifest: { ...result.manifest, phase: config.governance.phase, digest: config.governance.digest,
    sourcePlanSha256: inputs.publication?.sourcePlanSha256 ?? inputs.review.publication.sourcePlanSha256, transactionKind: "EXACT_DIRECTORY_CALL", automaticSubmission: false } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { url: { type: "string" }, phase: { type: "string", default: "schedule" }, publication: { type: "string" }, packet: { type: "string" },
      proofs: { type: "string" }, "verified-authorization": { type: "string" }, "schedule-hash": { type: "string" }, runtimes: { type: "string" }, "directory-runtime": { type: "string" },
      output: { type: "string" }, "key-file": { type: "string" } } });
    const json = (path) => JSON.parse(readFileSync(path)), output = privateOutputPath(values.output), keyFile = privateOutputPath(values["key-file"]); assert.notEqual(output.toLowerCase(), keyFile.toLowerCase());
    const packet = json(values.packet), publication = json(values.publication); assert.ok(!publication.testOnly);
    const review = await prepareGovernanceTransaction({ phase: values.phase, publication, packet, deploymentProofs: json(values.proofs),
      verifiedAuthorization: values["verified-authorization"] ? json(values["verified-authorization"]) : undefined, scheduleHash: values["schedule-hash"] });
    const built = buildOwnerGovernanceTransactionReview(values.url, { review, packet, runtimes: json(values.runtimes), directoryRuntime: json(values["directory-runtime"]) });
    writeFileSync(output, built.html, { flag: "wx", mode: 0o600 }); writeFileSync(keyFile, built.accessCode + "\n", { flag: "wx", mode: 0o600 });
    console.log("Prepared the exact governance " + values.phase + " transaction page. Only the owner can approve wallet costs and broadcast.");
  } catch { console.error("No governance wallet page prepared: required authorization, receipt, timing, runtime or current state checks failed. Private signatures were not logged."); process.exitCode = 1; }
}
