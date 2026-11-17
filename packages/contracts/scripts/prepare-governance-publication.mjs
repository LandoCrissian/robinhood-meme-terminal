import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { verifyProtocolReceipt } from "../../../scripts/production-readiness/protocol-receipt.mjs";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "../../../scripts/production-readiness/rpc.mjs";
import { privateOutputPath } from "./prepare-unsigned-4663.mjs";
import { protocolStageCandidate } from "./protocol-constructor-readiness.mjs";
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, hashTypedData, isAddressEqual, keccak256, parseAbi, toHex, zeroAddress, zeroHash } = require("viem");
const policy = JSON.parse(readFileSync(new URL("../../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations;
export const publicationActionTypes = Object.freeze({ Action: [
  { name: "kind", type: "uint8" }, { name: "nonce", type: "uint64" }, { name: "version", type: "uint32" },
  { name: "factory", type: "address" }, { name: "runtimeHash", type: "bytes32" },
  { name: "signerSetEpoch", type: "uint64" }, { name: "deadline", type: "uint48" },
] });
export const publicationDomainTypes = Object.freeze([
  { name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
]);
const noticeSeconds = 172800, executionWindowSeconds = 604800;
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const decimal = /^(0|[1-9][0-9]{0,19})$/;
const hash = /^0x[0-9a-f]{64}$/i;
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const same = (a, b) => typeof a === "string" && typeof b === "string" && isAddressEqual(a, b);
const abi = parseAbi([
  "function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
  "function signerSetEpoch() view returns(uint64)", "function nonce() view returns(uint64)", "function latestVersion() view returns(uint32)",
  "function suspended() view returns(bool)", "function pending() view returns(bytes32,uint48,uint48)",
  "function pendingRotation() view returns(bytes32,uint48,uint48)", "function publicationDelay() view returns(uint48)",
  "function executionWindow() view returns(uint48)", "function factories(uint32) view returns(address,bytes32)",
  "function migrationTemplates(uint32) view returns(address,bytes32)",
  "function actionDigest((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)) view returns(bytes32)",
  "function engineVersion() view returns(uint32)", "function fromVersion() view returns(uint32)", "function toVersion() view returns(uint32)",
]);
const tuple = (message) => ({ ...message, nonce: BigInt(message.nonce), signerSetEpoch: BigInt(message.signerSetEpoch), deadline: BigInt(message.deadline) });
export const publicationDigest = (typedData) => hashTypedData({ ...typedData, types: publicationActionTypes });

/** Pure exact-domain formatting. A production CLI obtains the state through bounded read-only RPCs below. */
export function buildPublicationAction({ action, directory, target, runtimeHash, nonce, signerSetEpoch, blockTimestamp,
  deadline = BigInt(blockTimestamp) + BigInt(noticeSeconds + executionWindowSeconds), owners = policy.owners, testOnly = false },
  { allowTestFixture = false } = {}) {
  assert.ok(!testOnly || allowTestFixture, "Test-only governance inputs cannot prepare production authorization");
  assert.ok(action === "publish-factory" || action === "publish-v3-template");
  assert.ok(same(directory, directory) && !same(directory, zeroAddress) && same(target, target) && !same(target, zeroAddress));
  assert.ok(hash.test(runtimeHash) && runtimeHash !== zeroHash);
  assert.ok(decimal.test(String(nonce)) && BigInt(nonce) < 1n << 64n);
  assert.ok(decimal.test(String(signerSetEpoch)) && BigInt(signerSetEpoch) > 0n && BigInt(signerSetEpoch) < 1n << 64n);
  const now = BigInt(blockTimestamp), limit = BigInt(deadline);
  assert.ok(limit >= now + BigInt(noticeSeconds) && limit <= now + BigInt(noticeSeconds + executionWindowSeconds) && limit < 1n << 48n,
    "Signing deadline must preserve the real notice and bounded execution window");
  assert.equal(owners.length, 3); assert.equal(new Set(owners.map((x) => x.toLowerCase())).size, 3);
  if (!testOnly) assert.deepEqual(owners, policy.owners, "Only the approved governance owner set is admitted");
  const typedData = { domain: { name: "RMT Launch Curve Directory", version: "2", chainId: 4663, verifyingContract: directory },
    types: { EIP712Domain: publicationDomainTypes, ...publicationActionTypes }, primaryType: "Action",
    message: { kind: action === "publish-factory" ? 0 : 4, nonce: String(nonce), version: action === "publish-factory" ? 1 : 3,
      factory: target, runtimeHash, signerSetEpoch: String(signerSetEpoch), deadline: limit.toString() } };
  return { schemaVersion: 1, scope: "UNSIGNED_DIRECTORY_PUBLICATION_AUTHORIZATION", action, chainId: 4663, directory,
    testOnly, owners, requiredSignatures: 2, typedData, digest: publicationDigest(typedData),
    noticeSeconds, maximumExecutionWindowSeconds: executionWindowSeconds,
    signingDeadlineUtc: new Date(Number(limit) * 1000).toISOString(), broadcastAuthorized: false,
    scheduleTransaction: null, executeAfter: null, executionPolicy: "Two current signatures authorize a later owner-approved schedule transaction. No execution before the canonical schedule plus 172800 real seconds." };
}

async function reconcilePublishedDirectory(packet, proof, readers) {
  const candidate = packet.plan.constructors[0];
  assert.equal(proof.scope, "READ_ONLY_4663_PROTOCOL_CREATE_RECEIPT"); assert.equal(proof.chainId, 4663);
  assert.equal(proof.status, "L2_DEPLOYMENT_VERIFIED"); assert.ok(same(proof.expectedAddress, candidate.address));
  assert.equal(proof.initcodeHash, candidate.initcodeHash);
  assert.equal(proof.runtimeHash, candidate.runtimeHash); assert.equal(proof.planSha256, packet.plan.planSha256);
  const rows = await Promise.all(["official", "pocket"].map(async (name) => {
    const reader = readers[name], tx = await value(reader, "eth_getTransactionByHash", [proof.transactionHash]);
    const receipt = await value(reader, "eth_getTransactionReceipt", [proof.transactionHash]);
    assert.ok(tx.type === "0x2" && tx.chainId === "0x1237" && tx.to === null && tx.value === "0x0" &&
      same(tx.from, packet.plan.sender) && tx.hash?.toLowerCase() === proof.transactionHash.toLowerCase() && BigInt(tx.nonce).toString() === candidate.nonce && tx.input === candidate.initcode &&
      !Object.hasOwn(tx, "authorizationList") && Array.isArray(tx.accessList) && tx.accessList.length === 0);
    assert.ok(receipt.status === "0x1" && receipt.type === "0x2" && receipt.to === null && same(receipt.from, packet.plan.sender) &&
      receipt.transactionIndex === tx.transactionIndex && Array.isArray(receipt.logs) && receipt.logs.length === 0 && same(receipt.contractAddress, candidate.address) &&
      receipt.transactionHash.toLowerCase() === proof.transactionHash.toLowerCase() && receipt.blockHash === proof.blockHash &&
      BigInt(receipt.blockNumber).toString() === proof.receiptBlock && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber);
    const block = await value(reader, "eth_getBlockByNumber", [receipt.blockNumber, false]); assert.equal(block.hash, receipt.blockHash);
    assert.equal(keccak256(await value(reader, "eth_getCode", [candidate.address, "latest"])), candidate.runtimeHash);
    return { hash: receipt.blockHash, block: receipt.blockNumber, transaction: tx.hash };
  }));
  assert.deepEqual(rows[0], rows[1]);
  return { ...proof, canonicalReceiptRechecked: true, currentStatePolicy: "EXPLICIT_PUBLICATION_STATE_RECHECK_FOLLOWS; ORIGINAL_INITIAL_STATE_EVIDENCE_PRESERVED" };
}
async function value(reader, method, params) {
  const row = await reader(method, params); assert.equal(row.status, "observed", "Required governance evidence is unavailable: " + method); return row.value;
}
async function call(reader, address, tag, functionName, args = []) {
  return decodeFunctionResult({ abi, functionName, data: await value(reader, "eth_call", [{ to: address,
    data: encodeFunctionData({ abi, functionName, args }) }, tag]) });
}
function runtimePin(address, code, expected) {
  assert.equal(keccak256(code), expected, "Governance dependency runtime differs");
  return { address, sha256: sha256(Buffer.from(code.slice(2), "hex")), byteLength: (code.length - 2) / 2, runtimeHash: expected };
}
/** This is preparation only. It never requests a wallet signature or admits a transaction method. */
export async function prepareGovernancePublication({ packet, action = "publish-factory", deploymentProofs, deadline,
  readers = Object.fromEntries(["official", "pocket"].map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })])),
  now = Date.now } = {}) {
  assert.ok(!packet?.testOnly);
  const { plan } = protocolStageCandidate(packet, "bootstrap");
  assert.equal(deploymentProofs?.length, 5, "All five canonical protocol deployment receipts are required");
  const verified = [];
  for (const [index, proof] of deploymentProofs.entries()) {
    assert.equal(proof.id, ids[index]); assert.equal(proof.status, "L2_DEPLOYMENT_VERIFIED");
    const current = action === "publish-v3-template" && index === 0
      ? await reconcilePublishedDirectory(packet, proof, readers)
      : await verifyProtocolReceipt({ packet, id: ids[index], hash: proof.transactionHash, readers, now });
    assert.equal(current.status, "L2_DEPLOYMENT_VERIFIED", "A required protocol receipt could not be reverified");
    verified.push(current);
  }
  const heads = await Promise.all(["official", "pocket"].map((name) => value(readers[name], "eth_getBlockByNumber", ["latest", false])));
  const height = heads.map((h) => BigInt(h.number)).reduce((a, b) => a < b ? a : b), tag = toHex(height);
  const directory = plan.constructors[0], target = action === "publish-factory" ? plan.bootstrapChildren[2] : plan.constructors[3];
  const readState = async (name) => {
    const reader = readers[name], header = await value(reader, "eth_getBlockByNumber", [tag, false]);
    assert.equal(BigInt(header.number), height); assert.ok(hash.test(header.hash));
    assert.ok(Math.abs(now() - Number(BigInt(header.timestamp)) * 1000) < 180000, "Governance canonical observation is stale");
    const state = Object.fromEntries(await Promise.all(["signerA", "signerB", "signerC", "signerSetEpoch", "nonce", "latestVersion",
      "suspended", "pending", "pendingRotation", "publicationDelay", "executionWindow"].map(async (field) => [field, await call(reader, directory.address, tag, field)])));
    for (const [field, expected] of Object.entries(state)) assert.deepEqual(await call(reader, directory.address, "pending", field), expected,
      "Pending governance authority differs from the canonical signing state");
    assert.deepEqual([state.signerA, state.signerB, state.signerC].map((x) => x.toLowerCase()), policy.owners.map((x) => x.toLowerCase()));
    assert.equal(state.suspended, false, "Discovery is suspended; publication authorization requires a separate incident decision");
    assert.deepEqual(state.pending, [zeroHash, 0, 0]); assert.deepEqual(state.pendingRotation, [zeroHash, 0, 0]);
    assert.equal(Number(state.publicationDelay), noticeSeconds); assert.equal(Number(state.executionWindow), executionWindowSeconds);
    if (action === "publish-factory") { assert.equal(Number(state.latestVersion), 0); assert.equal(Number(await call(reader, target.address, tag, "engineVersion")), 1); }
    else {
      assert.equal(Number(state.latestVersion), 1, "The factory publication must execute before V3-template authorization");
      const factory = await call(reader, directory.address, tag, "factories", [1]);
      assert.ok(same(factory[0], plan.bootstrapChildren[2].address)); assert.equal(factory[1], plan.bootstrapChildren[2].runtimeHash);
      const existing = await call(reader, directory.address, tag, "migrationTemplates", [3]); assert.deepEqual(existing, [zeroAddress, zeroHash]);
      assert.equal(Number(await call(reader, target.address, tag, "fromVersion")), 2); assert.equal(Number(await call(reader, target.address, tag, "toVersion")), 3);
    }
    const pins = [];
    for (const candidate of [...plan.constructors, ...plan.bootstrapChildren]) {
      const code = await value(reader, "eth_getCode", [candidate.address, tag]);
      assert.equal(await value(reader, "eth_getCode", [candidate.address, "pending"]), code);
      pins.push(runtimePin(candidate.address, code, candidate.runtimeHash));
    }
    for (const owner of policy.owners) for (const at of [tag, "pending"]) assert.equal(await value(reader, "eth_getCode", [owner, at]), "0x", "Governance owner is not an eligible EOA");
    return { name, header, state, pins };
  };
  const witnesses = await Promise.all(["official", "pocket"].map(readState));
  assert.equal(witnesses[0].header.hash, witnesses[1].header.hash); assert.deepEqual(witnesses[0].state, witnesses[1].state); assert.deepEqual(witnesses[0].pins, witnesses[1].pins);
  const current = witnesses[0], authorization = buildPublicationAction({ action, directory: directory.address, target: target.address,
    runtimeHash: target.runtimeHash, nonce: current.state.nonce, signerSetEpoch: current.state.signerSetEpoch,
    blockTimestamp: BigInt(current.header.timestamp), deadline });
  const actionTuple = tuple(authorization.typedData.message);
  const digests = await Promise.all(["official", "pocket"].map((name) => call(readers[name], directory.address, tag, "actionDigest", [actionTuple])));
  assert.ok(digests.every((d) => d === authorization.digest), "Directory actionDigest differs from the exact EIP-712 publication digest");
  const readChecks = [];
  for (const [field, expected] of Object.entries(current.state)) readChecks.push({ data: encodeFunctionData({ abi, functionName: field }),
    expected: encodeFunctionResult({ abi, functionName: field, result: expected }) });
  readChecks.push({ data: encodeFunctionData({ abi, functionName: "actionDigest", args: [actionTuple] }), expected: authorization.digest });
  // actionDigest is a single bytes32 ABI word, equal to the digest itself.
  for (const name of ["official", "pocket"]) assert.equal((await value(readers[name], "eth_getBlockByNumber", [tag, false])).hash, current.header.hash);
  return { ...authorization, protocolSender: plan.sender, sourcePlanSha256: plan.planSha256, compilerInputSha256: plan.compiler.inputSha256,
    observedAt: new Date(now()).toISOString(), observationBlock: { number: height.toString(), hash: current.header.hash,
      timestamp: BigInt(current.header.timestamp).toString() }, directoryChecks: readChecks, runtimePins: current.pins,
    target: { address: target.address, runtimeHash: target.runtimeHash },
    protocolReceipts: verified.map((proof, index) => ({ id: ids[index], hash: proof.transactionHash, blockHash: proof.blockHash,
      blockNumber: proof.receiptBlock, address: plan.constructors[index].address, input: plan.constructors[index].initcode,
      nonce: toHex(BigInt(plan.constructors[index].nonce)), value: "0x0" })),
    publicSourceVerification: { status: "INCOMPLETE_EXTERNAL_VERIFICATION", atPreparation: "Successor V3 and bootstrap child Blockscout verification remains pending or rate-limited (HTTP 429). Exact materialized compiler/runtime identity is separately verified.",
      independentAudit: false },
    finality: "L1_UNVERIFIED", strictSecurityGate: "FAIL_HIGH_22_RETAINED", governanceMediumObservations: 7 };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { packet: { type: "string" }, proofs: { type: "string" }, action: { type: "string", default: "publish-factory" },
    deadline: { type: "string" }, output: { type: "string" } } });
  const output = privateOutputPath(values.output);
  const result = await prepareGovernancePublication({ packet: JSON.parse(readFileSync(values.packet)), deploymentProofs: JSON.parse(readFileSync(values.proofs)),
    action: values.action, deadline: values.deadline });
  writeFileSync(output, JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Prepared an unsigned, chain-bound publication authorization; no signature or transaction requested.");
}
