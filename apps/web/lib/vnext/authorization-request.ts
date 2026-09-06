import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import {
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_PROVIDER_NATIVE_INPUT_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE
} from "./execution-settlement";

const ZERO_HASH = `0x${"0".repeat(64)}`;

export function vNextAuthorizationAuthorityRequest(evidence: VNextPreSignEvidence) {
  const hasV1 = evidence.feeExecution != null;
  const hasV2 = evidence.feeV2Economics !== undefined || evidence.feeV2Settlement !== undefined;
  const hasDirect = evidence.directNoRmtFee !== undefined;
  if (evidence.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE) {
    const executionId = evidence.feeV2Settlement?.executionId;
    if (
      hasV1
      || hasDirect
      || !evidence.feeV2Economics
      || !evidence.feeV2Settlement
      || !executionId
      || executionId === ZERO_HASH
      || !evidence.v2VerificationCommitment
    ) throw new Error("RMT rejected missing or contradictory V2 authorization authority.");
    return {
      settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
      executionId,
      v2VerificationCommitment: evidence.v2VerificationCommitment
    } as const;
  }
  if (evidence.settlementMode === VNEXT_LEGACY_V1_FEE) {
    const executionId = evidence.feeExecution?.executionId;
    if (hasV2 || hasDirect || !hasV1 || !executionId || executionId === ZERO_HASH || evidence.v2VerificationCommitment !== undefined) {
      throw new Error("RMT rejected missing or contradictory V1 authorization authority.");
    }
    return { settlementMode: VNEXT_LEGACY_V1_FEE, executionId } as const;
  }
  if (evidence.settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE) {
    if (evidence.provider !== "zero-x-swap" || hasV1 || hasV2 || hasDirect || !evidence.providerNativeFee || evidence.v2VerificationCommitment !== undefined) {
      throw new Error("RMT rejected missing or contradictory 0x provider-native authorization authority.");
    }
    return { settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE } as const;
  }
  if (evidence.settlementMode !== VNEXT_DIRECT_NO_RMT_FEE || hasV1 || hasV2 || !hasDirect || evidence.v2VerificationCommitment !== undefined) {
    throw new Error("RMT rejected contradictory direct authorization authority.");
  }
  return { settlementMode: VNEXT_DIRECT_NO_RMT_FEE } as const;
}
