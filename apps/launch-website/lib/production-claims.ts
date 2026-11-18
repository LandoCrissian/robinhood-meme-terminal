import type { Address, Hex } from "viem";
import type { EarningsClaimAmounts, EarningsClaimOperation } from "./earnings-claims";

export const claimSettlementProfile = "rmt-claim-settlement-v1";
export const claimSettlementStages = ["submitted", "receipt-observed", "canonical-l2", "indexing-pending", "settled", "reverted", "unavailable"] as const;
export type ClaimSettlementStage = typeof claimSettlementStages[number];
export type ClaimSettlementPoint = { blockNumber: string; blockHash: Hex; timestamp: string };
export type ClaimActivityIdentity = {
  schemaVersion: 1; chainId: 31337 | 4663; factory: Address; manager: Address; registry: Address; deploymentBlockHash: Hex;
  token: Address | null; ledger: Address; actor: Address; gasPayer: Address; beneficiary: Address;
  operation: EarningsClaimOperation; transactionHash: Hex; blockNumber: string; blockHash: Hex; logIndex: number;
  nativeWei: string; tokenWei: string; outerNonce: string; innerNonce: string; intentHash: Hex;
  pool: null | { positionTokenId: string; principalLiquidityWei: string; poolId: Hex; custodian: Address;
    poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address } };
};
export type ClaimIndexedEvidence = {
  schemaVersion: 1; status: "canonical"; activity: ClaimActivityIdentity; checkpoint: ClaimSettlementPoint;
};
export type ClaimFinalityPolicy = { kind: "unconfigured" } | {
  kind: "synthetic-local-v1"; chainId: 31337; checkpointBlockHash: Hex;
};
export type ClaimSettlementResult = {
  schemaVersion: 1; profile: typeof claimSettlementProfile; chainId: 31337 | 4663;
  scope: "synthetic-local" | "production-read-only"; stage: ClaimSettlementStage; executionEnabled: false;
  intentHash: Hex; reviewHash: Hex;
  transactionHash?: Hex; reason?: string; receiptObserved: boolean; canonicalAt?: ClaimSettlementPoint;
  outerReceiptStatus?: "success" | "reverted"; innerExecution?: "success" | "reverted" | "unproven";
  amounts?: EarningsClaimAmounts; activity?: ClaimActivityIdentity; indexed?: boolean;
  providers: { status: "agree" | "conflict" | "unavailable"; ids: string[] };
  finality: { status: "unverified" | "synthetic-local"; policy: null | "synthetic-local-v1";
    l1Finality: "unverified" | "not-applicable"; productionPolicySupported: false; reason: string };
};

/** No caller-provided boolean, report hash, posted batch or L2 finality tag can
 * establish a production Ethereum finality policy. That policy is not admitted
 * by this version. Local settled results remain explicitly synthetic. */
export function claimFinality(chainId: 31337 | 4663, checkpoint: ClaimSettlementPoint | undefined,
  policy: ClaimFinalityPolicy | undefined): ClaimSettlementResult["finality"] {
  if (chainId === 31337 && policy?.kind === "synthetic-local-v1" && policy.chainId === 31337 && checkpoint
      && /^0x[0-9a-f]{64}$/i.test(policy.checkpointBlockHash) && policy.checkpointBlockHash.toLowerCase() === checkpoint.blockHash.toLowerCase()) {
    return { status: "synthetic-local", policy: "synthetic-local-v1", l1Finality: "not-applicable", productionPolicySupported: false,
      reason: "Explicit isolated-chain policy only; no Ethereum L1 or production finality claim" };
  }
  return { status: "unverified", policy: null, l1Finality: chainId === 4663 ? "unverified" : "not-applicable", productionPolicySupported: false,
    reason: chainId === 4663 ? "No accepted Ethereum L1 execution-finality policy is implemented; finalized batch posting alone is insufficient"
      : "An exact synthetic-local checkpoint policy was not supplied" };
}
