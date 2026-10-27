import assert from "node:assert/strict";
import { keccak256, type Hex } from "viem";
import { readHistoricalSettlementTrace } from "./historical-settlement-trace";
import { boundVNextNativeSettlementEnvelope, verifyVNextNativeOutputSettlement, hasVerifiedVNextSwapSettlement } from "../vnext/output-settlement";
import { VNEXT_EXECUTION_STORAGE_KEY, readVNextExecutionJournal, findUnresolvedVNextExecution, resolveVNextExecution } from "../vnext/execution-recovery";
import { historicalSaleReceipt as receipt, historicalSaleTransaction as transaction, historicalSaleRecord } from "../testing/historical-cannacat-sale";
import trace from "./settlement-trace-archive/4663/0x3c5b142f2fcf2bad01a154b1b84754bd4e4c32281aa14c06641fa70f2221a522.json";

import { october27SaleRecord, october27SaleReceipt, october27SaleTransaction } from "../testing/october27-cannacat-sale";
import october27Trace from "./settlement-trace-archive/4663/0x2250b738ddd8ce5cb411372e5d4d8d2a2945979acdedc3d165d9cd02a89ff3bc.json";
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
// Reproduce the exact second sell which the owner identified on iPhone.
// Both completed histories must survive; an unrelated pending record must not clear.
const ownerRecord = october27SaleRecord(), ownerTransaction = october27SaleTransaction, ownerReceipt = october27SaleReceipt;
const ownerExpected = { hash: ownerTransaction.hash, blockHash: ownerTransaction.blockHash!, blockNumber: ownerTransaction.blockNumber!,
  from: ownerTransaction.from, to: ownerTransaction.to!, input: ownerTransaction.input, value: ownerTransaction.value };
check(boundVNextNativeSettlementEnvelope(ownerRecord, ownerReceipt, ownerTransaction), "Owner-copied plan target/calldata/amount match the canonical transaction");
check(keccak256(ownerTransaction.input) === ownerRecord.providerNativeFee!.calldataHash, "Owner's exact saved calldata hash matches on-chain calldata");
const ownerEvidence = readHistoricalSettlementTrace(ownerExpected);
check(ownerEvidence?.status === "available", "Second known sale gets independent, pinned full trace evidence");
if (!ownerEvidence || ownerEvidence.status !== "available") throw Error("Owner sale evidence unavailable");
const ownerProof = verifyVNextNativeOutputSettlement(ownerRecord, ownerReceipt, ownerTransaction, ownerEvidence.trace);
check(ownerProof?.amountAtomic === "143561490640", "Owner's exact stored minimum accepts only the actual native delivery");
check(ownerRecord.providerNativeFee!.protectedOutputAtomic === "142139696595", "Owner's saved minimum is preserved exactly");
const mismatchedOwner = structuredClone(ownerRecord); mismatchedOwner.providerNativeFee!.protectedOutputAtomic = "143561490641";
check(verifyVNextNativeOutputSettlement(mismatchedOwner, ownerReceipt, ownerTransaction, ownerEvidence.trace) === null, "Known owner hash cannot override an unsatisfied minimum");
const savedRoot = october27Trace.value;
try { october27Trace.value = "0x1"; check(readHistoricalSettlementTrace(ownerExpected) === null, "Second archive is independently integrity-pinned"); }
finally { october27Trace.value = savedRoot; }
check(readHistoricalSettlementTrace({ ...ownerExpected, blockHash: expected.blockHash }) === null, "First sale's block cannot authenticate the second sale");
check(readHistoricalSettlementTrace({ ...ownerExpected, input: transaction.input }) === null, "First sale's calldata cannot authenticate the second sale");
for (const legacy of [true, false]) {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const prior = { ...record, state: "confirmed" as const, outputAmountAtomic: proof!.amountAtomic, outputSettlement: proof! };
  storage.setItem(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify(legacy ? [ownerRecord, prior] : { schemaVersion: 2, executions: [ownerRecord, prior], walletRequests: [] }));
  check(findUnresolvedVNextExecution(ownerRecord.wallet, storage, now)?.txHash === ownerRecord.txHash, "Exact new sale reproduces the lock beside a previously settled sale");
  check(!ownerRecord.deadline, "Recovery does not need an obsolete executable quote or fabricated expiry");
  const recovered = resolveVNextExecution(ownerRecord.txHash, "confirmed", storage, now, { outputAmountAtomic: ownerProof!.amountAtomic, outputSettlement: ownerProof! });
  check(Boolean(recovered) && hasVerifiedVNextSwapSettlement(recovered!), "Strict evidence resolves only the owner sale");
  const refreshed = readVNextExecutionJournal(storage, now + 1000);
  check(refreshed.length === 2 && refreshed.every(hasVerifiedVNextSwapSettlement), "Multiple exact historical transactions survive refresh with proof");
  check(!findUnresolvedVNextExecution(ownerRecord.wallet, storage, now + 1000), "Neither completed trade recreates a lock");
  const pending = { ...ownerRecord, txHash: ("0x" + "4".repeat(64)) as Hex };
  storage.setItem(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, executions: [...refreshed, pending], walletRequests: [] }));
  check(findUnresolvedVNextExecution(ownerRecord.wallet, storage, now + 1000)?.txHash === pending.txHash, "A genuinely unresolved third record remains protected");
}
console.log(JSON.stringify({ result: "PASS", suite: "historical-native-settlement", checks, hash: record.txHash,
  exactPublicReceiptAndTrace: true, ownerCopiedRecoveryRecordAvailable: true, ownerSafariFullStorageAvailable: false, journalAuthority: "REPRESENTATIVE_TEST_ONLY", fundedTrades: 0 }));
