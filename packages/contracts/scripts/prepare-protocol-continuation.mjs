import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { governance } from "../../../docs/evidence/rmt-task043/compile-rotation-profile.mjs";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "../../../scripts/production-readiness/rpc.mjs";
import { observeMobileSender, MOBILE_DELEGATE_POLICY } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { verifySafeCreation } from "../../../scripts/production-readiness/safe.mjs";
import { deriveDelegatedConstructors } from "./delegated-mobile-constructors.mjs";
import { buildFixedSupplyInput, compileFixedSupplyProfile } from "./fixed-supply-profile.mjs";
import { mobilePayer, pinnedSafeCreationRows, safeProxyRuntimeHash } from "./mobile-review-plan.mjs";
import { assertApprovedLaunchTerms, approvedRmtTerms, privateOutputPath } from "./prepare-unsigned-4663.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, decodeFunctionResult, getContractAddress, isAddressEqual, keccak256, parseAbi, toHex,
  zeroHash, padHex } = require("viem");
const read = (path) => JSON.parse(readFileSync(new URL("../../../docs/evidence/" + path, import.meta.url)));
const profile = read("fixed-supply-security/4663-profile.json");
const infrastructure = read("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const safePolicy = read("rmt-task045/operations-safe-policy.json").operations;
const plans = pinnedSafeCreationRows();
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const roles = ["RMT-OPERATIONS", "RMT-RESERVE"];
export const operationsCreationHash = "0x7306d15f2ffcab498bd2063615ddaa862b6ff956415e39e4d278f75de84cdad6";
const hash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) !== 0n;
const decimal = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const sameAddress = (left, right) => typeof left === "string" && typeof right === "string" && isAddressEqual(left, right);
const sameAnchor = (left, right) => left?.number === right?.number && left?.hash === right?.hash;
const safeAbi = parseAbi([
  "function masterCopy() view returns(address)", "function VERSION() view returns(string)",
  "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)",
  "function nonce() view returns(uint256)",
  "function getModulesPaginated(address,uint256) view returns(address[] array,address next)",
  "function getStorageAt(uint256,uint256) view returns(bytes)",
]);
const sentinel = "0x0000000000000000000000000000000000000001";
const slot = (name) => BigInt(keccak256("0x" + Buffer.from(name).toString("hex")));

function assertFresh(anchor, observedAt, now) {
  assert.ok(anchor && decimal(anchor.number) && hash(anchor.hash), "Missing canonical continuation anchor");
  for (const time of [anchor.blockTimeUtc, observedAt]) {
    assert.ok(Number.isFinite(Date.parse(time)) && Date.parse(time) <= now + 10_000 && Date.parse(time) >= now - 180_000,
      "Continuation observation is stale or in the future; refresh read-only evidence");
  }
}

function assertSafeState(state) {
  assert.equal(state.runtimeHash, safeProxyRuntimeHash, "Safe proxy runtime differs");
  assert.ok(sameAddress(state.singleton, safePolicy.singleton), "Safe singleton differs");
  assert.equal(state.version, "1.4.1");
  assert.equal(state.threshold, "2");
  assert.equal(state.nonce, "0", "Treasury has been used; independently review its current permissions before deployment");
  assert.ok(Array.isArray(state.owners) && state.owners.length === 3 &&
    safePolicy.owners.every((owner) => state.owners.some((item) => sameAddress(item, owner))), "Safe owners differ");
  assert.deepEqual(state.modules, []);
  assert.ok(sameAddress(state.moduleNext, sentinel));
  assert.equal(state.handler.toLowerCase(), padHex(safePolicy.setup.fallbackHandler, { size: 32 }).toLowerCase());
  assert.equal(state.guard, zeroHash);
}

/** This validates observations, not an authorization to sign or spend. The CLI obtains them directly from pinned read-only RPCs. */
export function validateProtocolContinuationEvidence(evidence, now = Date.now()) {
  assert.equal(evidence?.chainId, 4663);
  assertFresh(evidence.anchor, evidence.observedAt, now);
  assert.deepEqual(evidence.providers, ["official", "pocket"]);
  assert.equal(evidence.broadcastAuthorized, false);
  const { sender } = evidence;
  assert.equal(sender.status, "OBSERVED");
  assert.equal(sender.accountType, "EIP_7702_DELEGATION");
  assert.equal(sender.nonceSynchronized, true);
  assert.ok(sameAnchor(sender.anchor, evidence.anchor));
  assert.ok(decimal(sender.confirmedNonce) && sender.confirmedNonce === sender.pendingNonce,
    "Unresolved sender nonce; recover the original transaction first");
  assert.ok(BigInt(sender.confirmedNonce) + 4n < (1n << 64n) - 1n);
  assert.equal(sender.delegation?.status, "PINNED_RUNTIME");
  for (const key of ["address", "runtimeHash", "designator"]) {
    assert.equal(sender.delegation[key].toLowerCase(), MOBILE_DELEGATE_POLICY[key].toLowerCase(), "Wallet delegation differs");
  }
  assert.ok(Array.isArray(evidence.safeReceipts) && evidence.safeReceipts.length === 2,
    "Both canonical Safe receipts are required; predicted beneficiaries are insufficient");
  assert.ok(Array.isArray(evidence.safeCurrent) && evidence.safeCurrent.length === 2);
  assert.equal(evidence.safeReceipts[0].hash.toLowerCase(), operationsCreationHash);
  assert.notEqual(evidence.safeReceipts[0].hash.toLowerCase(), evidence.safeReceipts[1].hash.toLowerCase());
  for (const [index, receipt] of evidence.safeReceipts.entries()) {
    assert.equal(receipt.status, "L2_CREATION_VERIFIED");
    assert.equal(receipt.chainId, 4663);
    assert.equal(receipt.role, roles[index]);
    assert.ok(hash(receipt.hash) && hash(receipt.blockHash) && decimal(receipt.receiptBlock));
    assert.ok(BigInt(receipt.receiptBlock) <= BigInt(evidence.anchor.number));
    assert.ok(sameAddress(receipt.safe, plans[index].expectedAddress), "Wrong deployed treasury");
    assert.equal(receipt.broadcastAuthorized, false);
    assert.deepEqual(receipt.initializationEvidence, { mode: "FRESH_ARCHIVE_STATE_AND_CANONICAL_RECEIPT",
      archiveProvider: "pocket", canonicalProvider: "official" }, "Receipt-state evidence policy differs");
    const tx = receipt.transactionIdentity;
    assert.equal(tx?.hash?.toLowerCase(), receipt.hash.toLowerCase(), "Missing corroborated creation transaction");
    assert.equal(tx.chainId, "4663");
    assert.ok(sameAddress(tx.from, mobilePayer) && sameAddress(tx.to, plans[index].to));
    assert.equal(tx.inputHash, plans[index].dataHash);
    assert.equal(tx.valueWei, "0");
    assert.ok(decimal(tx.nonce));
    assert.equal(tx.blockNumber, receipt.receiptBlock);
    assert.equal(tx.blockHash, receipt.blockHash);
    const current = evidence.safeCurrent[index];
    assert.equal(current.role, roles[index]);
    assert.ok(sameAddress(current.safe, receipt.safe) && sameAnchor(current.anchor, evidence.anchor));
    assert.deepEqual(current.providers, evidence.providers);
    assertSafeState(current.state);
  }
  assert.deepEqual(evidence.dependencies, profile.externalRuntimePins);
  assert.ok(Array.isArray(evidence.dependencyWitnesses) && evidence.dependencyWitnesses.length === 2);
  for (const [index, witness] of evidence.dependencyWitnesses.entries()) {
    assert.equal(witness.provider, evidence.providers[index]);
    assert.ok(sameAnchor(witness.anchor, evidence.anchor));
    assert.deepEqual(witness.runtimePins, profile.externalRuntimePins);
  }
  assert.deepEqual(evidence.governanceOwners, safePolicy.owners);
  assert.equal(evidence.governanceAccountsCodeEmpty, true);
  assert.ok(Array.isArray(evidence.destinations) && evidence.destinations.length === 5);
  for (const [index, destination] of evidence.destinations.entries()) {
    const nonce = BigInt(sender.pendingNonce) + BigInt(index); // Both Safe transactions are already mined; no +2 offset.
    assert.equal(destination.id, ids[index]);
    assert.equal(destination.nonce, nonce.toString());
    assert.ok(sameAddress(destination.address, getContractAddress({ from: mobilePayer, nonce })), "Wrong CREATE address");
    assert.equal(destination.code, "0x");
    assert.equal(destination.accountNonce, "0");
    assert.equal(destination.pendingCode, "0x");
    assert.equal(destination.pendingAccountNonce, "0");
    assert.deepEqual(destination.providers, evidence.providers);
  }
  return evidence;
}

export function buildProtocolContinuation(compilation, input, evidence, { now = Date.now() } = {}) {
  validateProtocolContinuationEvidence(evidence, now);
  for (const key of ["profile", "chainId", "compilerVersion", "inputSha256", "compilerSettings", "terms", "originalSourceSha256",
    "sourceSha256", "externalRuntimePins", "templates", "size"]) {
    assert.deepEqual(compilation.manifest[key], profile[key], "Frozen compiler closure differs: " + key);
  }
  assert.equal(sha256(input), profile.inputSha256);
  assertApprovedLaunchTerms(input, compilation.manifest.terms);
  for (const [name, artifact] of Object.entries(compilation.artifacts)) {
    assert.equal(sha256(Buffer.from(artifact.bytecode.slice(2), "hex")), profile.templates[name]?.creationSha256,
      "Creation artifact differs from pinned compiler output");
    assert.equal(sha256(Buffer.from(artifact.runtime.slice(2), "hex")), profile.templates[name]?.runtimeSha256,
      "Runtime artifact differs from pinned compiler output");
  }
  const derived = deriveDelegatedConstructors(compilation, {
    sender: mobilePayer, createDestinations: evidence.destinations,
    signers: evidence.governanceOwners, safeAddresses: evidence.safeReceipts.map(({ safe }) => safe),
  }, { includePrivateInitcode: true });
  const constructors = derived.constructors.map((candidate, index) => ({ ...candidate,
    dependsOn: index === 0 ? ["operations-safe", "reserve-safe"] : [ids[index - 1]],
    status: "UNSIGNED_REQUIRES_TRANSACTION_SPECIFIC_OWNER_APPROVAL",
    unsigned: { type: "0x2", chainId: "0x1237", from: mobilePayer, nonce: toHex(BigInt(candidate.nonce)), value: "0x0", data: candidate.initcode },
    fees: null, simulation: "REQUIRED_AGAINST_CURRENT_PREDECESSORS_BEFORE_EACH_OWNER_SIGNATURE",
  }));
  const directory = constructors[0];
  const governanceActions = [
    { id: "schedule-factory", kind: 0, version: 1, target: derived.bootstrapChildren[2], dependsOn: ["bootstrap"] },
    { id: "execute-factory", kind: 0, version: 1, target: derived.bootstrapChildren[2], dependsOn: ["schedule-factory"] },
    { id: "schedule-migration-template", kind: 4, version: 3, target: constructors[3], dependsOn: ["execute-factory"] },
    { id: "execute-migration-template", kind: 4, version: 3, target: constructors[3], dependsOn: ["schedule-migration-template"] },
  ].map(({ target, ...action }) => ({ ...action, to: directory.address, factory: target.address, runtimeHash: target.runtimeHash,
    domain: { ...governance.directory.domain, chainId: 4663, verifyingContract: directory.address },
    actionType: governance.directory.action, requiredSigners: 2, signerSetEpoch: null, actionNonce: null, deadline: null,
    signatures: null, data: null, scheduledDigest: null, executeAfter: null, executeBy: null,
    noticeSeconds: governance.noticeSeconds, maximumExecutionWindowSeconds: governance.maximumExecutionWindowSeconds,
    status: action.id.startsWith("schedule") ? "AWAITING_DEPLOYED_DIRECTORY_AND_TWO_CURRENT_SIGNER_APPROVALS"
      : "AWAITING_CANONICAL_SCHEDULE_AND_REAL_TWO_DAY_NOTICE",
  }));
  const result = {
    schemaVersion: 1, scope: "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS", chainId: 4663,
    status: "OWNER_TRANSACTION_APPROVAL_REQUIRED", broadcastAuthorized: false, signingAuthorized: false,
    observedAt: evidence.observedAt, anchor: evidence.anchor, sender: mobilePayer,
    confirmedNonce: evidence.sender.confirmedNonce, pendingNonce: evidence.sender.pendingNonce,
    safeReceipts: evidence.safeReceipts, safeCurrent: evidence.safeCurrent, evidenceSha256: sha256(JSON.stringify(evidence)),
    compiler: { profile: profile.profile, inputSha256: profile.inputSha256, compilerVersion: profile.compilerVersion },
    terms: approvedRmtTerms, constructors, bootstrapChildren: derived.bootstrapChildren, governanceActions,
    tokenCreation: null, tokenCreationPolicy: "OWNER_CREATES_RMT_LATER_THROUGH_ORDINARY_WEBSITE; NO_TOKEN_ISSUANCE_IN_THIS_QUEUE",
    security: { strictGate: "FAIL_HIGH", highFindings: 22, activeEngineHighFindings: 18, dependencyHighFindings: 4,
      governanceMediumFindings: 7, disposition: "RETAINED; TRANSACTION_SPECIFIC_MATERIAL_SECURITY_HOLDS_APPLY" },
    finality: "L2_CORROBORATED_L1_FINALITY_UNVERIFIED",
    noncePolicy: "Each mined predecessor must match its exact receipt and runtime. Abort on any unexpected nonce use; never resend automatically.",
  };
  return { ...result, planSha256: sha256(JSON.stringify(result)) };
}

async function observed(reader, method, params) {
  const result = await reader(method, params);
  assert.equal(result.status, "observed", "Required read-only continuation evidence unavailable: " + method);
  return result.value;
}

async function readSafeState(reader, safe, tag) {
  const call = async (functionName, args = []) => decodeFunctionResult({ abi: safeAbi, functionName,
    data: await observed(reader, "eth_call", [{ to: safe, data: encodeFunctionData({ abi: safeAbi, functionName, args }) }, tag]) });
  const [code, singleton, version, owners, threshold, nonce, modules, handler, guard] = await Promise.all([
    observed(reader, "eth_getCode", [safe, tag]), call("masterCopy"), call("VERSION"), call("getOwners"), call("getThreshold"), call("nonce"),
    call("getModulesPaginated", [sentinel, 1n]), call("getStorageAt", [slot("fallback_manager.handler.address"), 1n]),
    call("getStorageAt", [slot("guard_manager.guard.address"), 1n]),
  ]);
  const state = { runtimeHash: keccak256(code), singleton, version, owners, threshold: threshold.toString(), nonce: nonce.toString(),
    modules: modules[0], moduleNext: modules[1], handler, guard };
  assertSafeState(state);
  return state;
}

/** Only bounded reads to existing pinned RPCs. No eth_send*, signature, delegation or database operation exists here. */
export async function observeProtocolContinuation({ reserveHash, readers = Object.fromEntries(["official", "pocket"].map((name) =>
  [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] }, { mobileSafePayer: true })])), now = Date.now } = {}) {
  assert.ok(hash(reserveHash) && reserveHash.toLowerCase() !== operationsCreationHash,
    "A confirmed Reserve transaction hash is required; no predicted or fixture receipt is accepted");
  const names = ["official", "pocket"];
  assert.ok(names.every((name) => typeof readers[name] === "function"));
  const safeReceipts = await Promise.all([operationsCreationHash, reserveHash].map(async (transactionHash, index) => {
    // The official endpoint prunes historical state soon after mining. Pocket supplies fresh archive state;
    // the official provider still independently corroborates the canonical receipt and header.
    // A preserved report or operator assertion never substitutes for a failed archive read.
    const receipt = await verifySafeCreation({ reader: readers.pocket, corroboratingReader: readers.official,
      role: roles[index], hash: transactionHash, approvedPayer: mobilePayer });
    const transactions = await Promise.all(names.map(async (name) => {
      const tx = await observed(readers[name], "eth_getTransactionByHash", [transactionHash]);
      return { hash: tx.hash.toLowerCase(), chainId: BigInt(tx.chainId).toString(), from: tx.from.toLowerCase(),
        to: tx.to?.toLowerCase(), inputHash: keccak256(tx.input), valueWei: BigInt(tx.value).toString(),
        nonce: BigInt(tx.nonce).toString(), blockNumber: BigInt(tx.blockNumber).toString(), blockHash: tx.blockHash.toLowerCase() };
    }));
    assert.deepEqual(transactions[0], transactions[1], "Providers disagree on exact Safe creation transaction");
    return { ...receipt, transactionIdentity: transactions[0], initializationEvidence: {
      mode: "FRESH_ARCHIVE_STATE_AND_CANONICAL_RECEIPT", archiveProvider: "pocket", canonicalProvider: "official" } };
  }));
  const sender = await observeMobileSender({ readers, now, allowPinnedDelegation: true, includeCreateDestinations: false });
  const anchor = sender.anchor;
  assertFresh(anchor, new Date(now()).toISOString(), now());
  const tag = toHex(BigInt(anchor.number));
  const safeCurrent = await Promise.all(plans.map(async (plan, index) => {
    const witnesses = await Promise.all(names.map(async (name) => {
      const state = await readSafeState(readers[name], plan.expectedAddress, tag);
      assert.deepEqual(await readSafeState(readers[name], plan.expectedAddress, "pending"), state,
        "Pending Safe configuration differs from canonical state");
      return state;
    }));
    assert.deepEqual(witnesses[0], witnesses[1], "Providers disagree on current Safe configuration");
    return { role: roles[index], safe: plan.expectedAddress, anchor, providers: names, state: witnesses[0] };
  }));
  const dependencyWitnesses = await Promise.all(names.map(async (provider) => {
    const rpc = readers[provider];
    for (const pin of Object.values(profile.externalRuntimePins)) {
      const [code, pendingCode] = await Promise.all([observed(rpc, "eth_getCode", [pin.address, tag]),
        observed(rpc, "eth_getCode", [pin.address, "pending"])]);
      assert.equal(keccak256(code), pin.runtimeHash, "Protocol dependency runtime differs at anchor");
      assert.equal(keccak256(pendingCode), pin.runtimeHash, "Protocol dependency runtime differs at pending state");
    }
    for (const pin of [infrastructure.safe_l2, infrastructure.safe_proxy_factory, infrastructure.compatibility_fallback_handler]) {
      for (const block of [tag, "pending"]) assert.equal(keccak256(await observed(rpc, "eth_getCode", [pin.address, block])),
        pin.registryRuntimeKeccak256, "Safe infrastructure differs");
    }
    for (const owner of safePolicy.owners) for (const block of [tag, "pending"]) {
      assert.equal(await observed(rpc, "eth_getCode", [owner, block]), "0x", "Governance owner is not an admitted EOA");
    }
    return { provider, anchor, runtimePins: profile.externalRuntimePins };
  }));
  assert.ok(decimal(sender.pendingNonce), "Sender nonce is unavailable");
  const destinations = await Promise.all(ids.map(async (id, index) => {
    const nonce = BigInt(sender.pendingNonce) + BigInt(index);
    const address = getContractAddress({ from: mobilePayer, nonce });
    const witnesses = await Promise.all(names.map(async (name) => {
      const rpc = readers[name];
      const [code, accountNonce, pendingCode, pendingAccountNonce] = await Promise.all([
        observed(rpc, "eth_getCode", [address, tag]), observed(rpc, "eth_getTransactionCount", [address, tag]),
        observed(rpc, "eth_getCode", [address, "pending"]), observed(rpc, "eth_getTransactionCount", [address, "pending"]),
      ]);
      return { code, accountNonce: BigInt(accountNonce).toString(), pendingCode, pendingAccountNonce: BigInt(pendingAccountNonce).toString() };
    }));
    assert.deepEqual(witnesses[0], witnesses[1], "Providers disagree on CREATE vacancy");
    return { id, address, nonce: nonce.toString(), ...witnesses[0], providers: names };
  }));
  const after = await observeMobileSender({ readers, anchor, now, allowPinnedDelegation: true, includeCreateDestinations: false });
  for (const key of ["status", "accountType", "confirmedNonce", "pendingNonce", "delegation"]) {
    assert.deepEqual(after[key], sender[key], "Sender or delegation changed during continuation observation");
  }
  for (const name of names) {
    const header = await observed(readers[name], "eth_getBlockByNumber", [tag, false]);
    assert.equal(header.hash.toLowerCase(), anchor.hash, "Continuation anchor was reorganized");
  }
  const result = { chainId: 4663, observedAt: new Date(now()).toISOString(), broadcastAuthorized: false,
    anchor, providers: names, sender: after, safeReceipts, safeCurrent, dependencies: profile.externalRuntimePins, dependencyWitnesses,
    governanceOwners: safePolicy.owners, governanceAccountsCodeEmpty: true, destinations };
  return validateProtocolContinuationEvidence(result, now());
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let stage = "checking confirmed Reserve hash and private output";
  try {
    const { values } = parseArgs({ options: { solc: { type: "string" }, lib: { type: "string" },
      "reserve-hash": { type: "string" }, output: { type: "string" } } });
    assert.ok(hash(values["reserve-hash"]), "Supply the confirmed owner-controlled Reserve transaction hash");
    const output = privateOutputPath(values.output);
    assert.ok(values.solc);
    stage = "compiling and checking the frozen 4663 closure";
    const options = { solc: values.solc, lib: values.lib, chainId: 4663, includeImmutableNames: true };
    const { input } = buildFixedSupplyInput(options);
    const compilation = compileFixedSupplyProfile(options);
    stage = "verifying both actual Safe receipts and fresh protocol inputs";
    const evidence = await observeProtocolContinuation({ reserveHash: values["reserve-hash"] });
    stage = "binding the exact unsigned continuation";
    const plan = buildProtocolContinuation(compilation, input, evidence);
    writeFileSync(output, JSON.stringify({ plan, evidence }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Prepared five unsigned constructors and four separately gated governance actions. No token creation, signature or broadcast. Plan SHA-256 " + plan.planSha256);
  } catch {
    console.error("No transaction prepared: " + stage + " failed. No signing or broadcast occurred.");
    process.exitCode = 1;
  }
}
