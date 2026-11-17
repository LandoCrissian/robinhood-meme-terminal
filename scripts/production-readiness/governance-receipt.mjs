import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";
import { MOBILE_DEPLOYMENT_PAYER } from "./mobile-sender.mjs";
import { verifyDirectType2Outcome } from "../../packages/contracts/scripts/delegated-mobile-transaction.mjs";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { publicationDigest } from "../../packages/contracts/scripts/prepare-governance-publication.mjs";
import { governanceEventConfiguration, governanceTransactionAbi, observeCanonicalGovernanceSchedule }
  from "../../packages/contracts/scripts/prepare-governance-transaction.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, isAddressEqual, keccak256, parseAbi, toHex, zeroHash, zeroAddress } = require("viem");
const ownerPolicy = JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations;
const compiler = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
const names = ["official", "pocket"], hash = /^0x[0-9a-f]{64}$/i, bytes = /^0x(?:[0-9a-f]{2})+$/i, quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const same = (a, b) => typeof a === "string" && typeof b === "string" && isAddressEqual(a, b);
const amount = (value) => { assert.ok(typeof value === "string" && quantity.test(value), "Malformed RPC quantity"); return BigInt(value); };
const abiValue = (value) => Array.isArray(value) ? value.map(abiValue) : typeof value === "bigint" || typeof value === "number" ? BigInt(value).toString() : value;
const messageTuple = (message) => ({ ...message, nonce: BigInt(message.nonce), signerSetEpoch: BigInt(message.signerSetEpoch), deadline: BigInt(message.deadline) });
const canonicalMessage = (message) => ({ kind: Number(message.kind), nonce: BigInt(message.nonce).toString(), version: Number(message.version),
  factory: message.factory.toLowerCase(), runtimeHash: message.runtimeHash.toLowerCase(), signerSetEpoch: BigInt(message.signerSetEpoch).toString(), deadline: BigInt(message.deadline).toString() });
const stateAbi = parseAbi([
  "function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
  "function signerSetEpoch() view returns(uint64)", "function nonce() view returns(uint64)", "function latestVersion() view returns(uint32)",
  "function suspended() view returns(bool)", "function pending() view returns(bytes32,uint48,uint48)",
  "function publicationDelay() view returns(uint48)", "function executionWindow() view returns(uint48)",
  "function factories(uint32) view returns(address,bytes32)", "function migrationTemplates(uint32) view returns(address,bytes32)",
]);
class MissingEvidence extends Error {}
async function observed(reader, method, params = []) {
  const result = await reader(method, params);
  if (result?.status !== "observed" || result.value === null || result.value === undefined) throw new MissingEvidence("Required governance evidence unavailable: " + method);
  return result.value;
}
function blockHeader(block) {
  assert.ok(block && hash.test(block.hash) && block.hash !== zeroHash, "Malformed canonical governance block");
  return { number: amount(block.number).toString(), hash: block.hash.toLowerCase(), timestamp: amount(block.timestamp).toString() };
}
function assertPublication(publication, expectedRequest, phase, allowTestFixture) {
  assert.ok(!publication?.testOnly || allowTestFixture, "Synthetic governance inputs cannot verify production acceptance");
  assert.equal(publication.scope, "UNSIGNED_DIRECTORY_PUBLICATION_AUTHORIZATION");
  assert.equal(publication.chainId, 4663); assert.equal(publication.broadcastAuthorized, false);
  assert.equal(publication.noticeSeconds, 172800); assert.equal(publication.maximumExecutionWindowSeconds, 604800);
  assert.equal(publication.requiredSignatures, 2); assert.equal(publication.owners.length, 3);
  assert.equal(new Set(publication.owners.map((owner) => owner.toLowerCase())).size, 3);
  if (!publication.testOnly) assert.deepEqual(publication.owners, ownerPolicy.owners);
  assert.equal(publication.compilerInputSha256, compiler.inputSha256);
  assert.ok(same(publication.protocolSender, MOBILE_DEPLOYMENT_PAYER));
  assert.equal(publicationDigest(publication.typedData), publication.digest);
  assert.ok(same(publication.typedData.domain.verifyingContract, publication.directory));
  assert.deepEqual(publication.typedData.domain, { name: "RMT Launch Curve Directory", version: "2", chainId: 4663, verifyingContract: publication.directory });
  assert.ok(publication.action === "publish-factory" || publication.action === "publish-v3-template");
  const message = publication.typedData.message;
  assert.equal(Number(message.kind), publication.action === "publish-factory" ? 0 : 4);
  assert.equal(Number(message.version), publication.action === "publish-factory" ? 1 : 3);
  assert.ok(same(message.factory, publication.target.address) && message.runtimeHash === publication.target.runtimeHash);
  assert.ok(Array.isArray(publication.runtimePins) && publication.runtimePins.length === 8);
  assert.equal(new Set(publication.runtimePins.map((pin) => pin.address.toLowerCase())).size, 8);
  for (const pin of publication.runtimePins) assert.ok(same(pin.address, pin.address) && !same(pin.address, zeroAddress) &&
    hash.test(pin.runtimeHash) && pin.runtimeHash !== zeroHash && Number.isInteger(pin.byteLength) && pin.byteLength > 0 && pin.byteLength <= 24576);
  assert.ok(publication.runtimePins.some((pin) => same(pin.address, publication.directory)));
  assert.ok(publication.runtimePins.some((pin) => same(pin.address, message.factory) && pin.runtimeHash === message.runtimeHash));
  assert.ok(Array.isArray(publication.directoryChecks) && publication.directoryChecks.length > 0);
  assert.ok(phase === "schedule" || phase === "execute");
  assert.ok(expectedRequest && expectedRequest.type === "0x2" && expectedRequest.chainId === "0x1237" &&
    same(expectedRequest.from, MOBILE_DEPLOYMENT_PAYER) && same(expectedRequest.to, publication.directory) && expectedRequest.value === "0x0" &&
    quantity.test(expectedRequest.nonce) && bytes.test(expectedRequest.data), "The original owner-reviewed transaction intent is required");
  const decoded = decodeFunctionData({ abi: governanceTransactionAbi, data: expectedRequest.data });
  assert.equal(decoded.functionName, phase); assert.deepEqual(canonicalMessage(decoded.args[0]), canonicalMessage(message));
  assert.equal(encodeFunctionData({ abi: governanceTransactionAbi, functionName: phase, args: decoded.args }).toLowerCase(),
    expectedRequest.data.toLowerCase(), "Governance intent contains noncanonical or trailing calldata");
  return message;
}
function normalizeTx(tx) {
  assert.ok(tx && hash.test(tx.hash) && hash.test(tx.blockHash) && bytes.test(tx.input), "Malformed governance transaction");
  assert.equal(tx.type, "0x2"); assert.equal(amount(tx.chainId), 4663n);
  assert.ok(Array.isArray(tx.accessList) && tx.accessList.length === 0 && !Object.hasOwn(tx, "authorizationList"), "Governance call cannot change delegation or approvals");
  return { hash: tx.hash.toLowerCase(), blockHash: tx.blockHash.toLowerCase(), blockNumber: amount(tx.blockNumber).toString(),
    transactionIndex: amount(tx.transactionIndex).toString(), from: tx.from.toLowerCase(), to: tx.to?.toLowerCase(),
    input: tx.input.toLowerCase(), value: amount(tx.value).toString(), nonce: amount(tx.nonce).toString(),
    gas: amount(tx.gas).toString(), maxFeePerGas: amount(tx.maxFeePerGas).toString(), maxPriorityFeePerGas: amount(tx.maxPriorityFeePerGas).toString() };
}
function normalizeReceipt(receipt) {
  assert.ok(receipt && hash.test(receipt.transactionHash) && hash.test(receipt.blockHash));
  assert.equal(receipt.status, "0x1", "Governance transaction reverted"); assert.equal(receipt.type, "0x2"); assert.equal(receipt.contractAddress, null);
  assert.ok(Array.isArray(receipt.logs) && receipt.logs.length <= 2);
  const indexes = new Set();
  const logs = receipt.logs.map((log) => {
    assert.ok(log.removed === false && log.transactionHash?.toLowerCase() === receipt.transactionHash.toLowerCase() &&
      log.blockHash?.toLowerCase() === receipt.blockHash.toLowerCase() && log.blockNumber === receipt.blockNumber &&
      log.transactionIndex === receipt.transactionIndex && Array.isArray(log.topics) && log.topics.every((topic) => hash.test(topic)) &&
      /^0x(?:[0-9a-f]{2})*$/i.test(log.data), "Governance event identity differs");
    const index = amount(log.logIndex).toString(); assert.ok(!indexes.has(index), "Duplicate governance event index"); indexes.add(index);
    return { address: log.address.toLowerCase(), topics: log.topics.map((topic) => topic.toLowerCase()), data: log.data.toLowerCase(), logIndex: index };
  });
  return { hash: receipt.transactionHash.toLowerCase(), blockHash: receipt.blockHash.toLowerCase(), blockNumber: amount(receipt.blockNumber).toString(),
    transactionIndex: amount(receipt.transactionIndex).toString(), from: receipt.from.toLowerCase(), to: receipt.to?.toLowerCase(),
    gasUsed: amount(receipt.gasUsed).toString(), effectiveGasPrice: amount(receipt.effectiveGasPrice).toString(), logs };
}
async function call(reader, publication, tag, functionName, args = []) {
  return decodeFunctionResult({ abi: stateAbi, functionName, data: await observed(reader, "eth_call", [{ to: publication.directory,
    data: encodeFunctionData({ abi: stateAbi, functionName, args }) }, tag]) });
}
async function pinnedRuntimes(reader, publication, tag) {
  for (const pin of publication.runtimePins) {
    const code = await observed(reader, "eth_getCode", [pin.address, tag]);
    assert.ok(bytes.test(code) && (code.length - 2) / 2 === pin.byteLength, "Governance dependency runtime size differs");
    assert.equal(keccak256(code), pin.runtimeHash, "Governance dependency runtime differs");
  }
}
function postChecks(publication, phase, schedule) {
  const pendingData = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "pending" });
  const nonceData = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "nonce" });
  const latestData = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "latestVersion" });
  const message = publication.typedData.message;
  return publication.directoryChecks.map((check) => {
    if (check.data === pendingData) return { data: check.data, expected: encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "pending",
      result: phase === "schedule" ? [publication.digest, BigInt(schedule.executeAfter), BigInt(schedule.executeBy)] : [zeroHash, 0n, 0n] }) };
    if (phase === "execute" && check.data === nonceData) return { data: check.data, expected: encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "nonce", result: BigInt(message.nonce) + 1n }) };
    if (phase === "execute" && publication.action === "publish-factory" && check.data === latestData) return { data: check.data,
      expected: encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "latestVersion", result: Number(message.version) }) };
    return check;
  });
}
async function currentState(reader, publication, tag) {
  const fields = ["signerA", "signerB", "signerC", "signerSetEpoch", "nonce", "latestVersion", "suspended", "pending", "publicationDelay", "executionWindow"];
  const values = await Promise.all(fields.map((name) => call(reader, publication, tag, name)));
  const state = Object.fromEntries(fields.map((name, index) => [name, abiValue(values[index])]));
  assert.equal(state.publicationDelay, "172800"); assert.equal(state.executionWindow, "604800");
  state.mapping = abiValue(await call(reader, publication, tag, publication.action === "publish-factory" ? "factories" : "migrationTemplates", [Number(publication.typedData.message.version)]));
  return state;
}

/** Only canonical read operations. The reviewed account nonce and exact calldata remain distinct from indicative fee estimates. */
export async function verifyGovernanceReceipt({ publication, phase, hash: transactionHash, scheduleHash, expectedRequest,
  readers = Object.fromEntries(names.map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })])),
  now = Date.now, allowTestFixture = false } = {}) {
  const message = assertPublication(publication, expectedRequest, phase, allowTestFixture);
  assert.ok(hash.test(transactionHash) && transactionHash !== zeroHash);
  const base = { schemaVersion: 1, scope: "READ_ONLY_4663_GOVERNANCE_CALL_RECEIPT", phase, chainId: 4663, action: publication.action,
    directory: publication.directory, digest: publication.digest, signerSetEpoch: String(message.signerSetEpoch), actionNonce: String(message.nonce),
    transactionHash: transactionHash.toLowerCase(), expectedAccountNonce: amount(expectedRequest.nonce).toString(),
    finality: "L1_UNVERIFIED", strictSecurityGate: "FAIL_HIGH_22_RETAINED", signingAuthorized: false, broadcastAuthorized: false };
  // The shared schedule reconciler treats unavailable observations as hard failures. Preserve their availability classification here.
  const watched = Object.fromEntries(names.map((name) => [name, async (...args) => {
    const row = await readers[name](...args); if (row?.status !== "observed" || row.value === null || row.value === undefined) throw new MissingEvidence("Required canonical governance observation unavailable: " + args[0]); return row;
  }]));
  try {
    const schedule = await observeCanonicalGovernanceSchedule(publication, phase === "schedule" ? transactionHash : scheduleHash, watched);
    const views = await Promise.all(names.map(async (name) => {
      const reader = watched[name]; assert.equal(await observed(reader, "eth_chainId"), "0x1237");
      const [tx, receipt] = await Promise.all([observed(reader, "eth_getTransactionByHash", [transactionHash]), observed(reader, "eth_getTransactionReceipt", [transactionHash])]);
      const transaction = normalizeTx(tx), result = normalizeReceipt(receipt);
      const header = blockHeader(await observed(reader, "eth_getBlockByNumber", [receipt.blockNumber, false]));
      assert.equal(header.hash, result.blockHash); assert.equal(header.number, result.blockNumber);
      return { name, tx, receipt, transaction, result, header };
    }));
    assert.deepEqual(views[0].transaction, views[1].transaction, "Providers disagree on governance transaction");
    assert.deepEqual(views[0].result, views[1].result, "Providers disagree on governance receipt");
    assert.deepEqual(views[0].header, views[1].header, "Providers disagree on governance block time");
    const { tx, receipt, transaction, result, header } = views[0];
    assert.equal(transaction.hash, transactionHash.toLowerCase()); assert.equal(result.hash, transaction.hash);
    assert.equal(transaction.blockHash, result.blockHash); assert.equal(transaction.blockNumber, result.blockNumber); assert.equal(transaction.transactionIndex, result.transactionIndex);
    assert.ok(same(result.from, MOBILE_DEPLOYMENT_PAYER) && same(result.to, publication.directory));
    assert.equal(transaction.nonce, amount(expectedRequest.nonce).toString(), "ACCOUNT_NONCE_REQUIRES_OWNER_JOURNAL");
    assert.equal(transaction.input, expectedRequest.data.toLowerCase(), "Governance calldata differs from the reviewed owner request");
    const direct = verifyDirectType2Outcome({ chainId: 4663, type: "eip1559", accessList: tx.accessList, status: "success", from: tx.from, to: tx.to,
      nonce: transaction.nonce, valueWei: transaction.value, calldataHash: keccak256(tx.input), transactionHash: transaction.hash, blockHash: transaction.blockHash,
      blockNumber: transaction.blockNumber, gas: transaction.gas, gasUsed: result.gasUsed, effectiveGasPrice: result.effectiveGasPrice,
      maxFeePerGas: transaction.maxFeePerGas, maxPriorityFeePerGas: transaction.maxPriorityFeePerGas, contractAddress: receipt.contractAddress },
    { sender: MOBILE_DEPLOYMENT_PAYER, to: publication.directory, nonce: amount(expectedRequest.nonce).toString(), dataHash: keccak256(expectedRequest.data), valueWei: "0", expectedAddress: null });
    if (phase === "execute") {
      assert.ok(BigInt(header.timestamp) >= BigInt(schedule.executeAfter), "The actual two-day governance notice has not matured");
      assert.ok(BigInt(header.timestamp) <= BigInt(schedule.executeBy), "The canonical governance execution window expired");
      const events = governanceEventConfiguration(publication).executionEvents;
      assert.equal(result.logs.length, 2, "Expected the publication and ActionCleared events exactly once");
      for (const [index, event] of events.entries()) {
        assert.ok(same(result.logs[index].address, publication.directory));
        assert.deepEqual(result.logs[index].topics, event.topics.map((topic) => topic.toLowerCase()));
        assert.equal(result.logs[index].data, event.data.toLowerCase());
      }
    }
    const tag = receipt.blockNumber;
    await pinnedRuntimes(watched.pocket, publication, tag);
    for (const check of postChecks(publication, phase, schedule)) {
      assert.equal((await observed(watched.pocket, "eth_call", [{ to: publication.directory, data: check.data }, tag])).toLowerCase(), check.expected.toLowerCase(),
        "Receipt-block Directory state differs: canonical transaction state is unproven");
    }
    for (const owner of publication.owners) assert.equal(await observed(watched.pocket, "eth_getCode", [owner, tag]), "0x", "Receipt-block governance owner is not an admitted EOA");
    if (phase === "execute") {
      const mapping = await call(watched.pocket, publication, tag, publication.action === "publish-factory" ? "factories" : "migrationTemplates", [Number(message.version)]);
      assert.ok(same(mapping[0], message.factory)); assert.equal(mapping[1], message.runtimeHash);
    }
    const heads = await Promise.all(names.map(async (name) => blockHeader(await observed(watched[name], "eth_getBlockByNumber", ["latest", false]))));
    const height = heads.map((head) => BigInt(head.number)).reduce((a, b) => a < b ? a : b), currentTag = toHex(height);
    const current = await Promise.all(names.map(async (name) => {
      const block = blockHeader(await observed(watched[name], "eth_getBlockByNumber", [currentTag, false]));
      assert.equal(block.number, height.toString()); assert.ok(Number(block.timestamp) * 1000 <= now() + 10000 && Number(block.timestamp) * 1000 >= now() - 180000, "Current governance observation is stale");
      await pinnedRuntimes(watched[name], publication, currentTag);
      return { provider: name, block, state: await currentState(watched[name], publication, currentTag) };
    }));
    assert.deepEqual(current[0].block, current[1].block); assert.deepEqual(current[0].state, current[1].state);
    const state = current[0].state, actionNonce = BigInt(message.nonce), epoch = BigInt(message.signerSetEpoch);
    assert.ok(BigInt(state.nonce) >= actionNonce && BigInt(state.signerSetEpoch) >= epoch, "Current governance authority moved backwards");
    if (BigInt(state.signerSetEpoch) === epoch) assert.ok([state.signerA, state.signerB, state.signerC]
      .every((owner, index) => same(owner, publication.owners[index])), "Current signer identities changed without the expected epoch");
    let currentStatus;
    if (phase === "schedule" && state.nonce === String(actionNonce) && state.signerSetEpoch === String(epoch)) {
      assert.deepEqual(state.pending, [publication.digest, schedule.executeAfter, schedule.executeBy]);
      currentStatus = BigInt(current[0].block.timestamp) > BigInt(schedule.executeBy) ? "SCHEDULE_EXPIRED_REQUIRES_AUTHORIZED_RECOVERY" : "SCHEDULE_PENDING_REAL_NOTICE";
    } else if (phase === "execute") {
      assert.ok(BigInt(state.nonce) >= actionNonce + 1n);
      assert.ok(same(state.mapping[0], message.factory) && state.mapping[1] === message.runtimeHash, "Current publication mapping differs");
      currentStatus = state.nonce === String(actionNonce + 1n) && state.pending[0] === zeroHash && state.signerSetEpoch === String(epoch)
        ? "EXECUTED_STATE_UNCHANGED" : "EXECUTED_WITH_LATER_GOVERNANCE_STATE";
    } else currentStatus = "AUTHORITY_ADVANCED_OLD_SCHEDULE_NOT_EXECUTABLE";
    for (const name of names) for (const [block, expected] of [[receipt.blockNumber, result.blockHash], [currentTag, current[0].block.hash], [schedule.blockNumber, schedule.blockHash]]) {
      assert.equal(blockHeader(await observed(watched[name], "eth_getBlockByNumber", [block, false])).hash, expected.toLowerCase(), "Governance receipt or schedule reorganized during verification");
    }
    return { ...base, status: phase === "schedule" ? "L2_GOVERNANCE_SCHEDULE_VERIFIED" : "L2_GOVERNANCE_EXECUTE_VERIFIED", observedAt: new Date(now()).toISOString(),
      receiptBlock: result.blockNumber, blockHash: result.blockHash, receiptTimestamp: header.timestamp,
      transaction: direct, schedule: { hash: schedule.hash, blockNumber: amount(schedule.blockNumber).toString(), blockHash: schedule.blockHash,
        executeAfter: schedule.executeAfter, executeBy: schedule.executeBy, scheduleBlockTime: schedule.scheduleBlockTime },
      current, currentStatus, nextExecutionAuthorized: false, actualNetworkCostWei: (BigInt(result.gasUsed) * BigInt(result.effectiveGasPrice)).toString(),
      fees: "Owner wallet-reviewed fee bounds belong to the original wallet journal; indicative preparation fees are not substituted." };
  } catch (error) {
    return { ...base, status: error instanceof MissingEvidence ? "PENDING" : "EVIDENCE_INVALID", observedAt: new Date(now()).toISOString(), reason: error instanceof Error ? error.message : "Governance evidence unverified" };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { publication: { type: "string" }, transaction: { type: "string" }, phase: { type: "string" }, hash: { type: "string" },
    "schedule-hash": { type: "string" }, output: { type: "string" } } });
  const output = privateOutputPath(values.output), publication = JSON.parse(readFileSync(values.publication));
  const transaction = JSON.parse(readFileSync(values.transaction));
  const result = await verifyGovernanceReceipt({ publication, phase: values.phase, hash: values.hash, scheduleHash: values["schedule-hash"], expectedRequest: transaction.request });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(result.status + "; no signature, broadcast, notice bypass or public activation");
  if (result.status === "EVIDENCE_INVALID") process.exitCode = 1;
}
