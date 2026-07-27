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
      assessment: "unknown" | "no-common-controls-found" | "review-required";
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
    controlStatus: "not-proven";
  };
  holders: {
    count: number | null;
    poolShareBps: number | null;
    largestNonPoolHolder: {
      address: string;
      shareBps: number;
    } | null;
    creator: string | null;
    creatorShareBps: number | null;
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
