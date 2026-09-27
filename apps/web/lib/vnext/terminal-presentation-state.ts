import type { VNextDetectedWalletAsset } from "./wallet-assets";
import type { VNextAssetBalanceEvidence, VNextBalanceEvidence } from "./wallet-balance-evidence";

export type VNextWalletReadStatus = "idle" | "loading" | "ready" | "stale" | "error";

export type VNextWalletReadSnapshot = {
  walletAddress: string | null;
  walletKey: string | null;
  assets: VNextDetectedWalletAsset[];
  assetBalanceEvidence: VNextAssetBalanceEvidence;
  nativeBalance?: bigint;
  nativeBalanceEvidence: VNextBalanceEvidence;
  status: VNextWalletReadStatus;
};

export function heldCountIsIndeterminate(status: VNextWalletReadStatus) {
  return status === "idle" || status === "loading" || status === "error";
}

export function heldCountLabel(status: VNextWalletReadStatus, confirmedCount: number): number | "…" {
  return heldCountIsIndeterminate(status) ? "…" : confirmedCount;
}

export type VNextCapitalFlowCardStatus = "loading" | "ready" | "partial" | "unavailable" | "error";

export function capitalFlowStatusLabel(status: VNextCapitalFlowCardStatus) {
  if (status === "loading") return "CHECKING";
  if (status === "ready") return "LIVE";
  if (status === "partial") return "PARTIAL DATA";
  return "DATA UNAVAILABLE";
}
