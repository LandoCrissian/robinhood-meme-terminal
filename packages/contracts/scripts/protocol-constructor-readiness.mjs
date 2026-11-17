import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { protocolReceiptPlan, verifyProtocolReceipt } from "../../../scripts/production-readiness/protocol-receipt.mjs";
import { verifySafeCreation } from "../../../scripts/production-readiness/safe.mjs";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "../../../scripts/production-readiness/rpc.mjs";
import { MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { pinnedSafeCreationRows, safeProxyRuntimeHash } from "./mobile-review-plan.mjs";
import { approvedRmtTerms, privateOutputPath } from "./prepare-unsigned-4663.mjs";
import { directoryReviewCandidate, probePreparedConstructor } from "./constructor-readiness.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionData, decodeFunctionResult, getContractAddress, getCreate2Address,
  isAddressEqual, keccak256, parseAbi, toHex, padHex, stringToHex, zeroHash } = require("viem");
const load = (name) => JSON.parse(readFileSync(new URL("../../../docs/evidence/" + name, import.meta.url)));
const profile = load("fixed-supply-security/4663-profile.json");
const policy = load("rmt-task045/operations-safe-policy.json").operations;
const safeInfrastructure = load("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const fixedHelpers = load("fixed-supply-release/unsigned-bundle.json").fixtureOnly.transactions;
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const names = ["official", "pocket"];
const hash = /^0x[0-9a-f]{64}$/i;
const sentinel = "0x0000000000000000000000000000000000000001";
const dependencyType = { type: "tuple", components: [
  { name: "poolManager", type: "address" }, { name: "positionManager", type: "address" }, { name: "permit2", type: "address" },
  { name: "poolManagerHash", type: "bytes32" }, { name: "positionManagerHash", type: "bytes32" }, { name: "permit2Hash", type: "bytes32" },
] };
const typed = (...types) => types.map((type) => ({ type }));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => typeof left === "string" && typeof right === "string" && isAddressEqual(left, right);

function pinCreation(candidate, args) {
  const template = profile.templates[candidate.contract];
  assert.ok(template, "Contract is outside the frozen compiler closure");
  const creation = candidate.initcode.slice(2, 2 + template.creationBytes * 2);
  assert.equal(sha256(Buffer.from(creation, "hex")), template.creationSha256, "Creation bytecode differs from the frozen profile");
  assert.equal("0x" + candidate.initcode.slice(2 + creation.length), args, "Committed constructor inputs differ");
  assert.equal(keccak256(candidate.initcode), candidate.initcodeHash);
  assert.equal(candidate.runtimeBytes, template.runtimeBytes);
  assert.equal(candidate.initcodeBytes, (candidate.initcode.length - 2) / 2);
}

/** Admit only the four already-prepared protocol constructors. No nonce rebasing or arbitrary initcode is supported. */
export function protocolStageCandidate(packet, id) {
  assert.ok(ids.slice(1).includes(id), "Use one of the four remaining protocol stage ids");
  const { plan, evidence, candidate } = protocolReceiptPlan(packet, id);
  directoryReviewCandidate(packet);
  assert.deepEqual(plan.terms, approvedRmtTerms, "Approved economic configuration differs");
  const [directory, registry, v2, v3, bootstrap] = plan.constructors;
  const safes = pinnedSafeCreationRows();
  assert.equal(plan.safeReceipts?.length, 2);
  for (const [index, receipt] of plan.safeReceipts.entries()) {
    assert.equal(receipt.status, "L2_CREATION_VERIFIED");
    assert.equal(receipt.chainId, 4663);
    assert.equal(receipt.role, index === 0 ? "RMT-OPERATIONS" : "RMT-RESERVE");
    assert.ok(same(receipt.safe, safes[index].expectedAddress) && hash.test(receipt.hash) && hash.test(receipt.blockHash));
    assert.equal(receipt.broadcastAuthorized, false);
  }
  pinCreation(registry, encodeAbiParameters(typed("address"), [directory.address]));
  pinCreation(v2, "0x"); pinCreation(v3, "0x");
  assert.equal(v2.runtimeHash, fixedHelpers.find(({ name }) => name === "successor-v2").runtimeHash);
  assert.equal(v3.runtimeHash, fixedHelpers.find(({ name }) => name === "successor-v3").runtimeHash);
  const { poolManager, positionManager, permit2 } = profile.externalRuntimePins;
  const dependencies = [poolManager.address, positionManager.address, permit2.address,
    poolManager.runtimeHash, positionManager.runtimeHash, permit2.runtimeHash];
  const [guard, engine, factory] = plan.bootstrapChildren;
  assert.ok(same(engine.address, getContractAddress({ from: bootstrap.address, nonce: 2n })));
  assert.ok(same(factory.address, getContractAddress({ from: bootstrap.address, nonce: 3n })));
  pinCreation(guard, encodeAbiParameters(typed("address", "address"), [poolManager.address, engine.address]));
  assert.ok(hash.test(guard.create2Salt) && same(guard.address, getCreate2Address({ from: bootstrap.address,
    salt: guard.create2Salt, bytecodeHash: guard.initcodeHash })));
  assert.equal(BigInt(guard.address) & 0x3fffn, 0x2000n);
  pinCreation(engine, encodeAbiParameters([dependencyType, ...typed("address", "address")], [dependencies, factory.address, guard.address]));
  pinCreation(factory, encodeAbiParameters(typed("address", "address", "address", "address", "address", "bytes32", "uint256"),
    [engine.address, safes[0].expectedAddress, safes[1].expectedAddress, registry.address, v2.address, v2.runtimeHash,
      BigInt(approvedRmtTerms.creationFeeWei)]));
  pinCreation(bootstrap, encodeAbiParameters([dependencyType, ...typed("bytes32", "address", "address", "address", "address", "bytes32", "uint256")],
    [dependencies, guard.create2Salt, safes[0].expectedAddress, safes[1].expectedAddress, registry.address, v2.address,
      v2.runtimeHash, BigInt(approvedRmtTerms.creationFeeWei)]));
  return { plan, evidence, candidate: { ...candidate, request: candidate.unsigned }, requiredPredecessors: plan.constructors.slice(0, ids.indexOf(id)) };
}

export function validatePredecessorProofs(packet, id, proofs) {
  const stage = protocolStageCandidate(packet, id);
  assert.ok(Array.isArray(proofs) && proofs.length === stage.requiredPredecessors.length,
    "Every preceding constructor requires its actual canonical receipt proof");
  for (const [index, candidate] of stage.requiredPredecessors.entries()) {
    const proof = proofs[index];
    assert.equal(proof?.status, "L2_DEPLOYMENT_VERIFIED", "Predecessor is not verified");
    assert.equal(proof.id, candidate.id); assert.equal(proof.chainId, 4663);
    assert.equal(proof.planSha256, stage.plan.planSha256);
    assert.equal(proof.initcodeHash, candidate.initcodeHash); assert.equal(proof.runtimeHash, candidate.runtimeHash);
    assert.ok(same(proof.expectedAddress, candidate.address) && hash.test(proof.transactionHash) && proof.transactionHash !== zeroHash &&
      hash.test(proof.blockHash) && /^[1-9][0-9]*$/.test(proof.receiptBlock));
    assert.equal(proof.broadcastAuthorized, false);
  }
  return stage;
}

async function observed(reader, method, params = []) {
  const result = await reader(method, params);
  assert.ok(result?.status === "observed" && result.value !== null && result.value !== undefined,
    "Required protocol readiness observation is unavailable: " + method);
  return result.value;
}

export async function observeProtocolBindings(packet, stage, anchor, evidenceReaders) {
  const tag = toHex(BigInt(anchor.number));
  const abi = parseAbi(["function masterCopy() view returns(address)", "function VERSION() view returns(string)",
    "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)", "function nonce() view returns(uint256)",
    "function getModulesPaginated(address,uint256) view returns(address[] array,address next)", "function getStorageAt(uint256,uint256) view returns(bytes)"]);
  const getter = async (read, address, block, functionName, args = []) => decodeFunctionResult({ abi, functionName,
    data: await observed(read, "eth_call", [{ to: address, data: encodeFunctionData({ abi, functionName, args }) }, block]) });
  const result = [];
  for (const provider of names) {
    const read = evidenceReaders[provider];
    assert.equal(await observed(read, "eth_chainId"), "0x1237");
    const block = await observed(read, "eth_getBlockByNumber", [tag, false]);
    assert.equal(block.hash, anchor.hash);
    for (const predecessor of stage.requiredPredecessors) for (const at of [tag, "pending"]) {
      assert.equal(keccak256(await observed(read, "eth_getCode", [predecessor.address, at])), predecessor.runtimeHash,
        "A predecessor's deployed runtime changed");
    }
    const safeStates = [];
    for (const receipt of packet.plan.safeReceipts) for (const at of [tag, "pending"]) {
      const address = receipt.safe;
      assert.equal(keccak256(await observed(read, "eth_getCode", [address, at])), safeProxyRuntimeHash);
      assert.ok(same(await getter(read, address, at, "masterCopy"), policy.singleton));
      assert.equal(await getter(read, address, at, "VERSION"), "1.4.1");
      const actualOwners = await getter(read, address, at, "getOwners");
      assert.equal(actualOwners.length, 3);
      assert.ok(policy.owners.every((owner) => actualOwners.some((actual) => same(actual, owner))));
      assert.equal(await getter(read, address, at, "getThreshold"), 2n);
      assert.equal(await getter(read, address, at, "nonce"), 0n, "Treasury activity requires a new permissions review");
      const modules = await getter(read, address, at, "getModulesPaginated", [sentinel, 1n]);
      assert.equal(modules[0].length, 0); assert.ok(same(modules[1], sentinel));
      const slot = (name) => BigInt(keccak256(stringToHex(name)));
      assert.equal((await getter(read, address, at, "getStorageAt", [slot("fallback_manager.handler.address"), 1n])).toLowerCase(),
        padHex(policy.setup.fallbackHandler, { size: 32 }).toLowerCase());
      assert.equal(await getter(read, address, at, "getStorageAt", [slot("guard_manager.guard.address"), 1n]), zeroHash);
      safeStates.push({ role: receipt.role, at, status: "APPROVED_INITIAL_CONFIGURATION_UNCHANGED" });
    }
    for (const pin of Object.values(profile.externalRuntimePins)) for (const at of [tag, "pending"]) {
      assert.equal(keccak256(await observed(read, "eth_getCode", [pin.address, at])), pin.runtimeHash,
        "A pinned Uniswap dependency runtime differs");
    }
    for (const pin of [safeInfrastructure.safe_l2, safeInfrastructure.safe_proxy_factory,
      safeInfrastructure.compatibility_fallback_handler]) for (const at of [tag, "pending"]) {
      assert.equal(keccak256(await observed(read, "eth_getCode", [pin.address, at])), pin.registryRuntimeKeccak256,
        "A pinned Safe infrastructure runtime differs");
    }
    for (const owner of policy.owners) for (const at of [tag, "pending"]) {
      assert.equal(await observed(read, "eth_getCode", [owner, at]), "0x", "Governance owner no longer has the admitted account type");
    }
    result.push({ provider, blockHash: block.hash, safeStates, predecessorRuntimeChecks: stage.requiredPredecessors.length,
      dependencyRuntimeChecks: Object.keys(profile.externalRuntimePins).length });
  }
  return result;
}

/** Fresh reads only. No fixture hash, state override, nonce rebasing or transaction submission is accepted. */
export async function probeProtocolConstructor(packet, { id, predecessorProofs, evidenceReaders,
  transactionReaders, fetcher = fetch, now = Date.now, receiptVerifier = verifyProtocolReceipt, safeVerifier = verifySafeCreation } = {}) {
  const stage = validatePredecessorProofs(packet, id, predecessorProofs);
  evidenceReaders ??= Object.fromEntries(names.map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })]));
  const safeReceipts = [];
  for (const receipt of packet.plan.safeReceipts) {
    const proof = await safeVerifier({ reader: evidenceReaders.pocket, corroboratingReader: evidenceReaders.official,
      role: receipt.role, hash: receipt.hash, approvedPayer: MOBILE_DEPLOYMENT_PAYER });
    assert.equal(proof.status, "L2_CREATION_VERIFIED");
    assert.equal(proof.hash, receipt.hash); assert.equal(proof.blockHash, receipt.blockHash);
    assert.ok(same(proof.safe, receipt.safe));
    safeReceipts.push(proof);
  }
  const predecessors = [];
  for (const proof of predecessorProofs) {
    const fresh = await receiptVerifier({ packet, id: proof.id, hash: proof.transactionHash, readers: evidenceReaders, now });
    assert.equal(fresh.status, "L2_DEPLOYMENT_VERIFIED", "Predecessor receipt/state is unavailable or invalidated");
    for (const field of ["id", "transactionHash", "blockHash", "receiptBlock", "planSha256", "initcodeHash", "runtimeHash"]) {
      assert.equal(fresh[field], proof[field], "Predecessor canonical identity changed: " + field);
    }
    predecessors.push(fresh);
  }
  const result = await probePreparedConstructor(stage.candidate, { readers: transactionReaders, fetcher, now });
  assert.equal((result.runtime.runtimeCode.length - 2) / 2, stage.candidate.runtimeBytes,
    "CREATE simulation runtime size differs from the frozen template");
  const bindings = await observeProtocolBindings(packet, stage, result.review.anchor, evidenceReaders);
  for (const provider of names) {
    assert.equal((await observed(evidenceReaders[provider], "eth_getBlockByNumber", [toHex(BigInt(result.review.anchor.number)), false])).hash,
      result.review.anchor.hash, "Protocol readiness anchor was reorganized");
    assert.equal(await observed(evidenceReaders[provider], "eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"]),
      stage.candidate.request.nonce, "Sender nonce changed while prerequisites were checked");
  }
  return { ...result, review: { ...result.review, id, planSha256: stage.plan.planSha256, safeReceipts,
    predecessors, bindings, status: "PREREQUISITES_AND_CREATE_SIMULATION_VERIFIED", finality: "L1_UNVERIFIED" } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { packet: { type: "string" }, id: { type: "string" },
    predecessors: { type: "string" }, output: { type: "string" }, "runtime-output": { type: "string" } } });
  const output = privateOutputPath(values.output), runtimeOutput = privateOutputPath(values["runtime-output"]);
  assert.notEqual(output.toLowerCase(), runtimeOutput.toLowerCase());
  const supplied = JSON.parse(readFileSync(values.predecessors));
  const result = await probeProtocolConstructor(JSON.parse(readFileSync(values.packet)), { id: values.id,
    predecessorProofs: Array.isArray(supplied) ? supplied : [supplied] });
  writeFileSync(output, JSON.stringify(result.review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(runtimeOutput, JSON.stringify(result.runtime, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Verified the next exact unsigned constructor and all predecessors. No signature or broadcast. Fresh wallet cost approval required.");
}
