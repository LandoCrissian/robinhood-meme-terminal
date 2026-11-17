import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";
import { verifyDirectType2Outcome } from "../../packages/contracts/scripts/delegated-mobile-transaction.mjs";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { mobilePayer } from "../../packages/contracts/scripts/mobile-review-plan.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionResult, encodeFunctionData, getContractAddress, isAddressEqual, keccak256, parseAbi, toHex, zeroHash } = require("viem");
const profile = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
const policy = JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations;
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];
const contracts = ["RMTLaunchCurveDirectoryV2", "RMTLaunchProjectRegistryV3", "RMTLaunchCurveSuccessorDeployerV1", "RMTLaunchCurveSuccessorDeployerV2", "RMTLaunchCurveDeploymentV2"];
const hashPattern = /^0x[0-9a-f]{64}$/i;
const bytesPattern = /^0x(?:[0-9a-f]{2})+$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const decimalPattern = /^(0|[1-9][0-9]{0,19})$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const quantity = (value) => { assert.ok(typeof value === "string" && quantityPattern.test(value), "Malformed RPC quantity"); return BigInt(value); };
const addressEqual = (a, b) => typeof a === "string" && typeof b === "string" && isAddressEqual(a, b);
const abiValue = (value) => Array.isArray(value) ? value.map(abiValue)
  : typeof value === "bigint" || typeof value === "number" ? BigInt(value).toString() : value;

// Bind the exact previously prepared packet. This is receipt reconciliation, not source review or signing authority.
export function protocolReceiptPlan(packet, id) {
  assert.ok(packet && packet.plan && packet.evidence, "Supply the complete unsigned protocol packet");
  const { plan, evidence } = packet;
  const { planSha256, ...body } = plan;
  assert.equal(planSha256, sha256(JSON.stringify(body)), "Unsigned protocol plan digest differs");
  assert.equal(plan.evidenceSha256, sha256(JSON.stringify(evidence)), "Unsigned protocol evidence digest differs");
  assert.equal(plan.scope, "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS");
  assert.equal(plan.chainId, 4663);
  assert.equal(plan.broadcastAuthorized, false);
  assert.equal(plan.signingAuthorized, false);
  assert.ok(addressEqual(plan.sender, mobilePayer));
  assert.equal(plan.compiler.profile, profile.profile);
  assert.equal(plan.compiler.inputSha256, profile.inputSha256);
  assert.equal(plan.compiler.compilerVersion, profile.compilerVersion);
  assert.equal(plan.tokenCreation, null, "Protocol deployment must not issue a token");
  assert.deepEqual(plan.constructors.map((row) => row.id), ids);
  for (const [index, row] of plan.constructors.entries()) {
    assert.equal(row.contract, contracts[index]);
    assert.ok(decimalPattern.test(row.nonce) && addressEqual(row.address, getContractAddress({ from: mobilePayer, nonce: BigInt(row.nonce) })));
    assert.ok(bytesPattern.test(row.initcode) && hashPattern.test(row.initcodeHash) && row.initcodeHash !== zeroHash);
    assert.equal(keccak256(row.initcode), row.initcodeHash, "Constructor initcode digest differs");
    assert.equal((row.initcode.length - 2) / 2, row.initcodeBytes);
    assert.ok(row.initcodeBytes > 0 && row.initcodeBytes <= 49152 && Number.isInteger(row.runtimeBytes) && row.runtimeBytes > 0 && row.runtimeBytes <= 24576);
    assert.ok(hashPattern.test(row.runtimeHash) && row.runtimeHash !== zeroHash);
    assert.equal(row.unsigned.type, "0x2");
    assert.equal(row.unsigned.chainId, "0x1237");
    assert.ok(addressEqual(row.unsigned.from, mobilePayer));
    assert.equal(row.unsigned.to, undefined);
    assert.equal(row.unsigned.nonce, toHex(BigInt(row.nonce)));
    assert.equal(row.unsigned.value, "0x0");
    assert.equal(row.unsigned.data, row.initcode);
    if (index) assert.equal(BigInt(row.nonce), BigInt(plan.constructors[index - 1].nonce) + 1n);
  }
  assert.deepEqual(evidence.governanceOwners, policy.owners);
  const candidate = plan.constructors.find((row) => row.id === id);
  assert.ok(candidate, "Unknown protocol constructor id");
  if (id === "bootstrap") {
    assert.deepEqual(plan.bootstrapChildren.map((row) => row.contract), ["RMTV4CurveInitializationGuardV1", "RMTV4CurveGraduationV1", "RMTLaunchCurveFactoryV2"]);
    for (const child of plan.bootstrapChildren) assert.ok(hashPattern.test(child.runtimeHash) && child.runtimeHash !== zeroHash && child.runtimeBytes > 0 && child.runtimeBytes <= 24576);
    assert.equal(plan.bootstrapChildren[0].hookPermissionBits, "0x2000");
    assert.equal(BigInt(plan.bootstrapChildren[0].address) & 0x3fffn, 0x2000n);
  }
  return { plan, evidence, candidate };
}

class Unavailable extends Error {}
async function observed(reader, method, params) {
  const result = await reader(method, params);
  if (result?.status !== "observed" || result.value === null || result.value === undefined) throw new Unavailable("Required RPC evidence unavailable: " + method);
  return result.value;
}
function header(raw) {
  assert.ok(raw && hashPattern.test(raw.hash) && raw.hash !== zeroHash, "Malformed canonical block");
  return { number: quantity(raw.number).toString(), hash: raw.hash.toLowerCase(), timestamp: quantity(raw.timestamp).toString() };
}
function transactionIdentity(tx) {
  assert.ok(tx && hashPattern.test(tx.hash) && hashPattern.test(tx.blockHash), "Malformed transaction identity");
  assert.equal(tx.type, "0x2");
  assert.equal(quantity(tx.chainId), 4663n);
  assert.equal(tx.to, null, "Expected top-level CREATE, not a router or delegated call");
  assert.ok(Array.isArray(tx.accessList) && tx.accessList.length === 0, "CREATE access list differs");
  assert.ok(!Object.hasOwn(tx, "authorizationList"), "CREATE cannot change wallet delegation");
  assert.ok(bytesPattern.test(tx.input));
  return { hash: tx.hash.toLowerCase(), blockHash: tx.blockHash.toLowerCase(), blockNumber: quantity(tx.blockNumber).toString(),
    transactionIndex: quantity(tx.transactionIndex).toString(), chainId: quantity(tx.chainId).toString(), type: tx.type,
    from: tx.from.toLowerCase(), to: tx.to, nonce: quantity(tx.nonce).toString(), valueWei: quantity(tx.value).toString(),
    input: tx.input.toLowerCase(), gas: quantity(tx.gas).toString(), maxFeePerGas: quantity(tx.maxFeePerGas).toString(),
    maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas).toString(), accessList: [] };
}
function receiptIdentity(receipt) {
  assert.ok(receipt && hashPattern.test(receipt.transactionHash) && hashPattern.test(receipt.blockHash), "Malformed receipt identity");
  assert.equal(receipt.status, "0x1", "Constructor reverted");
  assert.equal(receipt.type, "0x2");
  assert.equal(receipt.to, null);
  assert.ok(Array.isArray(receipt.logs) && receipt.logs.length <= 128);
  const logs = receipt.logs.map((log) => {
    assert.ok(log.removed === false && log.transactionHash?.toLowerCase() === receipt.transactionHash.toLowerCase() &&
      log.blockHash?.toLowerCase() === receipt.blockHash.toLowerCase() && log.blockNumber === receipt.blockNumber &&
      log.transactionIndex === receipt.transactionIndex && Array.isArray(log.topics) && log.topics.every((topic) => hashPattern.test(topic)) &&
      /^0x(?:[0-9a-f]{2})*$/i.test(log.data), "Malformed constructor receipt log");
    return { address: log.address.toLowerCase(), topics: log.topics.map((value) => value.toLowerCase()), data: log.data.toLowerCase(),
      logIndex: quantity(log.logIndex).toString() };
  });
  return { hash: receipt.transactionHash.toLowerCase(), blockHash: receipt.blockHash.toLowerCase(), blockNumber: quantity(receipt.blockNumber).toString(),
    transactionIndex: quantity(receipt.transactionIndex).toString(), from: receipt.from.toLowerCase(), to: receipt.to,
    contractAddress: receipt.contractAddress?.toLowerCase(), gasUsed: quantity(receipt.gasUsed).toString(),
    effectiveGasPrice: quantity(receipt.effectiveGasPrice).toString(), logs };
}
async function runtime(reader, address, tag, expected) {
  const code = await observed(reader, "eth_getCode", [address, tag]);
  assert.ok(bytesPattern.test(code) && (code.length - 2) / 2 === expected.runtimeBytes, "Deployed runtime size differs");
  assert.equal(keccak256(code), expected.runtimeHash, "Deployed runtime digest differs");
  return { address, runtimeHash: expected.runtimeHash, runtimeBytes: expected.runtimeBytes };
}
async function getters(reader, address, tag, fields) {
  const state = {};
  for (const [name, type, expected] of fields) {
    const abi = parseAbi(["function " + name + "() view returns (" + type + ")"]);
    const data = await observed(reader, "eth_call", [{ to: address, data: encodeFunctionData({ abi, functionName: name }) }, tag]);
    const actual = decodeFunctionResult({ abi, functionName: name, data });
    if (type === "address") assert.ok(addressEqual(actual, expected), "Constructor state differs: " + name);
    else assert.deepEqual(abiValue(actual), abiValue(expected), "Constructor state differs: " + name);
    state[name] = abiValue(actual);
  }
  return state;
}
function directoryFields() {
  return [["signerA", "address", policy.owners[0]], ["signerB", "address", policy.owners[1]], ["signerC", "address", policy.owners[2]],
    ["signerSetEpoch", "uint64", 1n], ["nonce", "uint64", 0n], ["rotationNonce", "uint64", 0n],
    ["publicationDelay", "uint48", 172800n], ["executionWindow", "uint48", 604800n], ["latestVersion", "uint32", 0n],
    ["suspended", "bool", false], ["pending", "bytes32,uint48,uint48", [zeroHash, 0n, 0n]],
    ["pendingRotation", "bytes32,uint48,uint48", [zeroHash, 0n, 0n]]];
}

/** Read-only reconciliation of one owner-controlled CREATE. Missing evidence stays pending; conflicting evidence fails closed. */
export async function verifyProtocolReceipt({ packet, id, hash,
  readers = Object.fromEntries(["official", "pocket"].map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })])),
  now = Date.now } = {}) {
  const { plan, candidate } = protocolReceiptPlan(packet, id);
  assert.ok(hashPattern.test(hash) && hash !== zeroHash, "Supply a nonzero transaction hash");
  const base = { schemaVersion: 1, scope: "READ_ONLY_4663_PROTOCOL_CREATE_RECEIPT", chainId: 4663, id,
    contract: candidate.contract, expectedAddress: candidate.address, transactionHash: hash.toLowerCase(),
    planSha256: plan.planSha256, initcodeHash: candidate.initcodeHash, runtimeHash: candidate.runtimeHash,
    archiveProvider: "pocket", canonicalProviders: ["official", "pocket"], finality: "L1_UNVERIFIED", broadcastAuthorized: false };
  try {
    const values = await Promise.all(["official", "pocket"].map(async (name) => {
      const reader = readers[name];
      assert.equal(quantity(await observed(reader, "eth_chainId", [])), 4663n);
      const [tx, receipt] = await Promise.all([observed(reader, "eth_getTransactionByHash", [hash]), observed(reader, "eth_getTransactionReceipt", [hash])]);
      return { tx, receipt, transaction: transactionIdentity(tx), result: receiptIdentity(receipt) };
    }));
    assert.deepEqual(values[0].transaction, values[1].transaction, "Providers disagree on the constructor transaction");
    assert.deepEqual(values[0].result, values[1].result, "Providers disagree on the constructor receipt");
    const { tx, receipt, transaction, result } = values[0];
    assert.equal(transaction.hash, hash.toLowerCase());
    assert.equal(result.hash, transaction.hash);
    assert.equal(result.blockHash, transaction.blockHash);
    assert.equal(result.blockNumber, transaction.blockNumber);
    assert.equal(result.transactionIndex, transaction.transactionIndex);
    assert.ok(addressEqual(result.from, mobilePayer));
    assert.equal(transaction.input, candidate.initcode.toLowerCase(), "Constructor bytes differ from the reviewed packet");
    const direct = verifyDirectType2Outcome({ chainId: 4663, type: "eip1559", accessList: tx.accessList,
      status: "success", from: tx.from, to: tx.to, nonce: transaction.nonce, valueWei: transaction.valueWei,
      calldataHash: keccak256(tx.input), transactionHash: transaction.hash, blockHash: transaction.blockHash,
      blockNumber: transaction.blockNumber, gas: transaction.gas, gasUsed: result.gasUsed,
      effectiveGasPrice: result.effectiveGasPrice, maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas, contractAddress: receipt.contractAddress },
    { sender: mobilePayer, to: null, nonce: candidate.nonce, dataHash: candidate.initcodeHash, valueWei: "0", expectedAddress: candidate.address });
    const tag = receipt.blockNumber;
    const canonical = await Promise.all(["official", "pocket"].map(async (name) => header(await observed(readers[name], "eth_getBlockByNumber", [tag, false]))));
    assert.ok(canonical.every((block) => block.hash === result.blockHash && block.number === result.blockNumber), "Receipt is not canonical on both providers");
    const archiveRuntime = await runtime(readers.pocket, candidate.address, tag, candidate);
    let initialState = null;
    if (id === "directory") initialState = await getters(readers.pocket, candidate.address, tag, directoryFields());
    if (id === "registry") initialState = await getters(readers.pocket, candidate.address, tag,
      [["directory", "address", plan.constructors[0].address], ["migrationDelay", "uint48", 172800n], ["migrationWindow", "uint48", 604800n]]);
    const archiveChildren = id === "bootstrap" ? await Promise.all(plan.bootstrapChildren.map((child) => runtime(readers.pocket, child.address, tag, child))) : [];
    if (id === "bootstrap") await getters(readers.pocket, candidate.address, tag, plan.bootstrapChildren.map((child, index) =>
      [["initializationGuard", "graduationEngine", "factory"][index], "address", child.address]));
    const heads = await Promise.all(["official", "pocket"].map(async (name) => header(await observed(readers[name], "eth_getBlockByNumber", ["latest", false]))));
    const height = heads.map((head) => BigInt(head.number)).reduce((a, b) => a < b ? a : b);
    const currentTag = toHex(height);
    const current = await Promise.all(["official", "pocket"].map(async (name) => {
      const reader = readers[name];
      const block = header(await observed(reader, "eth_getBlockByNumber", [currentTag, false]));
      assert.equal(block.number, height.toString());
      assert.ok(Number(block.timestamp) * 1000 <= now() + 10000 && Number(block.timestamp) * 1000 >= now() - 180000, "Current deployment observation is stale");
      const deployed = await runtime(reader, candidate.address, currentTag, candidate);
      const state = id === "directory" ? await getters(reader, candidate.address, currentTag, directoryFields()) : null;
      const children = id === "bootstrap" ? await Promise.all(plan.bootstrapChildren.map((child) => runtime(reader, child.address, currentTag, child))) : [];
      return { provider: name, block, deployed, state, children };
    }));
    assert.deepEqual(current[0].block, current[1].block, "Providers disagree on current deployment block");
    assert.deepEqual(current[0].state, current[1].state);
    for (const name of ["official", "pocket"]) {
      assert.equal(header(await observed(readers[name], "eth_getBlockByNumber", [tag, false])).hash, result.blockHash, "Receipt reorganized during reconciliation");
      assert.equal(header(await observed(readers[name], "eth_getBlockByNumber", [currentTag, false])).hash, current[0].block.hash, "Current state reorganized during reconciliation");
    }
    return { ...base, status: "L2_DEPLOYMENT_VERIFIED", observedAt: new Date(now()).toISOString(),
      receiptBlock: result.blockNumber, blockHash: result.blockHash, transaction: direct, archiveRuntime,
      initialState, archiveChildren, current, actualNetworkCostWei: (BigInt(result.gasUsed) * BigInt(result.effectiveGasPrice)).toString(),
      feeApprovalEvidence: "OWNER_WALLET_REVIEW_IS_SEPARATE_FROM_THIS_UNSIGNED_PACKET", sourceVerification: "BLOCKSCOUT_PENDING" };
  } catch (error) {
    return { ...base, status: error instanceof Unavailable ? "PENDING" : "EVIDENCE_INVALID",
      reason: error instanceof Error ? error.message : "Receipt evidence could not be verified", observedAt: new Date(now()).toISOString() };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { packet: { type: "string" }, id: { type: "string" }, hash: { type: "string" }, output: { type: "string" } } });
  const output = privateOutputPath(values.output);
  const result = await verifyProtocolReceipt({ packet: JSON.parse(readFileSync(values.packet)), id: values.id, hash: values.hash });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(result.status + "; no signature, transaction submission or token issuance");
  if (result.status === "EVIDENCE_INVALID") process.exitCode = 1;
}
