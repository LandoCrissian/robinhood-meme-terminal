import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { vNextAuthorizationRequestSchema } from "../server/vnext-authorization-request";
import {
  assertVNextV2AuthorizationRequestContinuity,
  assertVNextV2VerificationContinuity,
  createVNextV2VerificationCommitment,
  verifyVNextV2VerificationCommitment
} from "../server/vnext-v2-verification-commitment";
import { vNextAuthorizationAuthorityRequest } from "./authorization-request";
import { parseVNextAuthorizationBundle } from "./authorization-plan";
import {
  FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  FEE_V2_SMOKE_EXECUTOR,
  FEE_V2_SMOKE_NOW_MS,
  FEE_V2_SMOKE_RECIPIENT,
  FEE_V2_SMOKE_SWAP_EVIDENCE,
  FEE_V2_SMOKE_SWAP_PLAN
} from "./fee-v2-smoke-fixture";
import { VNEXT_LEGACY_V1_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";

const secret = "real-path-continuity-smoke-secret-32-bytes-minimum";
const identityId = "did:privy:real-path-smoke";
const runtimeHash = `0x${"a".repeat(64)}` as const;
const nowMs = FEE_V2_SMOKE_NOW_MS;
const unsignedEvidence: VNextPreSignEvidence = {
  ...FEE_V2_SMOKE_SWAP_EVIDENCE,
  verifiedAtMs: nowMs,
  v2VerificationCommitment: undefined
};
const commitment = createVNextV2VerificationCommitment({
  evidence: unsignedEvidence,
  identityId,
  quoteRequestId: unsignedEvidence.sourceQuoteRequestId,
  verificationId: unsignedEvidence.verificationId,
  executorRuntimeHash: runtimeHash,
  nowMs,
  secret
});
const evidence: VNextPreSignEvidence = { ...unsignedEvidence, v2VerificationCommitment: commitment };
const authority = vNextAuthorizationAuthorityRequest(evidence);
assert.deepEqual(authority, {
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  executionId: evidence.feeV2Settlement!.executionId,
  v2VerificationCommitment: commitment
});

const request = {
  chainId: 4_663,
  quoteRequestId: evidence.sourceQuoteRequestId,
  verificationId: evidence.verificationId,
  provider: evidence.provider,
  inputAsset: evidence.inputAsset,
  outputAsset: evidence.outputAsset,
  inputAmountAtomic: evidence.inputAmountAtomic,
  recipient: evidence.recipient,
  expectedStatus: evidence.status,
  indicativeProtectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic,
  expectedProtectedOutputAtomic: evidence.protectedOutputAtomic,
  ...authority
};
assert.equal(vNextAuthorizationRequestSchema.safeParse(request).success, true);
assert.equal(request.executionId, evidence.feeV2Settlement!.executionId);

const claims = verifyVNextV2VerificationCommitment({
  token: commitment,
  identityId,
  wallet: getAddress(FEE_V2_SMOKE_RECIPIENT),
  quoteRequestId: evidence.sourceQuoteRequestId,
  verificationId: evidence.verificationId,
  nowMs: nowMs + 1,
  secret
});
assert.equal(assertVNextV2VerificationContinuity({ claims, evidence, executorRuntimeHash: runtimeHash }), true);
assert.equal(assertVNextV2AuthorizationRequestContinuity({ claims, request }), true);
assert.throws(() => assertVNextV2AuthorizationRequestContinuity({ claims, request: { ...request, executionId: undefined } }));
assert.throws(() => assertVNextV2AuthorizationRequestContinuity({ claims, request: { ...request, executionId: `0x${"9".repeat(64)}` } }));
assert.equal(parseVNextAuthorizationBundle({ evidence, plan: FEE_V2_SMOKE_SWAP_PLAN }, evidence, {
  quoteRequestId: evidence.sourceQuoteRequestId,
  inputAsset: evidence.inputAsset,
  outputAsset: evidence.outputAsset,
  inputAmountAtomic: evidence.inputAmountAtomic,
  recipient: evidence.recipient
}, nowMs + 1).plan.settlementMode, VNEXT_V2_ATOMIC_INPUT_FEE);

function rejectsEvidence(changed: VNextPreSignEvidence) {
  assert.throws(() => assertVNextV2VerificationContinuity({ claims, evidence: changed, executorRuntimeHash: runtimeHash }));
}

rejectsEvidence({ ...evidence, feeV2Settlement: { ...evidence.feeV2Settlement!, executionId: `0x${"9".repeat(64)}` } });
rejectsEvidence({ ...evidence, route: "weth_hop", pools: [evidence.pools[0], "0x8888888888888888888888888888888888888888"], fees: [evidence.fees[0], 500] });
const hopEvidence = {
  ...FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  status: "verified" as const,
  approvalRequired: false,
  exactSimulationPassed: true,
  nextAction: "swap" as const,
  nextActionTarget: FEE_V2_SMOKE_EXECUTOR,
  nextActionCalldataHash: FEE_V2_SMOKE_APPROVAL_EVIDENCE.calldataHash,
  route: "weth_hop" as const,
  pools: [FEE_V2_SMOKE_APPROVAL_EVIDENCE.pools[0], "0x8888888888888888888888888888888888888888"],
  fees: [3_000, 500],
  expectedOutputAtomic: "1100",
  protectedOutputAtomic: "1000",
  feeV2Economics: {
    ...FEE_V2_SMOKE_APPROVAL_EVIDENCE.feeV2Economics!,
    providerGrossExpectedOutputAtomic: "1100",
    providerProtectedOutputAtomic: "1000",
    expectedUserNetOutputAtomic: "1100",
    protectedUserNetOutputAtomic: "1000"
  },
  v2VerificationCommitment: undefined
} as VNextPreSignEvidence;
rejectsEvidence(hopEvidence);
const hopCommitment = createVNextV2VerificationCommitment({
  evidence: hopEvidence,
  identityId,
  quoteRequestId: hopEvidence.sourceQuoteRequestId,
  verificationId: hopEvidence.verificationId,
  executorRuntimeHash: runtimeHash,
  nowMs,
  secret
});
const hopClaims = verifyVNextV2VerificationCommitment({
  ...requestIdentity(),
  token: hopCommitment
});
assert.throws(() => assertVNextV2VerificationContinuity({
  claims: hopClaims,
  evidence,
  executorRuntimeHash: runtimeHash
}));
rejectsEvidence({ ...evidence, pools: ["0x8888888888888888888888888888888888888888"] });
rejectsEvidence({ ...evidence, fees: [500] });
rejectsEvidence({ ...evidence, feeV2Economics: { ...evidence.feeV2Economics!, expectedFeeAtomic: "2499", maximumFeeAtomic: "2499", providerInputAtomic: "997501" } });
rejectsEvidence({ ...evidence, feeV2Economics: { ...evidence.feeV2Economics!, providerInputAtomic: "997499" } });
rejectsEvidence({ ...evidence, expectedOutputAtomic: "1001", feeV2Economics: { ...evidence.feeV2Economics!, expectedUserNetOutputAtomic: "1001" } });
rejectsEvidence({ ...evidence, protectedOutputAtomic: "989", feeV2Economics: { ...evidence.feeV2Economics!, protectedUserNetOutputAtomic: "989", providerProtectedOutputAtomic: "989" } });
rejectsEvidence({ ...evidence, feeV2Settlement: { ...evidence.feeV2Settlement!, executionTarget: "0x8888888888888888888888888888888888888888" } });
assert.throws(() => assertVNextV2VerificationContinuity({ claims, evidence, executorRuntimeHash: `0x${"b".repeat(64)}` }));
rejectsEvidence({ ...evidence, feeV2Economics: { ...evidence.feeV2Economics!, policyHash: `0x${"b".repeat(64)}` } });
rejectsEvidence({ ...evidence, feeV2Economics: { ...evidence.feeV2Economics!, treasury: "0x8888888888888888888888888888888888888888" } });
rejectsEvidence({ ...evidence, recipient: "0x8888888888888888888888888888888888888888", feeV2Settlement: { ...evidence.feeV2Settlement!, recipient: "0x8888888888888888888888888888888888888888" } });
rejectsEvidence({ ...evidence, deadline: "1786000299", feeV2Settlement: { ...evidence.feeV2Settlement!, deadline: "1786000299" } });
rejectsEvidence({ ...evidence, nextActionTarget: "0x8888888888888888888888888888888888888888" });
rejectsEvidence({ ...evidence, nextActionCalldataHash: `0x${"b".repeat(64)}` });
rejectsEvidence({ ...evidence, transactionValueAtomic: "1" });
rejectsEvidence({ ...evidence, gasLimitUnits: "120001", estimatedNetworkCostWei: "360003000000000" });

assert.throws(() => verifyVNextV2VerificationCommitment({ ...requestIdentity(), token: "v1.bad.bad" }));
assert.throws(() => verifyVNextV2VerificationCommitment({ ...requestIdentity(), nowMs: nowMs + 60_000 }));
assert.throws(() => verifyVNextV2VerificationCommitment({ ...requestIdentity(), identityId: "did:privy:other" }));
assert.throws(() => verifyVNextV2VerificationCommitment({ ...requestIdentity(), wallet: getAddress("0x8888888888888888888888888888888888888888") }));

function requestIdentity() {
  return {
    token: commitment,
    identityId,
    wallet: getAddress(FEE_V2_SMOKE_RECIPIENT),
    quoteRequestId: evidence.sourceQuoteRequestId,
    verificationId: evidence.verificationId,
    nowMs: nowMs + 1,
    secret
  };
}

assert.throws(() => vNextAuthorizationAuthorityRequest({ ...evidence, feeV2Settlement: undefined } as VNextPreSignEvidence));
assert.throws(() => vNextAuthorizationAuthorityRequest({ ...evidence, feeExecution: { executionId: `0x${"7".repeat(64)}` } } as VNextPreSignEvidence));
const v1Id = `0x${"7".repeat(64)}`;
const v1 = {
  ...evidence,
  settlementMode: VNEXT_LEGACY_V1_FEE,
  rmtFeeEnabled: true,
  feeV2Economics: undefined,
  feeV2Settlement: undefined,
  v2VerificationCommitment: undefined,
  feeExecution: { executionId: v1Id }
} as unknown as VNextPreSignEvidence;
assert.deepEqual(vNextAuthorizationAuthorityRequest(v1), { settlementMode: VNEXT_LEGACY_V1_FEE, executionId: v1Id });

const composerSource = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const verifyRouteSource = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const authorizeRouteSource = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
assert.match(composerSource, /vNextAuthorizationAuthorityRequest\(evidence\)/,
  "the real TradeIntentComposer request must use the settlement-explicit authority builder");
assert.match(verifyRouteSource, /createVNextV2VerificationCommitment/);
assert.match(authorizeRouteSource, /verifyVNextV2VerificationCommitment/);
assert.match(authorizeRouteSource, /assertVNextV2VerificationContinuity/);
assert.match(authorizeRouteSource, /executionId:\s*parsed\.data\.executionId/,
  "the real authorization route must forward the committed execution ID to the provider adapter");
assert.doesNotMatch(composerSource, /feeExecution\s*\?\s*\{\s*executionId/,
  "the real client must not retain the V1-only execution-ID handoff");

console.log("RMT real V2 client execution-ID handoff and authenticated verify-authorize continuity smoke checks passed.");
