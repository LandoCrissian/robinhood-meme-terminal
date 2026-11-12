import { parseAbi, type Address } from "viem";

export const growthVaultDeployerAbi = parseAbi([
  "function factory() view returns (address)",
  "function reviewerA() view returns (address)",
  "function reviewerB() view returns (address)",
  "function vaultFor(address creator,bytes32 intentId) view returns (address)",
  "function createVault(bytes32 intentId) returns (address)",
]);

export const growthVaultAbi = parseAbi([
  "function factory() view returns (address)",
  "function creator() view returns (address)",
  "function intentId() view returns (bytes32)",
  "function launchContext() view returns (address token,bytes32 poolId)",
  "function snapshot() view returns ((uint256 nativeCollected,uint256 tokenCollected,uint256 nativePositionFees,uint256 tokenPositionFees,uint256 nativeHeld,uint256 tokenHeld,uint256 nativeAdded,uint256 tokenAdded,uint128 liquidityAdded,uint256 positionTokenId,uint64 lastAttemptAt,uint8 outcome) state)",
]);

export type GrowthAssets = { nativeWei: string; tokenBaseUnits: string };
export type GrowthEvidence =
  | { status: "unknown"; reason: string }
  | {
    status: "verified";
    vault: Address;
    feesAccrued: GrowthAssets;
    feesCollected: GrowthAssets;
    growthPositionFeesCollected: GrowthAssets;
    reserveHeld: GrowthAssets;
    liquidityAdded: GrowthAssets & { units: string };
    positionCustody: { status: "not_minted" } | { status: "locked"; positionTokenId: string; owner: Address };
    lastReinvestment: {
      outcome: "no_attempt" | "added" | "insufficient_assets" | "price_outside_review" | "below_minimum" | "settlement_deferred";
      timestampUnixSeconds: string | null;
    };
  };
