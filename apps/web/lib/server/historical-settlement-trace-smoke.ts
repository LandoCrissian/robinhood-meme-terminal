import assert from "node:assert/strict";
import { keccak256, type Hex } from "viem";
import { readHistoricalSettlementTrace } from "./historical-settlement-trace";
import { boundVNextNativeSettlementEnvelope, verifyVNextNativeOutputSettlement, hasVerifiedVNextSwapSettlement } from "../vnext/output-settlement";
import { VNEXT_EXECUTION_STORAGE_KEY, readVNextExecutionJournal, findUnresolvedVNextExecution, resolveVNextExecution } from "../vnext/execution-recovery";
import { historicalSaleReceipt as receipt, historicalSaleTransaction as transaction, historicalSaleRecord } from "../testing/historical-cannacat-sale";
import trace from "./settlement-trace-archive/4663/0x3c5b142f2fcf2bad01a154b1b84754bd4e4c32281aa14c06641fa70f2221a522.json";

const now = Date.now(), record = historicalSaleRecord(now);
const expected = { hash: transaction.hash, blockHash: transaction.blockHash!, blockNumber: transaction.blockNumber!, from: transaction.from,
  to: transaction.to!, input: transaction.input, value: transaction.value };
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
check(boundVNextNativeSettlementEnvelope(record, receipt, transaction), "Exact historical mined envelope binds before any trace");
const evidence = readHistoricalSettlementTrace(expected);
check(evidence?.status === "available", "Historical full trace remains available without a quote or live explorer");
if (!evidence || evidence.status !== "available") throw Error("Historical evidence unavailable");
const proof = verifyVNextNativeOutputSettlement(record, receipt, transaction, evidence.trace);
check(proof?.amountAtomic === "137068094858", "Strict verifier derives exact historical native delivery from full calls");
check(evidence.trace.inputHash === keccak256(transaction.input), "Original exact calldata remains bound");
for (const [name, changed] of [
  ["unknown transaction", { hash: `0x${"1".repeat(64)}` as Hex }],
  ["reorganized block", { blockHash: `0x${"2".repeat(64)}` as Hex }],
  ["wrong block height", { blockNumber: expected.blockNumber + 1n }],
  ["wrong sender", { from: "0x0000000000000000000000000000000000000123" }],
  ["wrong target", { to: "0x0000000000000000000000000000000000000123" }],
  ["wrong calldata", { input: "0x00" as Hex }],
  ["nonzero transaction value", { value: 1n }],
] as const) check(readHistoricalSettlementTrace({ ...expected, ...changed }) === null, name + " cannot use archived evidence");
const original = trace.value;
try { trace.value = "0x1"; check(readHistoricalSettlementTrace(expected) === null, "An archive-byte change cannot grant proof"); }
finally { trace.value = original; }
const aboveMinimum = structuredClone(record); aboveMinimum.providerNativeFee!.protectedOutputAtomic = "137068094859";
check(verifyVNextNativeOutputSettlement(aboveMinimum, receipt, transaction, evidence.trace) === null, "Exact stored minimum is never lowered to force acceptance");
check(verifyVNextNativeOutputSettlement(record, { ...receipt, status: "reverted" }, transaction, evidence.trace) === null, "Reverted receipt grants no settlement");
for (const legacy of [true, false]) {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  storage.setItem(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify(legacy ? [record] : { schemaVersion: 2, executions: [record], walletRequests: [] }));
  check(Boolean(findUnresolvedVNextExecution(record.wallet, storage, now)), "Original submitted history blocks duplicate submission");
  check(BigInt(record.deadline!) < BigInt(Math.floor(now / 1000)), "Original review is expired in the regression fixture");
  const saved = resolveVNextExecution(record.txHash, "confirmed", storage, now, { outputAmountAtomic: proof!.amountAtomic, outputSettlement: proof! });
  check(Boolean(saved) && hasVerifiedVNextSwapSettlement(saved!), "Expired-quote recovery persists authoritative settlement");
  const restored = readVNextExecutionJournal(storage, now + 1000);
  check(restored.length === 1 && restored[0].txHash === record.txHash, "Refresh preserves the original historical transaction");
  check(hasVerifiedVNextSwapSettlement(restored[0]), "Refresh restores the proof, not an obsolete submitted status");
  check(!findUnresolvedVNextExecution(record.wallet, storage, now + 1000), "Verified historical transaction releases only its own submission lock");
  const other = { ...record, txHash: `0x${"3".repeat(64)}` as Hex };
  storage.setItem(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, executions: [restored[0], other], walletRequests: [] }));
  check(findUnresolvedVNextExecution(record.wallet, storage, now + 1000)?.txHash === other.txHash, "Another unresolved transaction remains protected");
}
console.log(JSON.stringify({ result: "PASS", suite: "historical-native-settlement", checks, hash: record.txHash,
  exactPublicReceiptAndTrace: true, ownerSafariJournalAvailable: false, journalAuthority: "REPRESENTATIVE_TEST_ONLY", fundedTrades: 0 }));
