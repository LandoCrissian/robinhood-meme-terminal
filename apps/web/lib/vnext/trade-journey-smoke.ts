import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInjectedSignerSelection } from "../injected-wallet-signer";
import { sameInjectedPreferenceWallet } from "../injected-signer-preference";
import { TradeQuoteRequestError, tradeQuoteFailureFromResponse } from "../trade-quote-client";
import { PENDING_APPROVAL_JOURNEY_KEY, TradeJourneyError, emitTradeJourney, observedZeroXPhase, pendingApprovalRecordMatches,
  pendingApprovalWalletMatches, readPendingApprovalJourney, revalidateAfterApproval, savePendingApprovalJourney,
  tradeJourneyLabels, type PendingApprovalJourney } from "./trade-journey";
import type { VNextExecutionRecord } from "./execution-recovery";
import { zeroXIntegratorFeeAmount } from "./zero-x-settlement";

async function main() {
  const wallet = "0x1111111111111111111111111111111111111111";
  const other = "0x2222222222222222222222222222222222222222";
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const key = (id: string, account = wallet, brand = "metamask") => JSON.stringify(["injected", brand, id, account]);
  const identity = (id: string) => ({ authenticated: true, userId: "owner-fixture", address: wallet, linkedAddress: wallet, activeWalletKey: key(id), chainId: 4663 });
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; }, removeItem: () => { saved = null; } };
  const announce = (s: ReturnType<typeof createInjectedSignerSelection>, id: string, rdns = "io.metamask", accounts = [wallet], chain = "0x1237") => {
    s.announce({ info: { uuid: id, rdns, name: "MetaMask Mobile" }, provider: {
      async request({ method }: { method: string }) { assert.ok(["eth_accounts", "eth_chainId"].includes(method)); return method === "eth_accounts" ? accounts : chain; }, on() {}, removeListener() {}
    } });
  };
  const first = createInjectedSignerSelection({ storage: () => storage });
  first.setIdentity(identity(a)); announce(first, a); first.select(a);
  const preference = saved;
  const returning = createInjectedSignerSelection({ storage: () => storage });
  returning.setIdentity(identity(b)); announce(returning, b);
  assert.equal(await returning.restorePreference(), true, "new session UUID and wallet reported ID rebind to stable explicit preference");
  assert.equal((await returning.prepare(key(b), wallet)).uuid, b);
  assert.equal(sameInjectedPreferenceWallet(key(a), key(b, wallet, "rabby")), false);
  assert.equal(sameInjectedPreferenceWallet(key(a), key(b, other)), false);
  assert.equal(sameInjectedPreferenceWallet(key("io.metamask"), key("io.imposter")), false);
  for (const scenario of ["ambiguous", "other-account", "other-chain", "other-rdns", "no-preference"]) {
    saved = scenario === "no-preference" ? null : preference;
    const s = createInjectedSignerSelection({ storage: () => storage }); s.setIdentity(identity(b));
    announce(s, b, scenario === "other-rdns" ? "io.imposter" : "io.metamask", scenario === "other-account" ? [other] : [wallet], scenario === "other-chain" ? "0x1" : "0x1237");
    if (scenario === "ambiguous") announce(s, a);
    assert.equal(await s.restorePreference(), false, scenario);
  }
  const failure = tradeQuoteFailureFromResponse({ ok: false, status: 422, attempts: 1, latencyMs: 10,
    payload: { phase: "IDENTITY_UNAVAILABLE", providerRequestAttempted: false, error: "Both quote assets require verified Robinhood Chain identity and decimals." } });
  assert.ok(failure instanceof TradeQuoteRequestError);
  assert.equal(failure.phase, "IDENTITY_UNAVAILABLE");
  assert.equal(tradeJourneyLabels[failure.phase], "Token verification temporarily unavailable");
  assert.equal(observedZeroXPhase([]), "QUOTE_NOT_REQUESTED");
  const emitted: string[] = []; const originalInfo = console.info;
  try {
    console.info = (value: string) => { emitted.push(value); };
    emitTradeJourney({ phase: "APPROVAL_CONFIRMED", approvalRequired: true, approvalHashAvailable: true,
      secret: "must-never-be-emitted", retry: 999 } as Parameters<typeof emitTradeJourney>[0]);
  } finally { console.info = originalInfo; }
  assert.deepEqual(JSON.parse(emitted[0]), { event: "rmt_trade_journey", phase: "APPROVAL_CONFIRMED", approvalRequired: true, approvalHashAvailable: true });
  assert.equal(observedZeroXPhase([{ provider: "zero-x-swap", status: "no_route" }]), "ZEROX_NO_ROUTE");
  assert.equal(observedZeroXPhase([{ provider: "zero-x-swap", status: "temporarily_unavailable" }]), "ZEROX_PROVIDER_UNAVAILABLE");
  for (const phase of ["IDENTITY_UNAVAILABLE", "QUOTE_EXPIRED", "ZEROX_PROVIDER_UNAVAILABLE"] as const) {
    let attempts = 0; const waits: number[] = [];
    const result = await revalidateAfterApproval({ current: () => true, onRetry() {}, wait: async (ms) => { waits.push(ms); },
      attempt: async () => { if (++attempts === 1) throw new TradeJourneyError(phase, "sanitized fixture"); return "fresh verified envelope"; } });
    assert.equal(result, "fresh verified envelope"); assert.equal(attempts, 2); assert.deepEqual(waits, [1500]);
  }
  let attempts = 0;
  await assert.rejects(revalidateAfterApproval({ current: () => true, onRetry() {}, wait: async () => {},
    attempt: async () => { attempts++; throw new TradeJourneyError("ZEROX_PROVIDER_UNAVAILABLE", "fixture"); } }));
  assert.equal(attempts, 4, "bounded retry budget");
  for (const phase of ["ZEROX_POLICY_REJECTED", "SIMULATION_FAILED", "AUTHORIZATION_FAILED", "ZEROX_NO_ROUTE"] as const) {
    let count = 0;
    await assert.rejects(revalidateAfterApproval({ current: () => true, onRetry() {}, wait: async () => {}, attempt: async () => { count++; throw new TradeJourneyError(phase, "fixture"); } }));
    assert.equal(count, 1, "never retry failed policy/simulation or invent a route");
  }
  let current = true; attempts = 0;
  await assert.rejects(revalidateAfterApproval({ current: () => current, onRetry() { current = false; }, wait: async () => {},
    attempt: async () => { attempts++; throw new TradeJourneyError("QUOTE_EXPIRED", "fixture"); } }));
  assert.equal(attempts, 1, "account/chain/context change cancels continuation");
  const now = Date.now();
  const pending: PendingApprovalJourney = { version: 1, chainId: 4663, userId: "owner-fixture", wallet, walletKey: key(a),
    marketAddress: other, side: "sell", amount: "25", sellOutputKey: "eip155:4663/native", inputAsset: other,
    outputAsset: "0x0000000000000000000000000000000000000000", inputAmountAtomic: "25000000000000000000",
    approvalPlanId: a, approvalPayloadHash: `0x${"a".repeat(64)}`, createdAtMs: now, expiresAtMs: now + 600000 };
  savePendingApprovalJourney(pending, storage);
  assert.deepEqual(readPendingApprovalJourney(storage, now), pending);
  assert.equal(readPendingApprovalJourney(storage, now + 600001), null);
  assert.equal(pendingApprovalWalletMatches(pending, { userId: "owner-fixture", wallet, walletKey: key(b), chainId: 4663 }), true);
  const record = { schemaVersion: 1, submittedAtMs: now, updatedAtMs: now,
    provider: "zero-x-swap", kind: "erc20_approval", state: "confirmed", chainId: 4663, wallet,
    planId: a, payloadHash: pending.approvalPayloadHash, inputAsset: other, outputAsset: pending.outputAsset,
    inputAmountAtomic: pending.inputAmountAtomic, txHash: `0x${"b".repeat(64)}` } as VNextExecutionRecord;
  assert.equal(pendingApprovalRecordMatches(pending, record), true);
  for (const change of [{ kind: "swap" }, { state: "submitted" }, { state: "reverted" }, { planId: b }, { wallet: other }, { inputAmountAtomic: "1" }])
    assert.equal(pendingApprovalRecordMatches(pending, { ...record, ...change } as VNextExecutionRecord), false);
  storage.setItem(PENDING_APPROVAL_JOURNEY_KEY, JSON.stringify({ ...pending, signedTransaction: "not-allowed" }));
  assert.equal(readPendingApprovalJourney(storage, now), null);
  const evidence = (name: string) => JSON.parse(readFileSync(new URL(`../../../../evidence/${name}`, import.meta.url), "utf8"));
  const original = evidence("trading-hardening/zero-x-50-token-matrix.json");
  const matrix = evidence("live-trading-journey/matrix-live.json");
  const peep = evidence("live-trading-journey/peep-live.json");
  assert.equal(matrix.seed, 5272840); assert.equal(matrix.rows.length, 100); assert.equal(peep.rows.length, 80);
  assert.equal(new Set(matrix.rows.map((row: { token: string }) => row.token.toLowerCase())).size, 50);
  for (const row of matrix.rows) {
    const frozen = original.rows.find((entry: { sampleIndex: number; direction: string }) => entry.sampleIndex === row.sampleIndex && entry.direction === row.direction);
    assert.ok(frozen); assert.equal(row.token.toLowerCase(), frozen.assetContract.toLowerCase());
    assert.equal(row.inputAsset.toLowerCase(), frozen.inputAsset.toLowerCase());
    assert.equal(row.outputAsset.toLowerCase(), frozen.outputAsset.toLowerCase());
    assert.equal(row.canonicalProtocol, frozen.canonicalProtocol); assert.equal(row.canonicalVersion, frozen.canonicalVersion);
    if (row.direction === "SELL") {
      const buy = matrix.rows.find((entry: { sampleIndex: number; direction: string }) => entry.sampleIndex === row.sampleIndex && entry.direction === "BUY");
      assert.equal(row.inputAmountAtomic, buy.expectedOutputAtomic ?? frozen.testAmount);
    }
    assert.ok(["FIRM_VERIFIED", "ZEROX_NO_ROUTE", "ZEROX_UNAVAILABLE", "POLICY_REJECTED_MISSING_INTEGRATOR_FEE"].includes(row.status));
    if (row.status === "FIRM_VERIFIED") {
      assert.ok(row.fundedSimulation, "every admitted firm envelope receives the existing funded read-only simulation");
      assert.ok(["PASS", "UNSUPPORTED_TOKEN_STORAGE_LAYOUT"].includes(row.fundedSimulation.status));
      assert.equal(row.fundedSimulation.walletAuthority, false);
      if (row.fundedSimulation.status === "PASS") {
        assert.equal(row.fundedSimulation.exactEnvelopePreserved, true);
        assert.equal(row.fundedSimulation.calldataHash, row.requestHash);
        assert.equal(row.fundedSimulation.transactionTarget, row.transactionTarget);
        if (row.fundedSimulation.allowanceAtomic) assert.equal(row.fundedSimulation.allowanceAtomic, row.inputAmountAtomic);
      }
    }
  }
  const directions = new Map<string, number>();
  for (const row of peep.rows) {
    const direction = `${row.inputAsset}:${row.outputAsset}`;
    directions.set(direction, (directions.get(direction) ?? 0) + 1);
    assert.equal(row.token.toLowerCase(), "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f");
    if (row.identityStatus !== "IDENTITY_READY") {
      assert.equal(row.providerRequestAttempted, false); assert.equal(row.providerRequestCount, 0);
      assert.equal(row.status, "IDENTITY_UNAVAILABLE");
    }
  }
  assert.equal(directions.size, 4); for (const count of directions.values()) assert.equal(count, 20);
  for (const row of [...matrix.rows, ...peep.rows]) {
    assert.equal(row.provider, "zero-x-swap"); assert.equal(row.chainId, 4663);
    assert.equal(row.feeBps, 25); assert.equal(row.feeToken, row.inputAsset);
    assert.equal(row.feeAtomic, zeroXIntegratorFeeAmount(row.inputAmountAtomic));
    assert.equal(row.slippagePpm, 9900); assert.equal(row.hardMaxPpm, 10000);
    assert.equal(row.providerRequestAttempted, row.providerRequestCount > 0);
    if (row.status === "FIRM_VERIFIED") {
      assert.equal(row.allowanceTarget.toLowerCase(), "0x0000000000001ff3684f28c67538d4d072c22734");
      assert.equal(row.transactionTarget.toLowerCase(), row.allowanceTarget.toLowerCase());
      assert.equal(row.settler.toLowerCase(), "0x39b38686a19836ac10162c490e4558e120cbbe5f");
      assert.equal(row.recipient, wallet); assert.ok(BigInt(row.protectedOutput) > 0n);
    }
  }
  for (const report of [matrix, peep]) {
    assert.equal(report.legacyExecutorCalls, 0); assert.equal(report.realWalletRequests, 0);
    assert.equal(report.signatures, 0); assert.equal(report.realTransactions, 0);
  }
  console.log("Trading journey: stable UUID rebinding, truthful quote phases, bounded fresh post-approval retry and durable exact-intent binding PASS; real wallet requests 0.");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
