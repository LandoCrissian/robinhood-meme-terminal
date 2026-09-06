import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, keccak256, maxUint256, zeroAddress, type Hex } from "viem";
import type { VNextPreparedProviderAuthorization } from "../server/vnext-provider-adapter";
import { authorizationPayloadHash, parseVNextAuthorizationPlan, type VNextAuthorizationPlan } from "./authorization-plan";
import { parseVNextPreSignEvidence } from "./pre-sign-evidence";
import { prepareVNextWalletTransaction, vNextWalletRpcTransaction } from "./wallet-submission";
import { vnextSpotTradeInstruction } from "./execution-authority";
import { isVNextPlanRecoveryAdmissible, recordPreparedVNextWalletRequest, recordSubmittedVNextExecution, resolveVNextExecution, normalizeVNextExecutionJournal } from "./execution-recovery";
import { FEE_V2_SMOKE_SWAP_EVIDENCE, FEE_V2_SMOKE_SWAP_PLAN, FEE_V2_SMOKE_NOW_MS } from "./fee-v2-smoke-fixture";
import { zeroXFirmQuoteIdentity, type VNextZeroXProviderNativeFee } from "./zero-x-settlement";
import { readVNextPublicExecutionReleaseScope, requireVNextPublicExecutionProvider } from "../server/vnext-public-execution-provider-scope";
import { confirmedVNextFeePresentation } from "./confirmed-fee-receipt";

export function assertZeroXSharedWalletAuthorization(prepared: VNextPreparedProviderAuthorization) {
  const now = Date.now();
  const raw = { ...prepared.evidence, verificationId: randomUUID(), sourceQuoteRequestId: randomUUID() };
  const expected = {
    quoteRequestId: raw.sourceQuoteRequestId, inputAsset: raw.inputAsset, outputAsset: raw.outputAsset,
    inputAmountAtomic: raw.inputAmountAtomic, provider: "zero-x-swap" as const, recipient: raw.recipient,
    protectedOutputFloorAtomic: raw.indicativeProtectedOutputFloorAtomic
  };
  const evidence = parseVNextPreSignEvidence(raw, expected, now);
  const unsigned = {
    planId: randomUUID(), sourceQuoteRequestId: raw.sourceQuoteRequestId, sourceVerificationId: raw.verificationId,
    provider: "zero-x-swap" as const, chainId: 4_663 as const,
    ...prepared.transaction, inputAsset: raw.inputAsset, outputAsset: raw.outputAsset,
    inputAmountAtomic: raw.inputAmountAtomic, protectedOutputAtomic: raw.protectedOutputAtomic,
    recipient: raw.recipient, router: raw.router, settlementMode: raw.settlementMode,
    providerNativeFee: raw.providerNativeFee, deadline: raw.deadline, preparedAtMs: now,
    expiresAtMs: evidence.expiresAtMs, userAuthorizationRequired: true as const, serverSubmissionEnabled: false as const
  };
  const plan: VNextAuthorizationPlan = { ...unsigned, payloadHash: authorizationPayloadHash(unsigned) };
  assert.equal(parseVNextAuthorizationPlan(plan, evidence, now).kind, plan.kind);
  const wallet = prepareVNextWalletTransaction({ plan, evidence, connectedAddress: plan.recipient, connectedChainId: 4_663, nowMs: now });
  assert.deepEqual(vNextWalletRpcTransaction(wallet), {
    from: plan.recipient, to: plan.target, data: plan.data,
    value: `0x${BigInt(plan.value).toString(16)}`, gas: `0x${BigInt(plan.gasLimit).toString(16)}`,
    ...(plan.gasPrice !== undefined ? { gasPrice: `0x${BigInt(plan.gasPrice).toString(16)}` } : {})
  });
  assert.equal(vnextSpotTradeInstruction(plan).purpose, "spot_trade");
  assert.equal(isVNextPlanRecoveryAdmissible(plan, plan.recipient), true);

  const fees: [string, Partial<VNextZeroXProviderNativeFee>][] = [
    ["treasury", { treasury: zeroAddress }], ["bps", { feeBps: 26 as 25 }],
    ["token", { feeAsset: plan.outputAsset as Hex }], ["amount", { feeAmountAtomic: "1" }],
    ["recipient binding", { requestFeeRecipient: zeroAddress }], ["bps binding", { requestFeeBps: 26 as 25 }],
    ["fee token binding", { requestFeeToken: plan.outputAsset as Hex }],
    ["chain", { chainId: 1 as 4_663 }], ["provider", { provider: "sushi" as "zero-x-swap" }],
    ["executor claim", { feeExecutorRequired: true as false }]
  ];
  for (const [label, mutation] of fees) {
    const fee = { ...structuredClone(plan.providerNativeFee!), ...mutation };
    fee.firmQuote!.identity = zeroXFirmQuoteIdentity(fee);
    assert.throws(() => parseVNextAuthorizationPlan({ ...plan, providerNativeFee: fee }, evidence, now), label);
    assert.throws(() => parseVNextPreSignEvidence({ ...raw, providerNativeFee: fee }, expected, now), label);
  }
  for (const mutation of [
    { providerNativeFee: undefined }, { feeExecution: { implementationId: "RMT_UNISWAP_V3_FEE_EXECUTOR" } },
    { feeV2Economics: {} }, { feeV2Authorization: {} }, { directNoRmtFee: {} },
    { provider: "uniswap-v3" }, { chainId: 1 }, { gasLimit: "1" }, { gasPrice: "1" },
    { value: "123" }, { target: zeroAddress }, { data: "0xabcdef01" },
    { recipient: zeroAddress }, { inputAmountAtomic: "1000001" }, { protectedOutputAtomic: "1" },
    { expiresAtMs: evidence.expiresAtMs + 1 }
  ]) {
    const changed = { ...plan, ...mutation } as VNextAuthorizationPlan;
    changed.payloadHash = authorizationPayloadHash(changed);
    assert.throws(() => parseVNextAuthorizationPlan(changed, evidence, now));
  }
  assert.throws(() => parseVNextAuthorizationPlan(plan, evidence, evidence.expiresAtMs));
  if (plan.kind === "swap") {
    assert.throws(() => parseVNextAuthorizationPlan(plan, { ...evidence, exactSimulationPassed: false }, now));
    assert.throws(() => parseVNextAuthorizationPlan(plan, { ...evidence, nextAction: "approval" }, now));
    assert.throws(() => parseVNextAuthorizationPlan(plan, { ...evidence, authorizationReady: false }, now));
  } else {
    for (const amount of [maxUint256, BigInt(plan.inputAmountAtomic) + 1n]) {
      const changed = { ...plan, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [plan.router as Hex, amount] }) };
      changed.payloadHash = authorizationPayloadHash(changed);
      assert.throws(() => parseVNextAuthorizationPlan(changed, { ...evidence, nextActionCalldataHash: keccak256(changed.data) }, now));
    }
  }

  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const request = recordPreparedVNextWalletRequest({ requestId: randomUUID(), wallet: plan.recipient, plan, walletNonceBeforeRequest: 0n, requestBlockNumber: 123n }, storage, now);
  assert.ok(request, "0x exact calldata must be recovery-admissible before any wallet request");
  const record = recordSubmittedVNextExecution({ wallet: plan.recipient, plan, txHash: `0x${"a".repeat(64)}` }, storage, now);
  assert.ok(record);
  assert.equal(record.deadline, undefined, "opaque calldata must not claim an RMT onchain deadline");
  assert.equal(record.feeV2Settlement, undefined);
  assert.equal(record.feeSettlement, undefined);
  if (plan.kind === "swap") {
    assert.equal(record.providerNativeFee?.feeAmountAtomic, plan.providerNativeFee!.feeAmountAtomic);
    assert.equal(record.providerNativeFee?.providerFeeAtomic, plan.providerNativeFee!.providerFeeAtomic);
    const confirmed = resolveVNextExecution(record.txHash, "confirmed", storage, now + 1);
    assert.ok(confirmed);
    assert.equal(confirmedVNextFeePresentation({ record: confirmed, inputDecimals: 18, outputDecimals: 18, inputSymbol: "SELL", outputSymbol: "BUY" }).state, "quoted");
    assert.equal(normalizeVNextExecutionJournal([{ ...record, providerNativeFee: { ...record.providerNativeFee, treasury: zeroAddress } }], now).length, 0);
  }
  for (const provider of ["uniswap-v2", "uniswap-v3"] as const) {
    assert.throws(() => parseVNextAuthorizationPlan({ ...FEE_V2_SMOKE_SWAP_PLAN, provider, feeV2Authorization: undefined }, { ...FEE_V2_SMOKE_SWAP_EVIDENCE, provider, feeV2Settlement: undefined }, FEE_V2_SMOKE_NOW_MS + 1));
  }
  const scope = { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap" };
  assert.equal(readVNextPublicExecutionReleaseScope(scope), "ZERO_X_ONLY");
  assert.doesNotThrow(() => requireVNextPublicExecutionProvider("zero-x-swap", scope));
  for (const provider of ["sushi", "uniswap-v2", "uniswap-v3", "zero-x-gasless"] as const) assert.throws(() => requireVNextPublicExecutionProvider(provider, scope));
  assert.throws(() => requireVNextPublicExecutionProvider("zero-x-swap", { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap,sushi" }));
  return { plan, evidence };
}
