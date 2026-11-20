import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { encodeProductionLifecycleCalldata, isProductionLifecycleRequest, productionLifecycleCalldataMatches, productionTradingPins,
  type ProductionLifecycleOperation, type ProductionLifecycleRequest } from "../production-lifecycle";
import { prepareProductionLifecycle, verifyProductionLifecycle, productionDirectWallet, exactProductionLifecycleTransaction,
  handleProductionLifecycle, parseProductionActivity, recoverProductionLifecycleHash } from "./production-lifecycle";
import { productionTradingFixture } from "./production-trading-test-fixture";
import { curveProductionPins } from "./curve-production";
import { launchTokenSupplyWei } from "../launch-terms";
import { isTestLifecycleRequest } from "../test-lifecycle";

async function withFixture(run: (f: ReturnType<typeof productionTradingFixture>) => Promise<void>) {
  const f = productionTradingFixture(), originalFetch = globalThis.fetch;
  const url = process.env.RMT_LAUNCH_HISTORY_INDEXER_URL, credential = process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  globalThis.fetch = f.fetcher; process.env.RMT_LAUNCH_HISTORY_INDEXER_URL = "https://synthetic-indexer.invalid";
  process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN = "local-only";
  try { await run(f); } finally { globalThis.fetch = originalFetch;
    if (url === undefined) delete process.env.RMT_LAUNCH_HISTORY_INDEXER_URL; else process.env.RMT_LAUNCH_HISTORY_INDEXER_URL = url;
    if (credential === undefined) delete process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN; else process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN = credential;
  }
}
async function prepare(f: ReturnType<typeof productionTradingFixture>, op: ProductionLifecycleOperation = "buy", amount = "2000000000000000000") {
  const r = await prepareProductionLifecycle(f.context(), f.p.f.token, f.p.f.creator, op, op === "graduate" ? "0" : amount, op.includes("buy") || op.includes("sell") ? 50 : 0);
  assert.equal(r.status, "prepared"); assert.ok("request" in r && r.request && "quote" in r && r.quote);
  return r as Extract<typeof r, { request: unknown }>;
}
test("production curve adapter prepares genuine 4663 calldata, exact 2 ETH gross accounting and verified Nitro fees", async () => withFixture(async f => {
  const r = await prepare(f);
  assert.equal(r.request.chainId, "0x1237"); assert.equal(isTestLifecycleRequest(r.request), false);
  assert.equal(isProductionLifecycleRequest(r.request), true); assert.equal(await productionLifecycleCalldataMatches(r.request), true);
  assert.equal(r.state.targetBackingWei, "2000000000000000000"); assert.equal(r.state.targetSoldWei, (launchTokenSupplyWei * 3n / 5n).toString());
  assert.equal(r.quote.feeWei, "20000000000000000"); assert.equal(r.quote.refundWei, "0");
  assert.equal(r.quote.feeEvidence, "verified-nitro"); assert.equal(r.quote.l1PosterGasUnits, "10000"); assert.equal(r.quote.gasUnits, "62500");
  assert.equal(r.quote.gasPriceWei, "5"); assert.equal(r.quote.maxPriorityFeePerGasWei, "1");
  f.knobs.request = r.request; f.knobs.mined = true;
  assert.equal((await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity)).status, "confirmed");
}));
test("new production zero-poster policy requires actual measured zero native rates on both witnesses at the exact transaction block", async () => withFixture(async f => {
  f.knobs.zeroPoster = true;
  const r = await prepare(f);
  assert.equal(r.quote.feeEvidence, "verified-nitro-zero-poster"); assert.equal(r.quote.l1PosterGasUnits, "0");
  assert.ok(r.quote.feeEvidence === "verified-nitro-zero-poster");
  assert.deepEqual(r.quote.nitroZeroPosterPolicy, { profile: "nitro-zero-poster-v1", chainId: 4663, l1BaseFeeWei: "0", l1CalldataUnitWei: "0", l2BaseFeeWei: "2", nativeL2BaseFeeWei: "2",
    blockNumber: f.context().anchor.blockNumber.toString(), blockHash: f.context().anchor.blockHash });
  f.knobs.zeroNativeDifferent = true; const different = await prepare(f);
  assert.ok(different.quote.feeEvidence === "verified-nitro-zero-poster");
  assert.equal(different.quote.nitroZeroPosterPolicy.nativeL2BaseFeeWei, "3"); assert.equal(different.quote.nitroZeroPosterPolicy.l2BaseFeeWei, "2");
  assert.equal(different.quote.gasPriceWei, "7");
  f.knobs.zeroNativeDifferent = false; f.knobs.zeroBaseMismatch = true; const transactionDifferent = await prepare(f);
  assert.ok(transactionDifferent.quote.feeEvidence === "verified-nitro-zero-poster");
  assert.equal(transactionDifferent.quote.transactionBaseFeeWei, "3"); assert.equal(transactionDifferent.quote.nitroZeroPosterPolicy.l2BaseFeeWei, "2");
  assert.equal(transactionDifferent.quote.gasPriceWei, "7");
}));
test("new zero-poster branch rejects positive/mixed C8, absent data, nonzero native rates, zero transaction base and missing opt-in", async () => {
  for (const fault of ["positive", "conflicting", "missingC8", "nativeL1", "nativeUnit", "base", "missingNative", "noOptIn"] as const) await withFixture(async f => {
    f.knobs.zeroPoster = true;
    if (fault === "positive") f.knobs.positiveC8 = true;
    if (fault === "conflicting") f.knobs.conflictingC8 = true;
    if (fault === "missingC8") f.knobs.missingC8 = true;
    if (fault === "nativeL1") f.knobs.zeroL1Estimate = 1n;
    if (fault === "nativeUnit") f.knobs.zeroUnit = 1n;
    if (fault === "base") f.knobs.missingTransactionBase = true;
    if (fault === "missingNative") f.knobs.missingGasInfo = true;
    const context = f.context(); if (fault === "noOptIn") delete context.feePolicy;
    await assert.rejects(() => prepareProductionLifecycle(context, f.p.f.token, f.p.f.creator, "buy", "2000000000000000000", 50), fault);
  });
});
test("production review survives fast canonical blocks with a fresh same-policy quote, while age/reorg/deadline protections remain", async () => {
  for (const zero of [false, true]) await withFixture(async f => {
    f.knobs.zeroPoster = zero; const original = await prepare(f); f.knobs.advance = 12n;
    const refreshed = await prepareProductionLifecycle(f.context(), original.request.token, original.request.from, "buy", original.request.amountWei, 50, original.request);
    assert.equal(refreshed.status, "prepared"); assert.ok(refreshed.request && refreshed.quote);
    assert.deepEqual(refreshed.request, original.request, "the original review, calldata, nonce and deadline stay exact");
    if (zero) {
      assert.ok(refreshed.quote.feeEvidence === "verified-nitro-zero-poster" && original.quote.feeEvidence === "verified-nitro-zero-poster");
      assert.notEqual(refreshed.quote.nitroZeroPosterPolicy.blockNumber, original.quote.nitroZeroPosterPolicy.blockNumber);
    }
    f.knobs.advance = 257n;
    assert.equal((await prepareProductionLifecycle(f.context(), original.request.token, original.request.from, "buy", original.request.amountWei, 50, original.request)).status, "invalid");
    f.knobs.advance = 12n; f.p.knobs.reorg = true;
    assert.equal((await prepareProductionLifecycle(f.context(), original.request.token, original.request.from, "buy", original.request.amountWei, 50, original.request)).status, "invalid");
    f.p.knobs.reorg = false; f.knobs.expired = true;
    await assert.rejects(() => prepareProductionLifecycle(f.context(), original.request.token, original.request.from, "buy", original.request.amountWei, 50, original.request));
  });
});
test("four ETH gross input preserves two ETH graduation target and refunds all excess; source-target change is refused", async () => withFixture(async f => {
  const r = await prepare(f, "buy", "4000000000000000000");
  const [, gross, fee, refund] = f.buyQuote(4n * 10n ** 18n);
  assert.equal(gross - fee, 2n * 10n ** 18n); assert.equal(BigInt(r.quote.refundWei), refund); assert.ok(refund > 10n ** 18n);
  assert.equal(BigInt(r.quote.outputWei), launchTokenSupplyWei * 3n / 5n);
  f.knobs.request = r.request; f.knobs.mined = true;
  const result = await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity);
  assert.equal(result.status, "confirmed"); assert.equal(result.refundWei, refund.toString());
  f.knobs.mined = false; f.knobs.wrongTarget = true;
  await assert.rejects(() => prepare(f));
}));
test("production sell requires the exact finite allowance; approval destinations are actual production pins", async () => withFixture(async f => {
  const missing = await prepareProductionLifecycle(f.context(), f.p.f.token, f.p.f.creator, "sell", "1000", 50);
  assert.equal(missing.status, "invalid"); f.knobs.allowance = 1000n;
  const sold = await prepare(f, "sell", "1000"); assert.equal(sold.quote.outputWei, "990");
  f.knobs.request = sold.request; f.knobs.mined = true;
  assert.equal((await verifyProductionLifecycle(f.context(), sold.request, f.p.f.txHash, f.activity)).status, "confirmed");
  const data = await encodeProductionLifecycleCalldata("v4-token-approve", sold.request.token, sold.request.curve, 1000n, 0n, BigInt(sold.request.deadline));
  assert.equal(decodeFunctionData({ abi: erc20Abi, data }).args?.[0]?.toLowerCase(), productionTradingPins.permit2.toLowerCase());
  const permit = await encodeProductionLifecycleCalldata("v4-permit2-approve", sold.request.token, sold.request.curve, 1000n, 0n, BigInt(sold.request.deadline));
  const decoded = decodeFunctionData({ abi: parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]), data: permit });
  assert.equal(decoded.args?.[1]?.toLowerCase(), productionTradingPins.router.toLowerCase());
}));
test("graduation requires exact eligible state and verifies locked original production LP custody", async () => withFixture(async f => {
  const early = await prepareProductionLifecycle(f.context(), f.p.f.token, f.p.f.creator, "graduate", "0", 0); assert.equal(early.status, "invalid");
  f.knobs.phase = "eligible"; const r = await prepare(f, "graduate"); f.knobs.request = r.request; f.knobs.mined = true;
  assert.equal((await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity)).status, "confirmed");
  f.p.f.baseState.wrongPosition = true;
  assert.equal((await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity)).status, "unavailable");
}));
test("production v4 uses the complete canonical PoolKey and router 2.1.2 for exact-in swaps and finite approvals", async () => {
  for (const op of ["v4-buy", "v4-token-approve", "v4-permit2-approve", "v4-sell"] as const) await withFixture(async f => {
    f.knobs.phase = "graduated"; const amount = "1000000000000000000";
    if (op === "v4-permit2-approve" || op === "v4-sell") f.knobs.erc20Allowance = BigInt(amount);
    if (op === "v4-sell") f.knobs.permitAllowance = BigInt(amount);
    const r = await prepare(f, op, amount); assert.ok(r.request.v4); assert.equal(r.request.v4.poolKey.fee, 3000);
    assert.equal(r.request.v4.poolKey.tickSpacing, 60); assert.equal(r.request.v4.poolKey.hooks.toLowerCase(), curveProductionPins.guard[0].toLowerCase());
    assert.equal(await productionLifecycleCalldataMatches(r.request), true);
    f.knobs.request = r.request; f.knobs.mined = true;
    assert.equal((await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity)).status, "confirmed", op);
  });
});
test("checkpoint progress without exact durable events never confirms; recovery uses original nonce without resending", async () => withFixture(async f => {
  const r = await prepare(f); f.knobs.request = r.request; f.knobs.mined = true; f.knobs.missingIndex = true;
  assert.deepEqual(await verifyProductionLifecycle(f.context(), r.request, undefined, f.activity), { status: "pending", transactionHash: f.p.f.txHash, indexed: false, settlementPending: true });
  f.knobs.missingIndex = false; f.knobs.wrongIndex = true;
  assert.equal((await verifyProductionLifecycle(f.context(), r.request, undefined, f.activity)).status, "pending");
  f.knobs.wrongIndex = false;
  assert.equal(await recoverProductionLifecycleHash(f.rpc, f.context(), r.request), f.p.f.txHash);
  assert.equal((await verifyProductionLifecycle(f.context(), r.request, undefined, f.activity)).status, "confirmed");
  f.knobs.reorg = true; assert.equal((await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity)).status, "unavailable");
}));
test("both witnesses, release, review, wallet authority and transaction identity are mandatory", async () => withFixture(async f => {
  const r = await prepare(f); f.knobs.request = r.request;
  assert.equal((await prepareProductionLifecycle(f.context(), r.request.token, r.request.from, "buy", r.request.amountWei, 50, { ...r.request, approvalBinding: "f".repeat(64) })).status, "invalid");
  f.knobs.quoteConflict = true; await assert.rejects(() => prepare(f)); f.knobs.quoteConflict = false;
  f.knobs.peerOffline = true; await assert.rejects(() => prepare(f)); f.knobs.peerOffline = false;
  f.p.f.state.kind = "safe-1.4.1"; await assert.rejects(() => productionDirectWallet(f.rpc, r.request.from, f.context().anchor.blockNumber, true)); f.p.f.state.kind = "eoa";
  const tx = await f.rpc.getTransaction({ hash: f.p.f.txHash });
  assert.equal(exactProductionLifecycleTransaction(tx, r.request), true);
  for (const mutation of [{ chainId: 31337 }, { input: "0xdeadbeef" }, { value: 1n }, { nonce: 1 }, { type: "eip7702" }, { accessList: [{}] }, { authorizationList: [] }]) {
    assert.equal(exactProductionLifecycleTransaction({ ...tx, ...mutation } as never, r.request), false, JSON.stringify(mutation, (_, v) => typeof v === "bigint" ? v.toString() : v));
  }
}));
test("exact pinned MetaMask delegation can prepare a direct trade; changed or pending-revoked delegation cannot", async () => withFixture(async f => {
  f.p.f.state.kind = "metamask-7702";
  const prepared = await prepare(f);
  assert.equal(isProductionLifecycleRequest(prepared.request), true);
  f.p.f.state.pendingDelegateChanged = true; await assert.rejects(() => prepare(f));
  f.p.f.state.pendingDelegateChanged = false; f.p.f.state.badDelegate = true; await assert.rejects(() => prepare(f));
}));
test("reverted transaction stays terminal but never claims index settlement; malformed activity is rejected", async () => withFixture(async f => {
  const r = await prepare(f); f.knobs.request = r.request; f.knobs.mined = true; f.knobs.reverted = true;
  assert.equal((await verifyProductionLifecycle(f.context(), r.request, f.p.f.txHash, f.activity)).status, "reverted");
  const data = { schemaVersion: 1, profile: "rmt-curve-activity-v1", chainId: 4663, status: "ready", observedAt: new Date().toISOString(),
    token: r.request.token, transactionHash: f.p.f.txHash, deployment: f.directory().deployment, checkpoint: f.directory().checkpoint, events: [] };
  assert.ok(parseProductionActivity(data, r.request.token, f.p.f.txHash));
  assert.ok(parseProductionActivity({ ...data, events: [{ address: r.request.token, blockNumber: data.checkpoint.blockNumber,
    blockHash: data.checkpoint.blockHash, transactionHash: f.p.f.txHash, transactionIndex: 0, logIndex: 1,
    topics: ["0x" + "0".repeat(64)], data: "0x" }] }, r.request.token, f.p.f.txHash), "zero-valued indexed event topics are legitimate");
  assert.equal(parseProductionActivity({ ...data, profile: "rmt-curve-fixed-supply-security-v2" }, r.request.token, f.p.f.txHash), null);
  assert.equal(parseProductionActivity({ ...data, checkpoint: { ...data.checkpoint, timestamp: "2020-01-01T00:00:00.000Z" } }, r.request.token, f.p.f.txHash), null);
}));
test("production financial routes remain closed before reading body, connecting to any RPC or signing", async () => {
  const request = new Request("https://www.rmtlaunch.fun/api/launchpad/production-lifecycle", { method: "POST", headers: { Origin: "https://www.rmtlaunch.fun" }, body: "{}" });
  const response = await handleProductionLifecycle(request); assert.equal(response.status, 404); assert.equal((await response.json()).status, "unavailable");
  assert.equal(curveProductionPins.router212[0], productionTradingPins.router);
});
test("all eight real production operations fit bounded HTTP prepare/revalidate/verify bodies, including full v4 calldata", async () => {
  const sizes: Record<string, { prepare: number; verify: number }> = {};
  for (const op of ["buy", "sell", "approve", "graduate", "v4-buy", "v4-sell", "v4-token-approve", "v4-permit2-approve"] as const) await withFixture(async f => {
    if (op.startsWith("v4-")) f.knobs.phase = "graduated"; if (op === "graduate") f.knobs.phase = "eligible";
    if (op === "sell") f.knobs.allowance = 1000n;
    if (op === "v4-sell" || op === "v4-permit2-approve") f.knobs.erc20Allowance = 1000n;
    if (op === "v4-sell") f.knobs.permitAllowance = 1000n;
    const options = { configured: (() => ({ release: {}, approvalBinding: f.context().approvalBinding, scope: "trading" })) as any,
      resolve: (async () => f.context()) as any, activity: f.activity };
    const call = async (body: object) => {
      const response = await handleProductionLifecycle(new Request("https://www.rmtlaunch.fun/api/launchpad/production-lifecycle", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.rmtlaunch.fun" }, body: JSON.stringify(body) }), options);
      assert.equal(response.status, 200, op); return response.json();
    };
    const body = { action: "prepare", token: f.p.f.token, account: f.p.f.creator, operation: op, amountWei: op === "graduate" ? "0" : "1000", slippageBps: op.includes("buy") || op.includes("sell") ? 50 : 0 };
    const prepared = await call(body); assert.equal(prepared.status, "prepared", op);
    const prior = { ...body, prior: prepared.request };
    assert.equal((await call(prior)).status, "prepared", op);
    f.knobs.request = prepared.request; f.knobs.mined = true;
    const verification = { action: "verify", request: prepared.request, transactionHash: f.p.f.txHash };
    assert.equal((await call(verification)).status, "confirmed", op);
    sizes[op] = { prepare: Buffer.byteLength(JSON.stringify(prior)), verify: Buffer.byteLength(JSON.stringify(verification)) };
    assert.ok(sizes[op].prepare <= 4096 && sizes[op].verify <= 4096);
  });
  console.log("Production bounded HTTP body bytes: " + JSON.stringify(sizes));
});
test("active-gate HTTP still rejects foreign authority and oversized streamed bodies before RPC resolution", async () => {
  let resolves = 0; const options = { configured: (() => ({ release: {}, approvalBinding: "a".repeat(64), scope: "trading" })) as any,
    resolve: (async () => { resolves++; throw Error("must not resolve"); }) as any };
  const headers = { Origin: "https://www.rmtlaunch.fun", "Content-Type": "application/json" };
  assert.equal((await handleProductionLifecycle(new Request("https://foreign.invalid/api/launchpad/production-lifecycle", { method: "POST", headers, body: "{}" }), options)).status, 403);
  assert.equal((await handleProductionLifecycle(new Request("https://www.rmtlaunch.fun/api/launchpad/production-lifecycle", { method: "POST", headers, body: " ".repeat(4097) }), options)).status, 413);
  assert.equal(resolves, 0);
});
