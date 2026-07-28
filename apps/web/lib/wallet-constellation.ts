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

export type WalletConstellationGraph = {
  schemaVersion: 1;
  token: string;
  pair: string;
  nodes: WalletConstellationNode[];
  edges: WalletConstellationEdge[];
  decision: {
    state: TradeEvidenceState;
    findingCodes: string[];
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
