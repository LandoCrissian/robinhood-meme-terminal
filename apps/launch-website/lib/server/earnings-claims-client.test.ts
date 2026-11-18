import assert from "node:assert/strict";
import test from "node:test";
import { claimCalldataMatches, describeContractWalletClaim, encodeEarningsClaim, isEarningsClaimRequest, readEarningsClaimJournal, sendEarningsClaim, storeEarningsClaimJournal,
  type EarningsPreparedClaim } from "../earnings-claims";
import { prepareEarningsClaim } from "./earnings-claims";
import { readEarningsContracts } from "./earnings-contracts";
import { ea, eh, fixtureCode, earningsTestFixture } from "./earnings-test-fixture";

async function prepared() {
  const f = earningsTestFixture();
  const p = await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.creator, operation: "curve-claim" });
  assert.equal(p.status, "prepared"); return { f, p: p as EarningsPreparedClaim };
}
function memoryStorage() { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }

test("claim calldata encodes no recipient override, and only collect includes an on-chain deadline", async () => {
  const { p } = await prepared();
  assert.equal(isEarningsClaimRequest(p.request), true); assert.equal(await claimCalldataMatches(p.request), true);
  assert.equal(p.request.data, "0x4e71d92d"); assert.equal(p.request.deadline, null); assert.equal(p.quote.onchainDeadline, false);
  assert.equal(await encodeEarningsClaim("creation-fees", ea(3), null), "0x60fd947d");
  assert.notEqual(await encodeEarningsClaim("lp-claim-native", ea(3), null), await encodeEarningsClaim("lp-claim-token", ea(3), null));
  assert.equal(isEarningsClaimRequest({ ...p.request, beneficiary: ea(987654) }), false);
  assert.equal(await claimCalldataMatches({ ...p.request, data: "0x60fd947d" }), false);
  assert.equal(isEarningsClaimRequest({ ...p.request, chainId: "0x1" }), false);
  assert.equal(isEarningsClaimRequest({ ...p.request, destination: ea(987654) }), false);
});

test("wallet rejection clears only the explicitly rejected request and allows a fresh review", async () => {
  const { f, p } = await prepared(), storage = memoryStorage(); let sends = 0;
  const wallet = { request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [f.creator]; if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_getTransactionCount") return "0x0"; if (method === "eth_getCode") return fixtureCode;
    sends++; assert.equal(readEarningsClaimJournal(storage, p.request)?.state, "awaiting-wallet", "Journal precedes the wallet prompt");
    throw Object.assign(new Error("user rejected"), { code: 4001 });
  } };
  await assert.rejects(sendEarningsClaim({ ...p, wallet, storage, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" },
    now: () => p.request.reviewTimestamp * 1000, revalidate: async () => p }), /rejected/);
  assert.equal(sends, 1); assert.equal(readEarningsClaimJournal(storage, p.request), null);
});

test("wrapped wallet rejection clears only the exact unsubmitted intent and bounds error traversal", async () => {
  for (const mode of ["wrapped", "different-intent", "too-deep"] as const) {
    const { f, p } = await prepared(), storage = memoryStorage();
    const replacement = { ...p.request, nonce: "0x1" as const };
    const wallet = { request: async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return [f.creator]; if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getTransactionCount") return "0x0"; if (method === "eth_getCode") return fixtureCode;
      if (mode === "different-intent") storeEarningsClaimJournal(storage, { schemaVersion: 1, request: replacement,
        state: "awaiting-wallet", transactionHash: null, createdAt: 1, updatedAt: 1 });
      let error: unknown = { code: 4001 };
      for (let depth = 0; depth < (mode === "too-deep" ? 7 : 2); depth++) error = { cause: error };
      throw error;
    } };
    await assert.rejects(sendEarningsClaim({ ...p, wallet, storage, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" },
      now: () => p.request.reviewTimestamp * 1000, revalidate: async () => p }));
    const retained = readEarningsClaimJournal(storage, p.request);
    if (mode === "wrapped") assert.equal(retained, null);
    else { assert.equal(retained?.state, "awaiting-wallet"); assert.equal(retained?.request.nonce, mode === "different-intent" ? "0x1" : "0x0"); }
  }
});

test("a missing returned hash remains recoverable after refresh and prevents duplicate submission", async () => {
  const { f, p } = await prepared(), storage = memoryStorage(); let sends = 0;
  const wallet = { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [f.creator] : method === "eth_chainId" ? "0x7a69"
    : method === "eth_getTransactionCount" ? "0x0" : method === "eth_getCode" ? fixtureCode : (++sends, undefined) };
  const input = { ...p, wallet, storage, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" }, now: () => p.request.reviewTimestamp * 1000, revalidate: async () => p };
  const result = await sendEarningsClaim(input); assert.equal(result.state, "hash-missing");
  assert.equal(readEarningsClaimJournal(storage, p.request)?.request.nonce, p.request.nonce);
  await assert.rejects(sendEarningsClaim(input), /Recover the existing/); assert.equal(sends, 1);
});

test("RPC interruption after broadcast retains the original request without another signature", async () => {
  const { f, p } = await prepared(), storage = memoryStorage();
  const wallet = { request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [f.creator]; if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_getTransactionCount") return "0x0"; if (method === "eth_getCode") return fixtureCode; throw Error("transport interrupted");
  } };
  await assert.rejects(sendEarningsClaim({ ...p, wallet, storage, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" },
    now: () => p.request.reviewTimestamp * 1000, revalidate: async () => p }), /interrupted/);
  assert.equal(readEarningsClaimJournal(storage, p.request)?.state, "awaiting-wallet");
});

test("account/network changes, stale reviews and refreshed costs block the wallet send", async () => {
  for (const mode of ["account", "chain", "during-revalidation", "request", "cost", "expired"]) {
    const { f, p } = await prepared(), storage = memoryStorage(); let sends = 0, switched = false;
    const wallet = { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [mode === "account" || switched ? ea(987654) : f.creator]
      : method === "eth_chainId" ? mode === "chain" ? "0x1237" : "0x7a69" : (++sends, eh(12)) };
    await assert.rejects(sendEarningsClaim({ ...p, wallet, storage, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" },
      now: () => (mode === "expired" ? p.request.reviewExpiresAt : p.request.reviewTimestamp) * 1000,
      revalidate: async () => { switched = mode === "during-revalidation"; return mode === "request" ? { ...p, request: { ...p.request, nonce: "0x1" } }
        : mode === "cost" ? { ...p, quote: { ...p.quote, gasPriceWei: "3" } } : p; } }));
    assert.equal(sends, 0, mode); assert.equal(readEarningsClaimJournal(storage, p.request), null);
  }
});

test("hosted origins and 4663 never request account permission, signatures or transactions", async () => {
  const { p } = await prepared(); let calls = 0;
  for (const location of [{ protocol: "https:", hostname: "www.rmtlaunch.fun", port: "" }, { protocol: "https:", hostname: "preview.up.railway.app", port: "" }]) {
    await assert.rejects(sendEarningsClaim({ ...p, location, wallet: { request: async () => { calls++; } }, storage: memoryStorage(), revalidate: async () => p }));
  }
  await assert.rejects(sendEarningsClaim({ ...p, request: { ...p.request, chainId: "0x1237" }, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" },
    wallet: { request: async () => { calls++; } }, storage: memoryStorage(), revalidate: async () => p }));
  assert.equal(calls, 0);
});

test("wallet RPC corroborates current target runtime and pending nonce before journaling or signing", async () => {
  for (const mode of ["runtime", "nonce", "oversized-code"] as const) {
    const { f, p } = await prepared(); const storage = memoryStorage(); let sends = 0;
    const wallet = { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [f.creator] : method === "eth_chainId" ? "0x7a69"
      : method === "eth_getTransactionCount" ? mode === "nonce" ? "0x1" : "0x0"
      : method === "eth_getCode" ? mode === "runtime" ? "0x6002" : mode === "oversized-code" ? "0x" + "11".repeat(24577) : fixtureCode : (++sends, eh(12)) };
    await assert.rejects(sendEarningsClaim({ ...p, wallet, storage, location: { protocol: "http:", hostname: "127.0.0.1", port: "3456" },
      now: () => p.request.reviewTimestamp * 1000, revalidate: async () => p }));
    assert.equal(sends, 0); assert.equal(readEarningsClaimJournal(storage, p.request), null);
  }
});

test("contract-wallet handoff fixes the credited caller, ledger and zero-value inner CALL without an execution capability", async () => {
  const f = earningsTestFixture({ graduated: true }); f.state.contractBeneficiary = true;
  const snapshot = await readEarningsContracts(f.context, f.registration, f.creator);
  assert.equal(snapshot.status, "ready"); if (snapshot.status !== "ready") return;
  for (const operation of ["curve-claim", "lp-claim", "lp-claim-native", "lp-claim-token"] as const) {
    const described = await describeContractWalletClaim(snapshot, operation);
    assert.equal(described.requiredCaller, f.creator); assert.equal(described.value, "0x0"); assert.equal(described.executionEnabled, false);
    assert.equal(described.to.toLowerCase(), (operation === "curve-claim" ? f.ledger : f.lpLedger).toLowerCase());
    assert.equal(described.data, await encodeEarningsClaim(operation, f.token, null));
    assert.equal("nonce" in described, false, "A Safe nonce must not be replaced with its owner's EOA nonce");
    assert.equal("from" in described, false, "No outer EOA transaction is proposed");
    assert.equal(Object.isFrozen(described), true); assert.equal(Object.isFrozen(described.observation), true);
  }
});

test("unsigned handoff rejects relayer operations, mixed recipient identity and delegated EOA profiles", async () => {
  const f = earningsTestFixture({ graduated: true }); f.state.contractBeneficiary = true;
  const snapshot = await readEarningsContracts(f.context, f.registration, f.creator);
  assert.equal(snapshot.status, "ready"); if (snapshot.status !== "ready") return;
  for (const operation of ["lp-collect", "creation-fees"] as const) await assert.rejects(describeContractWalletClaim(snapshot, operation));
  await assert.rejects(describeContractWalletClaim({ ...snapshot, beneficiary: ea(999999) }, "curve-claim"));
  await assert.rejects(describeContractWalletClaim({ ...snapshot, rights: { ...snapshot.rights, accountType: "delegated-eoa" } }, "curve-claim"));
  await assert.rejects(describeContractWalletClaim({ ...snapshot, curve: { ...snapshot.curve, runtimeHash: "0x0" } }, "curve-claim"));
});
