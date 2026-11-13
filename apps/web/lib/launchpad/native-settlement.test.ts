import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, zeroAddress, type Address, type PublicClient, type TransactionReceipt } from "viem";
import { launchPoolId } from "./launch-record";
import { isNativeSettlementProof, NativeSettlementPending, verifyNativeSettlement } from "./native-settlement";
import { boundedReceiptLogs } from "./receipt-logs";

const address = (last: string) => `0x${last.padStart(40, "0")}` as Address;
const transactionHash = keccak256("0x01");
const blockHash = keccak256("0x02");
const from = address("11");
const to = address("22");
const poolManager = address("33");
const token = address("44");
const poolKey = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: address("2000") };
const record = { chainId: 4663, poolManager, factory: address("55"), poolKey, poolId: launchPoolId(poolKey) };
const request = { from, to, data: "0x12345678", value: "0x0" } as const;
const log = { address: poolManager, blockHash, blockNumber: 123n, transactionHash, transactionIndex: 1,
  logIndex: 4, data: "0x", topics: [keccak256("0x03")], removed: false } as TransactionReceipt["logs"][number];
const receipt: TransactionReceipt = { from, to, blockHash, blockNumber: 123n, status: "success", transactionHash, transactionIndex: 1,
  logs: [log], gasUsed: 1n, effectiveGasPrice: 1n, cumulativeGasUsed: 1n, contractAddress: null, logsBloom: "0x", type: "eip1559" };
const payout = { type: "CALL", from: poolManager, to: from, value: "0x04", input: "0x" };
const revertedParent = { type: "CALL", from: to, to: poolManager, value: "0x0", error: "private node error", calls: [payout] };
const root = { type: "CALL", from, to, value: "0x0", input: request.data, calls: [payout, revertedParent] };
const primary = rpc(() => root, "https://trace-a.example/rpc");
const secondary = rpc(() => ({ ...root, calls: [{ ...payout, value: "0x4" }] }), "https://trace-b.example/rpc");

function rpc(trace: () => unknown, url = "http://127.0.0.1:8545") {
  return { transport: { type: "http", url }, request: async () => trace() } as unknown as PublicClient;
}

function pending(reason: NativeSettlementPending["reason"]) {
  return (error: unknown) => error instanceof NativeSettlementPending && error.reason === reason;
}

test("proves only successful exact payouts and produces stable compact evidence", async () => {
  const local = await verifyNativeSettlement(primary, receipt, record, request, 4, 4n, async () => receipt);
  assert.equal(local.mode, "local_trace");
  let savedHash: string | undefined;
  const corroborated = await verifyNativeSettlement(primary, receipt, record, request, 4, 4n, async () => receipt, {
    primarySource: "archive-a", corroboration: { source: "archive-b", client: secondary, mode: "independent" },
    saveProof: (proof) => { savedHash = proof.evidenceHash; },
  });
  assert.equal(corroborated.mode, "independent_agreement");
  assert.deepEqual(corroborated.sources, ["archive-a", "archive-b"]);
  assert.equal(corroborated.evidenceHash, local.evidenceHash);
  assert.equal(savedHash, local.evidenceHash);
  assert.ok(isNativeSettlementProof(corroborated));
  assert.ok(!isNativeSettlementProof({ ...corroborated, amountAtomic: "5" }));
  assert.ok(!JSON.stringify(corroborated).includes("private node error"));
});

test("keeps shared simulator evidence distinct from independent corroboration", async () => {
  const sameOrigin = rpc(() => root, "https://trace-a.example/second");
  const rebind = async () => receipt;
  await assert.rejects(verifyNativeSettlement(primary, receipt, record, request, 4, 4n, rebind, {
    primarySource: "archive-a", corroboration: { source: "same-operator", client: sameOrigin, mode: "independent" },
  }), pending("disagreement"));
  const simulated = await verifyNativeSettlement(primary, receipt, record, request, 4, 4n, rebind, {
    corroboration: { source: "second-adapter", client: sameOrigin, mode: "simulation" },
  });
  assert.equal(simulated.mode, "simulated_agreement");
  await assert.rejects(verifyNativeSettlement(primary, receipt, record, request, 4, 4n, rebind, {
    primarySource: "https://trace-a.example/private-token",
  }), pending("disagreement"));
});

test("leaves unavailable, rate-limited, malformed, and unproven traces pending", async () => {
  let writes = 0;
  const verify = (trace: () => unknown) => verifyNativeSettlement(rpc(trace), receipt, record, request, 4, 4n,
    async () => receipt, { saveProof: () => { writes++; } });
  await assert.rejects(verify(() => { throw new Error("missing debug endpoint"); }), pending("unavailable"));
  await assert.rejects(verify(() => { throw { cause: { status: 429 } }; }), pending("rate_limited"));
  await assert.rejects(verify(() => null), pending("payout_unproven"));
  await assert.rejects(verify(() => ({ ...root, calls: [revertedParent] })), pending("payout_unproven"));
  await assert.rejects(verify(() => ({ ...root, calls: [payout, null] })), pending("malformed"));
  await assert.rejects(verify(() => ({ ...root, calls: Array(4097).fill(payout) })), pending("malformed"));
  await assert.rejects(verify(() => ({ ...root, calls: [payout, payout] })), pending("payout_unproven"));
  await assert.rejects(verify(() => ({ ...root, input: "0xdeadbeef" })), pending("disagreement"));
  await assert.rejects(verify(() => ({ ...root, to: poolManager })), pending("disagreement"));
  assert.equal(writes, 0);
});

test("rechecks canonical receipt after tracing and does not commit through failure", async () => {
  let writes = 0;
  const persist = () => { writes++; };
  await assert.rejects(verifyNativeSettlement(primary, receipt, record, request, 4, 4n,
    async () => { throw new Error("stale archive or changed block"); }, { saveProof: persist }), pending("stale"));
  const otherHash = keccak256("0x04");
  const conflicting = { ...receipt, blockHash: otherHash, logs: [{ ...log, blockHash: otherHash }] };
  await assert.rejects(verifyNativeSettlement(primary, receipt, record, request, 4, 4n,
    async (client) => client === secondary ? conflicting : receipt, {
      primarySource: "archive-a", corroboration: { source: "archive-b", client: secondary, mode: "independent" }, saveProof: persist,
    }), pending("disagreement"));
  const wrongPayout = rpc(() => ({ ...root, calls: [{ ...payout, value: "0x5" }] }));
  await assert.rejects(verifyNativeSettlement(primary, receipt, record, request, 4, 4n, async () => receipt, {
    corroboration: { source: "archive-b", client: wrongPayout, mode: "simulation" }, saveProof: persist,
  }), pending("disagreement"));
  await assert.rejects(verifyNativeSettlement(wrongPayout, receipt, record, request, 4, 4n, async () => receipt, {
    corroboration: { source: "archive-b", client: primary, mode: "simulation" }, saveProof: persist,
  }), pending("disagreement"));
  assert.equal(writes, 0);
  await assert.rejects(verifyNativeSettlement(primary, receipt, record, request, 4, 4n, async () => receipt,
    { saveProof: () => { throw new Error("interrupted persistence"); } }), pending("unavailable"));
  await verifyNativeSettlement(primary, receipt, record, request, 4, 4n, async () => receipt, { saveProof: persist });
  assert.equal(writes, 1);
});

test("rejects malformed, duplicated, orphaned and oversized receipt logs", () => {
  assert.deepEqual(boundedReceiptLogs(receipt), [log]);
  assert.throws(() => boundedReceiptLogs({ ...receipt, logs: [log, log] }), /duplicate/);
  assert.throws(() => boundedReceiptLogs({ ...receipt, logs: [{ ...log, transactionIndex: 2 }] }), /unbound/);
  assert.throws(() => boundedReceiptLogs({ ...receipt, logs: [{ ...log, removed: true }] }), /unbound/);
  const largeLog = { ...log, data: `0x${"11".repeat(40 * 1024)}` as const };
  assert.throws(() => boundedReceiptLogs({ ...receipt, logs: [largeLog, { ...largeLog, logIndex: 5 }] }), /review limit/);
});
