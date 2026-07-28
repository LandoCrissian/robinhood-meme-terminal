import type { TradeEvidenceState } from "./trade-readiness";

export type WalletConstellationNodeRole =
  | "holder"
  | "creator"
  | "pool"
  | "contract"
  | "intermediary"
  | "mint-source"
  | "burn-address";

export type WalletConstellationNode = {
  address: string;
  role: WalletConstellationNodeRole;
  label: string | null;
  holderRank: number | null;
  supplyShareBps: number | null;
  isContract: boolean;
  isFlagged: boolean;
  evidence: string[];
};

export type WalletConstellationEdge = {
  id: string;
  from: string;
  to: string;
  relation: "token-transfer" | "mint" | "burn";
  transferCount: number;
  rawAmount: string;
  firstSeenAt: string;
  lastSeenAt: string;
  transactionHashes: string[];
  confidence: "confirmed";
  interpretation: "transfer-only";
};

export type WalletConstellationSignal = {
  code:
    | "creator-holder-direct-link"
    | "top-holders-direct-link"
    | "repeated-direct-transfer"
    | "provider-flagged-participant";
  severity: "observe" | "review";
  label: string;
  description: string;
  relatedAddresses: string[];
  transactionHashes: string[];
  confidence: "confirmed";
  interpretation: "evidence-only";
};

export type WalletConstellationGraph = {
  schemaVersion: 1;
  token: string;
  pair: string;
  nodes: WalletConstellationNode[];
  edges: WalletConstellationEdge[];
  signals: WalletConstellationSignal[];
  decision: {
    state: TradeEvidenceState;
    findingCodes: string[];
  };
  holderSnapshot: {
    count: number | null;
    poolShareBps: number | null;
    topNonPoolShareBps: number | null;
    largestNonPoolShareBps: number | null;
    creatorShareBps: number | null;
  };
  coverage: {
    holderLimit: number;
    sampledTransfers: number;
    hasMoreTransfers: boolean;
    description: string;
  };
  checkedAt: string;
  limitations: string[];
};
