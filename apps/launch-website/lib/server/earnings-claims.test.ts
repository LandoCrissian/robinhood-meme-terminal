import assert from "node:assert/strict";
import test from "node:test";
import { prepareEarningsClaim, verifyEarningsClaim, recoverEarningsClaimHash, handleProductionEarningsClaim, handleTestEarningsClaim,
  earningsClaimReadiness } from "./earnings-claims";
import { ea, eh, earningsTestFixture } from "./earnings-test-fixture";
import type { EarningsClaimOperation, EarningsPreparedClaim } from "../earnings-claims";
import { launchTokenSupplyWei } from "../launch-terms";

async function prepare(f = earningsTestFixture(), operation: EarningsClaimOperation = "curve-claim") {
  const result = await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.creator, operation });
  assert.equal(result.status, "prepared"); return { f, p: result as EarningsPreparedClaim };
}
function mined(f: ReturnType<typeof earningsTestFixture>, p: EarningsPreparedClaim) {
  f.state.request = p.request; f.state.head = 12n; f.state.mined = true;
  f.context.checkpoint = { blockNumber: "12", blockHash: eh(12), timestamp: new Date(Number(f.block(12n).timestamp) * 1000).toISOString() };
}

test("curve claim preparation binds original ledger and requires the actual beneficiary account", async () => {
  const f = earningsTestFixture();
  const unauthorized = await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.reserve, operation: "curve-claim" });
  assert.deepEqual(unauthorized, { status: "invalid", reason: "beneficiary-wallet-required" });
  const { p } = await prepare(f);
  assert.equal(p.request.to.toLowerCase(), f.ledger.toLowerCase()); assert.equal(p.request.beneficiary, f.creator);
  assert.equal(p.request.expectedNativeWei, "70"); assert.equal(p.quote.estimatedNetworkFeeWei, "60000");
  assert.equal(p.request.deadline, null); assert.equal(p.quote.transactions, 1);
});

test("creator migration does not substitute the old ledger or its existing fee credit", async () => {
  const f = earningsTestFixture(); f.state.activeCurve = ea(700001); f.state.version = 3; f.state.migrated = true;
  const { p } = await prepare(f); assert.equal(p.request.originCurve.toLowerCase(), f.origin.toLowerCase()); assert.equal(p.request.to.toLowerCase(), f.ledger.toLowerCase());
});

test("Safe/contract beneficiary read compatibility never permits an EOA owner to send a beneficiary claim", async () => {
  const f = earningsTestFixture(); f.state.contractBeneficiary = true;
  const result = await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.creator, operation: "curve-claim" });
  assert.deepEqual(result, { status: "invalid", reason: "contract-wallet-execution-required" });
});

test("permissionless LP collection and creation-fee release cannot redirect the receiving ledger or Operations", async () => {
  const f = earningsTestFixture({ graduated: true });
  const collection = await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.reserve, operation: "lp-collect" });
  assert.equal(collection.status, "prepared"); if (collection.status !== "prepared") return;
  assert.equal(collection.request.beneficiary.toLowerCase(), f.lpLedger.toLowerCase()); assert.equal(collection.request.to, f.context.graduation.address);
  assert.equal(collection.request.discoveryRecipient, f.creator); assert.equal(collection.quote.onchainDeadline, true);
  const payout = await prepareEarningsClaim({ context: f.context, beneficiary: f.creator, account: f.creator, operation: "creation-fees" });
  assert.equal(payout.status, "prepared"); if (payout.status !== "prepared") return;
  assert.equal(payout.request.beneficiary.toLowerCase(), f.operations.toLowerCase()); assert.equal(payout.request.to, f.context.factory);
  assert.equal(payout.quote.amountSemantics, "factory-global-fees-may-grow");
});

test("native-only and token-only LP claims encode distinct calls with exact asset scope", async () => {
  for (const operation of ["lp-claim", "lp-claim-native", "lp-claim-token"] as const) {
    const { p } = await prepare(earningsTestFixture({ graduated: true }), operation);
    assert.equal(p.request.expectedNativeWei, operation === "lp-claim-token" ? "0" : "70");
    assert.equal(p.request.expectedTokenWei, operation === "lp-claim-native" ? "0" : "150"); assert.equal(p.request.deadline, null);
  }
});

test("fee growth preserves the reviewed minimum and original identity while reporting the new current credit", async () => {
  const { f, p } = await prepare(); f.state.extraCurveFee = 5n; f.state.head = 11n;
  f.context.checkpoint = { blockNumber: "11", blockHash: eh(11), timestamp: new Date(Number(f.block(11n).timestamp) * 1000).toISOString() };
  const fresh = await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.creator, operation: "curve-claim", prior: p.request });
  assert.equal(fresh.status, "prepared"); if (fresh.status !== "prepared") return;
  assert.deepEqual(fresh.request, p.request); assert.equal(fresh.quote.amounts.nativeWei, "75");
});

test("pending nonces, reverted simulation and stale review context fail closed", async () => {
  const f = earningsTestFixture(); f.state.pendingNonce = 1;
  assert.deepEqual(await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.creator, operation: "curve-claim" }),
    { status: "invalid", reason: "pending-account-nonce" });
  f.state.pendingNonce = 0; f.state.rejectSimulation = true;
  assert.deepEqual(await prepareEarningsClaim({ context: f.context, registration: f.registration, beneficiary: f.creator, account: f.creator, operation: "curve-claim" }), { status: "unavailable" });
});

test("verified claim settlement accepts actual fee growth with canonical event, cumulative accounting and exact trace", async () => {
  const { f, p } = await prepare(); mined(f, p); f.state.afterClaim = true;
  const result = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash });
  assert.equal(result.status, "confirmed"); assert.deepEqual(result.amounts, { nativeWei: "75", tokenWei: "0" });
  assert.equal(result.indexed, false, "An advancing registration cursor must not invent claim-event indexing"); assert.equal(f.state.traceCalls, 1);
});

test("missing or malformed native settlement proof keeps receipt-only claims pending", async () => {
  for (const flag of ["traceAvailable", "traceInvalid"] as const) {
    const { f, p } = await prepare(); mined(f, p); f.state.afterClaim = true;
    if (flag === "traceAvailable") f.state.traceAvailable = false; else f.state.traceInvalid = true;
    const result = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash });
    assert.equal(result.status, "pending", flag); assert.equal(result.settlementPending, true);
  }
});

test("an event and payment cannot contradict the beneficiary's cumulative claim accounting", async () => {
  const { f, p } = await prepare(); mined(f, p); f.state.afterClaim = false;
  assert.equal((await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash })).status, "unavailable");
});

test("token-only claims recover without unavailable native traces and require the exact ERC-20 transfer", async () => {
  const { f, p } = await prepare(earningsTestFixture({ graduated: true }), "lp-claim-token");
  mined(f, p); f.state.afterClaim = true; f.state.receiptNative = 0n; f.state.receiptToken = 150n; f.state.traceAvailable = false;
  const result = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash });
  assert.equal(result.status, "confirmed"); assert.deepEqual(result.amounts, { nativeWei: "0", tokenWei: "150" }); assert.equal(f.state.traceCalls, 0);
});

test("LP collection proves the actual ledger credit and unchanged principal before accepting payment", async () => {
  const { f, p } = await prepare(earningsTestFixture({ graduated: true }), "lp-collect");
  mined(f, p); f.state.afterCollection = true; f.state.receiptNative = 4n; f.state.receiptToken = 7n;
  const collected = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash });
  assert.equal(collected.status, "confirmed"); assert.deepEqual(collected.amounts, { nativeWei: "4", tokenWei: "7" });
  f.state.wrongPosition = true;
  assert.equal((await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash })).status, "unavailable");
});

test("a reverted original transaction is terminal without attributing fees or automatically retrying", async () => {
  const { f, p } = await prepare(); mined(f, p); f.state.revertReceipt = true;
  const result = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash });
  assert.equal(result.status, "reverted"); assert.equal(result.amounts, undefined); assert.equal(f.state.traceCalls, 0);
});

test("indexer outage never undoes independently verified settlement or fabricates indexed activity", async () => {
  const { f, p } = await prepare(); mined(f, p); f.state.afterClaim = true;
  const result = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash,
    indexed: async () => { throw Error("indexer interrupted"); } });
  assert.equal(result.status, "confirmed"); assert.equal(result.indexed, false);
  const indexed = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash,
    indexed: async (hash, blockHash, index, amounts) => hash === f.txHash && blockHash === eh(11) && index === 1 && amounts.nativeWei === "75" });
  assert.equal(indexed.status, "confirmed"); assert.equal(indexed.indexed, true);
});

test("review/receipt reorgs and a redirected request invalidate settlement instead of reporting success", async () => {
  for (const mode of ["review", "receipt", "recipient"] as const) {
    const { f, p } = await prepare(); mined(f, p); f.state.afterClaim = true;
    if (mode === "review") f.state.reorgReview = true; if (mode === "receipt") f.state.reorgReceipt = true;
    const request = mode === "recipient" ? { ...p.request, beneficiary: f.reserve } : p.request;
    assert.equal((await verifyEarningsClaim({ context: f.context, registration: f.registration, request, transactionHash: f.txHash })).status, "unavailable", mode);
  }
});

test("missing-hash nonce recovery identifies the original transaction without a scan or resend", async () => {
  const { f, p } = await prepare();
  assert.equal(await recoverEarningsClaimHash(f.context.rpc, { number: 10n }, p.request), "pending");
  mined(f, p); f.state.afterClaim = true;
  assert.equal(await recoverEarningsClaimHash(f.context.rpc, { number: 12n }, p.request), f.txHash);
  const result = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request });
  assert.equal(result.status, "confirmed"); assert.equal(result.transactionHash, f.txHash);
});

test("known transaction hashes retain bounded archive recovery beyond the missing-hash search window", async () => {
  const { f, p } = await prepare(); mined(f, p); f.state.afterClaim = true; f.state.head = 400n;
  f.context.checkpoint = { blockNumber: "400", blockHash: eh(400), timestamp: new Date(Number(f.block(400n).timestamp) * 1000).toISOString() };
  assert.equal(await recoverEarningsClaimHash(f.context.rpc, { number: 400n }, p.request), "unavailable");
  const known = await verifyEarningsClaim({ context: f.context, registration: f.registration, request: p.request, transactionHash: f.txHash });
  assert.equal(known.status, "confirmed"); assert.equal(known.transactionHash, f.txHash);
});

test("production adapter and hosted test routes remain disabled even with permissive-looking flags", async () => {
  assert.equal(earningsClaimReadiness().executionEnabled, false);
  for (const host of ["www.rmtlaunch.fun", "rmt-launch-website-preview.up.railway.app"]) {
    const request = new Request("https://" + host + "/api/launchpad/test-earnings", { method: "POST", headers: { host, origin: "https://" + host, "Content-Type": "application/json" }, body: "{}" });
    assert.equal((await handleTestEarningsClaim(request)).status, 404); assert.equal((await handleProductionEarningsClaim(request)).status, 404);
  }
  const f = earningsTestFixture();
  const production = await prepareEarningsClaim({ context: { ...f.context, chainId: 4663 }, beneficiary: f.creator, account: f.creator, operation: "creation-fees" });
  assert.deepEqual(production, { status: "unavailable", reason: "production-disabled" }); assert.equal(f.state.contractCalls, 0);
});

test("Next's internal localhost URL preserves exact loopback Host/Origin and rejects other origins", async () => {
  const { mkdtemp, writeFile, unlink, rmdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "rmt-earnings-origin-")), manifest = join(directory, "fixture.json");
  const f = earningsTestFixture();
  const settings = { RMT_CURVE_FIXTURE: "rmt-curve-fixed-supply-security-v2", RMT_CURVE_FIXTURE_READ_KEY: "1".repeat(64),
    RMT_CURVE_FIXTURE_SITE_ORIGIN: "http://127.0.0.1:3205", RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:8545",
    RMT_CURVE_FIXTURE_INDEXER: "http://127.0.0.1:4100", RMT_CURVE_FIXTURE_DEPLOYMENT: manifest,
    NETLIFY: "", VERCEL: "", DEPLOY_ID: "", CONTEXT: "", RAILWAY_ENVIRONMENT_ID: "" };
  const prior = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  try {
    await writeFile(manifest, JSON.stringify({ profile: "rmt-curve-fixed-supply-security-v2", chainId: 31337,
      fixedSupplyWei: launchTokenSupplyWei.toString(), factory: f.context.factory, factoryRuntimeHash: f.context.factoryRuntimeHash,
      projectRegistry: f.context.registry, registryRuntimeHash: f.context.registryRuntimeHash, deployBlock: 1, deploymentBlockHash: eh(1),
      creationFeeWei: "400000000000000", creationFeeRecipient: f.operations }));
    Object.assign(process.env, settings);
    const send = (url: string, host = "127.0.0.1:3205", origin = "http://127.0.0.1:3205") => handleTestEarningsClaim(new Request(url, {
      method: "POST", headers: { host, origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsupported" }),
    }));
    assert.equal((await send("http://localhost:3205/api/launchpad/test-earnings")).status, 400, "Correct fixture admitted; unsupported action rejected before RPC");
    assert.equal((await send("http://127.0.0.1:3205/api/launchpad/test-earnings")).status, 400);
    assert.equal((await send("http://localhost:3206/api/launchpad/test-earnings")).status, 403);
    assert.equal((await send("https://localhost:3205/api/launchpad/test-earnings")).status, 403);
    assert.equal((await send("http://localhost:3205/api/launchpad/test-earnings", "127.0.0.1:3205", "https://attacker.example")).status, 403);
    assert.equal((await send("http://localhost:3205/api/launchpad/test-earnings", "localhost:3205")).status, 404);
    process.env.RAILWAY_ENVIRONMENT_ID = "hosted";
    assert.equal((await send("http://localhost:3205/api/launchpad/test-earnings")).status, 404);
    assert.equal(f.state.contractCalls, 0);
  } finally {
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await unlink(manifest); await rmdir(directory);
  }
});
