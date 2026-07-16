import type { Address, Hash } from "viem";

export type OriginCoverage = "complete" | "partial" | "unavailable";

export type ExternalOriginClaim = {
  claimKind: "token-created" | "source-listed";
  sourceId: string;
  sourceName: string;
  factory: Address;
  transactionHash: Hash;
  blockNumber: string;
  evidenceHash: Hash;
};

export type TokenOrigin =
  | {
      kind: "rmt-v6";
      state: "rmt-verified";
      factory: Address;
      launchTransactionHash: Hash;
      launchBlock: string;
    }
  | {
      kind: "external";
      state: "attributed";
      sourceId: string;
      sourceName: string;
      claim: ExternalOriginClaim;
      coverage: OriginCoverage;
    }
  | {
      kind: "external";
      state: "disputed";
      claims: ExternalOriginClaim[];
      coverage: OriginCoverage;
    }
  | {
      kind: "external";
      state: "unattributed";
      coverage: "complete";
    }
  | {
      kind: "external";
      state: "unknown";
      coverage: "partial" | "unavailable";
    };

export type MarketVenue =
  | {
      kind: "rmt-curve";
      market: Address;
      execution: "rmt";
    }
  | {
      kind: "dex";
      dexId: string;
      pairAddress: string;
      url: string;
      execution: "read-only";
    }
  | {
      kind: "external-launchpad";
      sourceId: string;
      market?: Address;
      execution: "read-only";
    };
