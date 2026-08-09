import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VNextExecutionRecord } from "./execution-recovery";
import { postApprovalVerificationOutcome, resolvedVNextExecutionOutcome } from "./post-approval";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";

const record: VNextExecutionRecord = {
  schemaVersion: 1, chainId: 4_663,
  wallet: "0x1111111111111111111111111111111111111111",
  kind: "erc20_approval",
  inputAsset: "0x2222222222222222222222222222222222222222",
  outputAsset: "0x3333333333333333333333333333333333333333",
  inputAmountAtomic: "1000000",
  planId: "11111111-1111-4111-8111-111111111111",
  payloadHash: `0x${"a".repeat(64)}`,
  txHash: `0x${"b".repeat(64)}`,
  state: "confirmed",
  submittedAtMs: 1_786_000_000_000,
  updatedAtMs: 1_786_000_001_000
};
const matching = {
  record,
  wallet: record.wallet,
  inputAsset: record.inputAsset,
  outputAsset: record.outputAsset,
  inputAmountAtomic: record.inputAmountAtomic
};
const approvalOutcome = resolvedVNextExecutionOutcome(matching);
assert.equal(approvalOutcome?.state, "approval_confirmed");
assert.match(approvalOutcome?.message ?? "", /previous quote and payload were discarded/);
assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: { ...record, kind: "swap" } })?.state, "swap_confirmed");
assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: { ...record, state: "reverted" } })?.state, "reverted");
assert.equal(resolvedVNextExecutionOutcome({ ...matching, record: { ...record, state: "submitted" } }), null);
assert.equal(resolvedVNextExecutionOutcome({ ...matching, wallet: record.outputAsset }), null);
assert.equal(resolvedVNextExecutionOutcome({ ...matching, inputAsset: record.outputAsset }), null);
assert.equal(resolvedVNextExecutionOutcome({ ...matching, outputAsset: record.inputAsset }), null);
assert.equal(resolvedVNextExecutionOutcome({ ...matching, inputAmountAtomic: "999999" }), null);
assert.equal(resolvedVNextExecutionOutcome({ ...matching, handledTxHash: record.txHash }), null);
assert.equal(postApprovalVerificationOutcome({ status: "verified" } as VNextPreSignEvidence).state, "swap_ready");
assert.equal(postApprovalVerificationOutcome({ status: "approval_required" } as VNextPreSignEvidence).state, "blocked");

const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../server/vnext-uniswap-quote.ts", import.meta.url), "utf8");
assert.match(composer, /resolvedVNextExecutionOutcome/);
assert.match(composer, /clearTradeQuoteCache\(\)/);
assert.match(composer, /const freshQuote = await requestLiveRoutes\(\)/);
assert.match(composer, /const freshEvidence = await requestStrictVerification\(freshQuote\)/);
assert.match(composer, /Approval confirmed\. RMT is refreshing and verifying the swap automatically/);
assert.match(composer, /continuedApproval\.current/);
assert.match(composer, /requestAuthorizationPlan\(freshEvidence\)/);
assert.match(composer, /lastReadyQuote\.current = freshQuote/);
assert.match(composer, /lastReadyVerification\.current = freshEvidence/);
assert.match(composer, /const visibleQuote =/);
assert.match(composer, /const visibleVerification =/);
assert.match(composer, /postExecutionState\.state === "swap_confirmed"/);
assert.match(composer, /executionRecord\.state === "confirmed"/);
assert.match(composer, /Continue trading/);
assert.match(composer, /View confirmed transaction/);
assert.match(composer, /document\.body\.style\.overflow = "hidden"/);
assert.doesNotMatch(composer, /Continue with fresh verification/);
assert.match(verifier, /functionName: "allowance"/);
assert.match(verifier, /functionName: "balanceOf"/);
assert.match(verifier, /client\.call/);
const continuation = composer.slice(composer.indexOf("const continueAfterApproval"), composer.indexOf("const verificationLabel"));
assert.doesNotMatch(continuation, /sendTransaction|writeContract|signTypedData/);

console.log("RMT VNext post-approval fresh-verification smoke checks passed.");
