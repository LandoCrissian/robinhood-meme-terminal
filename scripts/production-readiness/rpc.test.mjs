import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agreedObservation, checkL1Receipt, checkTraceRoot, classifyL1Posting,
  makeReadOnlyRpc, ROBINHOOD_SOURCES, runRpcProbe } from "./rpc.mjs";

const rpc = (fetcher) => makeReadOnlyRpc({ name: "official", url: ROBINHOOD_SOURCES.official }, { fetcher });
const response = (id, result) => Response.json({ jsonrpc: "2.0", id, result });
const observed = (name, value) => ({ name, observation: { status: "observed", value } });
const byte32 = (num) => "0x" + BigInt(num).toString(16).padStart(64, "0");
const account = (num) => "0x" + BigInt(num).toString(16).padStart(40, "0");
const hex = (num) => "0x" + BigInt(num).toString(16);
const methodError = (id, code) => Response.json({ jsonrpc: "2.0", id, error: { code, message: "private upstream diagnostic" } });

test("unapproved RPC scope never reaches transport", async () => {
  let calls = 0;
  const read = rpc(async () => { ++calls; throw new Error("transport should not be called"); });
  await assert.rejects(read("eth_sendRawTransaction", ["0x01"]), /allowlist/);
  await assert.rejects(read("personal_sign", ["0x01", account(1)]), /allowlist/);
  await assert.rejects(read("eth_estimateGas", [{ to: account(1), data: "0x" }]), /reviewed Safe/);
  await assert.rejects(read("debug_traceTransaction", [byte32(1), { tracer: "callTracer", timeout: "3s" }]), /pinned historical/);
  await assert.rejects(read("eth_getLogs", [{ address: account(1), topics: [byte32(1)], fromBlock: "0x1", toBlock: "0x181" }]), /bounded/);
  assert.throws(() => makeReadOnlyRpc({ name: "alternate", url: "https://example.invalid" }), /pinned public providers/);
  assert.equal(calls, 0);
});

test("retries 429 once, bounds time and body, and redacts RPC diagnostics", async () => {
  let calls = 0;
  const read = rpc(async (url, options) => {
    assert.equal(url, ROBINHOOD_SOURCES.official);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const { id } = JSON.parse(options.body);
    return ++calls === 1 ? new Response("upstream details hidden", { status: 429 }) : response(id, "0x1237");
  });
  const answer = await read("eth_chainId");
  assert.equal(calls, 2);
  assert.equal(answer.value, "0x1237");
  assert.equal(answer.previousAttempt.httpStatus, 429);
  assert.ok(!JSON.stringify(answer).includes("hidden"));
  let repeats = 0;
  const limited = await rpc(async (_url, { body }) => {
    ++repeats;
    return methodError(JSON.parse(body).id, -32005);
  })("eth_chainId");
  assert.equal(repeats, 2);
  assert.equal(limited.rpcCode, -32005);
  assert.ok(!JSON.stringify(limited).includes("private upstream"));
  const tooLarge = await rpc(async (_url, { body }) => response(JSON.parse(body).id, "a".repeat(193 * 1024)))("eth_chainId");
  assert.equal(tooLarge.reason, "body-limit-or-null");
  const wrongId = await rpc(async () => response(2, "0x1237"))("eth_chainId");
  assert.equal(wrongId.reason, "envelope");
  assert.equal(wrongId.value, undefined);
});

test("corroboration demands two distinct sources and fails closed on conflicting observations", () => {
  const exact = byte32(1);
  assert.equal(agreedObservation([observed("primary", exact)], String).status, "UNVERIFIED");
  assert.equal(agreedObservation([observed("primary", exact), observed("primary", exact)], String).status, "UNVERIFIED");
  const two = [observed("primary", exact), observed("alternate", exact)];
  assert.equal(agreedObservation(two, String).status, "CORROBORATED");
  assert.equal(agreedObservation([...two, observed("third", byte32(2))], String).status, "CONFLICT");
});

const testHash = byte32(3);
const testTx = byte32(4);
const testLog = {
  address: account(5), blockNumber: "42", blockHash: testHash, transactionHash: testTx,
  logIndex: "1", topics: [byte32(6), byte32(7), byte32(8), byte32(9)], data: "0x00",
};
const rawLog = { ...testLog, blockNumber: "0x2a", logIndex: "0x1", removed: false };
const receipt = { status: "0x1", blockNumber: "0x2a", blockHash: testHash, transactionHash: testTx, logs: [rawLog] };

test("canonical receipt binds the exact event and rejects replaced or duplicate logs", () => {
  assert.equal(checkL1Receipt(receipt, testLog).transactionHash, testTx);
  assert.throws(() => checkL1Receipt({ ...receipt, status: "0x0" }, testLog), /does not bind/);
  assert.throws(() => checkL1Receipt({ ...receipt, blockHash: byte32(2) }, testLog), /does not bind/);
  assert.throws(() => checkL1Receipt({ ...receipt, logs: [{ ...rawLog, data: "0xab" }] }, testLog), /exact batch log/);
  assert.throws(() => checkL1Receipt({ ...receipt, logs: [{ ...rawLog, removed: true }] }, testLog), /Removed/);
  assert.throws(() => checkL1Receipt({ ...receipt, logs: [rawLog, rawLog] }, testLog), /exact batch log/);
});

test("Ethereum finalized tag alone cannot finalize a missing, conflicting or newer posting", () => {
  const accepted = (value) => ({ status: "CORROBORATED", value });
  assert.equal(classifyL1Posting({ status: "UNVERIFIED" }, accepted({ number: "42" })), "UNVERIFIED");
  assert.equal(classifyL1Posting(accepted(testLog), { status: "CONFLICT" }), "CONFLICT");
  assert.equal(classifyL1Posting(accepted(testLog), accepted({ number: "41" })), "CORROBORATED_L1_POSTING_NOT_FINALIZED");
  assert.equal(classifyL1Posting(accepted(testLog), accepted({ number: "42" })), "CORROBORATED_FINALIZED_L1_POSTING");
});

test("historical trace proof rejects a replaced selector, changed value and failed root", () => {
  const transaction = { from: account(1), to: account(2), input: "0xab", value: "0" };
  const root = { ...transaction, type: "CALL", value: "0x0" };
  assert.equal(checkTraceRoot(root, transaction).to, transaction.to);
  assert.throws(() => checkTraceRoot({ ...root, input: "0xff" }, transaction), /Unbound/);
  assert.throws(() => checkTraceRoot({ ...root, value: "0x1" }, transaction), /Unbound/);
  assert.throws(() => checkTraceRoot({ ...root, error: "reverted" }, transaction), /Unbound/);
});

test("the complete probe corroborates historical batch posting without implying new-engine finality", async () => {
  const source = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-release/l1-batches.json", import.meta.url)));
  const target = source.l2.finalizedTagSample;
  const batch = source.l1.batches.l2Finalized;
  const l1 = source.l1.sources.publicnode.entries[batch];
  const historicalLog = { ...rawLog, address: source.l1.inbox, blockNumber: hex(l1.blockNumber), blockHash: l1.blockHash,
    transactionHash: l1.transactionHash, topics: [source.l1.selector, byte32(batch), byte32(17), byte32(18)] };
  const block = (number, hash = byte32(number)) => ({
    number: hex(number), hash, parentHash: byte32(BigInt(number) - 1n), stateRoot: byte32(number), timestamp: "0x60",
  });
  const latest = target.number + 500;
  const fetcher = async (url, options) => {
    const { id, method, params } = JSON.parse(options.body);
    const robinhood = Object.values(ROBINHOOD_SOURCES).includes(url);
    if (method === "eth_chainId") return response(id, robinhood ? "0x1237" : "0x1");
    if (method === "eth_getBlockByNumber") {
      const tag = params[0];
      if (tag === "latest") return response(id, block(robinhood ? latest : l1.blockNumber + 8));
      if (tag === "finalized") return response(id, block(l1.blockNumber + 5));
      const number = BigInt(tag);
      const hash = number === BigInt(target.number) ? target.hash : number === BigInt(l1.blockNumber) ? l1.blockHash : byte32(number);
      return response(id, block(number, hash));
    }
    if (method === "eth_call" && params[0].to === source.l2.nodeInterface) {
      const selector = params[0].data.slice(0, 10);
      if (selector === "0x81f1adaf") return response(id, byte32(batch));
      assert.equal(selector, "0x6f275ef2");
      return response(id, byte32(l1.blockNumber - 3));
    }
    if (method === "eth_getLogs" && !robinhood) {
      assert.equal(params[0].topics[1], byte32(batch));
      assert.equal(params[0].fromBlock, hex(l1.blockNumber));
      assert.equal(params[0].toBlock, hex(l1.blockNumber));
      assert.equal(params[0].address, source.l1.inbox.toLowerCase());
      return response(id, [historicalLog]);
    }
    if (method === "eth_getTransactionReceipt" && !robinhood) {
      return response(id, { ...receipt, blockNumber: historicalLog.blockNumber, blockHash: l1.blockHash, transactionHash: l1.transactionHash,
        logs: [historicalLog] });
    }
    return methodError(id, -32601);
  };
  const report = await runRpcProbe({ fetcher });
  assert.equal(report.broadcastAuthorized, false);
  assert.equal(report.current.proof.status, "UNVERIFIED");
  assert.equal(report.archive.proof.status, "CONFLICT");
  assert.equal(report.finality.historicalBatch.status, "CORROBORATED_FINALIZED_L1_POSTING");
  assert.equal(report.finality.newEngineReceipt, "UNVERIFIED_DEPLOYMENT_DEPENDENT");
  assert.equal(report.routing.deployedExactPoolKey, "UNVERIFIED_DEPLOYMENT_DEPENDENT");
});
