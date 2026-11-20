import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, type Hex } from "viem";
import { archiveCompletedProductionCreation, assertNoPendingProductionCreation, completedProductionCreationsKey,
  productionCreationAbi, productionCreationFactory, productionCreationJournalKey, readCompletedProductionCreations,
  readProductionCreationJournal, submitProductionCreation, type ProductionCreationRequest, type ProductionWallet } from "../production-creation";
import { productionNonceFloorKey } from "../production-nonce";

const owner = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA", hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
function request(nonce = 0): ProductionCreationRequest {
  const intentId = hash(nonce + 100);
  return { from: owner, to: productionCreationFactory, chainId: "0x1237", nonce: `0x${nonce.toString(16)}`, value: "0x16bcc41e90000",
    intentId, deadline: "1800000000", blockNumber: "0x6f6c31e", blockHash: hash(10),
    data: encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: ["Archive Test", "ARC", "https://example.invalid/project",
      "0x0000000000000000000000000000000000000000", 0, intentId, 1800000000n] }) };
}
function storage() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
const journal = (nonce = 0) => ({ request: request(nonce), transactionHash: hash(nonce + 1) });
const verified = (nonce = 0) => ({ status: "confirmed" as const, transactionHash: hash(nonce + 1), indexed: true,
  token: "0x2222222222222222222222222222222222222222" as Hex });
test("explicit canonical creation archival preserves complete identity and releases only a strictly newer financial nonce", async () => {
  const s = storage(), original = journal(); s.setItem(productionCreationJournalKey, JSON.stringify(original));
  const archived = archiveCompletedProductionCreation(s, original, verified());
  assert.deepEqual(archived.request, original.request); assert.deepEqual(archived.verification, verified());
  assert.equal(readProductionCreationJournal(s), undefined); assert.equal(readCompletedProductionCreations(s).length, 1);
  assert.throws(() => assertNoPendingProductionCreation(s, owner, "0x0"), /nonce|reconciliation/i);
  assert.doesNotThrow(() => assertNoPendingProductionCreation(s, owner, "0x1"));
  const calls: string[] = [], provider = { async request(input: { method: string }) {
    calls.push(input.method);
    if (input.method === "eth_accounts") return [owner]; if (input.method === "eth_chainId") return "0x1237";
    if (input.method === "eth_getTransactionCount") return "0x1";
    if (input.method === "eth_getBlockByNumber") return { hash: hash(10) };
    if (input.method === "eth_sendTransaction") { assert.equal(readProductionCreationJournal(s)?.request.nonce, "0x1"); return hash(999); }
    throw Error("Unexpected wallet method");
  } };
  const wallet: ProductionWallet = { account: owner, provider, request: provider.request };
  await assert.rejects(submitProductionCreation(wallet, request(0), s, () => {})); assert.equal(calls.length, 0);
  await submitProductionCreation(wallet, request(1), s, () => {});
  assert.equal(calls.filter(call => call === "eth_sendTransaction").length, 1);
});
test("pending, unindexed, wrong-hash and changed-intent evidence cannot release the original creation", () => {
  for (const evidence of [{ ...verified(), status: "pending" as const }, { ...verified(), indexed: false },
    { ...verified(), transactionHash: hash(999) }]) {
    const s = storage(), original = journal(); s.setItem(productionCreationJournalKey, JSON.stringify(original));
    assert.throws(() => archiveCompletedProductionCreation(s, original, evidence)); assert.deepEqual(readProductionCreationJournal(s), original);
  }
  const s = storage(), original = journal(); s.setItem(productionCreationJournalKey, JSON.stringify(original));
  assert.throws(() => archiveCompletedProductionCreation(s, journal(1), verified(1))); assert.deepEqual(readProductionCreationJournal(s), original);
});
test("history or nonce-floor storage failures preserve active recovery before any release", () => {
  for (const key of [completedProductionCreationsKey, productionNonceFloorKey]) {
    const s = storage(), original = journal(); s.setItem(productionCreationJournalKey, JSON.stringify(original));
    const set = s.setItem; s.setItem = (name, value) => { if (name !== key) set(name, value); };
    assert.throws(() => archiveCompletedProductionCreation(s, original, verified())); assert.deepEqual(readProductionCreationJournal(s), original);
  }
});
test("bounded completed creation storage never evicts an original receipt to accept another creation", () => {
  const s = storage();
  for (let nonce = 0; nonce < 16; nonce++) { const original = journal(nonce); s.setItem(productionCreationJournalKey, JSON.stringify(original)); archiveCompletedProductionCreation(s, original, verified(nonce)); }
  const original = journal(16); s.setItem(productionCreationJournalKey, JSON.stringify(original));
  assert.throws(() => archiveCompletedProductionCreation(s, original, verified(16)), /full/);
  assert.equal(readCompletedProductionCreations(s).length, 16); assert.deepEqual(readProductionCreationJournal(s), original);
});
