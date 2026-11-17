import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeGovernanceTransactionFixture } from "../../packages/contracts/scripts/governance-transaction.fixture.mjs";
import { governanceTransactionAbi, governanceEventConfiguration } from "../../packages/contracts/scripts/prepare-governance-transaction.mjs";
import { buildPublicationAction, publicationActionTypes } from "../../packages/contracts/scripts/prepare-governance-publication.mjs";
import { verifyGovernanceAuthorization } from "../../packages/contracts/scripts/verify-governance-authorization.mjs";
import { assertGovernanceDeploymentBinding, verifyGovernanceReceipt } from "./governance-receipt.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, encodeFunctionData, encodeFunctionResult, encodeAbiParameters, parseAbi, toHex, zeroAddress, zeroHash } = require("viem");
const executeHash = "0x" + "99".repeat(32), executeBlockHash = "0x" + "66".repeat(32);
const intArg = (message) => ({ ...message, nonce: BigInt(message.nonce), signerSetEpoch: BigInt(message.signerSetEpoch), deadline: BigInt(message.deadline) });
const selector = (name) => encodeFunctionData({ abi: governanceTransactionAbi, functionName: name });
const nonceData = selector("nonce"), pendingData = selector("pending"), latestData = selector("latestVersion");
const epochAbi = parseAbi(["function signerSetEpoch() view returns(uint64)"]);
const epochData = encodeFunctionData({ abi: epochAbi, functionName: "signerSetEpoch" });

test("production governance binds the actual deployment plan, Directory, all eight runtimes and authorized target", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../docs/evidence/mobile-signing/protocol-mainnet.json", import.meta.url)));
  const publication = { action: "publish-factory", sourcePlanSha256: manifest.planSha256, compilerInputSha256: manifest.compiler.inputSha256,
    directory: manifest.constructors[0].address, runtimePins: [...manifest.constructors, ...manifest.bootstrapChildren].map((row) =>
      ({ address: row.address, runtimeHash: row.runtimeHash, byteLength: row.runtimeBytes })),
    target: { address: manifest.bootstrapChildren[2].address, runtimeHash: manifest.bootstrapChildren[2].runtimeHash } };
  assert.equal(assertGovernanceDeploymentBinding(publication).sourcePlanSha256, manifest.planSha256);
  for (const change of [(p) => { p.directory = zeroAddress; }, (p) => { p.sourcePlanSha256 = "aa".repeat(32); },
    (p) => { p.runtimePins[4].address = zeroAddress; }, (p) => { p.runtimePins[5].runtimeHash = zeroHash; },
    (p) => { p.runtimePins[6].byteLength++; }, (p) => { p.target.address = manifest.constructors[3].address; },
    (p) => { p.runtimePins.reverse(); }]) {
    const clone = structuredClone(publication); change(clone); assert.throws(() => assertGovernanceDeploymentBinding(clone));
  }
  const migration = structuredClone(publication); migration.action = "publish-v3-template";
  migration.target = { address: manifest.constructors[3].address, runtimeHash: manifest.constructors[3].runtimeHash };
  assert.doesNotThrow(() => assertGovernanceDeploymentBinding(migration));
});

async function harness({ phase = "schedule", template = false, advanced = false, later = false, early = false, expiredExecute = false, unavailable,
  changeTx, changeReceipt, peerMismatch = false, badRuntime = false, badArchivePending = false, reorg = false, badScheduleTime = false } = {}) {
  const f = await makeGovernanceTransactionFixture(), publication = f.publication;
  if (template) {
    Object.assign(publication, buildPublicationAction({ action: "publish-v3-template", directory: publication.directory,
      target: f.addresses[3], runtimeHash: publication.typedData.message.runtimeHash, nonce: "1", signerSetEpoch: "1",
      blockTimestamp: f.baseTime, owners: publication.owners, testOnly: true }, { allowTestFixture: true }));
    const actionAbi = parseAbi(["function actionDigest((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)) view returns(bytes32)"]);
    publication.directoryChecks = publication.directoryChecks.map((check) => check.data === nonceData
      ? { data: check.data, expected: encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "nonce", result: 1n }) }
      : check.data === latestData ? { data: check.data, expected: encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "latestVersion", result: 1 }) }
      : check.data.startsWith("0x1bba12f2") ? { data: encodeFunctionData({ abi: actionAbi, functionName: "actionDigest", args: [intArg(publication.typedData.message)] }), expected: publication.digest } : check);
    const responses = [];
    for (const account of f.accounts.slice(0, 2)) responses.push({ signer: account.address, signature: await account.signTypedData({ ...publication.typedData, types: publicationActionTypes }) });
    Object.assign(f.verifiedAuthorization, await verifyGovernanceAuthorization(publication, { schemaVersion: 1,
      scope: "OWNER_COLLECTED_DIRECTORY_TYPED_SIGNATURES", directory: publication.directory, typedData: publication.typedData,
      digest: publication.digest, signatureResponses: responses }, { allowTestFixture: true }));
    f.scheduleTransaction.input = f.verifiedAuthorization.scheduleCalldata;
    f.executionData = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "execute", args: [intArg(publication.typedData.message)] });
    Object.assign(f.event, governanceEventConfiguration(publication));
  }
  publication.target = { address: publication.typedData.message.factory, runtimeHash: publication.typedData.message.runtimeHash };
  f.clock.phase = "execute";
  f.clock.time = phase === "execute" ? f.baseTime + 172810 : f.baseTime + 10;
  if (later) f.clock.time = f.baseTime + 900000;
  const executionTime = early ? f.baseTime + 172799 : expiredExecute ? f.baseTime + 777601 : f.baseTime + 172805;
  const scheduleTx = structuredClone(f.scheduleTransaction);
  const executeTx = { ...structuredClone(scheduleTx), hash: executeHash, nonce: toHex(484), input: f.executionData,
    blockHash: executeBlockHash, blockNumber: "0x81" };
  const request = { type: "0x2", chainId: "0x1237", from: scheduleTx.from, to: publication.directory, value: "0x0",
    nonce: phase === "schedule" ? scheduleTx.nonce : executeTx.nonce, data: phase === "schedule" ? scheduleTx.input : executeTx.input };
  const calls = [], counts = {};
  const mappingFunction = template ? "migrationTemplates" : "factories";
  const mappingData = encodeFunctionData({ abi: governanceTransactionAbi, functionName: mappingFunction, args: [Number(publication.typedData.message.version)] });
  const mapping = (published) => encodeFunctionResult({ abi: governanceTransactionAbi, functionName: mappingFunction,
    result: published ? [publication.target.address, publication.target.runtimeHash] : [zeroAddress, zeroHash] });
  const readers = Object.fromEntries(["official", "pocket"].map((provider) => [provider, async (method, params = []) => {
    calls.push({ provider, method, params }); assert.ok(!/send|sign|impersonate|set/i.test(method));
    if (unavailable?.(provider, method, params)) return { status: "unavailable" };
    let value;
    if (method === "eth_getTransactionByHash" && [f.scheduleHash, executeHash].includes(params[0])) {
      value = structuredClone(params[0] === f.scheduleHash ? scheduleTx : executeTx);
      changeTx?.(value, params[0]); if (peerMismatch && provider === "official" && params[0] === (phase === "schedule" ? f.scheduleHash : executeHash)) value.gas = toHex(250001);
    } else if (method === "eth_getTransactionReceipt" && params[0] === executeHash) {
      value = { type: "0x2", from: executeTx.from, to: executeTx.to, transactionHash: executeHash, status: "0x1", contractAddress: null,
        blockHash: executeBlockHash, blockNumber: "0x81", transactionIndex: "0x0", gasUsed: toHex(90000), effectiveGasPrice: toHex(20000000),
        logs: f.event.executionEvents.map((event, index) => ({ address: publication.directory, topics: event.topics, data: event.data,
          transactionHash: executeHash, blockHash: executeBlockHash, blockNumber: "0x81", transactionIndex: "0x0", logIndex: toHex(index), removed: false })) };
      changeReceipt?.(value, params[0]);
    } else if (method === "eth_getTransactionReceipt" && params[0] === f.scheduleHash) {
      value = await f.rawReader(method, params); value = structuredClone(value); changeReceipt?.(value, params[0]);
    } else if (method === "eth_getBlockByNumber" && params[0] === "0x81") value = { number: "0x81", hash: executeBlockHash, timestamp: toHex(executionTime), gasLimit: toHex(30000000) };
    else if (method === "eth_getBlockByNumber" && params[0] === "0x80") {
      value = await f.rawReader(method, params); value = structuredClone(value);
      if (badScheduleTime) value.timestamp = toHex(f.baseTime + 604801);
      const key = provider + ":scheduleHeader"; counts[key] = (counts[key] ?? 0) + 1;
      if (reorg && counts[key] >= 3) value.hash = executeBlockHash;
    } else if (method === "eth_getCode" && badRuntime && params[0].toLowerCase() === publication.directory.toLowerCase()) value = "0x6001";
    else if (method === "eth_call") {
      const data = params[0].data, tag = params[1], receiptSchedule = tag === "0x80", receiptExecute = tag === "0x81";
      const consumed = receiptExecute || (!receiptSchedule && (phase === "execute" || advanced));
      if (data === nonceData) value = encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "nonce", result: BigInt(publication.typedData.message.nonce) + (consumed ? 1n : 0n) });
      else if (data === epochData && advanced && !receiptSchedule && !receiptExecute) value = encodeFunctionResult({ abi: epochAbi, functionName: "signerSetEpoch", result: 2n });
      else if (data === latestData) value = encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "latestVersion", result: template || (phase === "execute" && consumed) ? 1 : 0 });
      else if (data === pendingData) value = encodeFunctionResult({ abi: governanceTransactionAbi, functionName: "pending", result:
        consumed || (badArchivePending && receiptSchedule) ? [zeroHash, 0n, 0n] : [publication.digest, f.executeAfter, f.executeBy] });
      else if (data === mappingData) value = mapping(phase === "execute" && consumed);
      else value = await f.rawReader(method, params);
    } else value = await f.rawReader(method, params);
    return { status: "observed", value };
  }]));
  return { publication, phase, hash: phase === "schedule" ? f.scheduleHash : executeHash,
    scheduleHash: f.scheduleHash, expectedRequest: request, readers, now: () => f.clock.time * 1000, allowTestFixture: true, fixture: f, calls };
}

test("canonical schedule uses real block time and genuine two-key signatures, preserves pending notice and L1-unverified status", async () => {
  const h = await harness(), result = await verifyGovernanceReceipt(h);
  assert.equal(result.status, "L2_GOVERNANCE_SCHEDULE_VERIFIED", result.reason);
  assert.equal(result.schedule.executeAfter, String(h.fixture.baseTime + 172800));
  assert.equal(result.currentStatus, "SCHEDULE_PENDING_REAL_NOTICE");
  assert.equal(result.expectedAccountNonce, "483"); assert.equal(result.transaction.gasUsed, "100000");
  assert.equal(result.finality, "L1_UNVERIFIED"); assert.equal(result.strictSecurityGate, "FAIL_HIGH_22_RETAINED");
  assert.equal(result.nextExecutionAuthorized, false); assert.equal(result.broadcastAuthorized, false);
});

test("execution requires actual canonical scheduling, mature two-day time, exact publication and ActionCleared events, and mapping", async () => {
  const result = await verifyGovernanceReceipt(await harness({ phase: "execute" }));
  assert.equal(result.status, "L2_GOVERNANCE_EXECUTE_VERIFIED", result.reason);
  assert.equal(result.currentStatus, "EXECUTED_STATE_UNCHANGED"); assert.equal(result.expectedAccountNonce, "484");
});

test("V3-template publication uses its separate nonce, delay, MigrationTemplatePublished event and mapping", async () => {
  for (const phase of ["schedule", "execute"]) {
    const result = await verifyGovernanceReceipt(await harness({ phase, template: true }));
    assert.equal(result.status, phase === "schedule" ? "L2_GOVERNANCE_SCHEDULE_VERIFIED" : "L2_GOVERNANCE_EXECUTE_VERIFIED", result.reason);
    assert.equal(result.actionNonce, "1"); assert.equal(result.action, "publish-v3-template");
  }
});

test("late verification of a valid historical schedule does not pretend its signing deadline is current", async () => {
  const result = await verifyGovernanceReceipt(await harness({ later: true }));
  assert.equal(result.status, "L2_GOVERNANCE_SCHEDULE_VERIFIED", result.reason);
  assert.equal(result.currentStatus, "SCHEDULE_EXPIRED_REQUIRES_AUTHORIZED_RECOVERY");
});

test("later governance state remains explicit and never resurrects an old scheduled authorization", async () => {
  const result = await verifyGovernanceReceipt(await harness({ advanced: true }));
  assert.equal(result.status, "L2_GOVERNANCE_SCHEDULE_VERIFIED", result.reason);
  assert.equal(result.currentStatus, "AUTHORITY_ADVANCED_OLD_SCHEDULE_NOT_EXECUTABLE"); assert.equal(result.nextExecutionAuthorized, false);
});

test("early or expired canonical executions fail independently of the current wall clock", async () => {
  for (const option of [{ phase: "execute", early: true }, { phase: "execute", expiredExecute: true }]) {
    const result = await verifyGovernanceReceipt(await harness(option)); assert.equal(result.status, "EVIDENCE_INVALID", result.reason);
  }
});

test("wrong sender nonce requires the original owner journal and never prepares a replacement transaction", async () => {
  const h = await harness({ changeTx: (tx) => { tx.nonce = toHex(484); } });
  const result = await verifyGovernanceReceipt(h); assert.equal(result.status, "EVIDENCE_INVALID"); assert.match(result.reason, /ACCOUNT_NONCE_REQUIRES_OWNER_JOURNAL/);
});

test("wrong account, chain, value, transaction format, access list and delegation authorization fail closed", async () => {
  for (const changeTx of [(tx) => { tx.from = zeroAddress; }, (tx) => { tx.chainId = "0x1"; }, (tx) => { tx.value = "0x1"; },
    (tx) => { tx.type = "0x4"; }, (tx) => { tx.accessList = [{ address: zeroAddress, storageKeys: [] }]; },
    (tx) => { tx.authorizationList = []; }]) {
    const result = await verifyGovernanceReceipt(await harness({ changeTx })); assert.equal(result.status, "EVIDENCE_INVALID", result.reason);
  }
});

test("malformed, duplicate, removed or mismatched governance events fail closed", async () => {
  for (const changeReceipt of [(receipt) => { receipt.logs.push(structuredClone(receipt.logs[0])); },
    (receipt) => { receipt.logs[0].removed = true; }, (receipt) => { receipt.logs[0].blockHash = zeroHash; },
    (receipt) => { receipt.logs[0].topics[1] = zeroHash; }, (receipt) => { receipt.status = "0x0"; }]) {
    const result = await verifyGovernanceReceipt(await harness({ changeReceipt })); assert.equal(result.status, "EVIDENCE_INVALID", result.reason);
  }
});

test("execution events cannot omit, duplicate, reorder or redirect the publication", async () => {
  for (const changeReceipt of [(receipt, hash) => { if (hash === executeHash) receipt.logs.pop(); },
    (receipt, hash) => { if (hash === executeHash) receipt.logs.reverse(); },
    (receipt, hash) => { if (hash === executeHash) receipt.logs[0].data = zeroHash; }]) {
    const result = await verifyGovernanceReceipt(await harness({ phase: "execute", changeReceipt })); assert.equal(result.status, "EVIDENCE_INVALID", result.reason);
  }
});

test("duplicate or corrupted ECDSA approvals are rejected at the canonical receipt time", async () => {
  for (const duplicate of [true, false]) {
    const h = await harness(), decoded = decodeFunctionData({ abi: governanceTransactionAbi, data: h.expectedRequest.data });
    const signature = duplicate ? decoded.args[1] : "0x" + "00".repeat(65);
    const altered = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "schedule", args: [intArg(h.publication.typedData.message), decoded.args[1], signature] });
    h.expectedRequest.data = altered;
    const original = h.readers;
    h.readers = Object.fromEntries(Object.entries(original).map(([name, reader]) => [name, async (method, params) => {
      const row = await reader(method, params); if (method === "eth_getTransactionByHash") row.value = { ...row.value, input: altered }; return row;
    }]));
    const result = await verifyGovernanceReceipt(h); assert.equal(result.status, "EVIDENCE_INVALID", result.reason);
  }
});

test("unavailable receipts, archive state or provider failures stay pending without synthetic finality", async () => {
  for (const method of ["eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getCode", "eth_call"]) {
    const result = await verifyGovernanceReceipt(await harness({ unavailable: (_, requested) => requested === method })); assert.equal(result.status, "PENDING", result.reason);
  }
});

test("provider disagreement, runtime drift, wrong archive pending state, reorg and late scheduling invalidate evidence", async () => {
  for (const option of [{ peerMismatch: true }, { badRuntime: true }, { badArchivePending: true }, { reorg: true }, { badScheduleTime: true }]) {
    const result = await verifyGovernanceReceipt(await harness(option)); assert.equal(result.status, "EVIDENCE_INVALID", result.reason);
  }
});

test("original reviewed request is mandatory and test-only publications cannot enter the production CLI boundary", async () => {
  const h = await harness(); await assert.rejects(verifyGovernanceReceipt({ ...h, expectedRequest: undefined }));
  await assert.rejects(verifyGovernanceReceipt({ ...h, allowTestFixture: false }), /Synthetic governance/);
  h.expectedRequest.data += "00";
  await assert.rejects(verifyGovernanceReceipt(h), /noncanonical or trailing calldata/);
});
