import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizationPayloadHash, parseVNextAuthorizationBundle, parseVNextAuthorizationPlan } from "./authorization-plan";
import { plannedRmtExecutionFeeV2ForWalletAction } from "./execution-fee-policy-v2";
import {
  DIRECT_SMOKE_APPROVAL_EVIDENCE,
  DIRECT_SMOKE_APPROVAL_PLAN,
  DIRECT_SMOKE_SWAP_EVIDENCE,
  DIRECT_SMOKE_SWAP_PLAN
} from "./direct-no-rmt-fee-smoke-fixture";
import {
  FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  FEE_V2_SMOKE_APPROVAL_PLAN,
  FEE_V2_SMOKE_NOW_MS,
  FEE_V2_SMOKE_SWAP_EVIDENCE,
  FEE_V2_SMOKE_SWAP_PLAN
} from "./fee-v2-smoke-fixture";

const now = FEE_V2_SMOKE_NOW_MS + 1;
assert.equal(parseVNextAuthorizationPlan(FEE_V2_SMOKE_APPROVAL_PLAN, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now).kind, "erc20_approval");
assert.equal(parseVNextAuthorizationPlan(FEE_V2_SMOKE_SWAP_PLAN, FEE_V2_SMOKE_SWAP_EVIDENCE, now).kind, "swap");
assert.equal(parseVNextAuthorizationPlan(DIRECT_SMOKE_APPROVAL_PLAN, DIRECT_SMOKE_APPROVAL_EVIDENCE, now).kind, "erc20_approval");
assert.equal(parseVNextAuthorizationPlan(DIRECT_SMOKE_SWAP_PLAN, DIRECT_SMOKE_SWAP_EVIDENCE, now).kind, "swap");
assert.equal(plannedRmtExecutionFeeV2ForWalletAction("erc20_approval", FEE_V2_SMOKE_APPROVAL_PLAN.feeV2Economics!), "0");
assert.equal(plannedRmtExecutionFeeV2ForWalletAction("swap", FEE_V2_SMOKE_SWAP_PLAN.feeV2Economics!), "2500");

assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_SWAP_PLAN,
  feeV2Economics: undefined,
  feeV2Authorization: undefined
}, FEE_V2_SMOKE_SWAP_EVIDENCE, now), /without complete V2 fee authority/);
assert.throws(() => parseVNextAuthorizationPlan(FEE_V2_SMOKE_SWAP_PLAN, {
  ...FEE_V2_SMOKE_SWAP_EVIDENCE,
  feeV2Economics: undefined,
  feeV2Settlement: undefined
}, now), /without complete V2 fee authority/);
assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_APPROVAL_PLAN,
  feeV2Economics: undefined,
  feeV2Authorization: undefined
}, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now), /without complete V2 fee authority/);

function changedApprovalFee(field: keyof NonNullable<typeof FEE_V2_SMOKE_APPROVAL_PLAN.feeV2Economics>, value: unknown) {
  assert.throws(() => parseVNextAuthorizationPlan({
    ...FEE_V2_SMOKE_APPROVAL_PLAN,
    feeV2Economics: { ...FEE_V2_SMOKE_APPROVAL_PLAN.feeV2Economics!, [field]: value }
  }, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now));
}

function changedApprovalAuthorization(field: keyof NonNullable<typeof FEE_V2_SMOKE_APPROVAL_PLAN.feeV2Authorization>, value: unknown) {
  assert.throws(() => parseVNextAuthorizationPlan({
    ...FEE_V2_SMOKE_APPROVAL_PLAN,
    feeV2Authorization: { ...FEE_V2_SMOKE_APPROVAL_PLAN.feeV2Authorization!, [field]: value }
  }, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now));
}

assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_APPROVAL_PLAN,
  feeV2Economics: {}
}, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now));
assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_APPROVAL_PLAN,
  feeV2Authorization: {}
}, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now));
changedApprovalFee("policyHash", `0x${"9".repeat(64)}`);
changedApprovalFee("expectedFeeAtomic", "2499");
changedApprovalFee("maximumFeeAtomic", "2501");
changedApprovalFee("providerInputAtomic", "997501");
changedApprovalFee("treasury", "0x8888888888888888888888888888888888888888");
changedApprovalAuthorization("recipient", "0x8888888888888888888888888888888888888888");
changedApprovalAuthorization("providerTarget", "0x8888888888888888888888888888888888888888");
changedApprovalAuthorization("deadline", "1786000299");

function changedFee(field: keyof NonNullable<typeof FEE_V2_SMOKE_SWAP_PLAN.feeV2Economics>, value: unknown) {
  assert.throws(() => parseVNextAuthorizationPlan({
    ...FEE_V2_SMOKE_SWAP_PLAN,
    feeV2Economics: { ...FEE_V2_SMOKE_SWAP_PLAN.feeV2Economics!, [field]: value }
  }, FEE_V2_SMOKE_SWAP_EVIDENCE, now));
}
changedFee("userGrossInputAtomic", "1000001");
changedFee("feeBasisAtomic", "999999");
changedFee("providerInputAtomic", "997501");
changedFee("expectedFeeAtomic", "2499");
changedFee("maximumFeeAtomic", "2501");
changedFee("feeAsset", FEE_V2_SMOKE_SWAP_PLAN.feeV2Economics!.outputAsset);
changedFee("feeBps", 24);
changedFee("policyVersion", 3);
changedFee("policyHash", `0x${"9".repeat(64)}`);
changedFee("settlementMode", "v2-atomic-output-fee");

assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_SWAP_PLAN,
  feeV2Authorization: {
    ...FEE_V2_SMOKE_SWAP_PLAN.feeV2Authorization!,
    executionTarget: FEE_V2_SMOKE_SWAP_EVIDENCE.router
  }
}, FEE_V2_SMOKE_SWAP_EVIDENCE, now), /execution target changed|strict evidence/);
assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_SWAP_PLAN,
  feeV2Authorization: {
    ...FEE_V2_SMOKE_SWAP_PLAN.feeV2Authorization!,
    calldataHash: `0x${"8".repeat(64)}`
  }
}, FEE_V2_SMOKE_SWAP_EVIDENCE, now), /calldata hash changed/);
assert.throws(() => parseVNextAuthorizationPlan({
  ...FEE_V2_SMOKE_SWAP_PLAN,
  deadline: "1786000299"
}, FEE_V2_SMOKE_SWAP_EVIDENCE, now), /inconsistent authorization plan/);
const malformedApproval = { ...FEE_V2_SMOKE_APPROVAL_PLAN, data: "0x1234" as const };
assert.throws(() => parseVNextAuthorizationPlan({
  ...malformedApproval,
  payloadHash: authorizationPayloadHash(malformedApproval)
}, FEE_V2_SMOKE_APPROVAL_EVIDENCE, now));

const bundleEvidence = {
  ...FEE_V2_SMOKE_SWAP_EVIDENCE,
  verifiedAtMs: FEE_V2_SMOKE_NOW_MS,
  expiresAtMs: FEE_V2_SMOKE_NOW_MS + 300_000
};
assert.equal(parseVNextAuthorizationBundle({ evidence: bundleEvidence, plan: FEE_V2_SMOKE_SWAP_PLAN }, bundleEvidence, {
  quoteRequestId: bundleEvidence.sourceQuoteRequestId,
  inputAsset: bundleEvidence.inputAsset,
  outputAsset: bundleEvidence.outputAsset,
  inputAmountAtomic: bundleEvidence.inputAmountAtomic,
  recipient: bundleEvidence.recipient
}, now).plan.kind, "swap");
assert.throws(() => parseVNextAuthorizationBundle({
  evidence: { ...bundleEvidence, feeV2Economics: { ...bundleEvidence.feeV2Economics!, maximumFeeAtomic: "2501" } },
  plan: FEE_V2_SMOKE_SWAP_PLAN
}, bundleEvidence, {
  quoteRequestId: bundleEvidence.sourceQuoteRequestId,
  inputAsset: bundleEvidence.inputAsset,
  outputAsset: bundleEvidence.outputAsset,
  inputAmountAtomic: bundleEvidence.inputAmountAtomic,
  recipient: bundleEvidence.recipient
}, now));

const endpoint = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const parser = readFileSync(new URL("./authorization-plan.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(endpoint, /RMT_VNEXT_AUTHORIZATION_ENABLED !== "true"/);
assert.match(endpoint, /requireAuthenticatedTradeWallet/);
assert.match(endpoint, /prepareRobinhoodVNextAuthorization/);
assert.match(endpoint, /feeV2Economics/);
assert.match(endpoint, /feeV2Authorization/);
assert.match(parser, /wallet plan without complete V2 fee authority/);
assert.match(parser, /decodeFunctionData/);
assert.match(composer, /parseVNextAuthorizationBundle/);
assert.doesNotMatch(endpoint, /writeContract|sendTransaction|signTypedData|database|firestore/);
assert.doesNotMatch(parser, /writeContract|sendTransaction|signTypedData/);

console.log("RMT VNext universal-fee authorization-plan boundary smoke checks passed.");
