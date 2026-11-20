import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, toHex } from "viem";
import { submitProductionTrade, readProductionTradeJournal, clearProductionTradeJournal, assertNoPendingProductionTrade,
  productionTradeJournalIndex, listCompletedProductionTradeJournals, updateProductionTradeJournalFromVerification, type PreparedProductionTrade } from "../production-trading-wallet";
import { productionAccountLock, type ProductionWallet } from "../production-wallet";
import { productionCreationJournalKey, productionCreationAbi, productionCreationFactory, submitProductionCreation, type ProductionCreationRequest } from "../production-creation";
import { productionNonceFloorKey } from "../production-nonce";
import { prepareProductionLifecycle } from "./production-lifecycle";
import { productionTradingFixture } from "./production-trading-test-fixture";

function memory() {
  const records = new Map<string, string>();
  return { records, getItem: (k: string) => records.get(k) ?? null, setItem: (k: string, v: string) => { records.set(k, v); }, removeItem: (k: string) => { records.delete(k); } };
}
async function fixture(run: (f: { wallet: ProductionWallet; prepared: PreparedProductionTrade; storage: ReturnType<typeof memory>;
  knobs: { enabled: boolean; gasIncrease: boolean; code: string; nonce: string; chain: string; changedProvider: boolean; error: number | null;
    returnedHash: boolean; verifyHash: boolean; confirmed: boolean; locked: boolean; deniedStorage: boolean; feeVariantChanged: boolean; feeBaseMismatch: boolean;
    blockAdvance: bigint; expired: boolean; freshProofReorg: boolean };
  calls: Array<{ method: string; params?: readonly unknown[] }>; fetcher: typeof fetch; hash: `0x${string}`; window: any }) => Promise<void>, zeroPoster = false) {
  const f = productionTradingFixture(), storage = memory(), originalFetch = globalThis.fetch;
  const oldUrl = process.env.RMT_LAUNCH_HISTORY_INDEXER_URL, oldToken = process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.fetch = f.fetcher; process.env.RMT_LAUNCH_HISTORY_INDEXER_URL = "https://synthetic-indexer.invalid";
  process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN = "local-only";
  try {
    f.knobs.zeroPoster = zeroPoster;
    const prepared = await prepareProductionLifecycle(f.context(), f.p.f.token, f.p.f.creator, "buy", "2000000000000000000", 50);
    assert.ok(prepared.status === "prepared" && prepared.request && prepared.quote);
    const p = prepared as PreparedProductionTrade, r = JSON.parse(JSON.stringify(p.request)) as typeof p.request,
      baseQuote = JSON.parse(JSON.stringify(p.quote)) as typeof p.quote, hash = f.p.f.txHash;
    const knobs = { enabled: true, gasIncrease: false, code: "0x", nonce: "0x0", chain: "0x1237", changedProvider: false,
      error: null as number | null, returnedHash: true, verifyHash: true, confirmed: false, locked: false, deniedStorage: false, feeVariantChanged: false, feeBaseMismatch: false,
      blockAdvance: 0n, expired: false, freshProofReorg: false };
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const provider = { request: async (arg: { method: string; params?: readonly unknown[] }) => {
      calls.push(arg);
      switch (arg.method) {
        case "eth_accounts": return [r.from]; case "eth_chainId": return knobs.chain;
        case "eth_getBlockByNumber": return arg.params?.[0] === "latest" ? { number: toHex(BigInt(r.reviewBlockNumber) + knobs.blockAdvance), hash: r.reviewBlockHash,
          timestamp: toHex(knobs.expired ? BigInt(r.deadline) : BigInt(r.deadline) - 180n + (knobs.blockAdvance > 0n ? 3n : 0n)), baseFeePerGas: "0x2" }
          : { number: arg.params![0], hash: arg.params![0] === r.blockNumber ? r.blockHash : arg.params![0] === r.reviewBlockNumber ? r.reviewBlockHash
            : "0x" + (knobs.freshProofReorg ? "c" : "b").repeat(64), baseFeePerGas: knobs.feeBaseMismatch ? "0x3" : "0x2" };
        case "eth_getCode": return knobs.code; case "eth_getTransactionCount": return knobs.nonce;
        case "eth_gasPrice": return "0x2"; case "eth_getBalance": return toHex(100n * 10n ** 18n);
        case "eth_estimateGas": return "0xc350"; case "eth_call": return "0x";
        case "eth_sendTransaction":
          assert.ok(readProductionTradeJournal(storage, r.from, r.token), "intent must survive a crash before wallet returns");
          if (knobs.error !== null) throw { code: knobs.error };
          return knobs.returnedHash ? knobs.nonce === "0x0" ? hash : "0x" + "e".repeat(64) : undefined;
        default: throw Error("unexpected wallet call " + arg.method);
      }
    } };
    const wallet: ProductionWallet = { account: r.from, provider, request: provider.request };
    const window = { location: { protocol: "https:", hostname: "www.rmtlaunch.fun", port: "" }, ethereum: provider };
    Object.defineProperty(globalThis, "window", { value: window, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: async (name: string, options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
      assert.equal(name, productionAccountLock(r.from)); return callback(knobs.locked ? null : {});
    } } }, configurable: true });
    const fetcher: typeof fetch = async (input, init) => {
      if (input === "/api/launchpad/config") return Response.json({ status: "production-financial", chainId: 4663, trading: knobs.enabled ? "enabled" : "disabled", approvals: { trading: r.approvalBinding } });
      const body = JSON.parse(init!.body as string);
      if (body.action === "prepare") {
        const request = { ...r, nonce: knobs.nonce };
        assert.deepEqual(body.prior, request);
        const quote: any = { ...baseQuote, gasPriceWei: knobs.gasIncrease ? (BigInt(baseQuote.gasPriceWei) + 1n).toString() : baseQuote.gasPriceWei };
        if (quote.nitroZeroPosterPolicy && knobs.blockAdvance > 0n) quote.nitroZeroPosterPolicy = { ...quote.nitroZeroPosterPolicy,
          blockNumber: (BigInt(r.reviewBlockNumber) + knobs.blockAdvance).toString(), blockHash: "0x" + "b".repeat(64) };
        if (knobs.feeVariantChanged) { quote.feeEvidence = "verified-nitro"; quote.l1PosterGasUnits = "10000"; delete quote.nitroZeroPosterPolicy; delete quote.transactionBaseFeeWei; delete quote.observedGasPriceWei; }
        return Response.json({ status: "prepared", request, quote });
      }
      if (body.action === "verify") return Response.json({ status: knobs.confirmed ? "confirmed" : "pending", indexed: knobs.confirmed,
        ...(knobs.verifyHash && { transactionHash: knobs.nonce === "0x0" ? hash : "0x" + "e".repeat(64) }) });
      throw Error("unexpected same-origin API request");
    };
    globalThis.fetch = fetcher;
    await run({ wallet, prepared: p, storage, knobs, calls, fetcher, hash, window });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.RMT_LAUNCH_HISTORY_INDEXER_URL; else process.env.RMT_LAUNCH_HISTORY_INDEXER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN; else process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN = oldToken;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else Reflect.deleteProperty(globalThis, "navigator");
  }
}
test("production sender journals before exactly one explicit bounded type-2 request and refuses duplicate sends", async () => fixture(async f => {
  const result = await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher);
  assert.equal(result.status, "pending"); const sends = f.calls.filter(c => c.method === "eth_sendTransaction"); assert.equal(sends.length, 1);
  const tx = sends[0].params![0] as any; assert.equal(tx.chainId, "0x1237"); assert.equal(tx.type, "0x2");
  assert.equal(tx.maxFeePerGas, toHex(BigInt(f.prepared.quote.gasPriceWei))); assert.equal(tx.maxPriorityFeePerGas, "0x1");
  assert.equal(tx.nonce, f.prepared.request.nonce); assert.equal(Object.hasOwn(tx, "authorizationList"), false);
  assert.equal(readProductionTradeJournal(f.storage, f.wallet.account, f.prepared.request.token)?.transactionHash, f.hash);
  await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)); assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 1);
}));
test("strict zero-poster review sends only with its same canonical native policy and retains positive execution fees", async () => fixture(async f => {
  assert.equal(f.prepared.quote.feeEvidence, "verified-nitro-zero-poster"); assert.equal(f.prepared.quote.l1PosterGasUnits, "0");
  assert.equal((await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)).status, "pending");
  const sent = f.calls.find(c => c.method === "eth_sendTransaction")?.params?.[0] as any;
  assert.equal(sent.maxFeePerGas, "0x5"); assert.equal(sent.maxPriorityFeePerGas, "0x1");
}, true));
test("zero-poster client rejects absent native proof, policy/fee-variant changes and wallet checkpoint/base conflicts", async () => {
  for (const fault of ["missingProof", "wrongNative", "variant", "base", "ceiling", "missingTransactionBase", "missingRpcPrice"] as const) await fixture(async f => {
    if (fault === "missingProof") delete (f.prepared.quote as any).nitroZeroPosterPolicy;
    if (fault === "wrongNative") (f.prepared.quote as any).nitroZeroPosterPolicy.l1CalldataUnitWei = "1";
    if (fault === "variant") f.knobs.feeVariantChanged = true;
    if (fault === "base") f.knobs.feeBaseMismatch = true;
    if (fault === "ceiling") f.prepared.quote.gasPriceWei = "4";
    if (fault === "missingTransactionBase") delete (f.prepared.quote as any).transactionBaseFeeWei;
    if (fault === "missingRpcPrice") delete (f.prepared.quote as any).observedGasPriceWei;
    await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher), fault);
    assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 0);
  }, true);
});
test("a human production review can span fast blocks and refresh canonical native fee evidence without changing the intent", async () => {
  for (const zero of [false, true]) await fixture(async f => {
    f.knobs.blockAdvance = 12n;
    assert.equal((await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)).status, "pending");
    assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 1);
  }, zero);
  for (const failure of ["age", "expired", "freshReorg"] as const) await fixture(async f => {
    f.knobs.blockAdvance = failure === "age" ? 257n : 12n;
    if (failure === "expired") f.knobs.expired = true;
    if (failure === "freshReorg") f.knobs.freshProofReorg = true;
    await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher), failure);
    assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 0);
  }, true);
});
test("unknown wallet result and lost hash are preserved across reload and recovered without resending", async () => fixture(async f => {
  f.knobs.returnedHash = false; f.knobs.verifyHash = false;
  assert.equal((await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)).status, "pending");
  const restored = readProductionTradeJournal(f.storage, f.wallet.account, f.prepared.request.token); assert.ok(restored); assert.equal(restored.transactionHash, undefined);
  assert.throws(() => assertNoPendingProductionTrade(f.storage, f.wallet.account));
  await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher));
  assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 1);
}));
test("definite EIP1193 rejection clears only the unsubmitted record; unknown wallet errors preserve it", async () => {
  for (const code of [4001, -32000]) await fixture(async f => {
    f.knobs.error = code;
    if (code === 4001) { await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)); assert.equal(readProductionTradeJournal(f.storage, f.wallet.account, f.prepared.request.token), null); }
    else { assert.equal((await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)).status, "pending"); assert.ok(readProductionTradeJournal(f.storage, f.wallet.account, f.prepared.request.token)); }
  });
});
test("owner gate, origin, chain, wallet authority, nonce, revalidation and cross-tab lock failures prevent all sends", async () => {
  for (const change of ["gate", "origin", "chain", "code", "oversize-code", "nonce", "fees", "lock", "guard", "creation", "corrupt-index"] as const) await fixture(async f => {
    if (change === "gate") f.knobs.enabled = false;
    if (change === "origin") f.window.location.hostname = "evil.invalid";
    if (change === "chain") f.knobs.chain = "0x7a69";
    if (change === "code") f.knobs.code = "0x6001600055";
    if (change === "oversize-code") f.knobs.code = "0x" + "ff".repeat(24577);
    if (change === "nonce") f.knobs.nonce = "0x1";
    if (change === "fees") f.knobs.gasIncrease = true;
    if (change === "lock") f.knobs.locked = true;
    if (change === "creation") f.storage.setItem(productionCreationJournalKey, "{}");
    if (change === "corrupt-index") f.storage.setItem(productionTradeJournalIndex, "{}");
    await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher, () => { if (change === "guard") throw Error("revision changed"); }));
    assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 0, change);
  });
});
test("only the matching canonically indexed or reverted transaction clears durable production recovery", async () => fixture(async f => {
  await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher);
  const r = f.prepared.request;
  assert.throws(() => clearProductionTradeJournal(f.storage, r.from, r.token, { status: "confirmed", transactionHash: f.hash, indexed: false }));
  assert.throws(() => clearProductionTradeJournal(f.storage, r.from, r.token, { status: "confirmed", transactionHash: "0x" + "f".repeat(64) as `0x${string}`, indexed: true }));
  clearProductionTradeJournal(f.storage, r.from, r.token, { status: "confirmed", transactionHash: f.hash, indexed: true });
  assert.equal(readProductionTradeJournal(f.storage, r.from, r.token), null);
}));
test("consumed active and archived trade nonces block actual trade and creation senders after a wallet rewind before any wallet calls", async () => fixture(async f => {
  f.knobs.confirmed = true; await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher);
  const before = f.calls.length, r = f.prepared.request;
  await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)); assert.equal(f.calls.length, before);
  assert.throws(() => assertNoPendingProductionTrade(f.storage, r.from, "0x0")); assert.throws(() => assertNoPendingProductionTrade(f.storage, r.from));
  assertNoPendingProductionTrade(f.storage, r.from, "0x1");
  clearProductionTradeJournal(f.storage, r.from, r.token, { status: "confirmed", indexed: true, transactionHash: f.hash });
  const creation: ProductionCreationRequest = { from: r.from, to: productionCreationFactory, chainId: "0x1237", nonce: "0x0", value: "0x16bcc41e90000",
    intentId: f.hash, deadline: r.deadline, blockNumber: r.blockNumber, blockHash: r.blockHash,
    data: encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: ["Rewind Project", "REW", "", "0x0000000000000000000000000000000000000000", 0, f.hash, BigInt(r.deadline)] }) };
  await assert.rejects(() => submitProductionCreation(f.wallet as never, creation, f.storage, () => {}));
  await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)); assert.equal(f.calls.length, before);
  // Even bounded completed-receipt eviction cannot erase the account's durable floor.
  f.storage.records.delete("rmt:production:trade:v1:history");
  assert.throws(() => assertNoPendingProductionTrade(f.storage, r.from, "0")); assertNoPendingProductionTrade(f.storage, r.from, "1");
  f.knobs.nonce = "0x1"; f.prepared.request.nonce = "0x1";
  assert.equal((await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)).status, "confirmed");
  assert.equal(f.calls.filter(call => call.method === "eth_sendTransaction").length, 2, "a fresh nonce above the consumed floor remains usable");
}));
test("a canonical revert consumes its nonce, and an unavailable original or failed floor write keeps recovery blocked", async () => fixture(async f => {
  await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher); const r = f.prepared.request;
  const original = readProductionTradeJournal(f.storage, r.from, r.token)!;
  const setItem = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (key === productionNonceFloorKey) throw Error("synthetic floor storage unavailable"); setItem(key, value); };
  assert.throws(() => updateProductionTradeJournalFromVerification(f.storage, r.from, r.token, { status: "confirmed", indexed: true, transactionHash: f.hash }));
  assert.deepEqual(readProductionTradeJournal(f.storage, r.from, r.token), original);
  f.storage.setItem = setItem;
  updateProductionTradeJournalFromVerification(f.storage, r.from, r.token, { status: "reverted", indexed: false, transactionHash: f.hash });
  assert.throws(() => assertNoPendingProductionTrade(f.storage, r.from, "0")); assertNoPendingProductionTrade(f.storage, r.from, "1");
  updateProductionTradeJournalFromVerification(f.storage, r.from, r.token, { status: "unavailable", transactionHash: f.hash });
  assert.throws(() => assertNoPendingProductionTrade(f.storage, r.from, "1"));
}));
test("asynchronously mutated caller state cannot replace the reviewed intent or raise wallet fees", async () => fixture(async f => {
  const reviewedValue = f.prepared.request.value, reviewedFee = f.prepared.quote.gasPriceWei;
  const pending = submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher);
  f.prepared.request.value = "0xff"; f.prepared.quote.gasPriceWei = "999999999999999";
  assert.equal((await pending).status, "pending");
  const sent = f.calls.find(c => c.method === "eth_sendTransaction")?.params?.[0] as any;
  assert.equal(sent.value, reviewedValue); assert.equal(sent.maxFeePerGas, toHex(BigInt(reviewedFee)));
}));
test("storage failure prevents a wallet send and canonically settled responses retain their receipt until explicit archival", async () => {
  await fixture(async f => {
    f.storage.setItem = () => { throw Error("synthetic unavailable storage"); };
    await assert.rejects(() => submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)); assert.equal(f.calls.filter(c => c.method === "eth_sendTransaction").length, 0);
  });
  await fixture(async f => { f.knobs.confirmed = true;
    assert.equal((await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher)).status, "confirmed");
    assert.equal(readProductionTradeJournal(f.storage, f.wallet.account, f.prepared.request.token)?.verification?.status, "confirmed");
    clearProductionTradeJournal(f.storage, f.wallet.account, f.prepared.request.token, { status: "confirmed", indexed: true, transactionHash: f.hash });
    assert.equal(listCompletedProductionTradeJournals(f.storage).length, 1);
  });
});
test("unavailable recovered hash candidates cannot pin an unrelated transaction into the durable journal", async () => fixture(async f => {
  f.knobs.returnedHash = false; f.knobs.verifyHash = false; await submitProductionTrade(f.wallet, f.prepared, f.storage, f.fetcher);
  const r = f.prepared.request;
  updateProductionTradeJournalFromVerification(f.storage, r.from, r.token, { status: "unavailable", transactionHash: f.hash });
  assert.equal(readProductionTradeJournal(f.storage, r.from, r.token)?.transactionHash, undefined);
  updateProductionTradeJournalFromVerification(f.storage, r.from, r.token, { status: "pending", transactionHash: f.hash, settlementPending: true });
  assert.equal(readProductionTradeJournal(f.storage, r.from, r.token)?.transactionHash, f.hash);
}));
