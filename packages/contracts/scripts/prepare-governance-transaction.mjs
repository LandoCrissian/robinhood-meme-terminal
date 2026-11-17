import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "../../../scripts/production-readiness/rpc.mjs";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { prepareGovernancePublication, publicationActionTypes, publicationDigest } from "./prepare-governance-publication.mjs";
import { verifyGovernanceAuthorization } from "./verify-governance-authorization.mjs";
import { protocolStageCandidate } from "./protocol-constructor-readiness.mjs";
import { privateOutputPath } from "./prepare-unsigned-4663.mjs";
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  encodeFunctionResult, isAddressEqual, keccak256, parseAbi, recoverTypedDataAddress, toHex, zeroHash } = require("viem");
const tuple = "(uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)";
export const governanceTransactionAbi = parseAbi([
  "function schedule(" + tuple + ",bytes,bytes)", "function execute(" + tuple + ")",
  "function pending() view returns(bytes32,uint48,uint48)", "function nonce() view returns(uint64)", "function latestVersion() view returns(uint32)",
  "function factories(uint32) view returns(address,bytes32)", "function migrationTemplates(uint32) view returns(address,bytes32)",
  "event ActionScheduled(bytes32 indexed digest,uint64 indexed nonce,uint48 executableAt,uint48 expiresAt)",
  "event FactoryPublished(uint32 indexed version,address indexed factory,bytes32 runtimeHash)",
  "event MigrationTemplatePublished(uint32 indexed toVersion,address indexed deployer,bytes32 runtimeHash)",
  "event ActionCleared(bytes32 indexed digest,uint64 indexed nonce)",
]);
const gasAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
const names = ["official", "pocket"], hash = /^0x[0-9a-f]{64}$/i, quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const same = (a, b) => typeof a === "string" && typeof b === "string" && isAddressEqual(a, b);
const tupleValue = (message) => ({ ...message, nonce: BigInt(message.nonce), signerSetEpoch: BigInt(message.signerSetEpoch), deadline: BigInt(message.deadline) });
const stateCheck = (functionName, result, args = []) => ({ data: encodeFunctionData({ abi: governanceTransactionAbi, functionName, args }),
  expected: encodeFunctionResult({ abi: governanceTransactionAbi, functionName, result }) });
const actionMessage = (value) => ({ kind: Number(value.kind), nonce: BigInt(value.nonce).toString(), version: Number(value.version),
  factory: value.factory.toLowerCase(), runtimeHash: value.runtimeHash.toLowerCase(), signerSetEpoch: BigInt(value.signerSetEpoch).toString(), deadline: BigInt(value.deadline).toString() });
async function observed(reader, method, params = []) {
  const result = await reader(method, params); assert.equal(result.status, "observed", "Required governance transaction evidence is unavailable"); return result.value;
}

export async function recoverScheduleAuthorization(publication, verified, now = Date.now()) {
  assert.equal(verified?.status, "TWO_DISTINCT_GOVERNANCE_SIGNATURES_VERIFIED");
  assert.equal(verified.digest, publication.digest); assert.ok(same(verified.directory, publication.directory));
  const decoded = decodeFunctionData({ abi: governanceTransactionAbi, data: verified.scheduleCalldata });
  assert.equal(decoded.functionName, "schedule"); assert.deepEqual(actionMessage(decoded.args[0]), actionMessage(publication.typedData.message));
  const responses = [];
  for (const signature of decoded.args.slice(1)) responses.push({ signature,
    signer: await recoverTypedDataAddress({ ...publication.typedData, types: publicationActionTypes, signature }) });
  const result = await verifyGovernanceAuthorization(publication, { schemaVersion: 1, scope: "OWNER_COLLECTED_DIRECTORY_TYPED_SIGNATURES",
    digest: publication.digest, directory: publication.directory, typedData: publication.typedData, signatureResponses: responses },
  { now, allowTestFixture: publication.testOnly === true });
  assert.equal(result.scheduleCalldata, verified.scheduleCalldata, "Noncanonical or conflicting schedule calldata");
  return result;
}

export function governanceEventConfiguration(publication) {
  const message = tupleValue(publication.typedData.message), factory = publication.action === "publish-factory";
  const eventName = factory ? "FactoryPublished" : "MigrationTemplatePublished";
  return { digest: publication.digest, actionNonce: String(message.nonce), signerSetEpoch: String(message.signerSetEpoch), deadline: String(message.deadline),
    scheduleEventTopics: encodeEventTopics({ abi: governanceTransactionAbi, eventName: "ActionScheduled", args: { digest: publication.digest, nonce: message.nonce } }),
    pendingGetterData: encodeFunctionData({ abi: governanceTransactionAbi, functionName: "pending" }),
    executionEvents: [{ topics: encodeEventTopics({ abi: governanceTransactionAbi, eventName,
      args: factory ? { version: message.version, factory: message.factory } : { toVersion: message.version, deployer: message.factory } }),
      data: encodeAbiParameters([{ type: "bytes32" }], [message.runtimeHash]) },
    { topics: encodeEventTopics({ abi: governanceTransactionAbi, eventName: "ActionCleared", args: { digest: publication.digest, nonce: message.nonce } }), data: "0x" }],
  };
}

/** Reconcile the actual schedule on two providers. Real block time is the only notice clock. */
export async function observeCanonicalGovernanceSchedule(publication, transactionHash, readers) {
  assert.ok(hash.test(transactionHash)); const message = publication.typedData.message;
  const values = await Promise.all(names.map(async (name) => {
    const reader = readers[name]; assert.equal(await observed(reader, "eth_chainId"), "0x1237");
    const [tx, receipt] = await Promise.all([observed(reader, "eth_getTransactionByHash", [transactionHash]), observed(reader, "eth_getTransactionReceipt", [transactionHash])]);
    assert.ok(tx && receipt && tx.type === "0x2" && tx.chainId === "0x1237" && same(tx.from, MOBILE_DEPLOYMENT_PAYER) && same(tx.to, publication.directory) && tx.value === "0x0" &&
      Array.isArray(tx.accessList) && tx.accessList.length === 0 && !Object.hasOwn(tx, "authorizationList"));
    assert.ok(receipt.status === "0x1" && receipt.contractAddress == null && same(receipt.from, tx.from) && same(receipt.to, tx.to) &&
      tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber && tx.transactionIndex === receipt.transactionIndex &&
      tx.hash?.toLowerCase() === transactionHash.toLowerCase() && receipt.transactionHash?.toLowerCase() === transactionHash.toLowerCase());
    const block = await observed(reader, "eth_getBlockByNumber", [receipt.blockNumber, false]); assert.equal(block.hash, receipt.blockHash);
    assert.ok(quantity.test(block.timestamp));
    const decoded = decodeFunctionData({ abi: governanceTransactionAbi, data: tx.input }); assert.equal(decoded.functionName, "schedule");
    assert.deepEqual(actionMessage(decoded.args[0]), actionMessage(message));
    const verified = { status: "TWO_DISTINCT_GOVERNANCE_SIGNATURES_VERIFIED", directory: publication.directory, digest: publication.digest, scheduleCalldata: tx.input };
    await recoverScheduleAuthorization(publication, verified, Number(BigInt(block.timestamp)) * 1000);
    assert.ok(Array.isArray(receipt.logs) && receipt.logs.length === 1);
    const log = receipt.logs[0]; assert.ok(same(log.address, publication.directory) && log.removed === false &&
      log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber && log.transactionHash === receipt.transactionHash);
    const event = decodeEventLog({ abi: governanceTransactionAbi, eventName: "ActionScheduled", data: log.data, topics: log.topics, strict: true });
    const executeAfter = BigInt(block.timestamp) + 172800n, maximum = executeAfter + 604800n;
    const executeBy = maximum < BigInt(message.deadline) ? maximum : BigInt(message.deadline);
    assert.equal(event.args.digest, publication.digest); assert.equal(BigInt(event.args.nonce), BigInt(message.nonce));
    assert.equal(BigInt(event.args.executableAt), executeAfter); assert.equal(BigInt(event.args.expiresAt), executeBy);
    return { hash: transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, input: tx.input, nonce: tx.nonce,
      executeAfter: executeAfter.toString(), executeBy: executeBy.toString(), scheduleBlockTime: BigInt(block.timestamp).toString() };
  }));
  assert.deepEqual(values[0], values[1], "Providers disagree on the governance schedule"); return values[0];
}

function makeCostReader(name, expected, tag, fetcher) {
  let id = 0;
  return async (method, params = []) => {
    assert.ok(method === "eth_estimateGas" || method === "eth_maxPriorityFeePerGas");
    if (method === "eth_estimateGas") assert.deepEqual(params, [expected, tag]); else assert.deepEqual(params, []);
    const requestId = ++id;
    const response = await fetcher(ROBINHOOD_SOURCES[name], { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) });
    assert.equal(response.status, 200); const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= 16384); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(body.jsonrpc === "2.0" && body.id === requestId && !body.error && quantity.test(body.result)); return body.result;
  };
}

/** Produces no wallet request. Execute cannot reach simulation until the real canonical notice matures. */
export async function prepareGovernanceTransaction({ publication, phase = "schedule", packet, deploymentProofs, verifiedAuthorization, scheduleHash,
  readers = Object.fromEntries(names.map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })])),
  costReaders, fetcher = fetch, now = Date.now, allowTestFixture = false } = {}) {
  assert.ok(!publication?.testOnly || allowTestFixture, "Test-only inputs cannot prepare a production transaction");
  assert.ok(phase === "schedule" || phase === "execute"); assert.equal(publicationDigest(publication.typedData), publication.digest);
  let approved = publication, schedulePredecessor = null, data;
  if (phase === "schedule") {
    const signatures = await recoverScheduleAuthorization(publication, verifiedAuthorization, now()); data = signatures.scheduleCalldata;
    if (!publication.testOnly) {
      approved = await prepareGovernancePublication({ packet, deploymentProofs, readers, now, action: publication.action, deadline: publication.typedData.message.deadline });
      assert.equal(approved.digest, publication.digest, "Current authority differs from the collected authorization");
    }
  } else {
    if (!publication.testOnly) {
      const bound = protocolStageCandidate(packet, "bootstrap"); assert.equal(bound.plan.planSha256, publication.sourcePlanSha256);
      assert.equal(deploymentProofs?.length, 5);
    }
    schedulePredecessor = await observeCanonicalGovernanceSchedule(publication, scheduleHash, readers);
    data = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "execute", args: [tupleValue(publication.typedData.message)] });
  }
  const message = tupleValue(approved.typedData.message), event = governanceEventConfiguration(approved);
  const pendingData = event.pendingGetterData;
  const beforeChecks = approved.directoryChecks.map((c) => c.data === pendingData && phase === "execute"
    ? stateCheck("pending", [approved.digest, BigInt(schedulePredecessor.executeAfter), BigInt(schedulePredecessor.executeBy)]) : c);
  const afterChecks = beforeChecks.filter((c) => c.data !== pendingData);
  if (phase === "execute") {
    for (const [functionName, result] of [["nonce", message.nonce + 1n], ["latestVersion", 1]]) {
      const check = stateCheck(functionName, result), existing = afterChecks.findIndex((c) => c.data === check.data);
      assert.ok(existing >= 0); afterChecks[existing] = check;
    }
    afterChecks.push(stateCheck("pending", [zeroHash, 0, 0]));
    afterChecks.push(stateCheck(approved.action === "publish-factory" ? "factories" : "migrationTemplates", [message.factory, message.runtimeHash], [message.version]));
  }
  const heads = await Promise.all(names.map((name) => observed(readers[name], "eth_getBlockByNumber", ["latest", false])));
  const height = heads.map((b) => BigInt(b.number)).reduce((a, b) => a < b ? a : b), tag = toHex(height);
  const views = await Promise.all(names.map(async (name) => {
    const read = readers[name], block = await observed(read, "eth_getBlockByNumber", [tag, false]);
    assert.equal(await observed(read, "eth_chainId"), "0x1237"); assert.equal(BigInt(block.number), height);
    assert.ok(hash.test(block.hash) && quantity.test(block.timestamp) && quantity.test(block.gasLimit) && Math.abs(now() - Number(BigInt(block.timestamp)) * 1000) <= 180000);
    const time = BigInt(block.timestamp);
    if (phase === "execute") assert.ok(time >= BigInt(schedulePredecessor.executeAfter) && time <= BigInt(schedulePredecessor.executeBy),
      "The real two-day notice has not matured or the execution window expired; no simulation or transaction is prepared");
    else assert.ok(message.deadline >= time + 172800n);
    const [nonce, pendingNonce, senderCode, pendingCode, delegateCode, pendingDelegate, balance] = await Promise.all([
      observed(read, "eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, tag]), observed(read, "eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"]),
      observed(read, "eth_getCode", [MOBILE_DEPLOYMENT_PAYER, tag]), observed(read, "eth_getCode", [MOBILE_DEPLOYMENT_PAYER, "pending"]),
      observed(read, "eth_getCode", [MOBILE_DELEGATE_POLICY.address, tag]), observed(read, "eth_getCode", [MOBILE_DELEGATE_POLICY.address, "pending"]),
      observed(read, "eth_getBalance", [MOBILE_DEPLOYMENT_PAYER, tag]),
    ]);
    assert.ok(quantity.test(nonce) && nonce === pendingNonce && quantity.test(balance));
    assert.equal(senderCode.toLowerCase(), MOBILE_DELEGATE_POLICY.designator); assert.equal(pendingCode, senderCode);
    assert.equal(keccak256(delegateCode), MOBILE_DELEGATE_POLICY.runtimeHash); assert.equal(pendingDelegate, delegateCode);
    if (phase === "execute") for (const proof of approved.protocolReceipts) {
      const [tx, receipt, canonical] = await Promise.all([observed(read, "eth_getTransactionByHash", [proof.hash]),
        observed(read, "eth_getTransactionReceipt", [proof.hash]), observed(read, "eth_getBlockByNumber", [toHex(BigInt(proof.blockNumber)), false])]);
      assert.ok(tx.to === null && tx.type === "0x2" && tx.chainId === "0x1237" && same(tx.from, MOBILE_DEPLOYMENT_PAYER) && tx.input === proof.input &&
        tx.nonce === proof.nonce && tx.value === "0x0" && tx.hash.toLowerCase() === proof.hash.toLowerCase() &&
        !Object.hasOwn(tx, "authorizationList") && Array.isArray(tx.accessList) && tx.accessList.length === 0 &&
        receipt.status === "0x1" && receipt.to === null && same(receipt.contractAddress, proof.address) && receipt.blockHash === proof.blockHash &&
        receipt.blockNumber === toHex(BigInt(proof.blockNumber)) && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber && canonical.hash === proof.blockHash,
      "A protocol deployment's canonical receipt changed");
    }
    for (const pin of approved.runtimePins) {
      const code = await observed(read, "eth_getCode", [pin.address, tag]); assert.equal(keccak256(code), pin.runtimeHash);
      assert.equal(await observed(read, "eth_getCode", [pin.address, "pending"]), code);
    }
    for (const check of beforeChecks) for (const at of [tag, "pending"]) assert.equal((await observed(read, "eth_call", [{ to: approved.directory, data: check.data }, at])).toLowerCase(), check.expected.toLowerCase(),
      "Directory nonce, authority, pending digest or action changed");
    for (const owner of approved.owners) for (const at of [tag, "pending"]) assert.equal(await observed(read, "eth_getCode", [owner, at]), "0x");
    return { name, block, nonce, balance };
  }));
  assert.equal(views[0].block.hash, views[1].block.hash); assert.equal(views[0].nonce, views[1].nonce);
  const request = { type: "0x2", chainId: "0x1237", from: MOBILE_DEPLOYMENT_PAYER, to: approved.directory, value: "0x0", data, nonce: views[0].nonce };
  costReaders ??= Object.fromEntries(names.map((name) => [name, makeCostReader(name, request, tag, fetcher)]));
  const estimates = await Promise.all(names.map(async (name) => {
    assert.equal(await observed(readers[name], "eth_call", [request, tag]), "0x", "The exact governance simulation did not return an empty result");
    const [estimate, tip, price] = await Promise.all([costReaders[name]("eth_estimateGas", [request, tag]), costReaders[name]("eth_maxPriorityFeePerGas", []), observed(readers[name], "eth_gasPrice")]);
    assert.ok([estimate, tip, price].every((x) => quantity.test(x))); return { name, estimate: BigInt(estimate), tip: BigInt(tip), price: BigInt(price) };
  }));
  const nitroData = encodeFunctionData({ abi: gasAbi, functionName: "gasEstimateComponents", args: [approved.directory, false, data] });
  const raw = await observed(readers.official, "eth_call", [{ from: MOBILE_DEPLOYMENT_PAYER, to: "0x00000000000000000000000000000000000000c8", value: "0x0", data: nitroData }, tag]);
  const [total, l1, baseFee, l1BaseFee] = decodeFunctionResult({ abi: gasAbi, functionName: "gasEstimateComponents", data: raw });
  assert.ok(total > 0n && l1 >= 0n && l1 <= total && baseFee > 0n && l1BaseFee >= 0n);
  const estimate = estimates.reduce((best, row) => row.estimate > best ? row.estimate : best, total), gas = (estimate * 5n + 3n) / 4n;
  const tip = estimates.reduce((best, row) => row.tip > best ? row.tip : best, 0n);
  const maxFee = estimates.reduce((best, row) => row.price > best ? row.price : best, 2n * baseFee + tip);
  assert.ok(views.every((row) => gas <= BigInt(row.block.gasLimit) && gas * maxFee <= BigInt(row.balance)) && tip <= maxFee);
  for (const name of names) {
    assert.equal((await observed(readers[name], "eth_getBlockByNumber", [tag, false])).hash, views[0].block.hash);
    assert.equal(await observed(readers[name], "eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"]), request.nonce);
  }
  return { schemaVersion: 1, scope: "UNSIGNED_DIRECTORY_GOVERNANCE_TRANSACTION", phase, publication: approved,
    id: phase + "-" + (approved.action === "publish-factory" ? "factory" : "v3-template"), chainId: 4663,
    from: MOBILE_DEPLOYMENT_PAYER, to: approved.directory, valueWei: "0", data, dataHash: keccak256(data), request,
    observedAt: new Date(now()).toISOString(), observationBlock: { number: height.toString(), hash: views[0].block.hash },
    beforeChecks, afterChecks, governance: { ...event, phase, ...(schedulePredecessor && { executeAfter: schedulePredecessor.executeAfter, executeBy: schedulePredecessor.executeBy }) },
    governancePredecessor: schedulePredecessor, nitroData, cost: { estimatedWei: (total * baseFee).toString(), gasLimit: gas.toString(),
      maxFeePerGasWei: maxFee.toString(), priorityFeeWei: tip.toString(), maximumWei: (gas * maxFee).toString(), l1PostingWei: (l1 * baseFee).toString(),
      policy: "INDICATIVE_ONLY; LIVE_WALLET_COSTS_AND_EXPLICIT_OWNER_APPROVAL_REQUIRED" },
    signingAuthorized: false, broadcastAuthorized: false, sourceVerification: approved.publicSourceVerification ?? { status: "UNKNOWN" },
    strictSecurityGate: "FAIL_HIGH_22_RETAINED", finality: "L1_UNVERIFIED" };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { phase: { type: "string", default: "schedule" }, publication: { type: "string" }, packet: { type: "string" }, proofs: { type: "string" },
      "verified-authorization": { type: "string" }, "schedule-hash": { type: "string" }, output: { type: "string" } } });
    const json = (path) => JSON.parse(readFileSync(path)), output = privateOutputPath(values.output);
    const prepared = await prepareGovernanceTransaction({ phase: values.phase, publication: json(values.publication), packet: json(values.packet), deploymentProofs: json(values.proofs),
      verifiedAuthorization: values["verified-authorization"] ? json(values["verified-authorization"]) : undefined, scheduleHash: values["schedule-hash"] });
    writeFileSync(output, JSON.stringify(prepared, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Prepared only the exact unsigned governance " + values.phase + " call; no wallet request, signature or broadcast.");
  } catch { console.error("No governance transaction prepared: required authorization, canonical notice, runtime, state or cost evidence failed. Private signatures were not logged."); process.exitCode = 1; }
}
