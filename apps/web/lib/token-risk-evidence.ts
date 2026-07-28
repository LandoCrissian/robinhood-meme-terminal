export type TokenRiskEvidence = {
  token: string;
  pair: string;
  marketVerified: true;
  coverage: "complete" | "partial";
  contract: {
    sourcePublished: boolean | null;
    isProxy: boolean | null;
    bytecodeChanged: boolean | null;
    controls: {
      assessment:
        | "unknown"
        | "no-common-controls-found"
        | "known-launch-controls"
        | "review-required";
      detected: Array<{
        category: "supply" | "transfer" | "fees" | "upgrade" | "access" | "launch";
        functionName: string;
      }>;
      customWriteFunctions: string[];
      administrator: string | null;
      activeLaunchRestrictions: boolean | null;
      restrictionEndBlock: string | null;
      maxTransactionBps: number | null;
      maxWalletBps: number | null;
    };
  };
  liquidity: {
    controlStatus:
      | "not-proven"
      | "creator-controlled"
      | "third-party-wallet"
      | "contract-held"
      | "burn-address";
    evidenceSource: "none" | "launchpad-registry";
    positionManager: string | null;
    positionId: string | null;
    owner: string | null;
    approvedOperator: string | null;
    creatorCanTransfer: boolean | null;
    positionLiquidity: string | null;
  };
  holders: {
    count: number | null;
    poolShareBps: number | null;
    topNonPoolShareBps: number | null;
    topNonPoolHolders: Array<{
      address: string;
      shareBps: number;
      isContract: boolean;
      isScam: boolean;
    }>;
    largestNonPoolHolder: {
      address: string;
      shareBps: number;
    } | null;
    creator: string | null;
    creatorShareBps: number | null;
  };
  sellSimulation: {
    status: "passed" | "blocked" | "unavailable" | "not-run";
    method: "holder-to-pool-transfer";
    holder: string | null;
    amount: string | null;
    returnStyle: "boolean-true" | "no-return-data" | null;
  };
  warnings: string[];
  checkedAt: string;
};

export type TokenRiskEvidenceState =
  | { status: "loading"; evidence?: undefined }
  | { status: "ready"; evidence: TokenRiskEvidence }
  | { status: "unavailable"; evidence?: undefined };

export function formatOwnershipBps(basisPoints: number | null) {
  if (basisPoints === null) return "Unavailable";
  const percentage = basisPoints / 100;
  if (percentage > 0 && percentage < 0.01) return "<0.01%";
  return `${percentage.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
